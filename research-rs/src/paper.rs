use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufRead, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paper {
    pub id: String,
    pub source: String,
    pub title: String,
    pub authors: Vec<String>,
    #[serde(default, alias = "abstract")]
    pub r#abstract: String,
    pub url: String,
    #[serde(default, alias = "date")]
    pub published: String,
    #[serde(default, alias = "citations")]
    pub citation_count: u32,
    pub keywords_matched: Vec<String>,
    pub relevance_score: f64,
    #[serde(default)]
    pub discovered_at: String,
    #[serde(default)]
    pub mission_generated: bool,
}

pub fn normalize_id(id: &str) -> String {
    id.to_lowercase()
}

pub fn load_seen_ids(path: &Path) -> HashSet<String> {
    let mut seen = HashSet::new();
    if let Ok(file) = std::fs::File::open(path) {
        for line in std::io::BufReader::new(file).lines().flatten() {
            if let Ok(p) = serde_json::from_str::<Paper>(&line) {
                seen.insert(normalize_id(&p.id));
            }
        }
    }
    seen
}

pub fn append_paper(path: &Path, paper: &Paper) {
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        if let Ok(json) = serde_json::to_string(paper) {
            let _ = writeln!(file, "{}", json);
        }
    }
}

pub fn load_all_papers(path: &Path) -> Vec<Paper> {
    let mut papers = Vec::new();
    if let Ok(file) = std::fs::File::open(path) {
        for line in std::io::BufReader::new(file).lines().flatten() {
            if let Ok(p) = serde_json::from_str::<Paper>(&line) {
                papers.push(p);
            }
        }
    }
    papers
}

pub fn match_keywords(text: &str, keywords: &[String]) -> Vec<String> {
    let lower = text.to_lowercase();
    keywords.iter()
        .filter(|kw| lower.contains(&kw.to_lowercase()))
        .cloned()
        .collect()
}

pub fn has_negative_keywords(text: &str, negative_keywords: &[String]) -> bool {
    let lower = text.to_lowercase();
    negative_keywords.iter().any(|nk| lower.contains(&nk.to_lowercase()))
}

pub fn score_relevance(title: &str, abstract_text: &str, keywords: &[String]) -> f64 {
    let title_matches = match_keywords(title, keywords);
    let abstract_matches = match_keywords(abstract_text, keywords);

    let mut unique: HashSet<&str> = HashSet::new();
    for m in title_matches.iter().chain(abstract_matches.iter()) {
        unique.insert(m.as_str());
    }

    // Title matches are 3x more valuable than abstract matches
    let total = keywords.len().max(1) as f64;
    let mut score = (title_matches.len() as f64 * 3.0 + abstract_matches.len() as f64) / (total * 4.0);

    // Bonus for breadth of keyword coverage
    if unique.len() >= 3 { score *= 1.4; }
    if unique.len() >= 4 { score *= 1.3; }

    // Penalty if no title matches at all (purely abstract matches are weaker signals)
    if title_matches.is_empty() { score *= 0.6; }

    score.min(1.0)
}
