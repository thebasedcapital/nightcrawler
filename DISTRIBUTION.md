# Nightcrawler Distribution Plan

> Last updated: 2026-02-22
> Status: Ready to execute

## Executive Summary

Nightcrawler is an autonomous overnight agent loop for Claude Code that solves a real problem: long-running AI agent sessions that crash, lose context, burn budget, or spiral into nonsense. The competitive landscape is crowded (Ralph Loop, Continuous Claude, Auto-Claude, Claude Flow) but none solve the **episodic execution + structured handoff** problem that Nightcrawler was built around. That is our wedge.

**Key differentiator:** Nightcrawler does not try to keep one session alive forever. It accepts that sessions will end, and builds reliability around that inevitability -- bounded episodes, structured handoffs, diminishing returns detection, budget tracking, and crash recovery via launchd.

---

## 1. Platforms to Post On (Ranked by Likely Impact)

### Tier 1: High Impact

#### 1. Hacker News -- Show HN
- **URL:** https://news.ycombinator.com/submit
- **Why:** The single highest-leverage platform for developer tools. HN readers are exactly the target audience: power users, builders, people who leave machines running overnight. A front-page Show HN can generate 10k+ visits in a day and seed GitHub stars.
- **Where:** Submit as "Show HN: Nightcrawler -- Autonomous overnight agent loop with episodic execution"
- **Best time:** Wednesday 8:00-8:30 AM EST. Wednesday is peak traffic. Early morning catches the East Coast morning rush and stays on the front page through the West Coast wake-up. If you miss the window, try Tuesday or Thursday at the same time.
- **Content format:** Short, technical, no-BS. HN rewards substance. The post should link to the GitHub repo (once public) with a clear README. Comments should include a brief "why I built this" story focusing on the 6 death spirals of long-running agents. Code-heavy. No marketing speak. No emojis.
- **Risk:** HN can be brutal if the project looks half-baked. Ship a clean README, working code, and a demo GIF or asciicast recording before posting.

#### 2. Reddit: r/ClaudeAI
- **URL:** https://www.reddit.com/r/ClaudeAI/
- **Why:** The most engaged community of Claude Code users. Posts about autonomous workflows, CLAUDE.md configurations, and agent loops consistently hit the front page. This is where the target audience lives.
- **Subreddit:** r/ClaudeAI (primary), cross-post to r/ClaudeDev if it exists
- **Best time:** Tuesday-Thursday, 9:00 AM - 12:00 PM EST
- **Content format:** Long-form text post with code snippets. Reddit rewards personal narrative + technical depth. Structure as: "I built X because Y was broken. Here's how it works. [code]. Here's what I learned." Include a comparison to Ralph Loop since every commenter will ask.
- **Flair:** Use "Tools/Plugins" or "Agent Workflows" flair if available

#### 3. Reddit: r/AI_Agents
- **URL:** https://www.reddit.com/r/AI_Agents/
- **Why:** Dedicated to AI agent builders. Less Claude-specific, broader audience of people building with multiple LLM providers. Good for reaching the "I want to build autonomous systems" crowd.
- **Best time:** Same as above: Tuesday-Thursday, 9-12 EST
- **Content format:** Focus on the architecture and design patterns (episodic execution, handoff protocol, termination conditions) rather than Claude-specific details. This audience cares about the ideas, not just the tool.

#### 4. GitHub Repository
- **URL:** github.com (new repo needed)
- **Why:** The canonical home. Everything else links back here. Stars compound over time and feed awesome list rankings.
- **Specific actions:**
  - Clean README with architecture diagram, quick start, and comparison table
  - Add topics: `claude-code`, `autonomous-agent`, `ai-agent`, `agent-loop`, `overnight-agent`, `episodic-execution`, `launchd`
  - Add to GitHub Explore via topics
  - Submit to awesome lists (see Section 2)
  - Include an `examples/` directory with sample missions
  - Add a `CONTRIBUTING.md` to signal it is open to PRs
- **Content format:** The README is the marketing. It should be scannable in 30 seconds. Lead with a one-line description, architecture diagram, quick start, then detailed docs.

---

### Tier 2: Medium Impact

#### 5. dev.to
- **URL:** https://dev.to/
- **Why:** High SEO value. Dev.to articles rank well on Google and have a long tail. A good article will generate traffic for months. The AI/ML community there is active and growing.
- **Tags:** `#claude`, `#ai`, `#agents`, `#automation`, `#typescript`
- **Best time:** Tuesday or Wednesday morning EST
- **Content format:** Full-length article (2000-3000 words) with code blocks, diagrams, and a "Getting Started" section. Dev.to rewards practical, tutorial-style content. See Section 5 for the full draft article (saved to DEV-TO-ARTICLE.md).

#### 6. X/Twitter
- **URL:** https://x.com
- **Why:** Immediate visibility to the AI agent builder community. Key accounts like @bcherny (261K followers, Claude Code creator), @GeoffreyHuntley (Ralph Loop creator), @swyx, @mattpocock, and others can amplify if they find it interesting.
- **Content format:** Thread format (5-8 tweets). Lead with the hook: "I built a system that runs Claude Code for 12 hours overnight while I sleep. Here's how it doesn't crash." Include a short demo video or terminal recording (30-60 seconds). End with a link to the repo.
- **Accounts to @ mention / tag:**
  - @bcherny -- Claude Code creator, might engage
  - @GeoffreyHuntley -- Ralph Loop creator, natural comparison point
  - @AnthropicAI -- official Anthropic account
  - @alexalbert__ -- Anthropic DevRel, Claude Code advocate
  - @swyx -- AI engineering thought leader
  - @mattpocock -- developer educator, has compared Ralph Loop favorably
- **Best time:** Tuesday-Thursday, 9-11 AM EST or 1-3 PM EST
- **Hashtags:** #ClaudeCode #AIAgents #AutonomousCoding

#### 7. Reddit: r/LocalLLaMA
- **URL:** https://www.reddit.com/r/LocalLLaMA/
- **Why:** Massive community (800k+) of AI enthusiasts. While Nightcrawler is Claude-specific, the episodic execution pattern is model-agnostic. Frame it as "here's how to solve context loss in long-running agents" and mention it could be adapted for local models.
- **Best time:** Weekday mornings EST
- **Content format:** Technical deep-dive on the architecture. This audience wants to understand the internals and potentially adapt them.

#### 8. Discord: Claude Developers
- **URL:** https://discord.com/invite/6PPFFzqPDZ (61k+ members)
- **Why:** Direct access to Claude Code users. Lower reach than Reddit but higher engagement rate. Good for getting early adopters and feedback.
- **Channel:** Look for #showcase, #tools, #agent-development, or #claude-code channels
- **Content format:** Brief post with a link. Discord rewards conciseness. "Built an autonomous overnight agent loop for Claude Code. Episodic execution with structured handoffs. [repo link]"

#### 9. LinkedIn
- **URL:** https://www.linkedin.com
- **Why:** Reaches engineering managers, CTOs, and senior developers who might deploy this on their teams. Different audience than Reddit/HN -- more enterprise-focused. LinkedIn's algorithm heavily favors long-form posts about AI in 2026.
- **Content format:** Personal narrative post (not an article link). "I wanted Claude Code to work overnight while I slept. Here's what I learned about why AI agents fail at long tasks, and the system I built to fix it." 1500-2000 characters. Include the architecture diagram as an image.
- **Best time:** Tuesday-Thursday, 8-10 AM in your target timezone
- **Hashtags:** #AIAgents #ClaudeCode #DevTools #Automation

---

### Tier 3: Lower Immediate Impact, Long-Term Value

#### 10. Product Hunt
- **URL:** https://www.producthunt.com
- **Why:** Generates backlinks, press mentions, and a permanent product page. The AI Coding Agents category is active. Good for long-term discoverability.
- **Best time:** Tuesday 12:01 AM PST (Product Hunt resets daily). Coordinate hunters, have a landing page ready.
- **Content format:** Clean tagline, 3 screenshots/GIFs, a brief description. Need a "Hunter" with existing PH reputation for best results.
- **Category:** AI Coding Agents, Developer Tools, AI Agent Automation
- **Prerequisite:** Need a landing page or polished GitHub README before launching.

#### 11. YouTube
- **URL:** https://youtube.com
- **Why:** Demo videos have extremely long shelf life. "How to run Claude Code overnight" is a searchable query that will generate views for years. Also embeddable in the README, articles, and tweets.
- **Content format:** 5-10 minute demo video showing:
  1. Writing a mission file (30 sec)
  2. Starting Nightcrawler (30 sec)
  3. Watching logs in real-time (1 min)
  4. Showing the handoff between episodes (2 min)
  5. Reviewing the completion report in the morning (1 min)
  6. Architecture walkthrough (2-3 min)
- **Script outline:** See Section 4.

#### 12. Reddit: r/MachineLearning, r/coding, r/artificial
- **URL:** Various
- **Why:** Broader reach, lower conversion. r/MachineLearning is more academic. r/coding and r/artificial are general-purpose. Worth cross-posting but not primary targets.
- **Content format:** Shorter, more focused on the technical contribution. r/MachineLearning cares about the methodology (episodic execution as a pattern for agent reliability).

#### 13. ArXiv / Blog Post with Paper Flavor
- **URL:** https://arxiv.org or personal blog
- **Why:** The episodic execution + handoff protocol pattern is genuinely novel enough for a short technical report. Not a full academic paper, but a structured write-up with references could get cited. Positions you as a thought leader.
- **Format:** 4-6 page technical report: "Episodic Execution: A Pattern for Reliable Long-Running AI Agent Sessions"
- **Sections:** Problem, Related Work (Ralph Loop, Continuous Claude, STOP framework), Architecture, Evaluation (real mission results), Discussion
- **Timeline:** This is a secondary priority. Write after getting initial traction on the tool itself.

---

## 2. Awesome Lists to PR Into

### High Priority (Claude Code specific)

| Repository | Stars | PR Content |
|---|---|---|
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | ~21.6k | Add under "Agent Orchestrators" or "Autonomous Loops" section. One-liner: "Nightcrawler - Autonomous overnight agent loop with episodic execution, structured handoffs, and launchd supervision" |
| [jqueryscript/awesome-claude-code](https://github.com/jqueryscript/awesome-claude-code) | ~1k+ | Add under tools/frameworks section |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | ~500+ | Add as an agent orchestration skill |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | ~500+ | Same as above |

### Medium Priority (CLI coding agents / AI agents)

| Repository | Stars | PR Content |
|---|---|---|
| [bradAGI/awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents) | ~200+ | Add under "Autonomous Loops" or "Agent Harnesses" section alongside Ralph, Continuous Claude |
| [sorrycc/awesome-code-agents](https://github.com/sorrycc/awesome-code-agents) | ~100+ | Add under orchestration tools |
| [heilcheng/awesome-agent-skills](https://github.com/heilcheng/awesome-agent-skills) | ~100+ | Add as an agent skill/tool |

### Broader AI Agent Lists

| Repository | Stars | PR Content |
|---|---|---|
| [e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents) | ~10k+ | Add under autonomous coding agents |
| [Jenqyang/Awesome-AI-Agents](https://github.com/Jenqyang/Awesome-AI-Agents) | ~5k+ | Add under development/coding agents |
| [slavakurilyak/awesome-ai-agents](https://github.com/slavakurilyak/awesome-ai-agents) | ~2k+ | Add to the 300+ resource list |
| [kyrolabs/awesome-agents](https://github.com/kyrolabs/awesome-agents) | ~3k+ | Add under coding/development agents |
| [kaushikb11/awesome-llm-agents](https://github.com/kaushikb11/awesome-llm-agents) | ~1k+ | Add under agent frameworks |

### PR Template

```markdown
## Add Nightcrawler - Autonomous overnight agent loop

**What:** Nightcrawler is an autonomous overnight agent loop for Claude Code
with episodic execution, structured handoffs, and launchd supervision.

**Why it belongs:** Unlike simple while-true loops (Ralph), Nightcrawler uses
bounded episodes (30-60 min each) with structured HANDOFF.md between them,
diminishing returns detection, budget tracking, crash recovery, and 8
termination conditions. Designed for 8-12+ hour unattended runs.

**Link:** [github.com/...](https://github.com/...)
```

---

## 3. People/Accounts to Notify

### Direct Outreach (likely to engage)

| Person | Platform | Handle | Why |
|---|---|---|---|
| Geoffrey Huntley | X/Twitter | [@GeoffreyHuntley](https://x.com/GeoffreyHuntley) | Creator of Ralph Loop. Nightcrawler builds on the concept he popularized. He actively RTs related projects. Frame as "we took your idea further with episodic execution." |
| Boris Cherny | X/Twitter | [@bcherny](https://x.com/bcherny) | Head of Claude Code at Anthropic (261K followers). If he engages, it is game-changing reach. He has shared community tools before. |
| Alex Albert | X/Twitter | [@alexalbert__](https://x.com/alexalbert__) | Anthropic DevRel. Actively amplifies Claude Code ecosystem projects. |
| Anand Chowdhary | GitHub | [@AnandChowdhary](https://github.com/AnandChowdhary) | Creator of Continuous Claude (1.1k stars). Natural collaborator -- different approach to the same problem. |
| Frank Bria | GitHub | [@frankbria](https://github.com/frankbria) | Creator of ralph-claude-code. Might be interested in how Nightcrawler compares. |

### Broader Amplification

| Person | Platform | Handle | Why |
|---|---|---|---|
| Swyx (Shawn Wang) | X/Twitter | [@swyx](https://x.com/swyx) | AI engineering thought leader. Covers agent tooling regularly. |
| Matt Pocock | X/Twitter | [@mattpocock](https://x.com/mattpocock) | Praised Ralph Loop publicly. Interested in autonomous dev workflows. |
| Simon Willison | X/Twitter | [@simonw](https://x.com/simonw) | Covers AI tooling deeply. If it hits HN, he might blog about it. |
| Harrison Chase | X/Twitter | [@hwchase17](https://x.com/hwchase17) | LangChain creator. Interested in agent orchestration patterns. |
| Andrea Coda | Website | [ai-checker.webcoda.com.au](https://ai-checker.webcoda.com.au) | Wrote the Ralph Wiggum Technique article. Might write about Nightcrawler. |

### Community Channels

| Community | Where | Action |
|---|---|---|
| Claude Developers Discord | [discord.gg/6PPFFzqPDZ](https://discord.com/invite/6PPFFzqPDZ) | Post in #showcase or relevant channel |
| AgentSphere Discord | [discord invite](https://discord.com/invite/vXNG7gY8qB) | Cross-post for broader agent audience |
| Anthropic Community | Anthropic forums/community | Check for community showcase section |

---

## 4. Content Pieces to Create

### Required Before Launch

1. **GitHub README.md** -- The primary landing page
   - One-line tagline
   - Architecture diagram (ASCII or Mermaid)
   - Quick start (5 commands to first overnight run)
   - Comparison table vs Ralph Loop, Continuous Claude, Auto-Claude
   - Feature list with the 8 termination conditions
   - Config reference
   - FAQ

2. **Terminal recording** (asciicast or GIF)
   - 30-second demo: start mission -> watch logs -> see handoff -> completion report
   - Use `asciinema` for the recording, convert to GIF with `agg`
   - Embed in README and all posts

3. **Architecture diagram**
   - Show: Mission -> Orchestrator -> Episode 1 (claude -p) -> Handoff -> Episode 2 -> ... -> Report
   - Mermaid format for README, PNG for Twitter/LinkedIn

### Launch Content

4. **HN submission text**
   - Title: "Show HN: Nightcrawler -- Run Claude Code for 12 hours overnight with episodic execution"
   - Top comment: Brief "why I built this" + architecture overview

5. **Reddit post for r/ClaudeAI**
   - Title: "I built a system that runs Claude Code for 12 hours overnight -- here's how it doesn't crash"
   - Format: Personal narrative + technical walkthrough + comparison to Ralph Loop + code snippets

6. **X/Twitter thread**
   - Hook: "I wanted Claude Code to work overnight while I sleep. The problem: every autonomous loop I tried died within 2 hours. Here's what I built instead."
   - 6-8 tweets covering: the problem, the 6 death spirals, the solution (episodic execution), the architecture, the results, link to repo

7. **dev.to article** (see Section 5 / DEV-TO-ARTICLE.md)
   - Full 2500-word article with code examples
   - Cross-post to personal blog for SEO

8. **LinkedIn post**
   - Personal narrative format, 1500 chars
   - "What happens when you let an AI coding agent run for 12 hours? Usually: disaster. I built a system to fix that."

### Post-Launch

9. **YouTube demo video** (5-8 minutes)
   - Script outline:
     - [0:00-0:30] Hook: "What if your AI coding agent could work all night while you sleep?"
     - [0:30-2:00] The problem: 6 death spirals of long-running agents
     - [2:00-3:00] The solution: episodic execution with structured handoffs
     - [3:00-5:00] Live demo: writing a mission, starting Nightcrawler, watching it run
     - [5:00-6:00] Reviewing the completion report
     - [6:00-7:00] Architecture walkthrough
     - [7:00-7:30] Getting started, link to repo

10. **Technical blog post / ArXiv preprint** (optional, post-traction)
    - "Episodic Execution: A Pattern for Reliable Long-Running AI Agent Sessions"
    - Structured like a short academic paper with evaluation

### Draft Titles

| Platform | Title |
|---|---|
| Hacker News | Show HN: Nightcrawler -- Run Claude Code for 12 hours overnight with episodic execution |
| Reddit r/ClaudeAI | I built a system that runs Claude Code for 12 hours overnight -- here's how it doesn't crash |
| Reddit r/AI_Agents | Episodic execution: how I solved the "death spirals" of long-running AI agents |
| dev.to | Why Your Overnight AI Agent Fails (And How Episodic Execution Fixes It) |
| X/Twitter (hook) | I wanted Claude Code to work overnight while I sleep. Every loop I tried died within 2 hours. Here's what I built instead. |
| LinkedIn | What happens when you let an AI coding agent run for 12 hours? Usually: disaster. I built a system to fix that. |
| YouTube | Run Claude Code for 12 Hours Overnight -- Nightcrawler Demo |
| Product Hunt | Nightcrawler -- Autonomous overnight agent loop for Claude Code |

---

## 5. dev.to Article

Full article saved to: `~/.nightcrawler/DEV-TO-ARTICLE.md`

---

## 6. Launch Sequence (Recommended Order)

### Week -1: Preparation
- [ ] Make GitHub repo public with polished README
- [ ] Record terminal demo (asciicast/GIF)
- [ ] Create architecture diagram
- [ ] Write dev.to article draft
- [ ] Write all platform-specific content drafts

### Day 1 (Wednesday): Primary Launch
- [ ] 8:00 AM EST: Submit to Hacker News (Show HN)
- [ ] 8:30 AM EST: Post comment on HN with "why I built this"
- [ ] 9:00 AM EST: Post to r/ClaudeAI
- [ ] 9:30 AM EST: Post X/Twitter thread
- [ ] 10:00 AM EST: Post to Claude Developers Discord
- [ ] Monitor and respond to all comments for the first 6 hours

### Day 2: Secondary Platforms
- [ ] Post to r/AI_Agents
- [ ] Post to r/LocalLLaMA (adapted framing)
- [ ] Publish dev.to article
- [ ] Post LinkedIn update
- [ ] DM Geoffrey Huntley, tag relevant accounts on X

### Day 3-5: Awesome Lists + Follow-up
- [ ] Submit PRs to top 5 awesome lists
- [ ] Cross-post to r/MachineLearning, r/coding
- [ ] Post to AgentSphere Discord
- [ ] Follow up on any HN/Reddit threads

### Week 2: Long-tail
- [ ] Record and publish YouTube demo
- [ ] Submit remaining awesome list PRs
- [ ] Consider Product Hunt launch (if momentum warrants it)
- [ ] Write follow-up post with real mission results/data

---

## 7. Competitive Positioning

### Nightcrawler vs The Field

| Feature | Nightcrawler | Ralph Loop | Continuous Claude | Auto-Claude | Claude Flow |
|---|---|---|---|---|---|
| Episodic execution | Yes (bounded 30-60m) | No (one long session) | Partial (iteration-based) | No | No |
| Structured handoffs | HANDOFF.md protocol | No | PR-based | No | Memory-based |
| Crash recovery | launchd + checkpoints | Manual restart | CI/CD triggers | Manual | Manual |
| Budget tracking | Per-episode + total | No | Cost limits | No | No |
| Diminishing returns | Auto-detects, stops | Completion promise | Iteration limit | No | No |
| Termination conditions | 8 conditions | 2 (completion/limit) | 3 (iter/time/cost) | Manual | Manual |
| Process supervision | launchd plist | tmux/screen | GitHub Actions | None | None |
| Task immutability | tasks.json (flip only) | No | No | No | No |
| Git truth-checking | Yes (diff vs handoff) | No | PR-based | No | No |
| Mobile notifications | Moshi push | No | GitHub notifications | No | No |
| OS integration | macOS native (launchd) | Bash/tmux | Cloud/CI | Cloud | Cloud |

### Key Messaging

**Against Ralph Loop:** "Ralph is a while-true loop. Nightcrawler is an operating system for overnight agents. Ralph trusts one session to stay coherent for hours. Nightcrawler accepts that sessions will end, and builds reliability around that."

**Against Continuous Claude:** "Continuous Claude is CI/CD for Claude. Nightcrawler is an agent runtime. Continuous Claude creates PRs. Nightcrawler completes missions."

**Against Claude Flow:** "Claude Flow is a multi-agent swarm orchestrator. Nightcrawler is a single-agent reliability layer. They solve different problems and can be complementary."

---

## 8. Metrics to Track

- GitHub stars (target: 500 in first month)
- GitHub forks and PRs
- HN upvotes and rank
- Reddit upvotes and comments
- X/Twitter impressions and engagement
- dev.to views and reactions
- Awesome list PR acceptance rate
- Discord community mentions
- Inbound DMs/emails from users

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| "This is just a while loop with extra steps" | Lead with the 6 death spirals. Show real failure data from simpler approaches. Comparison table is critical. |
| Claude Code API changes break it | Pin to known working CLI version. Document compatibility. |
| Anthropic rate limits during overnight runs | Document rate limit behavior. Add configurable cooldown. Budget tracking already handles cost. |
| Perceived as irresponsible (unsupervised AI) | Emphasize safety: 8 termination conditions, budget caps, human stop flag, task immutability. |
| Low stars / no traction | Focus on r/ClaudeAI first (warmest audience). Iterate on messaging based on feedback before broader push. |
