---
status: accepted
date: 2026-09-06
---

# The gate lives in CI, the reviewer is read-only, and auto-merge is on from day one

Every AFK pipeline we studied, sandcastle included, tells the agent to run tests and trusts that it did. Dex Horthy's evidence (his own lights-off outage, SlopCodeBench's 24% strict pass for Opus 5) and Huntley's placeholder warning say the same thing: an agent's "done" is a claim. So the gate is required status checks on the PR: the target repo's own CI, a red-green proof (new tests must fail on main and pass on the branch), and a test-integrity check (no deleted, skipped, only, or todo tests). A separate fresh-context reviewer that never edits the branch ticks each acceptance criterion with evidence and emits a verdict as a required check. Merge is GitHub's native auto-merge plus merge queue, with no human and no LLM merger. Because Chi will not have a human merge path, the first 20 merges are each re-reviewed by an audit run on the strongest configured model, with a revert PR on a miss.

## Considered options

- **Human at the PR boundary, calibrate, then flip.** The industry default. Rejected by Chi: with 50 PRs a month she will not read them, and unread human review is auto-merge in disguise.
- **Edit-in-place reviewer (sandcastle's).** Rejected: a reviewer that pushes commits is a second implementer nobody reviews, and GitHub will not let it approve its own changes.
- **LLM merger agent.** Rejected: GitHub's merge queue does the rebase and re-test deterministically; an agent is needed only for true conflicts, which escalate in v0.

## Consequences

- Review-and-fix still happens, inside the implementer run (Matt's standards-and-spec review, then Anthropic's bugs-and-simplification review with fix) before any PR exists. One polish pass, one judge, never recursive reviews.
- Human surfaces are exactly four: grilling specs, the escalation queue, the first-20 audit findings, the digest.
- Maintainability backpressure (complexity and duplication deltas) is deferred but expected; RL never penalises erosion, so the gate must.
