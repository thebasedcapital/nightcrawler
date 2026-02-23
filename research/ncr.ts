#!/usr/bin/env tsx
/**
 * ncr — Nightcrawler Research CLI
 *
 * Unified CLI for the Nightcrawler Research Toolkit.
 *
 * Usage:
 *   ncr watch              Start watchtower (one poll cycle)
 *   ncr watch --daemon     Start watchtower in continuous mode
 *   ncr research "topic"   Generate a research mission from a topic
 *   ncr deepdive "url"     Generate a paper deep-dive mission from a URL
 *   ncr papers             List tracked papers
 *   ncr synthesize         Run synthesis on research output
 *   ncr review             Show running literature review
 *   ncr status             Show watchtower + mission status
 *   ncr launch             Launch Nightcrawler with active mission
 *   ncr templates          List available mission templates
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve, basename } from "path";
import { execSync, spawn } from "child_process";

// ── Paths ──────────────────────────────────────────────────────────────────

const BASE = resolve(process.env.HOME || "~", ".nightcrawler");
const RESEARCH_DIR = join(BASE, "research");
const MISSION_DIR = join(BASE, "missions", "active");
const TEMPLATE_DIR = join(BASE, "templates");
const STATE_DIR = join(BASE, "state");
const CONFIG_PATH = join(RESEARCH_DIR, "research-config.json");
const PAPERS_PATH = join(RESEARCH_DIR, "papers.jsonl");

// ── Helpers ────────────────────────────────────────────────────────────────

function run(cmd: string, opts: Record<string, any> = {}): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30000, stdio: "pipe", ...opts }).trim();
  } catch (e: any) {
    return e.stdout?.trim() || e.message;
  }
}

function ensureDirs(): void {
  for (const dir of [RESEARCH_DIR, MISSION_DIR, STATE_DIR, join(BASE, "logs", "episodes"), join(STATE_DIR, "checkpoints")]) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Commands ───────────────────────────────────────────────────────────────

function cmdWatch(args: string[]): void {
  const daemon = args.includes("--daemon");
  const script = join(RESEARCH_DIR, "watchtower.ts");
  const watchArgs = daemon ? ["--daemon"] : [];
  console.log(`Starting watchtower${daemon ? " (daemon mode)" : ""}...`);
  const proc = spawn("npx", ["tsx", script, ...watchArgs], {
    cwd: RESEARCH_DIR,
    stdio: "inherit",
  });
  proc.on("close", (code) => process.exit(code ?? 0));
}

function cmdResearch(topic: string): void {
  if (!topic) {
    console.error("Usage: ncr research \"topic description\"");
    process.exit(1);
  }

  ensureDirs();

  const date = new Date().toISOString().split("T")[0];
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);

  // Read the literature survey template
  const templatePath = join(TEMPLATE_DIR, "MISSION-literature-survey.md");
  if (!existsSync(templatePath)) {
    console.error("Template not found: MISSION-literature-survey.md");
    process.exit(1);
  }

  let mission = readFileSync(templatePath, "utf-8");
  mission = mission.replace(/\[TOPIC\]/g, topic);
  mission = mission.replace(/\[DATE\]/g, date);
  mission = mission.replace(/\[topic\]/g, slug);

  const missionPath = join(MISSION_DIR, "MISSION.md");
  if (existsSync(missionPath)) {
    console.error(`Active mission already exists at ${missionPath}`);
    console.error("Archive or delete it first, then try again.");
    process.exit(1);
  }

  writeFileSync(missionPath, mission);
  console.log(`Mission generated: ${missionPath}`);
  console.log(`Topic: ${topic}`);
  console.log(`\nTo launch: ncr launch`);
  console.log(`To edit first: $EDITOR ${missionPath}`);
}

function cmdDeepDive(url: string): void {
  if (!url) {
    console.error("Usage: ncr deepdive \"https://arxiv.org/abs/...\"");
    process.exit(1);
  }

  ensureDirs();

  const date = new Date().toISOString().split("T")[0];

  // Try to extract paper info from URL
  let title = "Unknown Paper";
  let arxivId = "";
  const arxivMatch = url.match(/arxiv\.org\/abs\/(\d+\.\d+)/);
  if (arxivMatch) {
    arxivId = arxivMatch[1];
    // Try to fetch title from Semantic Scholar
    try {
      const result = run(`curl -s "https://api.semanticscholar.org/graph/v1/paper/ARXIV:${arxivId}?fields=title"`);
      const data = JSON.parse(result);
      if (data.title) title = data.title;
    } catch {}
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

  const templatePath = join(TEMPLATE_DIR, "MISSION-paper-deepdive.md");
  if (!existsSync(templatePath)) {
    console.error("Template not found: MISSION-paper-deepdive.md");
    process.exit(1);
  }

  let mission = readFileSync(templatePath, "utf-8");
  mission = mission.replace("[PAPER TITLE]", title);
  mission = mission.replace("[Full paper title]", title);
  mission = mission.replace("[Author list]", "[To be determined]");
  mission = mission.replace("[arXiv/DOI link]", url);
  mission = mission.replace("[Date]", date);
  mission = mission.replace("[DATE]", date);
  mission = mission.replace(/\[short-name\]/g, slug);

  const missionPath = join(MISSION_DIR, "MISSION.md");
  if (existsSync(missionPath)) {
    console.error(`Active mission already exists at ${missionPath}`);
    process.exit(1);
  }

  writeFileSync(missionPath, mission);
  console.log(`Deep-dive mission generated: ${missionPath}`);
  console.log(`Paper: ${title}`);
  console.log(`URL: ${url}`);
  console.log(`\nTo launch: ncr launch`);
}

function cmdPapers(): void {
  if (!existsSync(PAPERS_PATH)) {
    console.log("No papers tracked yet. Run 'ncr watch' first.");
    return;
  }

  const lines = readFileSync(PAPERS_PATH, "utf-8").split("\n").filter(Boolean);
  const papers = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  console.log(`\nTracked Papers (${papers.length} total)`);
  console.log("─".repeat(60));

  const sorted = papers.sort((a: any, b: any) => b.relevance_score - a.relevance_score);
  for (const p of sorted.slice(0, 20)) {
    const score = (p.relevance_score * 100).toFixed(0);
    const citations = p.citation_count > 0 ? ` (${p.citation_count} cit.)` : "";
    console.log(`  [${score}%] ${p.title.slice(0, 65)}${citations}`);
    console.log(`       ${p.url}`);
    console.log(`       Keywords: ${p.keywords_matched.join(", ")}`);
    console.log();
  }

  if (papers.length > 20) {
    console.log(`  ... and ${papers.length - 20} more`);
  }
}

function cmdSynthesize(): void {
  const script = join(RESEARCH_DIR, "synthesis.ts");
  const proc = spawn("npx", ["tsx", script], {
    cwd: RESEARCH_DIR,
    stdio: "inherit",
  });
  proc.on("close", (code) => process.exit(code ?? 0));
}

function cmdReview(): void {
  const script = join(RESEARCH_DIR, "synthesis.ts");
  const proc = spawn("npx", ["tsx", script, "--review"], {
    cwd: RESEARCH_DIR,
    stdio: "inherit",
  });
  proc.on("close", (code) => process.exit(code ?? 0));
}

function cmdStatus(): void {
  console.log("\nNightcrawler Research Status");
  console.log("═".repeat(40));

  // Watchtower
  console.log("\n[Watchtower]");
  if (existsSync(PAPERS_PATH)) {
    const lines = readFileSync(PAPERS_PATH, "utf-8").split("\n").filter(Boolean);
    console.log(`  Papers tracked: ${lines.length}`);
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1]);
      console.log(`  Last discovery: ${last.discovered_at}`);
    }
  } else {
    console.log("  No papers tracked yet");
  }

  // Active mission
  console.log("\n[Mission]");
  const missionPath = join(MISSION_DIR, "MISSION.md");
  if (existsSync(missionPath)) {
    const mission = readFileSync(missionPath, "utf-8");
    const title = mission.match(/^# (?:Mission:\s*)?(.+)/m)?.[1] || "Unknown";
    console.log(`  Active: ${title}`);
  } else {
    console.log("  No active mission");
  }

  // State
  const statePath = join(STATE_DIR, "STATE.json");
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      console.log(`  Episode: ${state.current_episode}`);
      console.log(`  Status: ${state.status}`);
      console.log(`  Progress: ${state.progress?.tasks_completed || 0}/${state.progress?.tasks_total || 0} tasks`);
      console.log(`  Budget: $${(state.budget_spent_usd || 0).toFixed(2)} spent`);
    } catch {}
  }

  // Literature review
  console.log("\n[Literature Review]");
  const reviewPath = join(RESEARCH_DIR, "literature-review.json");
  if (existsSync(reviewPath)) {
    try {
      const review = JSON.parse(readFileSync(reviewPath, "utf-8"));
      console.log(`  Findings: ${review.total_findings}`);
      console.log(`  Sources: ${review.sources?.length || 0}`);
      console.log(`  Topics: ${(review.topics_covered || []).join(", ")}`);
      console.log(`  Last updated: ${review.last_updated}`);
    } catch {}
  } else {
    console.log("  No synthesis run yet");
  }

  console.log();
}

function cmdLaunch(): void {
  const missionPath = join(MISSION_DIR, "MISSION.md");
  if (!existsSync(missionPath)) {
    console.error("No active mission. Generate one first:");
    console.error("  ncr research \"your topic\"");
    console.error("  ncr deepdive \"https://arxiv.org/abs/...\"");
    process.exit(1);
  }

  // Update nightcrawler config to use research skill
  const configPath = join(BASE, "config.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    // Nightcrawler will pick up the skill from the skill path
    console.log(`Launching Nightcrawler with research skill...`);
    console.log(`Mission: ${missionPath}`);
    console.log(`Model: ${config.model}`);
    console.log(`Budget: $${config.max_budget_usd}`);
    console.log(`Max episodes: ${config.max_episodes}`);
    console.log();
  }

  const orchestrator = join(BASE, "nightcrawler.ts");
  const proc = spawn("npx", ["tsx", orchestrator], {
    cwd: BASE,
    stdio: "inherit",
    env: (() => {
      const env = { ...process.env, TERM: "dumb" };
      delete (env as any).CLAUDECODE;
      return env;
    })(),
  });
  proc.on("close", (code) => process.exit(code ?? 0));
}

function cmdTemplates(): void {
  console.log("\nAvailable Mission Templates");
  console.log("─".repeat(40));

  if (!existsSync(TEMPLATE_DIR)) {
    console.log("No templates directory found.");
    return;
  }

  const files = readdirSync(TEMPLATE_DIR).filter(f => f.startsWith("MISSION-") && f.endsWith(".md"));
  for (const file of files) {
    const name = file.replace("MISSION-", "").replace(".md", "");
    const content = readFileSync(join(TEMPLATE_DIR, file), "utf-8");
    const firstLine = content.match(/^# (.+)/m)?.[1] || name;
    console.log(`  ${name.padEnd(25)} ${firstLine}`);
  }

  console.log(`\nUsage: ncr research "topic"   (uses literature-survey template)`);
  console.log(`       ncr deepdive "url"     (uses paper-deepdive template)`);
  console.log(`       Or copy a template manually: cp templates/MISSION-*.md missions/active/MISSION.md`);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`
ncr — Nightcrawler Research CLI

Commands:
  watch              Poll arXiv & Semantic Scholar for new papers
  watch --daemon     Run watchtower continuously
  research "topic"   Generate a literature survey mission
  deepdive "url"     Generate a paper deep-dive mission
  papers             List tracked papers
  synthesize         Merge research output into knowledge base
  review             Show running literature review
  status             Show toolkit status
  launch             Launch Nightcrawler with active mission
  templates          List available mission templates
`);
    return;
  }

  ensureDirs();

  switch (cmd) {
    case "watch":
      cmdWatch(args.slice(1));
      break;
    case "research":
      cmdResearch(args.slice(1).join(" "));
      break;
    case "deepdive":
      cmdDeepDive(args[1] || "");
      break;
    case "papers":
      cmdPapers();
      break;
    case "synthesize":
      cmdSynthesize();
      break;
    case "review":
      cmdReview();
      break;
    case "status":
      cmdStatus();
      break;
    case "launch":
      cmdLaunch();
      break;
    case "templates":
      cmdTemplates();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error("Run 'ncr --help' for usage.");
      process.exit(1);
  }
}

main();
