use crate::config;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub claim: String,
    pub confidence: String,
    pub sources: Vec<String>,
    pub topic: String,
    pub date_found: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contradiction {
    pub claim_a: String,
    pub source_a: String,
    pub claim_b: String,
    pub source_b: String,
    pub topic: String,
    pub date_found: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LitReview {
    pub last_updated: String,
    pub total_papers: usize,
    pub total_findings: usize,
    pub total_contradictions: usize,
    pub topics_covered: Vec<String>,
    pub findings: Vec<Finding>,
    pub contradictions: Vec<Contradiction>,
    pub sources: Vec<String>,
}

impl Default for LitReview {
    fn default() -> Self {
        Self {
            last_updated: Utc::now().to_rfc3339(),
            total_papers: 0,
            total_findings: 0,
            total_contradictions: 0,
            topics_covered: vec![],
            findings: vec![],
            contradictions: vec![],
            sources: vec![],
        }
    }
}

fn review_json_path() -> std::path::PathBuf { config::research_dir().join("literature-review.json") }
fn review_md_path() -> std::path::PathBuf { config::research_dir().join("literature-review.md") }

fn load_review() -> LitReview {
    let path = review_json_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(review) = serde_json::from_str(&data) {
                return review;
            }
        }
    }
    LitReview::default()
}

fn save_review(review: &LitReview) {
    let _ = std::fs::write(review_json_path(), serde_json::to_string_pretty(review).unwrap());
}

fn extract_topic(filename: &str) -> String {
    filename
        .trim_end_matches(".md")
        .trim_start_matches("followup-")
        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '-')
        .trim_end_matches("-analysis")
        .trim_end_matches("-sources")
        .trim_end_matches("-integration")
        .replace('-', " ")
        .trim()
        .to_string()
}

fn extract_findings(content: &str, filename: &str) -> Vec<Finding> {
    let mut findings = Vec::new();
    let date = Utc::now().to_rfc3339();
    let topic = extract_topic(filename);

    // Match numbered findings: "1. **claim** — explanation — Confidence: HIGH"
    let re = Regex::new(r"(?m)^\d+\.\s+\*\*([^*]+)\*\*").unwrap();
    for cap in re.captures_iter(content) {
        let claim = cap[1].trim().to_string();
        if claim.len() < 10 { continue; }

        let line = &content[cap.get(0).unwrap().start()..];
        let line_end = line.find('\n').unwrap_or(line.len());
        let full_line = &line[..line_end].to_lowercase();

        let confidence = if full_line.contains("confidence: high") || full_line.contains("— high") {
            "HIGH"
        } else if full_line.contains("confidence: low") || full_line.contains("— low") {
            "LOW"
        } else if full_line.contains("[unverified]") {
            "UNVERIFIED"
        } else {
            "MEDIUM"
        };

        findings.push(Finding {
            claim,
            confidence: confidence.to_string(),
            sources: vec![filename.to_string()],
            topic: topic.clone(),
            date_found: date.clone(),
        });
    }

    // Also match "- **claim** — ..." bullet points
    let bullet_re = Regex::new(r"(?m)^-\s+\*\*([^*]+)\*\*").unwrap();
    for cap in bullet_re.captures_iter(content) {
        let claim = cap[1].trim().to_string();
        if claim.len() < 10 { continue; }
        if findings.iter().any(|f| f.claim == claim) { continue; }

        let line = &content[cap.get(0).unwrap().start()..];
        let line_end = line.find('\n').unwrap_or(line.len());
        let full_line = &line[..line_end].to_lowercase();

        let confidence = if full_line.contains("high") { "HIGH" }
            else if full_line.contains("low") { "LOW" }
            else if full_line.contains("unverified") { "UNVERIFIED" }
            else { "MEDIUM" };

        findings.push(Finding {
            claim,
            confidence: confidence.to_string(),
            sources: vec![filename.to_string()],
            topic: topic.clone(),
            date_found: date.clone(),
        });
    }

    findings
}

fn extract_sources(content: &str) -> Vec<String> {
    let re = Regex::new(r"https?://[^\s)>\]]+").unwrap();
    let mut sources: Vec<String> = Vec::new();
    for m in re.find_iter(content) {
        let url = m.as_str().trim_end_matches(|c: char| ".,;:!?".contains(c)).to_string();
        if !sources.contains(&url) {
            sources.push(url);
        }
    }
    sources
}

fn extract_contradictions(content: &str, filename: &str) -> Vec<Contradiction> {
    let mut contradictions = Vec::new();
    let topic = extract_topic(filename);

    // Look for "Contradictions" or "Debates" sections
    let section_re = Regex::new(r"(?s)## (?:Contradictions|Debates|Disagreements).*?(?=\n## |\n# |$)").unwrap();
    if let Some(section) = section_re.find(content) {
        let vs_re = Regex::new(r"(?m)^-\s+(.+?)\s+vs\.?\s+(.+?)(?::|$)").unwrap();
        for cap in vs_re.captures_iter(section.as_str()) {
            contradictions.push(Contradiction {
                claim_a: cap[1].trim().to_string(),
                source_a: filename.to_string(),
                claim_b: cap[2].trim().to_string(),
                source_b: filename.to_string(),
                topic: topic.clone(),
                date_found: Utc::now().to_rfc3339(),
            });
        }
    }

    contradictions
}

fn merge_findings(review: &mut LitReview, new_findings: &[Finding]) -> usize {
    let mut added = 0;
    for f in new_findings {
        let existing = review.findings.iter_mut().find(|ef| {
            ef.claim.to_lowercase() == f.claim.to_lowercase()
        });

        if let Some(existing) = existing {
            for src in &f.sources {
                if !existing.sources.contains(src) {
                    existing.sources.push(src.clone());
                }
            }
            if existing.sources.len() >= 3 && existing.confidence != "HIGH" {
                existing.confidence = "HIGH".to_string();
            }
        } else {
            review.findings.push(f.clone());
            added += 1;
        }
    }
    added
}

fn generate_review_markdown(review: &LitReview) -> String {
    let mut lines = vec![
        "# Literature Review — Nightcrawler Research".to_string(),
        String::new(),
        format!("*Last updated: {}*", review.last_updated),
        String::new(),
        "## Summary".to_string(),
        format!("- **Papers tracked:** {}", review.total_papers),
        format!("- **Key findings:** {}", review.findings.len()),
        format!("- **Contradictions detected:** {}", review.contradictions.len()),
        format!("- **Unique sources:** {}", review.sources.len()),
        format!("- **Topics covered:** {}", review.topics_covered.join(", ")),
        String::new(),
    ];

    // Group findings by topic
    let mut by_topic: HashMap<&str, Vec<&Finding>> = HashMap::new();
    for f in &review.findings {
        by_topic.entry(f.topic.as_str()).or_default().push(f);
    }

    lines.push("## Findings by Topic".to_string());
    for (topic, findings) in &by_topic {
        lines.push(String::new());
        lines.push(format!("### {}", topic));
        for f in findings {
            let badge = match f.confidence.as_str() {
                "HIGH" => "[HIGH]",
                "MEDIUM" => "[MED]",
                "LOW" => "[LOW]",
                _ => "[???]",
            };
            lines.push(format!("- {} {}", badge, f.claim));
            if f.sources.len() > 1 {
                lines.push(format!("  *({} sources)*", f.sources.len()));
            }
        }
    }

    if !review.contradictions.is_empty() {
        lines.push(String::new());
        lines.push("## Contradictions & Debates".to_string());
        for c in &review.contradictions {
            lines.push(format!("- **{}** vs **{}** ({})", c.claim_a, c.claim_b, c.topic));
        }
    }

    lines.push(String::new());
    lines.push("## All Sources".to_string());
    for src in review.sources.iter().take(50) {
        lines.push(format!("- {}", src));
    }
    if review.sources.len() > 50 {
        lines.push(format!("- *({} more...)*", review.sources.len() - 50));
    }

    lines.join("\n")
}

pub fn run(dir: Option<&str>) {
    eprintln!("SYNTHESIS_START");

    let target_dir = dir.map(|d| std::path::PathBuf::from(d))
        .unwrap_or_else(config::research_dir);

    if !target_dir.exists() {
        eprintln!("FATAL | Directory not found: {}", target_dir.display());
        std::process::exit(1);
    }

    let md_files: Vec<_> = std::fs::read_dir(&target_dir)
        .into_iter()
        .flat_map(|rd| rd.into_iter())
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.ends_with(".md") && !name.starts_with("literature-review")
        })
        .collect();

    if md_files.is_empty() {
        eprintln!("NO_FILES | No markdown files found to synthesize");
        return;
    }

    eprintln!("FILES_FOUND | {} markdown files", md_files.len());

    let mut review = load_review();
    let mut total_new_findings = 0;
    let mut total_new_sources = 0;
    let mut total_new_contradictions = 0;

    for entry in &md_files {
        let path = entry.path();
        let filename = entry.file_name().to_string_lossy().to_string();
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let findings = extract_findings(&content, &filename);
        let added = merge_findings(&mut review, &findings);
        total_new_findings += added;

        let sources = extract_sources(&content);
        for src in &sources {
            if !review.sources.contains(src) {
                review.sources.push(src.clone());
                total_new_sources += 1;
            }
        }

        let contradictions = extract_contradictions(&content, &filename);
        total_new_contradictions += contradictions.len();
        review.contradictions.extend(contradictions);

        let topic = extract_topic(&filename);
        if !topic.is_empty() && !review.topics_covered.contains(&topic) {
            review.topics_covered.push(topic);
        }

        eprintln!("PROCESSED | {} | findings={} sources={}", filename, findings.len(), sources.len());
    }

    review.total_findings = review.findings.len();
    review.total_contradictions = review.contradictions.len();
    review.total_papers = review.sources.iter()
        .filter(|s| s.contains("arxiv.org") || s.contains("semanticscholar.org") || s.contains("doi.org"))
        .count();
    review.last_updated = Utc::now().to_rfc3339();

    save_review(&review);
    let md = generate_review_markdown(&review);
    let _ = std::fs::write(review_md_path(), &md);

    eprintln!("SYNTHESIS_COMPLETE | +{} findings, +{} sources, +{} contradictions",
        total_new_findings, total_new_sources, total_new_contradictions);
}

pub fn show_review() {
    let review = load_review();
    println!("{}", generate_review_markdown(&review));
}
