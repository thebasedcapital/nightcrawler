#!/usr/bin/env tsx
/**
 * Watchtower — Paper monitoring for Nightcrawler
 *
 * Polls arXiv RSS + Semantic Scholar for new papers matching configured topics/keywords.
 * Deduplicates via papers.jsonl (by arXiv ID or DOI). Optionally generates MISSION.md.
 *
 * Usage:
 *   npx tsx watchtower.ts                     # one-shot poll
 *   npx tsx watchtower.ts --watch             # continuous polling
 *   npx tsx watchtower.ts --since 2026-02-20  # only papers after date
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

// ── Types & Paths ──────────────────────────────────────────────────────────

interface Config {
  topics: string[]; keywords: string[]; semantic_scholar_api_key: string;
  poll_interval_minutes: number; auto_launch: boolean; min_citation_count: number;
  max_papers_per_poll: number; relevance_threshold: number; vault_path: string;
}
interface PaperRecord {
  id: string; title: string; abstract: string; authors: string[]; date: string;
  source: "arxiv" | "s2"; url: string; citations: number;
  keywords_matched: string[]; relevance_score: number; discovered_at: string;
  mission_generated: boolean;
}

const BASE = resolve(process.env.HOME || "~", ".nightcrawler");
const RESEARCH = join(BASE, "research");
const CONFIG_PATH = join(RESEARCH, "research-config.json");
const PAPERS_PATH = join(RESEARCH, "papers.jsonl");
const LOG_PATH = join(RESEARCH, "watchtower.log");
const TEMPLATE_PATH = join(BASE, "templates", "MISSION-paper-deepdive.md");
const MISSION_DIR = join(BASE, "missions", "active");

// ── Helpers ────────────────────────────────────────────────────────────────

const iso = () => new Date().toISOString();
const dateStr = () => iso().split("T")[0];

function log(msg: string) {
  const line = `${iso()} | ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

function loadConfig(): Config {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function loadSeenIds(): Set<string> {
  const seen = new Set<string>();
  if (!existsSync(PAPERS_PATH)) return seen;
  for (const line of readFileSync(PAPERS_PATH, "utf-8").split("\n").filter(Boolean)) {
    try { seen.add((JSON.parse(line) as PaperRecord).id.toLowerCase()); } catch {}
  }
  return seen;
}

function savePaper(p: PaperRecord) {
  appendFileSync(PAPERS_PATH, JSON.stringify(p) + "\n");
}

function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw.toLowerCase()));
}

function score(title: string, abstract: string, keywords: string[]): { matched: string[]; score: number } {
  const matched = [...new Set(matchKeywords(title + " " + abstract, keywords))];
  return { matched, score: keywords.length > 0 ? matched.length / keywords.length : 0 };
}

// ── arXiv RSS ──────────────────────────────────────────────────────────────

interface RawPaper { id: string; title: string; abstract: string; authors: string[]; url: string; date: string }

async function fetchArxiv(topic: string): Promise<RawPaper[]> {
  try {
    const res = await fetch(`https://rss.arxiv.org/rss/${topic}`);
    if (!res.ok) { log(`ARXIV_ERR | ${topic} | ${res.status}`); return []; }
    return parseRSS(await res.text());
  } catch (e: any) { log(`ARXIV_FETCH_ERR | ${topic} | ${e.message}`); return []; }
}

function parseRSS(xml: string): RawPaper[] {
  const papers: RawPaper[] = [];
  for (const item of xml.split("<item>").slice(1)) {
    const tag = (t: string) => item.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim() || "";
    const link = tag("link");
    const aid = link.match(/(\d{4}\.\d{4,5})/)?.[1];
    if (!aid) continue;
    papers.push({
      id: `arXiv:${aid}`,
      title: tag("title").replace(/\(arXiv:.*?\)/, "").trim(),
      abstract: tag("description"),
      authors: tag("dc:creator").split(",").map(a => a.trim()).filter(Boolean),
      url: link.startsWith("http") ? link : `https://arxiv.org/abs/${aid}`,
      date: tag("pubDate") ? new Date(tag("pubDate")).toISOString().split("T")[0] : dateStr(),
    });
  }
  return papers;
}

// ── arXiv Search API (keyword-based, works any day including weekends) ─

async function searchArxiv(keywords: string[], limit: number): Promise<RawPaper[]> {
  const q = keywords.map(kw => `all:"${kw.replace(/"/g, "")}"`).join("+OR+");
  try {
    const res = await fetch(`http://export.arxiv.org/api/query?search_query=${q}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`);
    if (!res.ok) { log(`ARXIV_SEARCH_ERR | ${res.status}`); return []; }
    const xml = await res.text();
    const papers: RawPaper[] = [];
    for (const entry of xml.split("<entry>").slice(1)) {
      const idFull = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || "";
      const aid = idFull.match(/(\d{4}\.\d{4,5})/)?.[1];
      if (!aid) continue;
      const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() || "";
      const abstract = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim() || "";
      const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() || "";
      const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(m => m[1].trim());
      papers.push({
        id: `arXiv:${aid}`, title, abstract, authors,
        url: `https://arxiv.org/abs/${aid}`,
        date: published ? published.split("T")[0] : dateStr(),
      });
    }
    return papers;
  } catch (e: any) { log(`ARXIV_SEARCH_FETCH_ERR | ${e.message}`); return []; }
}

// ── Semantic Scholar ───────────────────────────────────────────────────────

interface S2Paper extends RawPaper { citations: number }

async function fetchS2(query: string, apiKey: string, since: string, limit: number): Promise<S2Paper[]> {
  const params = new URLSearchParams({
    query,
    fields: "paperId,title,abstract,year,publicationDate,citationCount,authors,externalIds,url,openAccessPdf",
    sort: "publicationDate",
    ...(since ? { publicationDateOrYear: `${since}:` } : {}),
  });
  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search/bulk?${params}`, { headers });
    if (!res.ok) { log(`S2_ERR | ${res.status}`); return []; }
    const data = await res.json() as any;
    return (data.data || []).slice(0, limit).map((p: any) => ({
      id: p.externalIds?.ArXiv ? `arXiv:${p.externalIds.ArXiv}`
        : p.externalIds?.DOI ? `DOI:${p.externalIds.DOI}` : `s2:${p.paperId}`,
      title: p.title || "",
      abstract: p.abstract || "",
      authors: (p.authors || []).map((a: any) => a.name),
      url: p.openAccessPdf?.url || p.url || `https://www.semanticscholar.org/paper/${p.paperId}`,
      date: p.publicationDate || (p.year ? `${p.year}-01-01` : dateStr()),
      citations: p.citationCount || 0,
    }));
  } catch (e: any) { log(`S2_FETCH_ERR | ${e.message}`); return []; }
}

// ── Mission Generator ──────────────────────────────────────────────────────

function generateMission(paper: PaperRecord): boolean {
  const dest = join(MISSION_DIR, "MISSION.md");
  if (existsSync(dest)) { log("MISSION_SKIP | active mission exists"); return false; }
  if (!existsSync(TEMPLATE_PATH)) { log("MISSION_SKIP | template missing"); return false; }

  mkdirSync(MISSION_DIR, { recursive: true });
  const template = readFileSync(TEMPLATE_PATH, "utf-8");
  const out = template
    .replace(/\{\{PAPER_TITLE\}\}|\[PAPER TITLE\]|\[Full paper title\]/g, paper.title)
    .replace(/\{\{PAPER_URL\}\}|\[arXiv\/DOI link\]/g, paper.url)
    .replace(/\{\{PAPER_ABSTRACT\}\}/g, paper.abstract.slice(0, 500))
    .replace(/\{\{PAPER_AUTHORS\}\}|\[Author list\]/g, paper.authors.join(", "))
    .replace(/\[Date\]/g, paper.date)
    .replace(/\[DATE\]/g, dateStr())
    .replace(/\{\{DATE\}\}/g, dateStr());
  writeFileSync(dest, out);
  log(`MISSION_GEN | ${paper.title.slice(0, 60)}`);
  return true;
}

// ── Poll Cycle ─────────────────────────────────────────────────────────────

async function poll(config: Config, since: string): Promise<PaperRecord[]> {
  log("POLL_START");
  const seen = loadSeenIds();
  const found: PaperRecord[] = [];

  const add = (raw: RawPaper, src: "arxiv" | "s2", cites: number) => {
    if (seen.has(raw.id.toLowerCase())) return;
    if (since && raw.date < since) return;
    if (cites < config.min_citation_count) return;
    const { matched, score: s } = score(raw.title, raw.abstract, config.keywords);
    if (matched.length === 0 || s < config.relevance_threshold) return;
    const rec: PaperRecord = {
      id: raw.id, title: raw.title, abstract: raw.abstract, authors: raw.authors,
      date: raw.date, source: src, url: raw.url, citations: cites,
      keywords_matched: matched, relevance_score: Math.round(s * 100) / 100,
      discovered_at: iso(), mission_generated: false,
    };
    found.push(rec); savePaper(rec); seen.add(rec.id.toLowerCase());
    log(`NEW | ${src} | ${rec.relevance_score} | ${rec.title.slice(0, 70)}`);
  };

  // 1. arXiv RSS per topic
  for (const topic of config.topics) {
    log(`ARXIV | ${topic}`);
    for (const p of await fetchArxiv(topic)) add(p, "arxiv", 0);
  }

  // 2. arXiv Search API (keyword-based, works on weekends)
  log(`ARXIV_SEARCH | ${config.keywords.slice(0, 3).join(", ")}`);
  for (const p of await searchArxiv(config.keywords.slice(0, 3), config.max_papers_per_poll)) add(p, "arxiv", 0);

  // 3. Semantic Scholar keyword search
  const q = config.keywords.slice(0, 3).join(" ");
  log(`S2 | "${q}"`);
  await new Promise(r => setTimeout(r, 1100)); // respect 1 req/sec rate limit
  for (const p of await fetchS2(q, config.semantic_scholar_api_key, since, config.max_papers_per_poll)) {
    add(p, "s2", p.citations);
  }

  log(`POLL_END | ${found.length} new`);

  // Auto-generate mission for top-scoring paper
  if (found.length > 0 && config.auto_launch) {
    const top = found.sort((a, b) => b.relevance_score - a.relevance_score)[0];
    if (generateMission(top)) top.mission_generated = true;
  }

  return found;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes("--watch");
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 ? (args[sinceIdx + 1] || "") : "";

  const config = loadConfig();
  log("=".repeat(40));
  log(`START | watch=${watch} since=${since || "all"}`);
  log(`TOPICS | ${config.topics.join(", ")}`);
  log(`KEYWORDS | ${config.keywords.join(", ")}`);

  do {
    const papers = await poll(config, since);
    if (!watch) {
      if (papers.length === 0) console.log("\nNo new papers found.");
      else {
        console.log(`\n${papers.length} new paper(s):\n`);
        for (const p of papers.sort((a, b) => b.relevance_score - a.relevance_score)) {
          console.log(`  [${p.relevance_score}] ${p.title.slice(0, 75)}`);
          console.log(`         ${p.url}  (${p.keywords_matched.join(", ")})\n`);
        }
      }
    }
    if (watch) {
      log(`SLEEP | ${config.poll_interval_minutes}m`);
      await new Promise(r => setTimeout(r, config.poll_interval_minutes * 60_000));
    }
  } while (watch);

  log("EXIT");
}

main().catch(e => { log(`FATAL | ${e}`); process.exit(1); });
