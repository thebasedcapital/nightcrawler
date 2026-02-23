# Autonomous Research Engine Ideas — Reference Catalog

15 deployable architectures for autonomous scientific discovery, organized by paradigm.

## Ralph-Loop Variants (Domain-Specific)

### 1. SciRalph — Scientific Research Institute
- Ralph loop pulling from `research_agenda.json`, cycling: lit review → hypothesis → experiment → analysis → write-up
- Deps: [snarktank/ralph](https://github.com/snarktank/ralph), Docker + scientific Python (numpy/scipy/rdkit/pyscf/astropy)
- Status: No packaged version. Base Ralph exists, community science adaptations are common.

### 2. DrugRalph / MatRalph — Drug & Materials Discovery
- Specialized for chemistry/biology: virtual screening, quantum sims, docking, synthesis routes
- Deps: [RDKit](https://www.rdkit.org), [PubChemPy](https://pubchempy.readthedocs.io), [PySCF](https://pyscf.org)
- Status: No named version. Users routinely add chemistry scripts to Ralph.

### 3. VentureRalph — Startup Factory
- Full autonomous startup: market research → finance modeling → MVP coding → growth experiments
- Deps: Ralph + web_search, Stripe API, deployment scripts
- Status: No packaged version. Ralph already used by solo founders for MVPs.

### 4. PatentRalph — Invention & IP Machine
- Prior-art search, novelty gap analysis, claim drafting, full USPTO-ready packages
- Deps: Ralph + Google Patents API, image-gen tools
- Status: No dedicated version.

### 5. ClimateRalph / SoluRalph — Climate Solution Engine
- Negative-emission tech modeling, optimization, engineering blueprints, policy briefs
- Deps: Ralph + astropy, scipy, [PuLP](https://www.pulpproject.org), netCDF tools
- Status: No packaged version.

## Agentic / Framework-Based

### 6. SciGraph — Stateful DAG Workflow
- Directed-graph workflow with conditional branches, checkpoints, retry logic
- Deps: [LangGraph](https://github.com/langchain-ai/langgraph), PostgreSQL/Redis
- Status: Core framework exists. Full science institute not packaged.

### 7. SciTree — Parallel Hypothesis Tree Search
- Best-first tree search over dozens of hypotheses, pruning dead-ends, deepening winners
- Deps: [AI-Scientist-v2](https://github.com/SakanaAI/AI-Scientist-v2) (12.2k stars)
- Status: **Exists.** Already produced peer-reviewed workshop papers.

### 8. SciCrew — Multi-Agent Research Lab
- Specialized roles (Planner, Researcher, Critic, Writer) that debate and reach consensus
- Deps: [CrewAI](https://github.com/crewAIInc/crewAI) (44.5k stars)
- Status: Core framework exists. Scientific crews commonly built by users.

### 9. EvoSci — Evolutionary Idea Search
- Genetic algorithm over 50-200 competing hypotheses with mutation, crossover, simulation fitness
- Deps: DEAP or PyGAD + domain simulators
- Status: No named version. Concept exists in academic papers.

### 10. KnowledgeReactor — Always-On Paper Synthesizer
- Event-driven: ingests arXiv papers, updates knowledge graph, detects gaps, spawns mini-projects
- Deps: Neo4j, arXiv RSS, Semantic Scholar API, Redis
- Status: **Partially built as Nightcrawler Research Toolkit (watchtower + synthesis).**

## Pure Algorithmic / Formal Methods

### 11. QD-Sci — Quality-Diversity Grid Search
- MAP-Elites grid maintaining diverse high-performing solutions across a feature space
- Deps: [pyribs](https://github.com/icaros-usc/pyribs) (MAP-Elites library)
- Status: Base QD framework exists. No science wrapper.

### 12. PySR-Auto — Symbolic Regression Discovery
- Genetic-programming symbolic regression: evolves closed-form equations from data + physics constraints
- Deps: [PySR](https://github.com/MilesCranmer/PySR)
- Status: **Exists.** Mature, high-performance library. Auto-scientist wrappers straightforward.

### 13. DreamerSci — World-Model Predictive Engine
- Learns a simulator from past experiments, uses MPC to optimize future experiment sequences
- Deps: [DreamerV3](https://github.com/danijar/dreamerv3) + JAX
- Status: Base world-model code exists. Applied to science planning in papers.

### 14. LeanExplorer — Formal Discovery Engine
- Monte-Carlo tree search inside Lean 4 to explore, prove, or disprove conjectures
- Deps: [Lean 4](https://github.com/leanprover/lean4) + mathlib
- Status: **Exists.** Active ecosystem with automated theorem explorers.

### 15. CausalOptiLab — Bayesian Causal Discovery
- Causal discovery + optimal experimental design: updates causal graphs, picks highest-info-gain interventions
- Deps: [DoWhy](https://github.com/py-why/dowhy) + [BoTorch](https://github.com/pytorch/botorch) + Pyro
- Status: Libraries exist and are combined in research. No all-in-one package.

## What We Built (Nightcrawler Research Toolkit)

Our toolkit covers **#10 KnowledgeReactor** — the gap that no existing tool fills:
- **Watchtower** monitors arXiv + Semantic Scholar for new relevant papers
- **Synthesis** merges findings into a running literature review with contradiction detection
- **Mission Templates** for 5 research types (survey, deep-dive, gap analysis, systematic review, follow-up)
- **Research Episode Skill** teaches Nightcrawler agents to use academic APIs and produce structured output
- **ncr CLI** ties it all together

The other 14 ideas remain as future directions or can be built as Nightcrawler mission templates.
