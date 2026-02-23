# Nightcrawler

Autonomous overnight agent loop for Claude Code. Decomposes multi-hour missions into bounded 30-60 minute episodes with structured handoffs, supervised by macOS launchd for crash recovery.

Nightcrawler runs while you sleep. You write a mission file, start the orchestrator, and wake up to a completion report.

```
You (11pm)                    Nightcrawler (11pm-7am)                    You (7am)
    |                               |                                      |
    +-- Write MISSION.md            |                                      |
    +-- launchctl load ...          |                                      |
    +-- Sleep                       +-- Episode 1 (breadth scan)           |
                                    +-- HANDOFF.md written                 |
                                    +-- Episode 2 (deep-dive A)            |
                                    +-- HANDOFF.md written                 |
                                    +-- Episode 3 (deep-dive B)            |
                                    +-- ...                                |
                                    +-- Episode N (synthesis)              |
                                    +-- COMPLETION_REPORT.md               |
                                                                           +-- Read report
                                                                           +-- Review artifacts
```

## Why Not Just Loop Claude?

The naive approach is a shell while-loop that restarts `claude` when it exits. Ralph Loop (`ghuntley.com/ralph`) popularized this pattern. It works, but has real problems at scale.

| | Shell Loop | Ralph Loop | Nightcrawler |
|---|---|---|---|
| **Context management** | None -- same session until OOM | In-session CLAUDE.md reread | Clean context per episode with structured HANDOFF.md |
| **Crash recovery** | Dies with terminal | Dies with terminal | launchd restarts on crash, survives sleep/logout |
| **State persistence** | None | In-memory only | STATE.json + checkpoints + PROGRESS.jsonl |
| **Cost control** | None | None | Per-episode AND total mission budget caps |
| **Task integrity** | Agent rewrites freely | Agent rewrites freely | Immutable tasks.json -- agents can only flip `passes: false` to `true` |
| **Termination** | Manual Ctrl-C | Manual or token limit | 8 automatic conditions (budget, time, errors, diminishing returns, ...) |
| **Progress verification** | Trust agent output | Trust agent output | Git diff cross-check against handoff claims |
| **Multi-hour missions** | Context window degrades | Context window degrades | Each episode gets a fresh context window |
| **Process supervision** | None | None | launchd plist with throttle, timeout, nice level |
| **Notifications** | None | None | Push notifications on start, error, completion |

## Architecture

```
+-------------------------------------------------------------------+
|                        macOS launchd                               |
|  (crash restart, 12h timeout, throttle, nice 5, background)       |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|                    nightcrawler.ts (~550 LOC)                      |
|                                                                    |
|  +-------------------+    +-------------------+    +----------+   |
|  | State Manager     |    | Termination Logic |    | Notifier |   |
|  | STATE.json        |    | 8 conditions      |    | Moshi    |   |
|  | tasks.json        |    | checked per cycle  |    | push     |   |
|  | checkpoints/      |    |                   |    |          |   |
|  +-------------------+    +-------------------+    +----------+   |
|                                                                    |
|  +-------------------+    +-------------------+                   |
|  | Prompt Builder    |    | Episode Runner    |                   |
|  | mission + state + |    | claude -p         |                   |
|  | handoff + git +   |--->| --dangerously-    |                   |
|  | skill + tasks     |    |   skip-permissions|                   |
|  +-------------------+    | --max-budget-usd  |                   |
|                           | --model opus      |                   |
|                           +-------------------+                   |
+-------------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------------+
|                         Claude Code                                |
|  (autonomous, no human, CLAUDECODE env deleted)                   |
|                                                                    |
|  Session opening ritual -> Work -> Handoff -> State update         |
+-------------------------------------------------------------------+
```

### Layer Stack

```
Layer 4:  MISSION.md           Human intent (written once)
Layer 3:  nightcrawler.ts      Orchestration loop, termination, budget
Layer 2:  claude -p             Claude Code in headless/pipe mode
Layer 1:  launchd               Process supervision, crash recovery
Layer 0:  macOS                 Sleep/wake handling, resource limits
```

### Data Flow

```
MISSION.md ──> tasks.json ──> STATE.json ──> HANDOFF.md ──> COMPLETION_REPORT.md
  (human)      (auto-gen)     (progress)    (per-episode)     (final output)
               (immutable)    (checkpoint)   (structured)
```

## Directory Structure

```
~/.nightcrawler/
  nightcrawler.ts              # Orchestrator (TypeScript, ~550 LOC)
  config.json                  # Runtime configuration
  com.user.nightcrawler.plist  # launchd service definition
  package.json                 # Node dependencies (tsx only)

  missions/
    active/
      MISSION.md               # Current mission (human writes this)
    TEMPLATE-research.md       # Research mission template
    TEMPLATE-implementation.md # Implementation mission template

  templates/
    MISSION-research.md        # Quick-start research template
    MISSION-implementation.md  # Quick-start implementation template

  skills/
    nightcrawler-episode.md    # Skill instructions loaded per episode

  state/
    STATE.json                 # Current mission state (progress, budget, errors)
    HANDOFF.md                 # Context transfer between episodes
    tasks.json                 # Immutable task tracker (auto-generated)
    PROGRESS.jsonl             # Append-only event log
    LOCK                       # PID lockfile (prevents double-run)
    STOP                       # Touch this file to stop after current episode
    COMPLETION_REPORT.md       # Final report (generated on termination)
    checkpoints/
      episode-001.json         # State snapshot after each episode
      episode-002.json
      ...

  logs/
    orchestrator.log           # Orchestrator event log
    launchd-stdout.log         # launchd stdout capture
    launchd-stderr.log         # launchd stderr capture
    episodes/
      episode-001.log          # Full output from each Claude session
      episode-002.log
      ...
```

## Quick Start

### 1. Install

```bash
cd ~/.nightcrawler
npm install
```

The only dependency is `tsx` for running TypeScript directly.

### 2. Write a Mission

```bash
# Copy a template
cp ~/.nightcrawler/templates/MISSION-research.md ~/.nightcrawler/missions/active/MISSION.md

# Edit it
$EDITOR ~/.nightcrawler/missions/active/MISSION.md
```

### 3. Run

**Foreground** (good for testing):

```bash
cd ~/.nightcrawler && npx tsx nightcrawler.ts
```

**Dry run** (generates prompts without calling Claude):

```bash
cd ~/.nightcrawler && npx tsx nightcrawler.ts --dry-run
```

**launchd** (survives terminal close, machine sleep, crashes):

```bash
cp ~/.nightcrawler/com.user.nightcrawler.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.nightcrawler.plist
```

### 4. Monitor

```bash
# Watch orchestrator log
tail -f ~/.nightcrawler/logs/orchestrator.log

# Check current state
cat ~/.nightcrawler/state/STATE.json | python3 -m json.tool

# Read latest handoff
cat ~/.nightcrawler/state/HANDOFF.md

# Read episode output
cat ~/.nightcrawler/logs/episodes/episode-001.log
```

### 5. Stop

```bash
# Graceful: finish current episode, then stop
touch ~/.nightcrawler/state/STOP

# Immediate: unload the service
launchctl unload ~/Library/LaunchAgents/com.user.nightcrawler.plist
```

### 6. Reset for Next Mission

```bash
rm -rf ~/.nightcrawler/state/*
rm -rf ~/.nightcrawler/logs/episodes/*
# Write new MISSION.md, then start again
```

## Configuration

`~/.nightcrawler/config.json`:

```json
{
  "max_duration_hours": 12,
  "max_episodes": 24,
  "max_budget_usd": 50.00,
  "budget_per_episode_usd": 5.00,
  "episode_timeout_seconds": 3600,
  "model": "claude-opus-4-6",
  "bootstrap_command": null,
  "error_threshold": 10,
  "diminishing_returns_lookback": 3,
  "cooldown_between_episodes_seconds": 10,
  "moshi_token": "",
  "notifications": {
    "on_start": true,
    "on_episode_complete": false,
    "on_error": true,
    "on_completion": true
  }
}
```

| Field | Default | Description |
|---|---|---|
| `max_duration_hours` | 12 | Hard wall-clock limit for the entire mission |
| `max_episodes` | 24 | Maximum number of episodes before forced termination |
| `max_budget_usd` | 50.00 | Total API spend cap across all episodes |
| `budget_per_episode_usd` | 5.00 | Per-episode spend cap (passed to `claude --max-budget-usd`) |
| `episode_timeout_seconds` | 3600 | Kill an episode after this many seconds (1 hour default) |
| `model` | claude-opus-4-6 | Model to use for episodes |
| `bootstrap_command` | null | Command to run before each episode (e.g., `npm test`) |
| `error_threshold` | 10 | Stop after this many total errors |
| `diminishing_returns_lookback` | 3 | Check last N episodes for progress stall |
| `cooldown_between_episodes_seconds` | 10 | Pause between episodes |
| `moshi_token` | "" | Moshi push notification token (optional) |

## Termination Conditions

The orchestrator checks 8 conditions before each episode. If any fires, the mission ends and a `COMPLETION_REPORT.md` is written.

| Condition | Trigger |
|---|---|
| **Human stop flag** | `~/.nightcrawler/state/STOP` file exists |
| **Agent termination** | Agent sets `termination_check.should_continue = false` in STATE.json |
| **Episode limit** | `current_episode >= max_episodes` |
| **Duration limit** | Wall-clock time exceeds `max_duration_hours` |
| **Budget limit** | `budget_spent_usd >= max_budget_usd` |
| **Error threshold** | Total errors reach `error_threshold` |
| **Fatal error** | Any fatal error recorded |
| **Diminishing returns** | Last N episodes averaged < 0.5 tasks completed per episode |

## Immutable Task Tracking

When a mission starts, Nightcrawler auto-generates `state/tasks.json` from the `- [ ]` checkboxes in MISSION.md:

```json
[
  { "id": 1, "description": "Survey the landscape", "passes": false },
  { "id": 2, "description": "Deep-dive: topic A", "passes": false },
  { "id": 3, "description": "Synthesize findings", "passes": false }
]
```

Agents can ONLY change `passes` from `false` to `true`. They cannot delete tasks, reorder them, rewrite descriptions, or add new ones. This prevents a known failure mode where autonomous agents rewrite their own success criteria to declare premature victory.

This pattern comes from Anthropic's recommendations for autonomous agent harnesses.

## Episode Lifecycle

Each episode follows a strict protocol:

```
1. Orchestrator checks 8 termination conditions
2. Orchestrator runs bootstrap_command (if configured)
3. Orchestrator builds prompt:
   - Skill instructions (nightcrawler-episode.md)
   - Episode metadata (number, budget, progress)
   - Full MISSION.md
   - Current STATE.json
   - Previous HANDOFF.md (if not Episode 1)
   - Git context (recent commits + diff)
   - tasks.json (immutable tracker)
   - Session opening ritual instructions
   - End-of-episode requirements
4. Orchestrator spawns: claude -p --dangerously-skip-permissions --model <model> --max-budget-usd <cap>
5. Agent executes session opening ritual:
   a. Reads STATE.json
   b. Reads HANDOFF.md
   c. Runs git log to verify handoff claims
   d. Runs baseline checks (tests/lint for implementation missions)
   e. Picks highest-priority incomplete task
6. Agent does work
7. Agent writes HANDOFF.md (structured template)
8. Agent updates STATE.json and tasks.json
9. Orchestrator re-reads state, records episode in history
10. Orchestrator saves checkpoint
11. Orchestrator waits cooldown_between_episodes_seconds
12. Loop back to step 1
```

## Git Diff Verification

A common failure mode in autonomous agents is hallucinated progress: the agent claims it completed work that doesn't exist. Nightcrawler mitigates this by injecting the actual git diff and recent commit log into each episode's prompt.

The next episode can cross-check what the previous handoff claims against what the git history shows. If they diverge, the agent knows to distrust the handoff and verify from source.

## Session Opening Ritual

Before doing any work, each episode executes a mandatory checklist (Anthropic's "session opening ritual" pattern):

1. Read STATE.json -- understand position in the mission
2. Read MISSION.md -- understand the goal
3. Read HANDOFF.md -- understand previous work
4. Read tasks.json -- understand what's done and what's left
5. Run `git log --oneline -5` -- verify what actually changed
6. Run baseline checks (tests/lint for implementation missions)
7. Pick the highest-priority incomplete task

This prevents agents from starting work based on stale assumptions or hallucinated context.

## Mission Templates

### Research Mission

Research missions follow a breadth-depth-synthesis pattern:

```markdown
# Mission: Autonomous Agent Coordination Protocols

**Type:** research
**Created:** 2026-02-22
**Max Duration:** 12 hours
**Max Episodes:** 24

## Objective

Survey the landscape of multi-agent coordination protocols. Identify
all major approaches (A2A, MCP, custom), map their tradeoffs, and
produce a synthesis document with confidence levels per claim.

## Existing Research

- `~/research/multi-agent-survey.md` -- prior survey from January

## Depth Targets

- [ ] Survey the landscape: identify all major protocols and frameworks
- [ ] Deep-dive: Google A2A protocol
- [ ] Deep-dive: Anthropic MCP coordination patterns
- [ ] Deep-dive: Academic approaches (arXiv, ACL)
- [ ] Cross-reference: identify contradictions between sources
- [ ] Synthesize: write final analysis with confidence levels per claim
- [ ] Bibliography: all sources cited with URLs

## Source Requirements

- Minimum 10 unique sources
- At least 3 academic papers (arXiv, ACL, etc.)
- At least 2 industry implementations or case studies
- Flag any claim with only 1 source as [UNVERIFIED]

## Output Artifacts

- `research/agent-coordination-analysis.md`
- `research/agent-coordination-sources.md`
- `research/agent-coordination-gaps.md`

## Constraints

- Do NOT hallucinate citations -- every URL must be real
- Do NOT pad with filler -- quality over word count
- Use WebSearch for discovery, WebFetch for reading sources

## Success Criteria

- [ ] All depth targets complete
- [ ] 10+ unique real sources cited
- [ ] Contradictions identified and analyzed
- [ ] Final synthesis written with confidence levels
- [ ] Gaps document captures remaining unknowns
```

### Implementation Mission

```markdown
# Mission: Add Rate Limiting to API Gateway

**Type:** implementation
**Created:** 2026-02-22
**Max Duration:** 8 hours
**Max Episodes:** 16

## Objective

Add token-bucket rate limiting to the API gateway. Per-user limits
with configurable burst. Must not break existing tests.

## Tasks

- [ ] Add rate limiter module with token-bucket algorithm
  - Files: src/middleware/rate-limiter.ts
  - Success criteria: unit tests pass

- [ ] Integrate with request pipeline
  - Files: src/server.ts, src/middleware/index.ts
  - Success criteria: integration tests pass

- [ ] Add configuration and per-user overrides
  - Files: src/config.ts, config/default.json
  - Success criteria: config loads, overrides work

- [ ] Add monitoring and rate-limit response headers
  - Files: src/middleware/rate-limiter.ts
  - Success criteria: X-RateLimit-* headers present

## Constraints

- Do NOT break existing tests
- Do NOT add new dependencies without justification
- Token bucket, not sliding window

## Success Criteria

- [ ] All tasks complete
- [ ] All tests passing (existing + new)
- [ ] No lint errors
```

## launchd Service

The included plist configures launchd for production use:

- **Crash recovery**: Restarts on crash, does not restart on clean exit
- **Throttle**: At most one restart per 30 seconds
- **Timeout**: Hard 12-hour wall-clock limit
- **Priority**: Nice level 5 (lower than interactive processes)
- **Process type**: Background
- **File descriptors**: 4096 soft limit
- **Logging**: stdout and stderr captured to `logs/`

```bash
# Install
cp ~/.nightcrawler/com.user.nightcrawler.plist ~/Library/LaunchAgents/

# Load (start)
launchctl load ~/Library/LaunchAgents/com.user.nightcrawler.plist

# Unload (stop)
launchctl unload ~/Library/LaunchAgents/com.user.nightcrawler.plist

# Check status
launchctl list | grep nightcrawler
```

## Process Safety

- **PID lockfile**: Only one orchestrator instance runs at a time. Stale locks from crashed processes are detected and cleaned.
- **CLAUDECODE env deleted**: Prevents the spawned Claude from thinking it's inside another Claude session, which causes behavioral issues.
- **TERM=dumb**: Prevents ANSI escape codes in output logs.
- **Signal handling**: Clean lock release on SIGTERM and SIGINT.

## Notifications

Nightcrawler sends push notifications via Moshi at key events:

- **on_start**: Mission name and task count
- **on_error**: Episode number, exit code, error count vs threshold
- **on_completion**: Final status, tasks completed, episodes run, budget spent

Set `moshi_token` in config.json. Leave empty to disable.

## Design Decisions

**Why episodes instead of one long session?**
Claude Code sessions degrade as context fills up. A 60-minute episode with a clean context window produces better work than minute 300 of a continuous session. The handoff protocol transfers only the essential context, not the full conversation history.

**Why immutable tasks.json?**
Without constraints, autonomous agents tend to rewrite their own objectives. An agent that can delete tasks will eventually "complete" a mission by removing the hard parts. The immutable tracker forces agents to do the actual work.

**Why launchd instead of a shell script?**
A shell loop dies when the terminal closes, the SSH session drops, or the machine sleeps. launchd is the macOS init system -- it survives all of these and restarts crashed processes automatically.

**Why delete the CLAUDECODE environment variable?**
When Claude Code detects the CLAUDECODE env var, it adjusts its behavior for being inside another Claude instance. This causes problems in headless mode. Deleting it gives the episode a clean behavioral context.

**Why git diff verification?**
Autonomous agents can hallucinate progress -- claiming they wrote files that don't exist or made changes that aren't in the diff. Injecting the actual git state lets the next episode detect and correct this.

## Research Toolkit

Nightcrawler ships with a research-specific extension: a paper monitor that watches arXiv and Semantic Scholar overnight, a synthesis engine that merges findings into a running literature review, and a suite of structured mission templates purpose-built for academic research tasks. All glued together by a single CLI wrapper (`ncr`) that generates missions, launches Nightcrawler, and synthesizes output.

The goal: wake up to a literature review, not a blank terminal.

### Architecture

```
                        WATCHTOWER
                      (Rust, ncr watch)
              ┌─────────────────────────────────┐
              │  arXiv RSS  arXiv Search API     │
              │  Semantic Scholar (225M papers)  │
              │  Relevance scoring + dedup       │
              │  → papers.jsonl                  │
              └──────────────┬──────────────────┘
                             │ relevant paper detected
                             ▼
                        NCR CLI
                     (Rust, 4.2MB binary)
              ┌─────────────────────────────────┐
              │  ncr research "topic"            │
              │  ncr deepdive "arxiv.org/..."    │
              │  → renders MISSION.md template   │
              └──────────────┬──────────────────┘
                             │ MISSION.md written
                             ▼
                      NIGHTCRAWLER
                    (nightcrawler.ts)
              ┌─────────────────────────────────┐
              │  Episode 1: breadth scan         │
              │  Episode 2: deep-dive A          │
              │  Episode 3: deep-dive B          │
              │  Episode N: synthesis            │
              │  (crash recovery, budget caps,   │
              │   immutable task tracking)       │
              └──────────────┬──────────────────┘
                             │ research/*.md written
                             ▼
                       SYNTHESIS
                     (Rust, ncr synthesize)
              ┌─────────────────────────────────┐
              │  Reads research output markdown  │
              │  Extracts findings + confidence  │
              │  Detects contradictions          │
              │  Maintains literature-review.md  │
              └─────────────────────────────────┘
```

### Quick Start (Research Mode)

```bash
cd ~/.nightcrawler

# 1. Start watching for new papers (one-shot poll)
ncr watch

# 2. Generate a literature survey mission
ncr research "autonomous AI research agents"

# 3. (Optional) Preview mission before launching
cat missions/active/MISSION.md

# 4. Launch Nightcrawler to execute the mission overnight
ncr launch

# 5. Monitor progress
ncr status

# 6. After mission completes, synthesize findings
ncr synthesize

# 7. View the running literature review
ncr review
```

To deep-dive a specific paper from an arXiv URL:

```bash
ncr deepdive "https://arxiv.org/abs/2510.16572"
ncr launch
```

To run the paper monitor continuously in the background:

```bash
ncr watch --daemon
```

### Research CLI (`ncr`)

The `ncr` binary is a native Rust CLI (4.2MB, zero runtime deps). Install with `cargo install --path research-rs` or copy `research-rs/target/release/ncr` to your PATH.

| Command | Description |
|---------|-------------|
| `ncr watch` | One-shot poll: arXiv RSS + Search + Semantic Scholar. Prints new papers found. |
| `ncr watch --daemon` | Continuous polling on `poll_interval_minutes` schedule. |
| `ncr research "topic"` | Generate a `MISSION-literature-survey.md` mission for a topic. |
| `ncr deepdive "url"` | Generate a `MISSION-paper-deepdive.md` mission from an arXiv URL. |
| `ncr papers` | List all tracked papers in `papers.jsonl` with relevance scores. |
| `ncr synthesize` | Run synthesis on all `research/*.md` output files. |
| `ncr review` | Print the current `literature-review.md`. |
| `ncr status` | Show watchtower config, paper count, mission status, last poll time. |
| `ncr launch` | Start Nightcrawler with the current active mission. |
| `ncr templates` | List all available mission templates in `templates/`. |

### The Full Pipeline

```
You (evening)                  Overnight                          You (morning)
     |                              |                                   |
     +-- ncr watch --daemon         |                                   |
     +-- ncr research "topic"  ---> +-- Episode 1 (breadth scan)       |
     +-- ncr launch                 +-- Episode 2 (deep A)             |
     +-- Sleep                      +-- Episode 3 (deep B)             |
                                    +-- Episode N (synthesis)           |
                                    +-- COMPLETION_REPORT.md            |
                                                                        +-- ncr synthesize
                                                                        +-- ncr review
                                                                        +-- literature-review.md ready
```

Each stage is independently useful. Watchtower runs as a cron job. The mission templates work without the CLI. Synthesis runs on any directory of markdown files from past missions. Nothing requires the whole stack to be running at once.

### Components

#### Watchtower (`research/watchtower.ts`)

Polls three APIs for new papers matching your configured topics and keywords:

- **arXiv RSS**: Daily feed per category (e.g., `cs.AI`, `cs.MA`). Instant for new preprints.
- **arXiv Search API**: Keyword-based query across all dates. Catches papers outside your RSS categories.
- **Semantic Scholar API**: 225M papers with citation counts, year, abstract. Best for relevance-ranked discovery.

Papers are deduplicated by normalized ID (case-insensitive) and scored by keyword relevance. Title matches are weighted 3x over abstract matches; abstract-only hits are penalized 0.6x. Papers must match at least `min_keyword_matches` keywords and score above `relevance_threshold` to be written to `research/papers.jsonl`. Negative keywords (e.g., "reinforcement learning", "autonomous driving") instantly reject irrelevant papers.

If `auto_launch: true`, Watchtower generates a mission and starts Nightcrawler automatically when a sufficiently relevant paper arrives.

Optional vault-aware boosting: if `vault_path` is set, papers whose abstracts mention topics already in your VaultGraph knowledge base score higher.

#### Synthesis (`research/synthesis.ts`)

Reads all markdown files in the research output directory after a mission completes and:

1. Extracts findings tagged with confidence levels (`HIGH`, `MEDIUM`, `LOW`, `UNVERIFIED`)
2. Detects contradictions: two findings that make opposing claims about the same subject
3. Merges new findings into `literature-review.md`, deduplicating by semantic similarity
4. Appends a contradiction log if any conflicts were detected

The literature review accumulates across missions. Each run adds to it rather than replacing it, so the file grows into a comprehensive knowledge base over time.

Confidence levels follow the research episode skill convention:

| Level | Meaning |
|-------|---------|
| `HIGH` | Multiple independent sources agree |
| `MEDIUM` | Single strong source, or multiple weak sources |
| `LOW` | Single weak source, or inference from adjacent evidence |
| `UNVERIFIED` | Claim with no traceable source; flagged for follow-up |

#### Research Episode Skill (`skills/research-episode.md`)

An enhanced version of the standard episode skill, loaded automatically for research missions. Teaches the agent:

- How to query Semantic Scholar, OpenAlex, and arXiv APIs directly (with example curl commands)
- The breadth-then-depth methodology: survey wide first, then pick the 3-5 most relevant threads to follow down
- Cross-referencing protocol: when two sources conflict, note both, attribute the conflict, don't resolve it arbitrarily
- Structured output format: findings with confidence tags, sources as numbered references, gaps section
- Citation hygiene: every URL must resolve; hallucinated citations are flagged as fatal errors in the handoff

#### Mission Templates

Five templates live in `templates/`, each targeting a different research task shape:

| Template | Use Case |
|----------|----------|
| `MISSION-literature-survey.md` | Comprehensive landscape scan of a field or topic. Breadth-first, then synthesize. Good starting point for any new research area. |
| `MISSION-paper-deepdive.md` | Single paper analysis: methods, results, limitations, related work, open questions. Useful for important new preprints. |
| `MISSION-gap-analysis.md` | Find what's missing. Maps existing work, then explicitly identifies unsolved problems and underexplored directions. |
| `MISSION-systematic-review.md` | Structured evidence synthesis following PRISMA-adjacent methodology. Defines inclusion/exclusion criteria, records search protocol, grades evidence quality. |
| `MISSION-followup.md` | Investigate a specific paper or thread flagged by Watchtower. Pre-populated with the paper's metadata; agent fills in the analysis. |

`ncr research "topic"` renders `MISSION-literature-survey.md` with the topic filled in.
`ncr deepdive "url"` renders `MISSION-paper-deepdive.md` with paper metadata fetched from arXiv.

#### RESEARCH-IDEAS.md

A catalog of 15 autonomous research engine architectures, included as a reference and inspiration document. Covers approaches ranging from citation graph traversal to adversarial paper debate to continuous hypothesis refinement loops. Not active code -- a design document.

### Configuration (`research/research-config.json`)

```json
{
  "topics": ["cs.AI", "cs.MA", "cs.SE"],
  "keywords": ["autonomous agent", "agent orchestration", "agentic workflow", "multi-agent coordination", "LLM agent"],
  "negative_keywords": ["reinforcement learning", "autonomous driving", "traffic signal", "vehicle"],
  "semantic_scholar_api_key": "",
  "poll_interval_minutes": 60,
  "auto_launch": false,
  "min_citation_count": 0,
  "min_keyword_matches": 2,
  "max_papers_per_poll": 20,
  "relevance_threshold": 0.35,
  "vault_path": "",
  "output_dir": "research"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `topics` | `["cs.AI"]` | arXiv category codes for RSS feeds. See [arxiv.org/category_taxonomy](https://arxiv.org/category_taxonomy). |
| `keywords` | `[]` | Keywords to match in titles and abstracts. Case-insensitive substring match. |
| `semantic_scholar_api_key` | `""` | Optional API key for higher rate limits (100 RPS vs 1 RPS unauthenticated). Free at [semanticscholar.org/product/api](https://www.semanticscholar.org/product/api). |
| `poll_interval_minutes` | `60` | How often Watchtower polls when running as a daemon. |
| `auto_launch` | `false` | Automatically start Nightcrawler when a paper above threshold is found. |
| `min_citation_count` | `0` | Filter out papers with fewer citations. Useful for excluding preprints in established fields. |
| `max_papers_per_poll` | `20` | Maximum papers to ingest per poll cycle, sorted by relevance score descending. |
| `min_keyword_matches` | `2` | Require at least N keyword matches before considering a paper. Prevents single-keyword noise. |
| `negative_keywords` | `[]` | Papers matching any of these keywords are instantly rejected, regardless of positive score. |
| `relevance_threshold` | `0.35` | Papers below this score are stored but not used to trigger missions. Range 0-1. |
| `vault_path` | `""` | Path to a VaultGraph vault for graph-aware relevance boosting. Leave empty to skip. |
| `output_dir` | `"research"` | Directory (relative to `~/.nightcrawler`) where research output and synthesis files are written. |

### Free APIs Used

No paid data sources. No Python frameworks. No vendor lock-in.

| API | Coverage | Rate Limit | Cost |
|-----|----------|-----------|------|
| [Semantic Scholar](https://api.semanticscholar.org/) | 225M papers, citation graph, recommendations | 100 RPS with free API key; 1 RPS without | Free |
| [OpenAlex](https://openalex.org/) | 240M works, 50K added daily, full metadata | 100K req/day without key; higher with email param | Free (CC0) |
| [arXiv RSS](https://arxiv.org/help/rss) | All categories, daily new papers | No limit | Free |
| [arXiv Search API](https://info.arxiv.org/help/api/) | Full-text search across all arXiv | 3 req/sec suggested | Free |

Semantic Scholar is the primary discovery engine. OpenAlex is used for cross-referencing and citation metadata. arXiv RSS is the fastest signal for brand-new preprints.

### Directory Structure (Research)

The Research Toolkit adds these paths to the standard Nightcrawler layout:

```
~/.nightcrawler/
  research-rs/                 # Rust CLI (ncr binary)
    src/
      main.rs                  # CLI entry, 9 subcommands, mission gen
      watchtower.rs            # arXiv RSS + Search + S2 with retry/backoff
      synthesis.rs             # Finding extraction, contradiction detection
      paper.rs                 # Paper struct, scoring, JSONL I/O
      config.rs                # Config structs, directory helpers
    Cargo.toml

  research/
    watchtower.ts              # Paper monitor (TS, superseded by Rust)
    synthesis.ts               # Knowledge merger (TS, superseded by Rust)
    ncr.ts                     # CLI wrapper (TS, superseded by Rust)
    research-config.json       # Research toolkit configuration
    papers.jsonl               # All tracked papers with scores and metadata
    literature-review.json     # Structured findings (JSON)
    literature-review.md       # Running synthesis (grows across missions)

  skills/
    nightcrawler-episode.md    # Standard episode skill
    research-episode.md        # Enhanced episode skill for research missions

  templates/
    MISSION-research.md        # Quick-start research template
    MISSION-implementation.md  # Quick-start implementation template
    MISSION-literature-survey.md   # Comprehensive landscape scan
    MISSION-paper-deepdive.md      # Single paper analysis
    MISSION-gap-analysis.md        # Find what's missing in a field
    MISSION-systematic-review.md   # Structured evidence synthesis
    MISSION-followup.md            # Investigate watchtower-detected papers

  RESEARCH-IDEAS.md            # Catalog of 15 autonomous research engine architectures
```

### Comparison with Existing Tools

The gap nobody fills: a system that connects **paper monitoring** to **autonomous overnight research** to **accumulated knowledge synthesis**, running on your machine, using free APIs, requiring no framework installation.

| Tool | Stars | What it does | What it doesn't do |
|------|-------|-------------|-------------------|
| **AI-Scientist** (Sakana) | 12.2k | Fully autonomous: hypothesis → experiment → paper | Doesn't monitor for new work; requires GPU; no episodic execution |
| **SciAgents** (MIT) | 587 | Multi-agent knowledge graph construction from papers | Can't run overnight autonomously; no paper monitoring |
| **CrewAI** | 44.5k | General multi-agent framework with research roles | No paper monitoring; no synthesis accumulation; no crash recovery |
| **Elicit** | — | Literature review assistant, paper monitoring | Not autonomous; human-in-the-loop only |
| **Ralph Loop** | ~11k | Continuous Claude Code loop | No research tooling; no structured handoffs; no paper monitoring |
| **Nightcrawler Research** | — | Watchtower detects papers → generates missions → executes overnight → synthesis accumulates | Doesn't write LaTeX or run experiments (yet) |

The key architectural difference: Nightcrawler Research is a **pipeline**, not a monolith. Each piece (Watchtower, mission templates, episodic execution, synthesis) works standalone. Watchtower can run as a cron job without Nightcrawler. Synthesis can run on past research output from any source. The mission templates work with standard Nightcrawler. You compose them in whatever order fits your workflow.

## Requirements

- macOS (for launchd; the orchestrator itself is platform-agnostic)
- Node.js 18+
- Claude Code CLI (`claude` in PATH, typically at `~/.local/bin/claude`)
- Claude Max or API access with sufficient budget

## Credits

- **Ralph Loop** ([ghuntley.com/ralph](https://ghuntley.com/ralph)) -- the original in-session loop pattern. Nightcrawler's episodic approach was designed to solve the context degradation and crash recovery problems that emerge when running Ralph for hours.
- **Anthropic's Claude Code harness guide** -- the session opening ritual, immutable JSON task tracking, and `--dangerously-skip-permissions` patterns come directly from Anthropic's recommendations for autonomous agent harnesses.
- **Architecture synthesis** -- the episode/handoff/termination design emerged from a structured debate between Claude Opus and GLM-5 (Fireworks AI), combining ideas from distributed systems (checkpointing, circuit breakers) with agent-specific patterns (context window management, hallucination detection).

## License

MIT
