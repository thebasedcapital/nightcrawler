use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchConfig {
    pub topics: Vec<String>,
    pub keywords: Vec<String>,
    #[serde(default)]
    pub semantic_scholar_api_key: String,
    #[serde(default = "default_poll_interval")]
    pub poll_interval_minutes: u64,
    #[serde(default)]
    pub auto_launch: bool,
    #[serde(default)]
    pub min_citation_count: u32,
    #[serde(default = "default_max_papers")]
    pub max_papers_per_poll: usize,
    #[serde(default = "default_threshold")]
    pub relevance_threshold: f64,
    #[serde(default)]
    pub vault_path: String,
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
    #[serde(default)]
    pub negative_keywords: Vec<String>,
    #[serde(default = "default_min_keyword_matches")]
    pub min_keyword_matches: usize,
}

fn default_poll_interval() -> u64 { 60 }
fn default_max_papers() -> usize { 20 }
fn default_threshold() -> f64 { 0.3 }
fn default_output_dir() -> String { "research".into() }
fn default_min_keyword_matches() -> usize { 2 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NightcrawlerConfig {
    pub model: String,
    pub max_budget_usd: f64,
    pub max_episodes: u32,
    #[serde(default)]
    pub moshi_token: String,
}

pub fn base_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".into());
    PathBuf::from(home).join(".nightcrawler")
}

pub fn research_dir() -> PathBuf { base_dir().join("research") }
pub fn mission_dir() -> PathBuf { base_dir().join("missions").join("active") }
pub fn template_dir() -> PathBuf { base_dir().join("templates") }
pub fn state_dir() -> PathBuf { base_dir().join("state") }

pub fn load_research_config() -> Result<ResearchConfig, String> {
    let path = research_dir().join("research-config.json");
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    serde_json::from_str(&data).map_err(|e| format!("Parse error: {}", e))
}

pub fn load_nightcrawler_config() -> Result<NightcrawlerConfig, String> {
    let path = base_dir().join("config.json");
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;
    serde_json::from_str(&data).map_err(|e| format!("Parse error: {}", e))
}

pub fn ensure_dirs() {
    for dir in &[
        research_dir(),
        mission_dir(),
        state_dir(),
        base_dir().join("logs").join("episodes"),
        state_dir().join("checkpoints"),
    ] {
        let _ = std::fs::create_dir_all(dir);
    }
}
