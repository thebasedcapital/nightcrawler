# Why Your Overnight AI Agent Fails (And How Episodic Execution Fixes It)

> How I built Nightcrawler -- an autonomous agent loop that runs Claude Code for 12+ hours with structured handoffs, crash recovery, and 8 termination conditions.

---

You go to bed. Claude Code is humming along, refactoring your test suite. You set it loose with `--dangerously-skip-permissions` and a prayer. You wake up 8 hours later.

What do you find?

If you are lucky: a completed task. If you are unlucky -- and I was unlucky many times -- you find one of these six disasters.

## The 6 Death Spirals of Long-Running AI Agents

Every developer who has tried to run an AI coding agent overnight has hit at least one of these:

### 1. The Context Cliff
After 30-60 minutes of work, the model's effective context fills up. It starts forgetting what it did earlier. It re-reads files it already processed. It contradicts decisions it made 20 minutes ago. Eventually it starts undoing its own work.

### 2. The Hallucinated Handoff
The agent writes "I completed tasks 1-5" in its output. You check git. Tasks 2 and 4 were never actually done. The agent's self-assessment diverged from reality because it lost track of what it actually committed versus what it planned to do.

### 3. The Budget Inferno
You wake up to a $200 API bill. The agent hit a hard problem, generated massive prompts trying to solve it, and burned through your budget in a single multi-turn loop. No circuit breaker. No budget cap per work unit.

### 4. The Infinite Retry Loop
The agent encounters a flaky test. It tries to fix it. The fix breaks something else. It tries to fix that. The original test fails again. Three hours later, it is still cycling between the same two broken states with zero net progress.

### 5. The Silent Crash
The process dies at 2 AM -- an OOM kill, a network timeout, a macOS sleep event. Nobody notices. When you wake up, you find a half-finished refactor with uncommitted changes and no record of what was accomplished.

### 6. The Drift Spiral
The agent starts with clear intent. By hour 3, it has wandered so far from the original mission that it is adding features nobody asked for, refactoring code that was fine, and creating documentation files for a project that does not exist.

---

## Why Simple Loops Do Not Work

The most popular approach to overnight agents is some variant of this:

```bash
while true; do
  claude -p "Continue working on the project. If done, output DONE."
  # check for DONE, maybe sleep, repeat
done
```

This is the [Ralph Wiggum technique](https://ghuntley.com/loop/), popularized by Geoffrey Huntley. It is elegant. It works for short tasks. But it has a fundamental assumption that breaks down overnight: **it assumes each iteration starts fresh and can pick up from filesystem state alone.**

For a 30-minute task, that is fine. For a 12-hour mission, you need more:

- What was the agent working on when it stopped?
- What decisions did it make and why?
- What did it try that failed?
- How much budget has been spent?
- Is the agent still making progress, or is it spinning?
- Did git actually change, or did the agent just claim it did?

A simple loop cannot answer these questions. That is the gap Nightcrawler fills.

---

## The Solution: Episodic Execution

Nightcrawler does not try to keep one session alive forever. It accepts that sessions will end and builds reliability around that inevitability.

The core idea: **bounded episodes with structured handoffs.**

```
Mission.md
    |
    v
[Orchestrator] -----> [Episode 1: claude -p] -----> HANDOFF.md
    |                                                    |
    |  <-- read state, check termination conditions --   |
    |                                                    v
    +----------------> [Episode 2: claude -p] -----> HANDOFF.md
    |                                                    |
    |  <-- read state, check budget, detect stalling --  |
    |                                                    v
    +----------------> [Episode 3: claude -p] -----> HANDOFF.md
    |                                                    |
    ...                                                  |
    v                                                    v
COMPLETION_REPORT.md                              STATE.json
```

Each episode is a fresh `claude -p` session that:

1. Reads the mission (what to do)
2. Reads the handoff from the previous episode (what was done, what is next)
3. Verifies via `git log` and `git diff` that the handoff is truthful
4. Works on the highest-priority incomplete task
5. Writes a structured handoff for the next episode
6. Updates state (progress, errors, budget)

The orchestrator sits between episodes and decides: continue, or stop?

---

## Architecture: ~500 Lines of TypeScript

Nightcrawler is a single TypeScript file (`nightcrawler.ts`, ~500 LOC) that orchestrates everything:

```typescript
// The main loop is deceptively simple
while (true) {
  const { cont, reason } = shouldContinue(state, config);
  if (!cont) {
    // Write completion report and exit
    break;
  }

  const prompt = buildEpisodePrompt(state, episodeNum);
  const { exitCode, output } = await runEpisode(prompt, config, episodeNum);

  // Re-read state (agent may have updated it)
  // Track episode in history
  // Handle errors
  // Checkpoint
  // Cooldown
}
```

### The Episode Prompt

Each episode receives a carefully constructed prompt that includes:

- The skill instructions (how to behave as an autonomous agent)
- The mission (what to accomplish)
- The current state (progress, budget, errors)
- The previous handoff (what was done, what is next)
- The git context (recent commits, diff)
- A task tracker (immutable tasks.json the agent can only mark complete)

```typescript
function buildEpisodePrompt(state: State, episodeNum: number): string {
  const mission = readText(MISSION_PATH);
  const handoff = fileExists(HANDOFF_PATH) ? readText(HANDOFF_PATH) : null;

  // Include git context for truth-checking
  const gitLog = execSync("git log --oneline -10").toString();
  const diff = execSync("git diff --stat HEAD~1").toString();

  // Build structured prompt with all context
  // ...
}
```

### The 8 Termination Conditions

The orchestrator checks these before every episode:

```typescript
function shouldContinue(state: State, config: Config) {
  // 1. Human stop flag (touch ~/.nightcrawler/state/STOP)
  if (fileExists(STOP_FLAG)) return { cont: false, reason: "human_stop_flag" };

  // 2. Agent said stop (mission complete or blocked)
  if (!state.termination_check.should_continue) return { cont: false, reason: "agent_terminated" };

  // 3. Episode limit (default: 24)
  if (state.current_episode >= config.max_episodes) return { cont: false, reason: "episode_limit" };

  // 4. Duration limit (default: 12 hours)
  const elapsed = (Date.now() - started) / (1000 * 60 * 60);
  if (elapsed >= config.max_duration_hours) return { cont: false, reason: "duration_limit" };

  // 5. Budget limit (default: $50)
  if (state.budget_spent_usd >= config.max_budget_usd) return { cont: false, reason: "budget_limit" };

  // 6. Error threshold (default: 10 errors)
  if (state.errors.total >= config.error_threshold) return { cont: false, reason: "error_threshold" };

  // 7. Fatal error
  if (state.errors.fatal > 0) return { cont: false, reason: "fatal_error" };

  // 8. Diminishing returns (< 0.5 tasks/episode for 3 consecutive)
  if (avgCompleted < 0.5) return { cont: false, reason: "diminishing_returns" };

  return { cont: true, reason: null };
}
```

That eighth condition -- diminishing returns detection -- is the one that prevents death spiral #4 (the infinite retry loop). If the agent completes less than half a task per episode for three episodes in a row, something is wrong and Nightcrawler stops.

### The Handoff Protocol

Every episode must write a structured `HANDOFF.md` before finishing:

```markdown
# Episode 3 Handoff

## Summary
Implemented the authentication middleware and wrote 12 tests.
All tests passing. Rate limiting is next.

## Work Completed
- Created auth/middleware.ts with JWT validation
- Added 12 test cases in auth/middleware.test.ts
- Updated routes/api.ts to use the middleware

## In-Progress Work
- File: auth/rate-limiter.ts
- What's left: Implement sliding window rate limiting

## Key Context for Next Episode
- JWT secret is loaded from env var AUTH_SECRET
- The middleware expects Bearer tokens, not Basic auth
- rate-limiter.ts exists but is empty scaffolding

## Files Modified
- auth/middleware.ts: new file, JWT validation
- auth/middleware.test.ts: new file, 12 tests
- routes/api.ts: added authMiddleware to all /api/* routes

## Decisions Made
- Used jose library over jsonwebtoken: async-first, better types

## Errors Encountered
- None this episode
```

This handoff is not optional. The skill instructions loaded into every episode enforce it. And the orchestrator cross-checks it against `git log` in the next episode's prompt -- the agent cannot claim it changed files that git says were not modified.

### Process Supervision with launchd

Nightcrawler runs under macOS launchd, which provides:

- **Crash recovery:** If the process dies, launchd restarts it (with a 30-second throttle)
- **Sleep/wake handling:** launchd manages macOS sleep events correctly
- **Background execution:** Runs with `Nice: 5` (lower priority) and `ProcessType: Background`
- **Hard timeout:** 12-hour maximum via `TimeOut: 43200`
- **Logging:** stdout/stderr redirected to log files

```xml
<key>KeepAlive</key>
<dict>
    <key>Crashed</key>
    <true/>
    <key>SuccessfulExit</key>
    <false/>
</dict>
```

The process also uses a PID-based lockfile to prevent duplicate instances:

```typescript
function acquireLock(): boolean {
  if (fileExists(LOCK_PATH)) {
    try {
      const pid = parseInt(readText(LOCK_PATH).trim());
      process.kill(pid, 0); // Check if still alive
      return false; // Still running
    } catch {
      log("STALE_LOCK | Removing stale lockfile");
    }
  }
  writeFileSync(LOCK_PATH, String(process.pid));
  return true;
}
```

---

## Task Immutability: Preventing Cheating

One subtle but critical design decision: `tasks.json`.

When a mission starts, the orchestrator extracts all `- [ ]` checkboxes from `MISSION.md` and writes them to `tasks.json`. The agent may ONLY change the `passes` field from `false` to `true`. It cannot delete tasks, reorder them, rename them, or add new ones.

```json
[
  { "id": 1, "description": "Create auth middleware", "passes": true },
  { "id": 2, "description": "Write auth tests", "passes": true },
  { "id": 3, "description": "Implement rate limiting", "passes": false },
  { "id": 4, "description": "Add API documentation", "passes": false }
]
```

Why? Because overnight agents will try to redefine the mission to match what they actually accomplished. Task immutability prevents that.

---

## Comparison: Nightcrawler vs Ralph Loop vs Continuous Claude

| Feature | Nightcrawler | Ralph Loop | Continuous Claude |
|---|---|---|---|
| **Core approach** | Bounded episodes | Infinite loop | CI/CD loop |
| **Context management** | Structured handoffs | Filesystem only | PR-based |
| **Crash recovery** | launchd + checkpoints | Manual restart | GitHub Actions |
| **Budget tracking** | Per-episode + total cap | None | Cost limit |
| **Stall detection** | Diminishing returns algo | Completion promise | Iteration limit |
| **Termination** | 8 conditions | 2 conditions | 3 conditions |
| **Truth checking** | Git diff vs handoff | None | PR review |
| **Process supervision** | launchd (macOS native) | tmux/screen | Cloud CI |
| **Notifications** | Mobile push (Moshi) | None | GitHub notifications |
| **Task immutability** | tasks.json (flip-only) | None | None |

**Ralph Loop** is perfect for tasks that fit in a single session with a few retries. If your task is "fix this bug and run tests until they pass," Ralph is the right tool.

**Nightcrawler** is for when you want to hand the machine a 12-hour research mission or a 50-task implementation plan and walk away. The episodic architecture handles all the failure modes that destroy simple loops over extended runs.

**Continuous Claude** sits between them -- it is a CI/CD-style loop that creates PRs, waits for checks, and merges. It is great for teams that want autonomous contributions that go through their normal review process.

---

## Mission Templates

Nightcrawler ships with two mission templates:

### Research Mission (breadth -> depth -> synthesis)

```markdown
# Mission: [Research Topic]

**Type:** research
**Max Duration:** 12 hours
**Max Episodes:** 24

## Depth Targets
- [ ] Survey the landscape: identify all major players and approaches
- [ ] Deep-dive: [subtopic 1]
- [ ] Deep-dive: [subtopic 2]
- [ ] Cross-reference: identify contradictions between sources
- [ ] Synthesize: write final analysis with confidence levels
- [ ] Bibliography: all sources cited with URLs

## Source Requirements
- Minimum 10 unique sources
- At least 3 academic papers
- Flag any claim with only 1 source as [UNVERIFIED]
```

### Implementation Mission

```markdown
# Mission: [Feature Name]

**Type:** implementation
**Max Duration:** 12 hours
**Max Episodes:** 24

## Tasks
1. - [ ] [Task 1]
   - Files: [likely files]
   - Success criteria: [how to verify]

2. - [ ] [Task 2]
   - Files: [likely files]
   - Success criteria: [how to verify]
```

---

## Getting Started

### Prerequisites

- Claude Code CLI installed (`claude` command available)
- macOS (for launchd supervision) or any Unix system (run directly)
- Node.js 18+ (for tsx)

### Setup

```bash
# Clone
git clone https://github.com/YOUR_REPO/nightcrawler.git ~/.nightcrawler
cd ~/.nightcrawler

# Install dependencies
npm install

# Write your mission
cp templates/MISSION-research.md missions/active/MISSION.md
# Edit MISSION.md with your actual mission

# Configure (optional -- defaults are sane)
# Edit config.json to set budget, duration, model, etc.
```

### Run

```bash
# Direct run (stays in terminal)
npx tsx nightcrawler.ts

# Dry run (see what would happen without spending money)
npx tsx nightcrawler.ts --dry-run

# With launchd (survives terminal close, crash recovery)
cp com.user.nightcrawler.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.nightcrawler.plist
launchctl start com.user.nightcrawler
```

### Monitor

```bash
# Watch logs
tail -f ~/.nightcrawler/logs/orchestrator.log

# Check state
cat ~/.nightcrawler/state/STATE.json | jq '.progress'

# Emergency stop
touch ~/.nightcrawler/state/STOP
```

### Configuration

| Setting | Default | Description |
|---|---|---|
| `max_duration_hours` | 12 | Hard time limit |
| `max_episodes` | 24 | Maximum episode count |
| `max_budget_usd` | 50 | Total cost cap |
| `budget_per_episode_usd` | 5 | Per-episode cost cap |
| `episode_timeout_seconds` | 3600 | Single episode timeout |
| `model` | claude-opus-4-6 | Model for episodes |
| `error_threshold` | 10 | Max errors before stopping |
| `cooldown_between_episodes_seconds` | 10 | Pause between episodes |

---

## What Happens When You Wake Up

When Nightcrawler finishes (by any of the 8 termination conditions), it writes a completion report:

```markdown
# Nightcrawler Completion Report

**Mission:** auth-system-implementation
**Status:** COMPLETED
**Reason:** mission_complete
**Started:** 2026-02-21T23:00:00Z
**Ended:** 2026-02-22T06:45:00Z
**Episodes:** 8
**Budget:** $18.50 of $50.00
**Tasks:** 6/6 completed

## Episode History
- Episode 1: exit=0, tasks_completed=1, duration=45m
- Episode 2: exit=0, tasks_completed=1, duration=38m
- Episode 3: exit=0, tasks_completed=1, duration=52m
- Episode 4: exit=1, tasks_completed=0, duration=12m (flaky test, recovered)
- Episode 5: exit=0, tasks_completed=1, duration=41m
- Episode 6: exit=0, tasks_completed=1, duration=35m
- Episode 7: exit=0, tasks_completed=1, duration=28m
- Episode 8: exit=0, tasks_completed=0, duration=15m (final verification)

## Errors
- Total: 1
- Recovered: 1
- Fatal: 0
```

You also get a push notification on your phone (via Moshi) when it completes, errors, or stops.

---

## Design Principles

1. **Sessions will end. Build around that.** Do not fight context limits. Embrace bounded episodes.

2. **Verify, do not trust.** Cross-check handoffs against git. The agent's self-report is evidence, not truth.

3. **Fail safely.** 8 termination conditions, budget caps, error thresholds, human stop flag. The default behavior on any unexpected state is to stop, not to continue.

4. **Immutable contracts.** The agent cannot redefine the mission. tasks.json is a one-way ratchet: tasks can be completed, never removed.

5. **Observable at all times.** STATE.json, PROGRESS.jsonl, per-episode logs, per-episode checkpoints. If something goes wrong at 3 AM, you can reconstruct exactly what happened.

6. **Native OS integration.** launchd is not just a convenience -- it is a reliability mechanism. It handles crashes, sleep/wake, and process lifecycle better than any userspace solution.

---

## Credits and Acknowledgments

- **Geoffrey Huntley** ([@GeoffreyHuntley](https://x.com/GeoffreyHuntley)) for creating the [Ralph Wiggum technique](https://ghuntley.com/loop/) that proved autonomous agent loops are useful and inspired this project.
- **Boris Cherny** ([@bcherny](https://x.com/bcherny)) for building Claude Code and the `-p` flag that makes headless operation possible.
- **Anthropic** for Claude and the Claude Code CLI.
- **Anand Chowdhary** ([@AnandChowdhary](https://github.com/AnandChowdhary)) for [Continuous Claude](https://github.com/AnandChowdhary/continuous-claude), which showed the CI/CD approach to autonomous loops.

---

## What's Next

- **Multi-model support:** Use different models for different episode types (Sonnet for simple tasks, Opus for complex ones)
- **Linux systemd support:** Equivalent to launchd for Linux servers
- **Web dashboard:** Real-time monitoring of mission progress in the browser
- **Mission chaining:** Output of one mission feeds into the next
- **Cost estimation:** Predict budget usage before starting based on mission complexity

---

*Nightcrawler is open source. If you run Claude Code for more than an hour at a time, give it a try.*

*If you have questions or want to share how your overnight mission went, find me on [GitHub](https://github.com/YOUR_REPO/nightcrawler) or [X/Twitter](https://x.com/YOUR_HANDLE).*

---

**Tags:** #claude #ai #agents #automation #typescript #devtools
