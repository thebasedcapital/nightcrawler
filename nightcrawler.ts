#!/usr/bin/env tsx
import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, appendFileSync, statSync } from "fs";
import { join, resolve } from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface Config {
  max_duration_hours: number;
  max_episodes: number;
  max_budget_usd: number;
  budget_per_episode_usd: number;
  episode_timeout_seconds: number;
  model: string;
  error_threshold: number;
  diminishing_returns_lookback: number;
  cooldown_between_episodes_seconds: number;
  bootstrap_command?: string;
  moshi_token: string;
  notifications: {
    on_start: boolean;
    on_episode_complete: boolean;
    on_error: boolean;
    on_completion: boolean;
  };
}

interface State {
  version: string;
  mission_id: string;
  started_at: string;
  current_episode: number;
  total_episodes_estimate: number;
  status: string;
  budget_spent_usd: number;
  progress: {
    tasks_total: number;
    tasks_completed: number;
    tasks_in_progress: number;
    tasks_blocked: number;
    artifacts_created: string[];
  };
  errors: {
    total: number;
    recovered: number;
    fatal: number;
    last_error: string | null;
    last_error_at: string | null;
  };
  episode_history: Array<{
    episode: number;
    started_at: string;
    ended_at: string;
    exit_code: number;
    tasks_completed_this_episode: number;
  }>;
  termination_check: {
    should_continue: boolean;
    reason: string | null;
  };
}

// ── Paths ──────────────────────────────────────────────────────────────────

const BASE = resolve(process.env.HOME || "~", ".nightcrawler");
const STATE_PATH = join(BASE, "state", "STATE.json");
const HANDOFF_PATH = join(BASE, "state", "HANDOFF.md");
const PROGRESS_PATH = join(BASE, "state", "PROGRESS.jsonl");
const MISSION_PATH = join(BASE, "missions", "active", "MISSION.md");
const CONFIG_PATH = join(BASE, "config.json");
const SKILL_PATH = join(BASE, "skills", "nightcrawler-episode.md");
const LOG_PATH = join(BASE, "logs", "orchestrator.log");
const STOP_FLAG = join(BASE, "state", "STOP");

// ── Helpers ────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");
const CLAUDE_BIN = resolve(process.env.HOME || "~", ".local", "bin", "claude");

function now(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  const line = `${now()} | ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_PATH, line + "\n");
  } catch {}
}

function logProgress(entry: Record<string, unknown>): void {
  try {
    appendFileSync(PROGRESS_PATH, JSON.stringify({ _timestamp: now(), ...entry }) + "\n");
  } catch {}
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function readText(path: string): string {
  return readFileSync(path, "utf-8");
}

function fileExists(path: string): boolean {
  return existsSync(path);
}

async function notifyMoshi(config: Config, message: string): Promise<void> {
  if (!config.moshi_token) return;
  try {
    const body = JSON.stringify({ token: config.moshi_token, message });
    const proc = spawn("curl", [
      "-s", "-X", "POST",
      "https://api.getmoshi.app/api/webhook",
      "-H", "Content-Type: application/json",
      "-d", body,
    ]);
    await new Promise<void>((resolve) => proc.on("close", () => resolve()));
  } catch (e) {
    log(`NOTIFY_FAILED | ${e}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── State Management ───────────────────────────────────────────────────────

function initState(config: Config): State {
  if (fileExists(STATE_PATH)) {
    log("STATE_LOADED | Resuming existing mission");
    return readJson<State>(STATE_PATH);
  }

  if (!fileExists(MISSION_PATH)) {
    log("FATAL | No mission file at " + MISSION_PATH);
    process.exit(1);
  }

  const mission = readText(MISSION_PATH);
  // Try to extract mission ID from frontmatter or first heading
  const idMatch = mission.match(/mission.id:\s*(.+)/i) || mission.match(/^#\s+(?:Mission:\s*)?(.+)/m);
  const missionId = idMatch?.[1]?.trim().toLowerCase().replace(/\s+/g, "-") || "unnamed-mission";

  // Try to count tasks (lines matching "- [ ]")
  const taskCount = (mission.match(/^[\s]*-\s*\[[\s]\]/gm) || []).length;

  const state: State = {
    version: "1.0.0",
    mission_id: missionId,
    started_at: now(),
    current_episode: 0,
    total_episodes_estimate: Math.max(taskCount * 2, 6),
    status: "STARTING",
    budget_spent_usd: 0,
    progress: {
      tasks_total: taskCount,
      tasks_completed: 0,
      tasks_in_progress: 0,
      tasks_blocked: 0,
      artifacts_created: [],
    },
    errors: { total: 0, recovered: 0, fatal: 0, last_error: null, last_error_at: null },
    episode_history: [],
    termination_check: { should_continue: true, reason: null },
  };

  writeJson(STATE_PATH, state);

  // Auto-generate tasks.json from MISSION.md checkboxes
  const tasksJsonPath = join(BASE, "state", "tasks.json");
  if (!fileExists(tasksJsonPath)) {
    const taskLines = mission.match(/^[\s]*-\s*\[\s*\]\s*(.+)/gm) || [];
    if (taskLines.length > 0) {
      const tasks = taskLines.map((line, i) => {
        const desc = line.replace(/^[\s]*-\s*\[\s*\]\s*/, "").trim();
        return { id: i + 1, description: desc, passes: false };
      });
      writeJson(tasksJsonPath, tasks);
      log(`TASKS_JSON_CREATED | ${tasks.length} tasks extracted from MISSION.md`);
    }
  }

  log(`STATE_INITIALIZED | mission=${missionId} tasks=${taskCount}`);
  logProgress({ event: "MISSION_START", mission_id: missionId, tasks: taskCount });
  return state;
}

// ── Termination Logic ──────────────────────────────────────────────────────

function shouldContinue(state: State, config: Config): { cont: boolean; reason: string | null } {
  // Human stop flag
  if (fileExists(STOP_FLAG)) {
    return { cont: false, reason: "human_stop_flag" };
  }

  // Agent said stop
  if (!state.termination_check.should_continue) {
    return { cont: false, reason: state.termination_check.reason || "agent_terminated" };
  }

  // Episode limit
  if (state.current_episode >= config.max_episodes) {
    return { cont: false, reason: "episode_limit" };
  }

  // Duration limit
  const started = new Date(state.started_at).getTime();
  const elapsed_hours = (Date.now() - started) / (1000 * 60 * 60);
  if (elapsed_hours >= config.max_duration_hours) {
    return { cont: false, reason: "duration_limit" };
  }

  // Budget limit
  if (state.budget_spent_usd >= config.max_budget_usd) {
    return { cont: false, reason: "budget_limit" };
  }

  // Error threshold
  if (state.errors.total >= config.error_threshold) {
    return { cont: false, reason: "error_threshold" };
  }

  // Fatal error
  if (state.errors.fatal > 0) {
    return { cont: false, reason: "fatal_error" };
  }

  // Diminishing returns: check last N episodes
  const lookback = config.diminishing_returns_lookback;
  if (state.episode_history.length >= lookback) {
    const recent = state.episode_history.slice(-lookback);
    const avgCompleted = recent.reduce((s, e) => s + e.tasks_completed_this_episode, 0) / lookback;
    if (avgCompleted < 0.5) {
      return { cont: false, reason: "diminishing_returns" };
    }
  }

  // Mission complete
  if (state.progress.tasks_total > 0 && state.progress.tasks_completed >= state.progress.tasks_total) {
    return { cont: false, reason: "mission_complete" };
  }

  return { cont: true, reason: null };
}

// ── Episode Prompt Builder ─────────────────────────────────────────────────

function buildEpisodePrompt(state: State, episodeNum: number): string {
  const mission = readText(MISSION_PATH);
  const skill = fileExists(SKILL_PATH) ? readText(SKILL_PATH) : "";
  const handoff = fileExists(HANDOFF_PATH) ? readText(HANDOFF_PATH) : null;

  // Get git context for verification (if in a git repo)
  let gitContext = "";
  try {
    const { execSync } = require("child_process");
    const diff = execSync("git diff --stat HEAD~1 2>/dev/null || echo ''", {
      encoding: "utf-8", timeout: 5000,
    }).trim();
    const gitLog = execSync("git log --oneline -10 2>/dev/null || echo ''", {
      encoding: "utf-8", timeout: 5000,
    }).trim();
    const parts_git: string[] = [];
    if (gitLog) parts_git.push(`### Recent Commits\n\`\`\`\n${gitLog}\n\`\`\``);
    if (diff) parts_git.push(`### Diff Since Last Commit\n\`\`\`\n${diff}\n\`\`\``);
    if (parts_git.length) gitContext = `\n## Git Context\n\n${parts_git.join("\n\n")}\n`;
  } catch {}

  // Load tasks.json if it exists (immutable task tracking — agent can only flip passes)
  const tasksJsonPath = join(BASE, "state", "tasks.json");
  let tasksJson = "";
  if (fileExists(tasksJsonPath)) {
    tasksJson = `\n## Task Tracker (tasks.json)\n\nThis file is at \`~/.nightcrawler/state/tasks.json\`. You may ONLY change the \`passes\` field from \`false\` to \`true\`. Do NOT delete, reorder, or rewrite tasks.\n\n\`\`\`json\n${readText(tasksJsonPath)}\n\`\`\`\n`;
  }

  const parts: string[] = [];

  // Skill instructions
  if (skill) parts.push(skill);

  // Episode header
  parts.push(`\n---\n\n# Episode ${episodeNum} of Autonomous Mission\n`);
  parts.push(`**Mission ID:** ${state.mission_id}`);
  parts.push(`**Started:** ${state.started_at}`);
  parts.push(`**Budget remaining:** $${(state.budget_spent_usd).toFixed(2)} spent of $${readJson<Config>(CONFIG_PATH).max_budget_usd} max`);
  parts.push(`**Progress:** ${state.progress.tasks_completed}/${state.progress.tasks_total} tasks complete\n`);

  // Mission
  parts.push(`## Mission\n\n${mission}\n`);

  // State
  parts.push(`## Current State\n\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`);

  // Handoff
  if (handoff && episodeNum > 1) {
    parts.push(`## Handoff from Episode ${episodeNum - 1}\n\n${handoff}\n`);
  } else {
    parts.push(`## First Episode\n\nThis is Episode 1. No prior work exists. Start from the beginning.\n`);
  }

  // Git context (log + diff)
  if (gitContext) parts.push(gitContext);

  // JSON task tracker
  if (tasksJson) parts.push(tasksJson);

  // Session opening ritual (Anthropic pattern)
  parts.push(`## Session Opening Ritual\n`);
  parts.push(`Before doing ANY work, execute these steps in order:`);
  parts.push(`1. Read \`~/.nightcrawler/state/STATE.json\` — understand your position`);
  parts.push(`2. Read \`~/.nightcrawler/state/HANDOFF.md\` (if exists) — understand previous work`);
  parts.push(`3. Run \`git log --oneline -5\` — verify what actually changed vs what handoff claims`);
  parts.push(`4. If a bootstrap command exists, run it to verify the environment works`);
  parts.push(`5. Pick the highest-priority incomplete task and begin\n`);

  // End-of-episode requirements
  parts.push(`## End-of-Episode Requirements\n`);
  parts.push(`Before you finish, you MUST:`);
  parts.push(`1. Write \`~/.nightcrawler/state/HANDOFF.md\` following the template in your skill instructions`);
  parts.push(`2. Update \`~/.nightcrawler/state/STATE.json\` — increment current_episode to ${episodeNum}, update progress counts, set status to "EPISODE_COMPLETE"`);
  parts.push(`3. If \`~/.nightcrawler/state/tasks.json\` exists, flip \`passes\` to \`true\` for completed tasks (do NOT modify anything else in the file)`);
  parts.push(`4. If ALL tasks are done: set termination_check.should_continue to false and reason to "mission_complete"`);
  parts.push(`\nDo NOT ask any questions. Work autonomously. Begin now.`);

  return parts.join("\n");
}

// ── Episode Runner ─────────────────────────────────────────────────────────

function runEpisode(prompt: string, config: Config, episodeNum: number): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const episodeLogPath = join(BASE, "logs", "episodes", `episode-${String(episodeNum).padStart(3, "0")}.log`);
    let output = "";

    if (DRY_RUN) {
      log(`DRY_RUN | Would run claude -p with ${prompt.length} char prompt`);
      // Write prompt to log for inspection
      writeFileSync(episodeLogPath, `[DRY RUN] Prompt:\n\n${prompt}\n`);
      resolve({ exitCode: 0, output: "[dry run]" });
      return;
    }

    const args = [
      "-p",
      "--dangerously-skip-permissions",
      "--model", config.model,
      "--max-budget-usd", String(config.budget_per_episode_usd),
      "--output-format", "text",
      prompt,
    ];

    log(`EPISODE_SPAWN | claude args: -p --model ${config.model} --max-budget-usd ${config.budget_per_episode_usd}`);

    const proc = spawn(CLAUDE_BIN, args, {
      cwd: process.env.HOME,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: config.episode_timeout_seconds * 1000,
      env: (() => {
        const env = { ...process.env, TERM: "dumb" };
        delete env.CLAUDECODE;
        return env;
      })(),
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      try { appendFileSync(episodeLogPath, text); } catch {}
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      try { appendFileSync(episodeLogPath, `[stderr] ${text}`); } catch {}
    });

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, output });
    });

    proc.on("error", (err) => {
      log(`EPISODE_PROCESS_ERROR | ${err.message}`);
      resolve({ exitCode: 1, output: `Process error: ${err.message}` });
    });
  });
}

// ── Main Loop ──────────────────────────────────────────────────────────────

const LOCK_PATH = join(BASE, "state", "LOCK");

function acquireLock(): boolean {
  if (fileExists(LOCK_PATH)) {
    // Check if PID is still alive
    try {
      const pid = parseInt(readText(LOCK_PATH).trim());
      process.kill(pid, 0); // Signal 0 = check if alive
      return false; // Still running
    } catch {
      // Process dead, stale lock
      log("STALE_LOCK | Removing stale lockfile");
    }
  }
  writeFileSync(LOCK_PATH, String(process.pid));
  return true;
}

function releaseLock(): void {
  try { if (fileExists(LOCK_PATH)) { const { unlinkSync } = require("fs"); unlinkSync(LOCK_PATH); } } catch {}
}

async function main(): Promise<void> {
  log("========================================");
  log("NIGHTCRAWLER_START");
  log(`DRY_RUN=${DRY_RUN}`);

  if (!acquireLock()) {
    log("ALREADY_RUNNING | Another instance holds the lock. Exiting.");
    process.exit(0);
  }
  process.on("exit", releaseLock);
  process.on("SIGTERM", () => { releaseLock(); process.exit(0); });
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });

  const config = readJson<Config>(CONFIG_PATH);
  let state = initState(config);

  if (config.notifications.on_start) {
    await notifyMoshi(config, `Nightcrawler starting: ${state.mission_id} (${state.progress.tasks_total} tasks)`);
  }

  // Main episode loop
  while (true) {
    // Check termination BEFORE starting episode
    const { cont, reason } = shouldContinue(state, config);
    if (!cont) {
      log(`TERMINATION | reason=${reason}`);
      state.status = reason === "mission_complete" ? "COMPLETED" : "TERMINATED";
      state.termination_check = { should_continue: false, reason };
      writeJson(STATE_PATH, state);
      logProgress({ event: "MISSION_END", reason, status: state.status });

      if (config.notifications.on_completion) {
        const summary = `${state.status}: ${reason} | ${state.progress.tasks_completed}/${state.progress.tasks_total} tasks | ${state.current_episode} episodes | $${state.budget_spent_usd.toFixed(2)} spent`;
        await notifyMoshi(config, `Nightcrawler ${summary}`);
      }

      // Write completion report
      const report = [
        `# Nightcrawler Completion Report`,
        ``,
        `**Mission:** ${state.mission_id}`,
        `**Status:** ${state.status}`,
        `**Reason:** ${reason}`,
        `**Started:** ${state.started_at}`,
        `**Ended:** ${now()}`,
        `**Episodes:** ${state.current_episode}`,
        `**Budget:** $${state.budget_spent_usd.toFixed(2)} of $${config.max_budget_usd}`,
        `**Tasks:** ${state.progress.tasks_completed}/${state.progress.tasks_total} completed`,
        ``,
        `## Episode History`,
        ``,
        ...state.episode_history.map(
          (e) => `- Episode ${e.episode}: exit=${e.exit_code}, tasks_completed=${e.tasks_completed_this_episode}, duration=${e.ended_at}`
        ),
        ``,
        `## Errors`,
        `- Total: ${state.errors.total}`,
        `- Recovered: ${state.errors.recovered}`,
        `- Fatal: ${state.errors.fatal}`,
        state.errors.last_error ? `- Last: ${state.errors.last_error}` : "",
        ``,
        `## Final Handoff`,
        ``,
        fileExists(HANDOFF_PATH) ? readText(HANDOFF_PATH) : "(no handoff written)",
      ].join("\n");

      writeFileSync(join(BASE, "state", "COMPLETION_REPORT.md"), report);
      log("COMPLETION_REPORT_WRITTEN");
      break;
    }

    // Prepare episode
    const episodeNum = state.current_episode + 1;
    const episodeStartedAt = now();
    log(`EPISODE_START | episode=${episodeNum}`);
    logProgress({ event: "EPISODE_START", episode: episodeNum });

    state.current_episode = episodeNum;
    state.status = "EPISODE_RUNNING";
    writeJson(STATE_PATH, state);

    // Run bootstrap command if configured
    if (config.bootstrap_command) {
      try {
        const { execSync } = require("child_process");
        execSync(config.bootstrap_command, { encoding: "utf-8", timeout: 30000, stdio: "pipe" });
        log(`BOOTSTRAP | ran: ${config.bootstrap_command}`);
      } catch (e: any) {
        log(`BOOTSTRAP_FAILED | ${e.message}`);
      }
    }

    // Build prompt and run
    const prompt = buildEpisodePrompt(state, episodeNum);
    const { exitCode, output } = await runEpisode(prompt, config, episodeNum);

    const episodeEndedAt = now();
    log(`EPISODE_END | episode=${episodeNum} exit=${exitCode} output_len=${output.length}`);
    logProgress({ event: "EPISODE_END", episode: episodeNum, exit_code: exitCode });

    // Re-read state (agent may have updated it), but preserve our tracking fields
    const previousHistory = [...state.episode_history];
    const previousBudget = state.budget_spent_usd;
    const previousErrors = { ...state.errors };
    if (fileExists(STATE_PATH)) {
      try {
        const agentState = readJson<State>(STATE_PATH);
        // Take agent's progress updates but keep our tracking
        state.progress = agentState.progress;
        state.termination_check = agentState.termination_check;
        // Agent may have set status to EPISODE_COMPLETE or similar
        if (agentState.status === "EPISODE_COMPLETE" || agentState.status === "COMPLETED") {
          state.status = agentState.status;
        }
      } catch (e) {
        log(`STATE_PARSE_ERROR | ${e} — using in-memory state`);
      }
    }
    state.episode_history = previousHistory;
    state.budget_spent_usd = previousBudget;
    state.errors = previousErrors;

    // Track episode in history
    const prevCompleted = state.episode_history.length > 0
      ? state.episode_history.reduce((s, e) => s + e.tasks_completed_this_episode, 0)
      : 0;
    const tasksThisEpisode = Math.max(0, state.progress.tasks_completed - prevCompleted);

    state.episode_history.push({
      episode: episodeNum,
      started_at: episodeStartedAt,
      ended_at: episodeEndedAt,
      exit_code: exitCode,
      tasks_completed_this_episode: tasksThisEpisode,
    });

    // Handle errors
    if (exitCode !== 0) {
      state.errors.total++;
      state.errors.last_error = `Episode ${episodeNum} exited with code ${exitCode}`;
      state.errors.last_error_at = episodeEndedAt;
      log(`EPISODE_ERROR | episode=${episodeNum} code=${exitCode}`);
      logProgress({ event: "ERROR", episode: episodeNum, exit_code: exitCode });

      if (config.notifications.on_error) {
        await notifyMoshi(config, `Nightcrawler error: Episode ${episodeNum} exited ${exitCode} (${state.errors.total}/${config.error_threshold} errors)`);
      }

      // Check if handoff exists — if not, the episode crashed before writing state
      if (!fileExists(HANDOFF_PATH) && episodeNum > 1) {
        log("CRASH_RECOVERY | No handoff found — next episode starts from last checkpoint");
        state.errors.recovered++;
      }
    }

    // Checkpoint
    const checkpointPath = join(BASE, "state", "checkpoints", `episode-${String(episodeNum).padStart(3, "0")}.json`);
    writeJson(checkpointPath, state);

    // Save state
    state.status = "EPISODE_COMPLETE";
    writeJson(STATE_PATH, state);

    // Cooldown between episodes
    if (config.cooldown_between_episodes_seconds > 0) {
      log(`COOLDOWN | ${config.cooldown_between_episodes_seconds}s`);
      await sleep(config.cooldown_between_episodes_seconds * 1000);
    }
  }

  log("NIGHTCRAWLER_EXIT");
}

main().catch((e) => {
  log(`FATAL | ${e}`);
  process.exit(1);
});
