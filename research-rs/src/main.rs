mod config;
mod paper;
mod synthesis;
mod watchtower;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "ncr", about = "Nightcrawler Research — Paper monitoring, missions, and knowledge synthesis")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Poll arXiv & Semantic Scholar for new papers
    Watch {
        /// Run continuously at poll_interval_minutes
        #[arg(long)]
        daemon: bool,
    },
    /// Generate a literature survey mission from a topic
    Research {
        /// Topic description
        topic: Vec<String>,
    },
    /// Generate a paper deep-dive mission from a URL
    Deepdive {
        /// arXiv or paper URL
        url: String,
    },
    /// List tracked papers with relevance scores
    Papers,
    /// Merge research output into knowledge base
    Synthesize {
        /// Directory to process (default: research/)
        #[arg(long)]
        dir: Option<String>,
    },
    /// Show running literature review
    Review,
    /// Show watchtower + mission status
    Status,
    /// Launch Nightcrawler with active mission
    Launch,
    /// List available mission templates
    Templates,
}

fn cmd_research(topic: &str) {
    if topic.is_empty() {
        eprintln!("Usage: ncr research \"topic description\"");
        std::process::exit(1);
    }

    config::ensure_dirs();

    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let slug: String = topic.to_lowercase()
        .chars().map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()[..50.min(topic.len())].to_string();

    let template_path = config::template_dir().join("MISSION-literature-survey.md");
    if !template_path.exists() {
        eprintln!("Template not found: MISSION-literature-survey.md");
        std::process::exit(1);
    }

    let mission = std::fs::read_to_string(&template_path)
        .unwrap()
        .replace("[Topic]", topic)
        .replace("[TOPIC]", topic)
        .replace("[topic]", &slug)
        .replace("[date]", &date)
        .replace("[DATE]", &date);

    let mission_path = config::mission_dir().join("MISSION.md");
    if mission_path.exists() {
        eprintln!("Active mission already exists at {}", mission_path.display());
        eprintln!("Archive or delete it first.");
        std::process::exit(1);
    }

    std::fs::write(&mission_path, &mission).unwrap();
    println!("Mission generated: {}", mission_path.display());
    println!("Topic: {}", topic);
    println!("\nTo launch: ncr launch");
    println!("To edit first: $EDITOR {}", mission_path.display());
}

fn cmd_deepdive(url: &str) {
    if url.is_empty() {
        eprintln!("Usage: ncr deepdive \"https://arxiv.org/abs/...\"");
        std::process::exit(1);
    }

    config::ensure_dirs();

    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let title = "Unknown Paper"; // S2 lookup could be added but may 429

    let arxiv_re = regex::Regex::new(r"arxiv\.org/abs/(\d+\.\d+)").unwrap();
    let slug = if let Some(cap) = arxiv_re.captures(url) {
        format!("arxiv-{}", &cap[1])
    } else {
        "paper".to_string()
    };

    let template_path = config::template_dir().join("MISSION-paper-deepdive.md");
    if !template_path.exists() {
        eprintln!("Template not found: MISSION-paper-deepdive.md");
        std::process::exit(1);
    }

    let mission = std::fs::read_to_string(&template_path)
        .unwrap()
        .replace("{{PAPER_TITLE}}", title)
        .replace("{{PAPER_AUTHORS}}", "[To be determined]")
        .replace("{{PAPER_URL}}", url)
        .replace("{{PAPER_ABSTRACT}}", "[Will be fetched during investigation]")
        .replace("{{DATE}}", &date)
        .replace("[PAPER TITLE]", title)
        .replace("[short-name]", &slug);

    let mission_path = config::mission_dir().join("MISSION.md");
    if mission_path.exists() {
        eprintln!("Active mission already exists.");
        std::process::exit(1);
    }

    std::fs::write(&mission_path, &mission).unwrap();
    println!("Deep-dive mission generated: {}", mission_path.display());
    println!("Paper: {}", title);
    println!("URL: {}", url);
    println!("\nTo launch: ncr launch");
}

fn cmd_papers() {
    let path = config::research_dir().join("papers.jsonl");
    let papers = paper::load_all_papers(&path);

    if papers.is_empty() {
        println!("No papers tracked yet. Run 'ncr watch' first.");
        return;
    }

    println!("\nTracked Papers ({} total)", papers.len());
    println!("{}", "─".repeat(60));

    let mut sorted = papers;
    sorted.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap());

    for (_i, p) in sorted.iter().take(20).enumerate() {
        let score = (p.relevance_score * 100.0) as u32;
        let cit = if p.citation_count > 0 {
            format!(" ({} cit.)", p.citation_count)
        } else {
            String::new()
        };
        let title = &p.title[..65.min(p.title.len())];
        println!("  [{}%] {}{}", score, title, cit);
        println!("       {}", p.url);
        println!("       Keywords: {}", p.keywords_matched.join(", "));
        println!();
    }

    if sorted.len() > 20 {
        println!("  ... and {} more", sorted.len() - 20);
    }
}

fn cmd_status() {
    println!("\nNightcrawler Research Status");
    println!("{}", "═".repeat(40));

    // Watchtower
    println!("\n[Watchtower]");
    let papers_path = config::research_dir().join("papers.jsonl");
    let papers = paper::load_all_papers(&papers_path);
    if papers.is_empty() {
        println!("  No papers tracked yet");
    } else {
        println!("  Papers tracked: {}", papers.len());
        if let Some(last) = papers.last() {
            println!("  Last discovery: {}", last.discovered_at);
        }
    }

    // Active mission
    println!("\n[Mission]");
    let mission_path = config::mission_dir().join("MISSION.md");
    if mission_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&mission_path) {
            let title = content.lines()
                .find(|l| l.starts_with("# "))
                .map(|l| l.trim_start_matches("# ").trim_start_matches("Mission: "))
                .unwrap_or("Unknown");
            println!("  Active: {}", title);
        }
    } else {
        println!("  No active mission");
    }

    // State
    let state_path = config::state_dir().join("STATE.json");
    if state_path.exists() {
        if let Ok(data) = std::fs::read_to_string(&state_path) {
            if let Ok(state) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(ep) = state.get("current_episode").and_then(|v| v.as_u64()) {
                    println!("  Episode: {}", ep);
                }
                if let Some(s) = state.get("status").and_then(|v| v.as_str()) {
                    println!("  Status: {}", s);
                }
                if let Some(budget) = state.get("budget_spent_usd").and_then(|v| v.as_f64()) {
                    println!("  Budget: ${:.2} spent", budget);
                }
            }
        }
    }

    // Literature review
    println!("\n[Literature Review]");
    let review_path = config::research_dir().join("literature-review.json");
    if review_path.exists() {
        if let Ok(data) = std::fs::read_to_string(&review_path) {
            if let Ok(review) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(f) = review.get("total_findings").and_then(|v| v.as_u64()) {
                    println!("  Findings: {}", f);
                }
                if let Some(s) = review.get("sources").and_then(|v| v.as_array()) {
                    println!("  Sources: {}", s.len());
                }
                if let Some(t) = review.get("topics_covered").and_then(|v| v.as_array()) {
                    let topics: Vec<&str> = t.iter().filter_map(|v| v.as_str()).collect();
                    println!("  Topics: {}", topics.join(", "));
                }
                if let Some(u) = review.get("last_updated").and_then(|v| v.as_str()) {
                    println!("  Last updated: {}", u);
                }
            }
        }
    } else {
        println!("  No synthesis run yet");
    }

    println!();
}

fn cmd_launch() {
    let mission_path = config::mission_dir().join("MISSION.md");
    if !mission_path.exists() {
        eprintln!("No active mission. Generate one first:");
        eprintln!("  ncr research \"your topic\"");
        eprintln!("  ncr deepdive \"https://arxiv.org/abs/...\"");
        std::process::exit(1);
    }

    let nc_config = config::load_nightcrawler_config().ok();

    println!("Launching Nightcrawler with research skill...");
    println!("Mission: {}", mission_path.display());
    if let Some(ref c) = nc_config {
        println!("Model: {}", c.model);
        println!("Budget: ${}", c.max_budget_usd);
        println!("Max episodes: {}", c.max_episodes);
    }
    println!();

    let orchestrator = config::base_dir().join("nightcrawler.ts");
    let mut cmd = std::process::Command::new("npx");
    cmd.arg("tsx").arg(&orchestrator)
        .current_dir(config::base_dir())
        .env("TERM", "dumb")
        .env_remove("CLAUDECODE");

    let status = cmd.status().unwrap_or_else(|e| {
        eprintln!("Failed to launch: {}", e);
        std::process::exit(1);
    });

    std::process::exit(status.code().unwrap_or(1));
}

fn cmd_templates() {
    println!("\nAvailable Mission Templates");
    println!("{}", "─".repeat(40));

    let template_dir = config::template_dir();
    if !template_dir.exists() {
        println!("No templates directory found.");
        return;
    }

    if let Ok(entries) = std::fs::read_dir(&template_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("MISSION-") || !name.ends_with(".md") { continue; }

            let short = name.replace("MISSION-", "").replace(".md", "");
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                let first_line = content.lines()
                    .find(|l| l.starts_with("# "))
                    .unwrap_or(&short);
                println!("  {:<25} {}", short, first_line);
            }
        }
    }

    println!("\nUsage: ncr research \"topic\"   (uses literature-survey template)");
    println!("       ncr deepdive \"url\"     (uses paper-deepdive template)");
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    config::ensure_dirs();

    match cli.command {
        Commands::Watch { daemon } => watchtower::run(daemon).await,
        Commands::Research { topic } => cmd_research(&topic.join(" ")),
        Commands::Deepdive { url } => cmd_deepdive(&url),
        Commands::Papers => cmd_papers(),
        Commands::Synthesize { dir } => synthesis::run(dir.as_deref()),
        Commands::Review => synthesis::show_review(),
        Commands::Status => cmd_status(),
        Commands::Launch => cmd_launch(),
        Commands::Templates => cmd_templates(),
    }
}
