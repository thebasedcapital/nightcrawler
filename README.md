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
