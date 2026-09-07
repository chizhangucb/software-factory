# Loop engineering, graph engineering, Grok Bot vs the Ralph loop

Research note for issue #4. Date: 2026-09-06. Primary sources only, cited inline. House style: blunt.

## TL;DR

- Loop engineering: a name (Addy Osmani, June 7 2026) for what Ralph already was: a system, not a person, prompts the agent until a stop condition holds. Anthropic adopted the term and mapped it onto `/goal`, `/loop`, `/schedule`, routines. Rebranding plus productization of Ralph, not a new mechanism.
- Graph engineering: a July 18 2026 X wave, not a coined technique. Nodes are agents, edges are routing, state travels the edges. LangChain's own response: this is LangGraph, three years old, and a loop is just a one-node cyclic graph. Anthropic's concrete artifact is dynamic workflows (a JS script Claude writes that fans out subagents). Extension of Ralph in one direction only: the plan moves from the prompt into code.
- Grok Bot: an xAI product (Aug 11 2026), not a technique. Persistent cloud VMs, named bots that message each other, a chief-of-staff pattern. The "ChatGPT moment" line is an a16z investor's quote relayed by press. Different mechanism from Ralph, aimed at office work, not repo work. Not a factory replacement.
- None of the three replaces the factory. Two ideas are worth stealing: the four-way loop taxonomy for naming what triggers and stops each stage, and dynamic workflows for parallel per-ticket fan-out with adversarial verification. The gate-in-CI plus read-only reviewer design already matches what every source says survives contact with production.

## The six X posts

x.com, xcancel, nitter, r.jina.ai, and Exa/Parallel fetch all failed (login wall, browser challenge, or 401 on network reputation). oembed and threadreaderapp.com worked for the tweet text and the article opener only. All six posts are X Articles, and the article bodies sit behind login. Below is what each actually says, as far as it could be read.

1. addyosmani, June 8 2026 (https://x.com/addyosmani/status/2064127981161959567). Opener recovered: "Loop Engineering. Loop engineering is replacing yourself as the person who prompts the agent. You design the system that does it instead. A loop here can be thought of a recursive goal where you define a purpose and..." This is the X mirror of his blog essay of June 7, read in full below. Body behind login; the blog is the primary source anyway.
2. dexhorthy, July 24 2026 (https://x.com/dexhorthy/status/2080697380379427275). Tweet text recovered in full: "gave up on waiting on nikita for the articles fix - part 1 is here part 2 is coming" linking X article 2078710413345402880. Article body could not be read. Same day Dex published his AI Engineer talk "Harness Engineering is not Enough: Why Software Factories Fail" (July 23), read via its transcript summary below; treat that talk as the substance. Part 1 body unread.
3. trq212 (Thariq Shihipar, Anthropic), June 2 2026 (https://x.com/trq212/status/2061907337154367865). Opener recovered: "A harness for every task: dynamic workflows in Claude Code. Last week, we released dynamic workflows in Claude Code. Claude can now write its own harness on the fly, custom-built for the task at hand." Same text as the claude.com blog post of June 2, read in full below.
4. AnatoliKopadze, July 24 2026 (https://x.com/AnatoliKopadze/status/2080668775796314331). Opener recovered: "Graph Engineering explained: what it is, when to use it and when not to. Most people are using AI at 5 to 10% of what it can actually do. There is a faster way, and it is bigger than it looks." Body unread. The account's prior threads on threadreader are crypto airdrop and memecoin guides, so weight accordingly.
5. 0xCodez, July 20 2026 (https://x.com/0xCodez/status/2079165300625330317). Opener recovered: "Graph Engineering with Claude: 14-Step roadmap from 0 to graph architect (Full Course). Most people who try to build a multi-step agent end up with a straight line. Step one, step two, step three - each waiting politely for the last to finish before it starts. 9/10 notice that half those..." Body unread. It is a course funnel published two days into the graph engineering wave.
6. DavidOndrej1, Aug 31 2026 (https://x.com/DavidOndrej1/status/2094424967345496191). Article 2094424686499160065, body unread. His public skill repo covers the same ground and is readable: `davidondrej/skills/skills/agent-orchestration/new-grok-bot/SKILL.md` (verified 2026-08-30 per its own header). Used below as his stated view.

Could not be read after all attempts: the article bodies of all six. Recovered: tweet text and dates for all six, article openers for 1, 3, 4, 5.

## Loop engineering

From the people who named it.

- Definition (Osmani, June 7 2026, https://addyosmani.com/blog/loop-engineering/): "Loop engineering is replacing yourself as the person who prompts the agent. You design the system that does it instead." He credits the framing to Peter Steinberger ("You should be designing loops that prompt your agents") and Boris Cherny ("My job is to write loops"). He calls it "one floor above the harness."
- Parts list (same essay): automations on a schedule, worktrees for parallel isolation, skills for project knowledge, plugins/connectors, subagents so "one of them has the idea and a different one checks it", plus a state file outside the context window. He maps all six onto both Codex and Claude Code.
- His own caveats, same essay: "its still early, I'm skeptical and you absolutely have to be careful about token costs." And: "Verification is still on you... 'done' is a claim and not a proof."
- He says the practice predates the name: "before we had primitives baked into Claude Code and Codex, loop engineering was heavily about setting up your own bash loop... a number of us were playing around with the Ralph loop by Geoff Huntley" (https://addyosmani.com/blog/practical-loop-engineering/, Aug 14 2026).
- Anthropic's version (Claude Code team, https://claude.com/blog/getting-started-with-loops): "we define loops as agents repeating cycles of work until a stop condition is met." Four types: turn-based (you prompt), goal-based (`/goal`, an evaluator model checks the condition each turn), time-based (`/loop`, `/schedule`), proactive (event or schedule, no human in real time; "Best used for: Recurring streams of well-defined work: bug reports, issue triage, migrations"). Their advice: "Not all tasks require complex loops; start with the simplest solution."
- `/goal` mechanics (https://code.claude.com/docs/en/goal): "After each turn, a small fast model checks whether the condition holds." The evaluator "doesn't run commands or read files independently," it judges from the transcript. So it is a model-judged stop, not a gate.

Relation to Ralph: rebranding plus productization. Ralph is `while :; do cat PROMPT.md | claude-code ; done` with one item per loop, specs and a plan file reloaded every pass, and "backpressure" from tests and type checkers (https://ghuntley.com/ralph/). Huntley's Jan 2026 follow-up says the pattern "is GENERIC and can be used for ALL TASKS" and that Ralph "is an orchestrator pattern where you allocate the array with the required backing specifications and then give it a goal then looping the goal" (https://ghuntley.com/loop). That is loop engineering's definition, six months earlier. What changed is that the bash loop became `/goal`, the plan file became routines, and the vendors named it.

Hype vs substance: the substance is real and old. The new bit is that the primitives ship in the product, so a loop is cheaper to build and easier to babysit. The hype is the "you shouldn't be prompting anymore" framing; Osmani himself hedges it in the same paragraph.

## Graph engineering

Nobody built a thing called graph engineering. It is a discourse wave with a few readable anchors.

- Trigger: Peter Steinberger, July 18 2026, twelve words: "Are we still talking loops or did we shift to graphs yet?" (https://x.com/steipete/status/2078277297791189132, quoted by LangChain below). Earlier uses exist: Itamar Friedman's "flow (/graph) engineering" in Feb 2024.
- The nearest thing to a builder's definition is LangChain's response (Runkle and Chase, July 22 2026, https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph): "In LangGraph, nodes do work... Edges define what happens next... You can think of this as a state machine." Their verdict on novelty: "Representing agentic systems as graphs isn't new, we've been doing it for three years!" and "Loop engineering isn't an alternative to graphs, so much as a simple version of them... a loop is just a directed, cyclic graph." What they concede is new: a node can now be a whole coding agent run, not just an LLM call.
- When not to graph, same post: "Some tasks are more agentic by nature, and forcing them into deterministic paths is the wrong move." They moved their own deep research off a fixed graph to an agent loop.
- Anthropic's concrete artifact, which the X courses lean on: dynamic workflows (https://code.claude.com/docs/en/workflows, blog https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code, Thariq Shihipar and Sid Bidasaria, June 2 2026). "A dynamic workflow is a JavaScript script that orchestrates subagents at scale. Claude writes the script... A workflow moves the plan into code." Named patterns: classify-and-act, fan-out-and-synthesize, adversarial verification, generate-and-filter, tournament, loop until done. Motivation stated as three failure modes of one long context: agentic laziness, self-preferential bias, goal drift. Cost warning in the same post: "dynamic workflows often use more tokens and are best suited for complex, high value tasks." Workflow subagents "always run in acceptEdits mode."
- Anthropic's earlier orchestrator-workers write-up reported the multi-agent version beat single-agent by 90.2% on an internal research eval and used about 15x the tokens of a chat turn (https://www.anthropic.com/engineering/built-multi-agent-research-system).
- A Sept 2026 arXiv paper adopts the name for "explicit, dynamic, evolving graph structures representing tasks, agents, and system states" (https://arxiv.org/abs/2608.21156). Academic packaging, after the fact.

Relation to Ralph: an extension in one specific way. Huntley argued explicitly against it: "everyone seemed to be trying to crack on multi-agent, agent-to-agent communication and multiplexing. At this stage, it's not needed... Ralph is monolithic... one task per loop" (https://ghuntley.com/ralph/). Graph engineering is the opposite bet: several nodes, a script holding the plan. Ralph's inner rules (fresh context per item, plan on disk, backpressure from tests) still apply inside each node.

Hype vs substance: mostly hype as a term, real as a pattern. Nothing shipped on July 18. Dynamic workflows had shipped seven weeks earlier and are the substance. The X "courses" (0xCodez, Kopadze) are funnels riding the wave; their openers are the only readable part and they say nothing a LangGraph README did not.

## Grok Bot

- What it is, from xAI (https://x.ai/news/introducing-grok-bot, Aug 11 2026, and https://docs.x.ai/grok-bot/overview): "Grok Bot is your team of always-on agents. They have their own computer, work inside tools and apps like you do, and keep working 24/7." Each account gets one persistent cloud VM with browser, filesystem, terminal. Bots "can independently message each other and share context in threads." Pattern they promote: "A chief of staff sits on top, with a specialist for each lane: inbox management, expenses, recruiting, bug fixes." Bots learn routines by watching you once. Beta for SuperGrok Heavy, Cursor Ultra, Cursor Teams Premium.
- Security caveat in their own docs: "Treat a login or file placed on the computer as available to all of your Bots... without getting separate security boundaries."
- The "ChatGPT moment" line: Gavin Baker (a16z) said tasks that took hours in Claude Code finish in 7 to 12 seconds in Grok Bot; reported by Crypto Briefing, Aug 31 2026 (https://cryptobriefing.com/grok-bot-coding-chatgpt-moment/). Same article notes Claude Code variants still score higher on SWE-bench. Investor quote, not a builder claim, and the timing metric is not from a benchmark.
- David Ondrej's stated view (his `new-grok-bot` SKILL.md): "A Grok Bot is a hire, not a prompt." His anti-patterns include "Repo-centric coding → Cursor / Grok Build" and "Needs hard isolation between duties... → shared computer makes this unsafe."
- xAI also ships an API-level multi-agent research model, `grok-4.20-multi-agent`, leader plus sub-agents, no client-side tools (https://docs.x.ai/developers/model-capabilities/text/multi-agent). Different product, same marketing umbrella.

Relation to Ralph: different mechanism. Ralph is one process, one repo, one task per loop, state on disk. Grok Bot is persistent named agents on a shared VM messaging each other, state in the bot's memory. It is closer to an office-assistant product than to a coding loop; even Ondrej redirects repo work elsewhere.

Hype vs substance: the product is real and the persistent-VM idea is a genuine form factor. The "ChatGPT moment for agents" is press amplification of one investor tweet. No independent reproduction of the productivity numbers found.

## What "loop engineering with batch run" meant for Chi

- Not a Claude Code feature. "Batch run" is AIOS's own practice: batches of Linear tickets run by parallel agents, recorded under `records/batch-run-2/` and `records/batch-run-3/` (Aug 12 to 13, 2026, chizhang-2 git history). No Claude Code doc page mentions "batch"; the docs index (https://code.claude.com/docs/llms.txt) has `/goal`, `/loop`, routines, and workflows only.
- Chi's own lesson, Aug 29 2026 session: "We actually did three or even more rounds of fixes on some very stupid and simple tasks by leveraging loop engineering. I think that is a big lesson." That matches Osmani's and Anthropic's warnings above: a model-judged "done" without a turn cap or a cheap deterministic stop overspends on trivial work.
- Closest Claude Code primitive to what she ran: `/goal` with a turn cap ("stop after 5 tries"), or a routine per ticket. The factory's gate-in-CI is the deterministic stop those runs lacked.

## Would any of them replace or improve the factory

The factory: issue to PR on GitHub Actions, gate as required status checks, read-only reviewer emitting a verdict, retry cap then escalation (CONTEXT.md).

- Replace: no. Every primary source that has run agents against a real codebase lands where the factory already is. Dex Horthy's lights-off factory (July 2025) failed because "maintainability erodes silently"; his fix is planning up front and keeping human review (AI Engineer talk, July 23 2026, https://www.youtube.com/watch?v=Ib5GBkD555M). Osmani: "'done' is a claim and not a proof." Anthropic's goal evaluator reads the transcript, it does not run the tests. The factory's gate runs the tests.
- Loop engineering improves naming, not mechanism. The factory is already a proactive loop in Anthropic's taxonomy (event triggered, per-task stop, runs until disabled). Adopt the vocabulary: say what triggers each stage and what stops it.
- Graph engineering, via dynamic workflows, could improve one stage: a run that fans out per file or per acceptance criterion and adversarially verifies each piece before the PR. Cost is the catch; the same post says use it for high value tasks only. Keep it inside the implementer's sandbox, never as the gate.
- Grok Bot does not fit. Shared VM, no security boundary between bots, repo work redirected to other tools by its own advocates, and no GitHub-native gate story.

## Recommendation for the factory

- Keep the architecture. Gate in CI plus read-only reviewer is the design the primary sources arrive at after failures, not before them.
- Steal the loop taxonomy: for each factory stage write down trigger, stop condition, and primitive. It exposes the missing turn cap that cost Chi three rounds on trivial tickets.
- Add a hard retry and turn cap per run, deterministic, before any model-judged stop. Anthropic's own example is "stop after 5 tries."
- Trial dynamic workflows inside the implementer for tickets that decompose (migrations, multi-file changes), with adversarial verification per piece. Measure tokens per merged PR against the plain run before making it default.
- Ignore "graph engineering" as a term and Grok Bot as a product for this factory. Revisit Grok Bot only if a non-repo lane (digest, triage chat) needs a persistent assistant, and read its shared-computer security note first.
- Open a follow-up to fetch the six article bodies from a logged-in browser and diff them against this note. Nothing here depends on them, but issue #4 asked for them.

## Sources

- https://addyosmani.com/blog/loop-engineering/ (June 7 2026)
- https://addyosmani.com/blog/practical-loop-engineering/ (Aug 14 2026)
- https://claude.com/blog/getting-started-with-loops (Claude Code team)
- https://code.claude.com/docs/en/goal
- https://code.claude.com/docs/en/workflows
- https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code (June 2 2026)
- https://www.anthropic.com/engineering/built-multi-agent-research-system
- https://ghuntley.com/ralph/ (July 2025) and https://ghuntley.com/loop (Jan 17 2026)
- https://www.langchain.com/blog/3-years-of-graph-engineering-with-langgraph (July 22 2026)
- https://arxiv.org/abs/2608.21156
- https://x.ai/news/introducing-grok-bot (Aug 11 2026), https://docs.x.ai/grok-bot/overview, https://docs.x.ai/developers/model-capabilities/text/multi-agent
- https://github.com/davidondrej/skills/blob/main/skills/agent-orchestration/new-grok-bot/SKILL.md
- https://cryptobriefing.com/grok-bot-coding-chatgpt-moment/ (Aug 31 2026, secondary, for the a16z quote only)
- https://www.youtube.com/watch?v=Ib5GBkD555M (Dex Horthy, AI Engineer, July 23 2026)
- The six X posts listed above, read via publish.twitter.com/oembed and threadreaderapp.com

## Addendum: the six article bodies, read in full (2026-09-06, via Chi's logged-in browser)

All six X Articles were read end to end, plus Dex Horthy's parts 2 and 3, which part 1 defers to. Nothing above is retracted. What the full bodies add:

### Addy Osmani, "Loop Engineering" (Jun 8 2026, 2.3M views)
- Five building blocks plus memory: scheduled automations, worktrees, skills, connectors, sub-agents, and a state file outside the model. Both Claude Code and Codex ship all five.
- `/goal` uses a separate small model to judge the stop condition, which is "the maker and checker split applied to the stop condition itself." It reads the transcript, it does not run the tests.
- His own caveats, verbatim in spirit: verification is still on you, "done is a claim and not a proof," comprehension debt grows faster with a smoother loop, and "if I relied entirely on automated loops ... my product's quality would suffer."
- Source: https://x.com/addyosmani/status/2064127981161959567

### Thariq Shihipar (Anthropic), "A harness for every task: dynamic workflows" (Jun 2 2026)
- Dynamic workflows: Claude writes a JS orchestration script, spawns subagents with schemas, worktrees, model choice. Trigger word "ultracode".
- Names the three failure modes it exists to fight: agentic laziness, self-preferential bias, goal drift. Patterns: classify-and-act, fan-out-and-synthesize, adversarial verification, generate-and-filter, tournament, loop-until-done.
- Explicit guidance: "most traditional coding tasks do not need a panel of 5 reviewers." Token budgets can be set in the prompt.
- Source: https://x.com/trq212/status/2061907337154367865

### Dex Horthy, "Why Software Factories Fail" parts 1 to 3 (Jul 24 to 27 2026, 570K views on part 1)
- Part 1 thesis: lights-off factories fail because of model training, not harness quality. RL rewards FAIL_TO_PASS and PASS_TO_PASS; "there is no penalty for eroding codebase maintainability." Test edits are thrown away in eval because models "quietly comment out the failing test or splice in a mock."
- His own July 2025 lights-off attempt: outages, then a two week hand rewrite by his cofounder in November.
- Part 2: put code review back. Front-load four human-in-the-loop phases: product review, system architecture, program design (types, signatures, call-stack trees), vertical slices. ~40% of tasks still one-shot. "30 minutes of planning saves hours of review." "Read the dang code."
- Part 3: SlopCodeBench (UW Madison, March 2026), incrementally divulged specs with held-out black-box tests per checkpoint. Opus 5 strict pass 24% on his subset, Opus 4.8 and Sonnet 5 at 6%. No model finished any challenge defect-free, including the "easy" one. His read: "today's models can't be relied on to run lights-off without steering." Cognition's Frontier Code penalises tests that do not fail on pre-patch code, which is the red-green rule.
- Sources: https://x.com/dexhorthy/status/2080697380379427275, https://x.com/dexhorthy/status/2081058573556306030, https://x.com/dexhorthy/status/2081797628552270027

### Anatoli Kopadze, "Graph Engineering explained" (Jul 24 2026, 12M views)
- Graph = nodes with contracts plus edges that carry data. The "fake edge test": drop sequencing that carries no data and run those steps in parallel. The diamond: fan out, reduce in code, verify with a fresh context skeptic, synthesise.
- His best point, section 9, "anchors": a graph that only checks itself is "consistent, nothing verified." Needs nodes that cannot be argued with: "tests that actually ran, not should pass, did pass." Rules the optimiser would bend must be frozen.
- It is dynamic workflows repackaged; his own build instructions are "put the word workflow in your prompt." Cites Bun's rewrite at roughly $165K usage.
- Source: https://x.com/AnatoliKopadze/status/2080668775796314331

### 0xCodez, "Graph Engineering with Claude: 14-step roadmap" (Jul 20 2026, 7.4M views)
- A tutorial on the dynamic workflows API: schemas as edge contracts, `parallel()`, barriers, conditionals, a verifier on the edge, worktree isolation, converging cycles, model tiering, self-routing. Same substance as Kopadze with code. Substack funnel.
- Source: https://x.com/0xCodez/status/2079165300625330317

### David Ondrej, "Agentic Engineering Setup" (Aug 31 2026)
- Subscriptions over API: "do not pay API pricing." Recommends stacking $200 plans; says the Cursor plan gives separate limits for Cursor and Grok Bot.
- Cloud agents are the future (cites Cursor's internal merged-PR share from cloud agents rising from 10 to 15% to near 60% in 2026), but warns of lock-in; his answer is a cheap VPS running Herdr with SSH.
- Reviews: `/total-review` runs two models (GPT-5.6 Sol and Fable 5) and dedupes. "NEVER do recursive reviews ... models invent imaginary bugs." ADRs in every repo. Models bloat tests; say "don't add tests" to land at the right amount. Read-only prod DB role for agents.
- Grok Bot is mentioned only as an interaction layer worth a subscription; nothing on its mechanism.
- Source: https://x.com/DavidOndrej1/status/2094424967345496191

### What the full read changes for the factory
- Nothing replaces the loop. Every primary source that ran agents on real code lands on: deterministic gate, separate fresh-context verifier, human review somewhere.
- Dex's SlopCodeBench numbers are the strongest evidence in this note and cut against a fully lights-off design. They argue for two additions to the map: maintainability backpressure in the gate (complexity and duplication deltas, not just pass or fail) and a standing human code-reading sample after calibration, not only an agent audit.
- Dex's front-loaded phases map onto Chi's grilling, /to-spec, and /to-tickets. The one missing phase is program design (types, signatures, call trees) inside the spec.
- Ondrej's "never recursive reviews" and Thariq's "no panel of five" both say: one implementer polish pass plus one reviewer, not more.
- Kopadze's "anchors" is the same rule as the factory's "gate lives in CI, never in a prompt."
