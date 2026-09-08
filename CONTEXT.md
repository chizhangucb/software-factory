# Software Factory

Autonomous pipeline that turns well-scoped tickets into merged code with as little human time as possible. This file is the glossary: the words the specs, prompts, and docs all use for the same things. No implementation details live here.

## Language

**Spec**:
A grilled, human-approved description of a feature. Produced by a grilling session then /to-spec. The parent issue of its tickets.
_Avoid_: PRD (Matt's word, same thing), plan.

**Ticket**:
One vertical slice of a spec, sized to one fresh context window, carrying acceptance criteria. Produced by /to-tickets. The unit the factory picks up.
_Avoid_: task, issue (the tracker's word for the container), sub-issue.

**Acceptance criteria**:
The checklist on a ticket that says what done means. Written before any agent starts. The reviewer ticks each one with evidence.

**Run**:
One agent's attempt at one ticket in one fresh sandbox, ending in a PR or an escalation.
_Avoid_: iteration (Ralph's word for a loop pass), session.

**Gate**:
The mechanical checks a PR must pass before it can merge. Lives in CI as required status checks, never only in an agent prompt.
_Avoid_: verification, validation, definition of done (say gate plus acceptance criteria).

**Placeholder**:
Code that satisfies the gate without doing the work: a stub, a hardcoded return, a test that asserts the stub, a skipped or deleted test.
_Avoid_: cheating, slop.

**Escalation**:
A ticket the factory gives up on after its retry cap. Labeled for a human, branch kept, log attached. The only queue a human must read.
_Avoid_: failure, blocked (the tracker's dependency word).

**Target repo**:
A repo the factory is allowed to work on. First one is chronicle.

**Implementer**:
The agent that runs one ticket and produces the PR. Never approves anything.

**Reviewer**:
The agent that judges a PR against its acceptance criteria and emits the verdict. Read-only on the branch.

**Verdict**:
The reviewer's pass or fail, delivered as a required status check. Merge needs gate green plus verdict pass.

**Calibration**:
The opening period when a human merges every PR to learn where the reviewer fails. Ends by decision, not by count.

**Audit**:
A re-review of a merged PR against its ticket, run by an agent on the strongest configured model, read-only. Every merged factory PR for the first 20; a sampled cadence after that (deferred). A miss reverts. Reported in the digest.

**Digest**:
The daily Telegram message listing merges, escalations, and audit findings. The human's inbox for the factory.

**Dispatcher**:
The step that moves a ticket into the factory once its blockers close. Bridges the human intent label to the factory's state labels.

**Trusted author**:
Whoever the factory will take instructions from. A ticket body is what the implementer executes, so on a public target the dispatcher runs only tickets written by an author it trusts, by GitHub's `author_association`. Default: the repo owner alone.
_Avoid_: allowlist, whitelist.

**Proof run**:
The acceptance test for the factory: seven tickets in two chains on a fixture repo, two accounts, one forced rate limit, zero human actions.

**Fixture repo**:
A throwaway target repo with a tiny project, used only by the proof run and ticket demos.

**Rotation**:
Choosing which subscription account a run uses, by remaining quota, and retrying once on the next one when a run is rate limited.

**Agent workflow**:
A workflow that runs a model. Named with sandcastle's `agent-` prefix, so the prefix is how a reader tells which jobs spend a subscription: `agent-implement`, `agent-review`, `agent-implement-pr`, `agent-audit`. Everything else under `.github/workflows/` runs no model and keeps a plain name.
_Avoid_: agent job (Actions' word for a step group inside a workflow).
