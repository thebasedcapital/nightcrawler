#!/usr/bin/env tsx
/**
 * Synthesis — Post-Mission Knowledge Merger for Nightcrawler Research Toolkit
 *
 * Runs after a research mission completes. Reads output artifacts,
 * merges findings into VaultGraph, detects contradictions, and
 * updates a running literature review.
 *
 * Usage:
 *   npx tsx synthesis.ts                    # Process latest mission output
 *   npx tsx synthesis.ts --dir path/to/dir  # Process specific directory
 *   npx tsx synthesis.ts --review           # Show running literature review
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "fs";
import { join, resolve, basename } from "path";
import { execSync } from "child_process";

// ── Types ──────────────────────────────────────────────────────────────────

interface Finding {
  claim: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";
  sources: string[];
  topic: string;
  date_found: string;
}

interface Contradiction {
  claim_a: string;
  source_a: string;
  claim_b: string;
  source_b: string;
  topic: string;
  date_found: string;
}

interface LitReview {
  last_updated: string;
  total_papers: number;
  total_findings: number;
  total_contradictions: number;
  topics_covered: string[];
  findings: Finding[];
  contradictions: Contradiction[];
  sources: string[];
}

// ── Paths ──────────────────────────────────────────────────────────────────

const BASE = resolve(process.env.HOME || "~", ".nightcrawler");
const RESEARCH_DIR = join(BASE, "research");
const REVIEW_PATH = join(RESEARCH_DIR, "literature-review.json");
const REVIEW_MD_PATH = join(RESEARCH_DIR, "literature-review.md");
const LOG_PATH = join(RESEARCH_DIR, "synthesis.log");

// ── Helpers ────────────────────────────────────────────────────────────────

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

function loadReview(): LitReview {
  if (existsSync(REVIEW_PATH)) {
    return JSON.parse(readFileSync(REVIEW_PATH, "utf-8"));
  }
  return {
    last_updated: now(),
    total_papers: 0,
    total_findings: 0,
    total_contradictions: 0,
    topics_covered: [],
    findings: [],
    contradictions: [],
    sources: [],
  };
}

function saveReview(review: LitReview): void {
  writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2) + "\n");
}

// ── Extraction ─────────────────────────────────────────────────────────────

function extractFindings(content: string, filename: string): Finding[] {
  const findings: Finding[] = [];
  const date = now();

  // Extract from "Key Findings" sections
  const findingsSection = content.match(/## Key Findings\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (findingsSection) {
    const lines = findingsSection[1].split("\n").filter(l => l.match(/^\d+\.|^-\s+\*\*/));
    for (const line of lines) {
      const claim = line.replace(/^\d+\.\s*\*\*|\*\*.*$|^-\s*\*\*|\*\*\s*—.*/g, "").trim();
      if (!claim || claim.length < 10) continue;

      // Detect confidence
      let confidence: Finding["confidence"] = "MEDIUM";
      const lower = line.toLowerCase();
      if (lower.includes("confidence: high") || lower.includes("— high")) confidence = "HIGH";
      else if (lower.includes("confidence: low") || lower.includes("— low")) confidence = "LOW";
      else if (lower.includes("[unverified]")) confidence = "UNVERIFIED";

      findings.push({
        claim,
        confidence,
        sources: [filename],
        topic: extractTopic(filename),
        date_found: date,
      });
    }
  }

  // Extract individual findings marked with confidence levels
  const confidencePatterns = content.matchAll(/\*\*([^*]+)\*\*\s*(?:—|:)\s*([^—\n]+?)(?:\s*—\s*Confidence:\s*(HIGH|MEDIUM|LOW|\[UNVERIFIED\]))?$/gm);
  for (const match of confidencePatterns) {
    const claim = match[1].trim();
    if (claim.length < 10 || findings.some(f => f.claim === claim)) continue;

    findings.push({
      claim,
      confidence: (match[3] as Finding["confidence"]) || "MEDIUM",
      sources: [filename],
      topic: extractTopic(filename),
      date_found: date,
    });
  }

  return findings;
}

function extractSources(content: string): string[] {
  const sources: string[] = [];

  // Extract URLs
  const urls = content.matchAll(/https?:\/\/[^\s\)>\]]+/g);
  for (const match of urls) {
    const url = match[0].replace(/[.,;:!?]$/, "");
    if (!sources.includes(url)) sources.push(url);
  }

  return sources;
}

function extractContradictions(content: string, filename: string): Contradiction[] {
  const contradictions: Contradiction[] = [];

  // Look for "Contradictions" or "Debates" sections
  const section = content.match(/## (?:Contradictions|Debates|Disagreements)[\s\S]*?(?=\n## |\n# |$)/);
  if (!section) return contradictions;

  const items = section[0].split(/\n-\s+/).slice(1);
  for (const item of items) {
    const vsMatch = item.match(/(.+?)\s+vs\.?\s+(.+?)(?::|$)/);
    if (vsMatch) {
      contradictions.push({
        claim_a: vsMatch[1].trim(),
        source_a: filename,
        claim_b: vsMatch[2].trim(),
        source_b: filename,
        topic: extractTopic(filename),
        date_found: now(),
      });
    }
  }

  return contradictions;
}

function extractTopic(filename: string): string {
  return basename(filename, ".md")
    .replace(/^followup-\d{4}-\d{2}-\d{2}-/, "")
    .replace(/-analysis$|-sources$|-integration$/, "")
    .replace(/-/g, " ");
}

// ── Merge Logic ────────────────────────────────────────────────────────────

function mergeFindings(review: LitReview, newFindings: Finding[]): number {
  let added = 0;
  for (const finding of newFindings) {
    // Check for duplicates (same claim, fuzzy match)
    const existing = review.findings.find(f =>
      f.claim.toLowerCase() === finding.claim.toLowerCase() ||
      (f.claim.length > 20 && finding.claim.length > 20 &&
       f.claim.toLowerCase().includes(finding.claim.toLowerCase().slice(0, 30)))
    );

    if (existing) {
      // Merge sources
      for (const src of finding.sources) {
        if (!existing.sources.includes(src)) existing.sources.push(src);
      }
      // Upgrade confidence if new source confirms
      if (existing.sources.length >= 3 && existing.confidence !== "HIGH") {
        existing.confidence = "HIGH";
      } else if (existing.sources.length >= 2 && existing.confidence === "UNVERIFIED") {
        existing.confidence = "LOW";
      }
    } else {
      review.findings.push(finding);
      added++;
    }
  }
  return added;
}

// ── VaultGraph Integration ─────────────────────────────────────────────────

function syncToVault(review: LitReview, vaultPath: string): void {
  if (!vaultPath) return;

  try {
    // Check if vaultgraph binary exists
    execSync("which vaultgraph", { stdio: "pipe" });
  } catch {
    log("VAULT_SKIP | vaultgraph not found");
    return;
  }

  // Write findings as a vault note
  const content = generateReviewMarkdown(review);
  try {
    execSync(
      `vaultgraph write --vault "${vaultPath}" --file "nightcrawler-literature-review" --overwrite`,
      {
        input: content,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    log("VAULT_SYNCED | literature review updated in vault");
  } catch (e: any) {
    log(`VAULT_ERROR | ${e.message}`);
  }
}

// ── Markdown Generation ────────────────────────────────────────────────────

function generateReviewMarkdown(review: LitReview): string {
  const lines: string[] = [
    `# Literature Review — Nightcrawler Research`,
    ``,
    `*Last updated: ${review.last_updated}*`,
    ``,
    `## Summary`,
    `- **Papers tracked:** ${review.total_papers}`,
    `- **Key findings:** ${review.findings.length}`,
    `- **Contradictions detected:** ${review.contradictions.length}`,
    `- **Unique sources:** ${review.sources.length}`,
    `- **Topics covered:** ${review.topics_covered.join(", ")}`,
    ``,
  ];

  // Findings by topic
  const byTopic = new Map<string, Finding[]>();
  for (const f of review.findings) {
    const arr = byTopic.get(f.topic) || [];
    arr.push(f);
    byTopic.set(f.topic, arr);
  }

  lines.push(`## Findings by Topic`);
  for (const [topic, findings] of byTopic) {
    lines.push(``, `### ${topic}`);
    for (const f of findings) {
      const badge = f.confidence === "HIGH" ? "[HIGH]" : f.confidence === "MEDIUM" ? "[MED]" : f.confidence === "LOW" ? "[LOW]" : "[???]";
      lines.push(`- ${badge} ${f.claim}`);
      if (f.sources.length > 1) lines.push(`  *(${f.sources.length} sources)*`);
    }
  }

  // Contradictions
  if (review.contradictions.length > 0) {
    lines.push(``, `## Contradictions & Debates`);
    for (const c of review.contradictions) {
      lines.push(`- **${c.claim_a}** vs **${c.claim_b}** (${c.topic})`);
    }
  }

  // Sources
  lines.push(``, `## All Sources`);
  for (const src of review.sources.slice(0, 50)) {
    lines.push(`- ${src}`);
  }
  if (review.sources.length > 50) {
    lines.push(`- *(${review.sources.length - 50} more...)*`);
  }

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes("--review")) {
    const review = loadReview();
    const md = generateReviewMarkdown(review);
    console.log(md);
    return;
  }

  log("SYNTHESIS_START");

  // Determine which directory to process
  let targetDir = RESEARCH_DIR;
  const dirIdx = args.indexOf("--dir");
  if (dirIdx !== -1 && args[dirIdx + 1]) {
    targetDir = resolve(args[dirIdx + 1]);
  }

  if (!existsSync(targetDir)) {
    log(`FATAL | Directory not found: ${targetDir}`);
    process.exit(1);
  }

  // Find all markdown files in the target directory
  const mdFiles = readdirSync(targetDir)
    .filter(f => f.endsWith(".md") && !f.startsWith("literature-review"))
    .map(f => join(targetDir, f));

  if (mdFiles.length === 0) {
    log("NO_FILES | No markdown files found to synthesize");
    return;
  }

  log(`FILES_FOUND | ${mdFiles.length} markdown files`);

  // Load existing review
  const review = loadReview();

  let totalNewFindings = 0;
  let totalNewSources = 0;
  let totalNewContradictions = 0;

  for (const file of mdFiles) {
    const content = readFileSync(file, "utf-8");
    const filename = basename(file);

    // Extract and merge findings
    const findings = extractFindings(content, filename);
    const added = mergeFindings(review, findings);
    totalNewFindings += added;

    // Extract and merge sources
    const sources = extractSources(content);
    for (const src of sources) {
      if (!review.sources.includes(src)) {
        review.sources.push(src);
        totalNewSources++;
      }
    }

    // Extract contradictions
    const contradictions = extractContradictions(content, filename);
    review.contradictions.push(...contradictions);
    totalNewContradictions += contradictions.length;

    // Track topic
    const topic = extractTopic(filename);
    if (topic && !review.topics_covered.includes(topic)) {
      review.topics_covered.push(topic);
    }

    log(`PROCESSED | ${filename} | findings=${findings.length} sources=${sources.length} contradictions=${contradictions.length}`);
  }

  // Update totals
  review.total_findings = review.findings.length;
  review.total_contradictions = review.contradictions.length;
  review.total_papers = review.sources.filter(s => s.includes("arxiv.org") || s.includes("semanticscholar.org") || s.includes("doi.org")).length;
  review.last_updated = now();

  // Save
  saveReview(review);
  const md = generateReviewMarkdown(review);
  writeFileSync(REVIEW_MD_PATH, md);

  log(`SYNTHESIS_COMPLETE | +${totalNewFindings} findings, +${totalNewSources} sources, +${totalNewContradictions} contradictions`);
  log(`TOTALS | ${review.findings.length} findings, ${review.sources.length} sources, ${review.contradictions.length} contradictions`);

  // Sync to VaultGraph if configured
  const configPath = join(RESEARCH_DIR, "research-config.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.vault_path) {
      syncToVault(review, config.vault_path);
    }
  }

  log("SYNTHESIS_EXIT");
}

main();
