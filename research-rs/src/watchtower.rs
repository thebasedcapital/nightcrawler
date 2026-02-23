use crate::config::{self, ResearchConfig};
use crate::paper::{self, Paper};
use chrono::Utc;
use regex::Regex;
use std::collections::HashSet;
use std::path::PathBuf;

fn papers_path() -> PathBuf { config::research_dir().join("papers.jsonl") }
fn log_path() -> PathBuf { config::research_dir().join("watchtower.log") }

fn log(msg: &str) {
    let line = format!("{} | {}", Utc::now().to_rfc3339(), msg);
    eprintln!("{}", line);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path()) {
        use std::io::Write;
        let _ = writeln!(f, "{}", line);
    }
}

// ── arXiv Search API ───────────────────────────────────────────────────

async fn search_arxiv(keywords: &[String], max_results: usize) -> Vec<RawPaper> {
    let query = keywords.iter()
        .take(3)
        .map(|kw| format!("all:\"{}\"", kw.replace('"', "")))
        .collect::<Vec<_>>()
        .join("+OR+");

    let url = format!(
        "http://export.arxiv.org/api/query?search_query={}&max_results={}&sortBy=submittedDate&sortOrder=descending",
        query, max_results
    );

    log(&format!("ARXIV_SEARCH | {}", &keywords[..3.min(keywords.len())].join(", ")));

    let body = match reqwest::get(&url).await {
        Ok(resp) => match resp.text().await {
            Ok(t) => t,
            Err(e) => { log(&format!("ARXIV_READ_ERROR | {}", e)); return vec![]; }
        },
        Err(e) => { log(&format!("ARXIV_FETCH_ERROR | {}", e)); return vec![]; }
    };

    parse_arxiv_atom(&body)
}

struct RawPaper {
    id: String,
    title: String,
    abstract_text: String,
    authors: Vec<String>,
    url: String,
    published: String,
}

fn parse_arxiv_atom(xml: &str) -> Vec<RawPaper> {
    let mut papers = Vec::new();
    let id_re = Regex::new(r"(\d+\.\d+)").unwrap();

    for entry in xml.split("<entry>").skip(1) {
        let id_full = extract_tag(entry, "id");
        let arxiv_id = match id_re.find(&id_full) {
            Some(m) => m.as_str().to_string(),
            None => continue,
        };

        let title = extract_tag(entry, "title")
            .split_whitespace().collect::<Vec<_>>().join(" ");
        let summary = extract_tag(entry, "summary")
            .split_whitespace().collect::<Vec<_>>().join(" ");
        let published = extract_tag(entry, "published");

        // Extract authors
        let author_re = Regex::new(r"<author>\s*<name>([\s\S]*?)</name>").unwrap();
        let authors: Vec<String> = author_re.captures_iter(entry)
            .map(|c| c[1].trim().to_string())
            .collect();

        papers.push(RawPaper {
            id: format!("arxiv:{}", arxiv_id),
            title,
            abstract_text: summary,
            authors,
            url: format!("https://arxiv.org/abs/{}", arxiv_id),
            published,
        });
    }

    papers
}

fn extract_tag(xml: &str, tag: &str) -> String {
    let pattern = format!("<{}>((?s).*?)</{}>", tag, tag);
    Regex::new(&pattern).ok()
        .and_then(|re| re.captures(xml))
        .map(|c| c[1].trim().to_string())
        .unwrap_or_default()
}

// ── arXiv RSS ──────────────────────────────────────────────────────────

async fn fetch_arxiv_rss(topic: &str) -> Vec<RawPaper> {
    let url = format!("https://rss.arxiv.org/rss/{}", topic);
    log(&format!("ARXIV_RSS | {}", topic));

    let body = match reqwest::get(&url).await {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(t) => t,
            Err(_) => return vec![],
        },
        _ => return vec![],
    };

    let id_re = Regex::new(r"(\d+\.\d+)").unwrap();
    let mut papers = Vec::new();

    for item in body.split("<item>").skip(1) {
        let title = extract_tag(item, "title")
            .replace(|c: char| c == '\n' || c == '\r', " ")
            .trim().to_string();
        let link = extract_tag(item, "link");
        let description = extract_tag(item, "description");
        // Strip HTML tags from description
        let desc_clean = Regex::new(r"<[^>]+>").unwrap()
            .replace_all(&description, "").trim().to_string();

        let arxiv_id = match id_re.find(&link) {
            Some(m) => m.as_str().to_string(),
            None => continue,
        };

        let creator = extract_tag(item, "dc:creator");
        let authors: Vec<String> = creator.split(',').map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect();

        papers.push(RawPaper {
            id: format!("arxiv:{}", arxiv_id),
            title,
            abstract_text: desc_clean,
            authors,
            url: if link.starts_with("http") { link } else { format!("https://arxiv.org/abs/{}", arxiv_id) },
            published: Utc::now().to_rfc3339(),
        });
    }

    papers
}

// ── Semantic Scholar ───────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct S2Response {
    data: Option<Vec<S2Paper>>,
}

#[derive(serde::Deserialize)]
struct S2Paper {
    #[serde(rename = "paperId")]
    paper_id: String,
    title: Option<String>,
    r#abstract: Option<String>,
    url: Option<String>,
    year: Option<i32>,
    #[serde(rename = "citationCount")]
    citation_count: Option<u32>,
    #[serde(rename = "publicationDate")]
    publication_date: Option<String>,
    #[serde(rename = "externalIds")]
    external_ids: Option<S2ExternalIds>,
    authors: Option<Vec<S2Author>>,
}

#[derive(serde::Deserialize)]
struct S2ExternalIds {
    #[serde(rename = "ArXiv")]
    arxiv: Option<String>,
}

#[derive(serde::Deserialize)]
struct S2Author {
    name: Option<String>,
}

async fn search_semantic_scholar(query: &str, api_key: &str, limit: usize) -> Vec<RawPaper> {
    let url = format!(
        "https://api.semanticscholar.org/graph/v1/paper/search?query={}&limit={}&fields=title,abstract,authors,url,year,citationCount,externalIds,publicationDate",
        urlencoding(query), limit
    );

    log(&format!("S2_SEARCH | \"{}\"", query));

    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("x-api-key", api_key);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => { log(&format!("S2_FETCH_ERROR | {}", e)); return vec![]; }
    };

    if !resp.status().is_success() {
        log(&format!("S2_API_ERROR | {} | {}", resp.status().as_u16(), query));
        return vec![];
    }

    let data: S2Response = match resp.json().await {
        Ok(d) => d,
        Err(e) => { log(&format!("S2_PARSE_ERROR | {}", e)); return vec![]; }
    };

    data.data.unwrap_or_default().into_iter().map(|p| {
        let id = if let Some(ref ext) = p.external_ids {
            if let Some(ref arxiv) = ext.arxiv {
                format!("arxiv:{}", arxiv)
            } else {
                format!("s2:{}", p.paper_id)
            }
        } else {
            format!("s2:{}", p.paper_id)
        };

        RawPaper {
            id,
            title: p.title.unwrap_or_default(),
            abstract_text: p.r#abstract.unwrap_or_default(),
            authors: p.authors.unwrap_or_default().into_iter()
                .filter_map(|a| a.name).collect(),
            url: p.url.unwrap_or_else(|| format!("https://www.semanticscholar.org/paper/{}", p.paper_id)),
            published: p.publication_date.unwrap_or_else(|| format!("{}-01-01", p.year.unwrap_or(2026))),
        }
    }).collect()
}

fn urlencoding(s: &str) -> String {
    s.replace(' ', "+").replace('"', "%22")
}

// ── Mission Generator ──────────────────────────────────────────────────

pub fn generate_mission(papers: &[Paper]) -> String {
    let mut sorted = papers.to_vec();
    sorted.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());
    let top: Vec<_> = sorted.iter().take(5).collect();

    let date = Utc::now().format("%Y-%m-%d").to_string();

    let mut all_keywords: HashSet<&str> = HashSet::new();
    for p in &top {
        for kw in &p.keywords_matched {
            all_keywords.insert(kw.as_str());
        }
    }

    let paper_list: String = top.iter().map(|p| {
        format!("- **{}** ({}, {} citations)\n  {}\n  Matched: {}",
            p.title, p.source, p.citation_count, p.url, p.keywords_matched.join(", "))
    }).collect::<Vec<_>>().join("\n");

    format!(r#"# Mission: Follow-up Investigation — New Papers Detected

**Type:** research
**Created:** {date}
**Triggered by:** Watchtower ({} new relevant papers)
**Keywords matched:** {}

## Objective

Watchtower detected {} new papers relevant to our research interests. Investigate these papers, extract key findings, and integrate them into our knowledge base.

## Papers to Investigate

{paper_list}

## Depth Targets

- [ ] Read and summarize each paper's core contribution
- [ ] Identify how each paper relates to our existing research
- [ ] Extract actionable insights (new techniques, tools, or approaches)
- [ ] Identify contradictions with our existing knowledge
- [ ] Update knowledge base with new findings
- [ ] Write synthesis connecting new papers to existing work

## Source Requirements

- Minimum 5 unique sources (the detected papers + their references)
- Cross-reference key claims across papers
- Flag any claim with only 1 source as [UNVERIFIED]

## Output Artifacts

- `research/followup-{date}-analysis.md` — Analysis of new papers
- `research/followup-{date}-sources.md` — Bibliography
- `research/followup-{date}-integration.md` — How findings connect to existing work

## Success Criteria

- [ ] All papers investigated
- [ ] Key findings extracted
- [ ] Contradictions identified
- [ ] Knowledge base updated
- [ ] Synthesis written
"#,
        top.len(),
        all_keywords.into_iter().collect::<Vec<_>>().join(", "),
        top.len(),
    )
}

// ── Main Poll ──────────────────────────────────────────────────────────

pub async fn poll(config: &ResearchConfig) -> Vec<Paper> {
    log("POLL_START");
    let pp = papers_path();
    let mut seen = paper::load_seen_ids(&pp);
    let mut new_papers = Vec::new();

    // 1. arXiv RSS (weekdays only)
    for topic in &config.topics {
        let rss_papers = fetch_arxiv_rss(topic).await;
        process_raw_papers(rss_papers, "arxiv", config, &mut seen, &mut new_papers, &pp);
    }

    // 2. arXiv Search API (keyword-based)
    let search_papers = search_arxiv(&config.keywords, config.max_papers_per_poll).await;
    process_raw_papers(search_papers, "arxiv", config, &mut seen, &mut new_papers, &pp);

    // 3. Semantic Scholar
    let query = config.keywords.iter().take(3).cloned().collect::<Vec<_>>().join(" ");
    let s2_papers = search_semantic_scholar(&query, &config.semantic_scholar_api_key, config.max_papers_per_poll).await;
    process_raw_papers(s2_papers, "semantic_scholar", config, &mut seen, &mut new_papers, &pp);

    log(&format!("POLL_END | {} new papers found", new_papers.len()));
    new_papers
}

fn process_raw_papers(
    raw: Vec<RawPaper>,
    source: &str,
    config: &ResearchConfig,
    seen: &mut HashSet<String>,
    new_papers: &mut Vec<Paper>,
    papers_path: &std::path::Path,
) {
    for raw_p in raw {
        if seen.contains(&raw_p.id) { continue; }

        let matched = paper::match_keywords(
            &format!("{} {}", raw_p.title, raw_p.abstract_text),
            &config.keywords,
        );
        if matched.is_empty() { continue; }

        let relevance = paper::score_relevance(&raw_p.title, &raw_p.abstract_text, &config.keywords);
        if relevance < config.relevance_threshold { continue; }

        let p = Paper {
            id: raw_p.id.clone(),
            source: source.to_string(),
            title: raw_p.title,
            authors: raw_p.authors,
            r#abstract: raw_p.abstract_text,
            url: raw_p.url,
            published: raw_p.published,
            citation_count: 0,
            keywords_matched: matched,
            relevance_score: relevance,
            discovered_at: Utc::now().to_rfc3339(),
            mission_generated: false,
        };

        log(&format!("NEW_PAPER | {} | {:.2} | {}", p.source, p.relevance_score, &p.title[..80.min(p.title.len())]));
        paper::append_paper(papers_path, &p);
        seen.insert(raw_p.id);
        new_papers.push(p);
    }
}

pub async fn run(daemon: bool) {
    let config = match config::load_research_config() {
        Ok(c) => c,
        Err(e) => { eprintln!("Error: {}", e); return; }
    };

    log("========================================");
    log(&format!("WATCHTOWER_START | daemon={}", daemon));
    log(&format!("CONFIG | topics={} keywords={}", config.topics.join(","), config.keywords.join(",")));

    loop {
        let new_papers = poll(&config).await;

        if !new_papers.is_empty() && config.auto_launch {
            let mission_path = config::mission_dir().join("MISSION.md");
            if !mission_path.exists() {
                let mission = generate_mission(&new_papers);
                let _ = std::fs::create_dir_all(config::mission_dir());
                let _ = std::fs::write(&mission_path, &mission);
                log(&format!("MISSION_GENERATED | {} papers", new_papers.len()));
            } else {
                log("MISSION_SKIPPED | Active mission already exists");
            }
        }

        if !daemon { break; }

        log(&format!("SLEEP | {} minutes", config.poll_interval_minutes));
        tokio::time::sleep(tokio::time::Duration::from_secs(config.poll_interval_minutes * 60)).await;
    }

    log("WATCHTOWER_EXIT");
}
