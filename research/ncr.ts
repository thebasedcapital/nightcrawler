#!/usr/bin/env tsx
/**
 * ncr — Nightcrawler Research CLI
 *
 * Usage:
 *   ncr watch                    Start watchtower (one-shot)
 *   ncr watch --continuous       Start watchtower (continuous polling)
 *   ncr research "topic"         Generate + optionally launch a research mission
 *   ncr papers                   List tracked papers
 *   ncr papers --top 5           Show top 5 by relevance
 *   ncr synthesize               Run synthesis on latest mission output
 *   ncr report                   Print synthesis report
 *   ncr status                   Show watchtower + mission status
 */

import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "fs";
import { join, resolve } from "path";

const BASE = resolve(process.env.HOME || "~", ".nightcrawler");
const RESEARCH = join(BASE, "research");
const PAPERS = join(RESEARCH, "papers.jsonl");
const FINDINGS = join(RESEARCH, "findings.jsonl");
const STATE = join(BASE, "state", "STATE.json");
const MISSION = join(BASE, "missions", "active", "MISSION.md");
const WATCHTOWER = join(RESEARCH, "watchtower.ts");
const SYNTHESIS = join(RESEARCH, "synthesis.ts");
const CONFIG = join(RESEARCH, "research-config.json");

function run(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim(); } catch { return ""; }
}

function readSafe(p: string): string { return existsSync(p) ? readFileSync(p, "utf-8") : ""; }

function countLines(p: string): number {
  return readSafe(p).trim().split("\n").filter(Boolean).length;
}

// ── Commands ──────────────────────────────────────────────────────────────

function cmdWatch(args: string[]) {
  const continuous = args.includes("--continuous");
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 ? args[sinceIdx + 1] || "" : "";
  
  const runArgs = [WATCHTOWER];
  if (continuous) runArgs.push("--watch");
  if (since) runArgs.push("--since", since);
  
  console.log(`Watchtower ${continuous ? "(continuous)" : "(one-shot)"}...`);
  const child = spawn("npx", ["tsx", ...runArgs], { stdio: "inherit", cwd: RESEARCH });
  child.on("close", (code) => process.exit(code || 0));
}

function cmdResearch(args: string[]) {
  const topic = args.filter(a => !a.startsWith("--")).join(" ");
  if (!topic) { console.error("Usage: ncr research \"topic description\""); process.exit(1); }
  
  const templatePath = join(BASE, "templates", "MISSION-literature-survey.md");
  if (!existsSync(templatePath)) { console.error("Template missing: MISSION-literature-survey.md"); process.exit(1); }
  
  if (existsSync(MISSION)) {
    console.error("Active mission already exists. Complete or archive it first.");
    console.error(`  ${MISSION}`);
    process.exit(1);
  }

  mkdirSync(join(BASE, "missions", "active"), { recursive: true });
  const template = readFileSync(templatePath, "utf-8");
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  const date = new Date().toISOString().slice(0, 10);
  
  const mission = template
    .replace(/\[Topic\]|\[topic\]/g, topic)
    .replace(/\[date\]/g, date)
    .replace(/\[topic\]/g, slug);
  
  writeFileSync(MISSION, mission);
  console.log(`Mission created: ${MISSION}`);
  console.log(`Topic: ${topic}`);
  console.log(`\nTo run: npx tsx ~/.nightcrawler/nightcrawler.ts`);
  
  if (args.includes("--launch")) {
    console.log("\nLaunching Nightcrawler...");
    const child = spawn("npx", ["tsx", join(BASE, "nightcrawler.ts")], { stdio: "inherit" });
    child.on("close", (code) => process.exit(code || 0));
  }
}

function cmdPapers(args: string[]) {
  if (!existsSync(PAPERS)) { console.log("No papers tracked yet. Run: ncr watch"); return; }
  
  const lines = readSafe(PAPERS).trim().split("\n").filter(Boolean);
  const papers = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  
  const topIdx = args.indexOf("--top");
  const limit = topIdx >= 0 ? parseInt(args[topIdx + 1] || "10") : papers.length;
  
  const sorted = papers.sort((a: any, b: any) => b.relevance_score - a.relevance_score).slice(0, limit);
  
  console.log(`\n${papers.length} papers tracked (showing ${sorted.length}):\n`);
  for (const p of sorted) {
    const flag = p.mission_generated ? " [MISSION]" : "";
    console.log(`  [${p.relevance_score}] ${p.title.slice(0, 70)}${flag}`);
    console.log(`         ${p.source} | ${p.date} | ${p.citations} cites | ${p.keywords_matched.join(", ")}`);
    console.log(`         ${p.url}\n`);
  }
}

function cmdSynthesize() {
  console.log("Running synthesis...\n");
  const child = spawn("npx", ["tsx", SYNTHESIS], { stdio: "inherit", cwd: RESEARCH });
  child.on("close", (code) => process.exit(code || 0));
}

function cmdReport() {
  const child = spawn("npx", ["tsx", SYNTHESIS, "--report"], { stdio: "inherit", cwd: RESEARCH });
  child.on("close", (code) => process.exit(code || 0));
}

function cmdStatus() {
  console.log("\n=== Nightcrawler Research Status ===\n");
  
  // Config
  if (existsSync(CONFIG)) {
    const config = JSON.parse(readSafe(CONFIG));
    console.log(`Topics: ${config.topics.join(", ")}`);
    console.log(`Keywords: ${config.keywords.join(", ")}`);
    console.log(`Auto-launch: ${config.auto_launch}`);
    console.log(`Poll interval: ${config.poll_interval_minutes}m`);
  }
  
  // Papers
  const paperCount = existsSync(PAPERS) ? countLines(PAPERS) : 0;
  console.log(`\nPapers tracked: ${paperCount}`);
  
  // Findings
  const findingCount = existsSync(FINDINGS) ? countLines(FINDINGS) : 0;
  console.log(`Findings synthesized: ${findingCount}`);
  
  // Active mission
  if (existsSync(MISSION)) {
    const mission = readSafe(MISSION);
    const title = mission.match(/^#\s+(.+)/m)?.[1] || "Unknown";
    console.log(`\nActive mission: ${title}`);
    
    if (existsSync(STATE)) {
      try {
        const state = JSON.parse(readSafe(STATE));
        console.log(`  Status: ${state.status}`);
        console.log(`  Episode: ${state.current_episode}`);
        console.log(`  Progress: ${state.progress?.tasks_completed || 0}/${state.progress?.tasks_total || 0} tasks`);
        console.log(`  Budget: $${(state.budget_spent_usd || 0).toFixed(2)}`);
      } catch {}
    }
  } else {
    console.log(`\nNo active mission.`);
  }
  
  // Watchtower log
  const logPath = join(RESEARCH, "watchtower.log");
  if (existsSync(logPath)) {
    const stat = statSync(logPath);
    const age = Math.round((Date.now() - stat.mtimeMs) / 60000);
    console.log(`\nWatchtower last ran: ${age}m ago`);
  } else {
    console.log(`\nWatchtower: never run`);
  }
  
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "watch": cmdWatch(args); break;
  case "research": cmdResearch(args); break;
  case "papers": cmdPapers(args); break;
  case "synthesize": case "synth": cmdSynthesize(); break;
  case "report": cmdReport(); break;
  case "status": cmdStatus(); break;
  default:
    console.log(`
ncr — Nightcrawler Research CLI

Commands:
  watch [--continuous] [--since DATE]  Poll for new papers
  research "topic" [--launch]          Create a research mission
  papers [--top N]                     List tracked papers
  synthesize                           Run synthesis on mission output
  report                               Print findings report
  status                               Show system status
`);
}
