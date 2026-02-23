#!/usr/bin/env tsx
// Synthesis — Post-Mission Knowledge Merger for Nightcrawler
// Extracts findings from HANDOFF.md + active mission markdown,
// detects contradictions, appends to findings.jsonl + literature-review.md.
// Usage: npx tsx synthesis.ts [--report]
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync, mkdirSync } from "fs";
import { join, resolve, basename } from "path";

interface Finding {
  id: string; claim: string; confidence: "HIGH"|"MEDIUM"|"LOW"|"UNVERIFIED";
  sources: string[]; topic: string; date: string; mission_id: string; contradicts: string[];
}

const BASE = resolve(process.env.HOME || "~", ".nightcrawler");
const HANDOFF = join(BASE, "state", "HANDOFF.md");
const ACTIVE_DIR = join(BASE, "missions", "active");
const RESEARCH = join(BASE, "research");
const LIT_REVIEW = join(RESEARCH, "literature-review.md");
const FINDINGS_JSONL = join(RESEARCH, "findings.jsonl");
const STATE_PATH = join(BASE, "state", "STATE.json");
const today = () => new Date().toISOString().slice(0, 10);

function readSafe(p: string): string { return existsSync(p) ? readFileSync(p, "utf-8") : ""; }

function getMissionId(): string {
  try { return JSON.parse(readSafe(STATE_PATH)).mission_id || "unknown"; } catch { return "unknown"; }
}

function loadFindings(): Finding[] {
  return readSafe(FINDINGS_JSONL).trim().split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean) as Finding[];
}

function nextId(all: Finding[]): string {
  const max = all.reduce((m, f) => Math.max(m, parseInt(f.id.replace("f-",""),10)||0), 0);
  return `f-${String(max + 1).padStart(3, "0")}`;
}

function extractSources(content: string): string[] {
  const sec = content.match(/##\s*Research Sources Found\n([\s\S]*?)(?=\n## |\n# |$)/i);
  const text = sec ? sec[1] : content;
  const urls: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s)\]>]+/g)) {
    const u = m[0].replace(/[.,;:!?]+$/, "");
    if (!urls.includes(u)) urls.push(u);
  }
  return urls;
}

function cleanClaim(t: string): string {
  return t.replace(/\s*\[(HIGH|MEDIUM|LOW|UNVERIFIED)\]/gi,"")
    .replace(/\s*—?\s*Confidence:\s*\w+/gi,"").trim();
}

function parseConf(line: string): Finding["confidence"] {
  const l = line.toLowerCase();
  if (l.includes("[high]") || l.includes("confidence: high")) return "HIGH";
  if (l.includes("[low]") || l.includes("confidence: low")) return "LOW";
  if (l.includes("[unverified]") || l.includes("unverified")) return "UNVERIFIED";
  return "MEDIUM";
}

function extractClaims(content: string, file: string): Array<{claim:string;confidence:Finding["confidence"];sources:string[]}> {
  const claims: Array<{claim:string;confidence:Finding["confidence"];sources:string[]}> = [];
  const srcs = extractSources(content);
  let inFindings = false;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (/^##\s*(Key )?Findings/i.test(t)) { inFindings = true; continue; }
    if (inFindings && /^##\s/.test(t)) { inFindings = false; continue; }
    // "- **Finding:** ..." or "- **Claim:** ..."
    const fm = t.match(/^-\s+\*\*(?:Finding|Claim):\*\*\s*(.+)/i);
    if (fm) { claims.push({claim:cleanClaim(fm[1]),confidence:parseConf(t),sources:srcs.slice(0,3)}); continue; }
    // Bullets under ## Findings
    if (inFindings && /^[-*]\s+/.test(t)) {
      const text = cleanClaim(t.replace(/^[-*]\s+/,"").replace(/\*\*/g,""));
      if (text.length >= 15) claims.push({claim:text,confidence:parseConf(t),sources:srcs.slice(0,3)});
      continue;
    }
    // Numbered: "1. **Bold** — description"
    const nm = t.match(/^\d+\.\s+\*\*(.+?)\*\*\s*(?:—|:|-)\s*(.+)/);
    if (nm) claims.push({claim:cleanClaim(`${nm[1]}: ${nm[2]}`),confidence:parseConf(t),sources:srcs.slice(0,3)});
  }
  return claims;
}

function topicFrom(file: string): string {
  return basename(file, ".md").replace(/^HANDOFF$/i,"mission-output")
    .replace(/^followup-\d{4}-\d{2}-\d{2}-/,"").replace(/-(analysis|sources|output)$/i,"").replace(/-/g," ");
}

function detectContradictions(claim: string, existing: Finding[]): string[] {
  const ids: string[] = [];
  const words = new Set(claim.toLowerCase().replace(/[^a-z0-9\s]/g,"").split(/\s+/).filter(w=>w.length>3));
  const neg = /\bnot\b|\bno\b|\bfail|\bunlike|\bcontrar|\bhowever|\binstead|\brather\b|\bdespite\b|\bunnecessary\b/i;
  for (const f of existing) {
    const ew = new Set(f.claim.toLowerCase().replace(/[^a-z0-9\s]/g,"").split(/\s+/).filter(w=>w.length>3));
    const inter = [...words].filter(w => ew.has(w)).length;
    const union = new Set([...words,...ew]).size;
    const jac = union > 0 ? inter / union : 0;
    if (jac > 0.3 && neg.test(claim) !== neg.test(f.claim)) ids.push(f.id);
    else if (jac > 0.4 && claim !== f.claim) {
      const ne = claim.slice(-40).toLowerCase().split(/\s+/);
      const oe = f.claim.slice(-40).toLowerCase();
      if (ne.filter(w => oe.includes(w)).length < 2) ids.push(f.id);
    }
  }
  return ids;
}

function appendLitReview(mid: string, findings: Finding[], sources: string[]) {
  if (!existsSync(RESEARCH)) mkdirSync(RESEARCH, {recursive:true});
  const hdr = existsSync(LIT_REVIEW) ? "" : "# Literature Review -- Nightcrawler Research\n\n";
  const sec = [
    `\n## Mission: ${mid} (${today()})`, "",
    `### Findings (${findings.length})`,
    ...findings.map(f=>`- [${f.confidence}] ${f.claim}${f.contradicts.length?` *(contradicts: ${f.contradicts.join(", ")})*`:""}`),
    "", `### Sources`, ...sources.map(s=>`- ${s}`), "", "---", "",
  ].join("\n");
  if (hdr) writeFileSync(LIT_REVIEW, hdr+sec); else appendFileSync(LIT_REVIEW, sec);
}

function report() {
  const findings = loadFindings();
  if (!findings.length) { console.log("No findings recorded yet."); return; }
  const byTopic = new Map<string, Finding[]>();
  for (const f of findings) byTopic.set(f.topic, [...(byTopic.get(f.topic)||[]), f]);
  const cCount = findings.filter(f=>f.contradicts.length>0).length;
  const missions = new Set(findings.map(f=>f.mission_id));
  console.log(`\n=== Nightcrawler Research Synthesis Report ===\n`);
  console.log(`Total findings: ${findings.length}  |  High confidence: ${findings.filter(f=>f.confidence==="HIGH").length}`);
  console.log(`Contradictions: ${cCount}  |  Missions: ${missions.size}  |  Topics: ${byTopic.size}\n`);
  for (const [topic, fs] of byTopic) {
    console.log(`--- ${topic} (${fs.length}) ---`);
    for (const f of fs) {
      const flag = f.contradicts.length ? ` [!CONTRADICTS ${f.contradicts.join(",")}]` : "";
      console.log(`  [${f.confidence}] ${f.claim}${flag}`);
    }
    console.log();
  }
}

function main() {
  if (process.argv.includes("--report")) { report(); return; }
  if (!existsSync(RESEARCH)) mkdirSync(RESEARCH, {recursive:true});
  const mid = getMissionId();
  const existing = loadFindings();
  const newF: Finding[] = [];
  const allSrc: string[] = [];

  // 1. HANDOFF.md
  const handoff = readSafe(HANDOFF);
  if (handoff) {
    allSrc.push(...extractSources(handoff));
    for (const c of extractClaims(handoff, "HANDOFF.md")) {
      const id = nextId([...existing,...newF]);
      newF.push({id,claim:c.claim,confidence:c.confidence,sources:c.sources,
        topic:topicFrom("HANDOFF.md"),date:today(),mission_id:mid,
        contradicts:detectContradictions(c.claim,existing)});
    }
  }

  // 2. Active mission markdown
  if (existsSync(ACTIVE_DIR)) {
    for (const file of readdirSync(ACTIVE_DIR).filter(f=>f.endsWith(".md"))) {
      const content = readFileSync(join(ACTIVE_DIR,file),"utf-8");
      const srcs = extractSources(content);
      for (const s of srcs) if (!allSrc.includes(s)) allSrc.push(s);
      for (const c of extractClaims(content, file)) {
        if (newF.some(f=>f.claim===c.claim)) continue;
        const id = nextId([...existing,...newF]);
        newF.push({id,claim:c.claim,confidence:c.confidence,
          sources:c.sources.length?c.sources:srcs.slice(0,3),
          topic:topicFrom(file),date:today(),mission_id:mid,
          contradicts:detectContradictions(c.claim,existing)});
      }
    }
  }

  if (!newF.length && !allSrc.length) { console.log("Nothing to synthesize."); return; }

  // 3. Append findings.jsonl
  for (const f of newF) appendFileSync(FINDINGS_JSONL, JSON.stringify(f)+"\n");

  // 4. Update literature-review.md
  appendLitReview(mid, newF, allSrc);

  // 5. Summary
  const cc = newF.filter(f=>f.contradicts.length>0).length;
  console.log(`\n=== Synthesis Complete ===`);
  console.log(`Mission: ${mid}  |  New findings: ${newF.length}  |  Sources: ${allSrc.length}`);
  console.log(`Contradictions: ${cc}  |  Total findings: ${existing.length+newF.length}`);
  if (cc) { console.log("\nContradictions:"); for (const f of newF.filter(f=>f.contradicts.length)) console.log(`  ${f.id}: "${f.claim.slice(0,60)}..." vs ${f.contradicts.join(", ")}`); }
  console.log(`\nWrote: ${FINDINGS_JSONL}\nWrote: ${LIT_REVIEW}`);
}

main();
