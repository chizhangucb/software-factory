# Software Factory

Autonomous pipeline that turns well-scoped tickets into merged code with as little human time as possible.

This file is the glossary: the words the specs, prompts, and docs all use for the same things. Name a concept here and every document names it the same way. Definitions only; how a thing is built lives in `README.md` and `docs/adr/`.

## Language

**Spec**:
A grilled, human-approved description of a feature. Produced by a grilling session then /to-spec. The parent issue of its tickets.
_Avoid_: PRD (Matt's word, same thing), plan.

**Ticket**:
One vertical slice of a spec, sized to one fresh context window, carrying acceptance criteria. Produced by /to-tickets. The unit the factory picks up.
_Avoid_: task, issue (the tracker's word for the container), sub-issue.
_Except_ as a heading: `# ISSUE` and `# LINKED ISSUE` are the vendored prompts' section headings and stay sandcastle's. The prose under them says ticket.

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

**Caller**:
The one workflow file a target repo carries, at its own `.github/workflows/factory.yml`. It calls the factory's reusable workflows and holds that target's inputs. Copied from `templates/factory.yml`.
_Avoid_: client, consumer, the target's workflow.

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
Whoever the factory will take instructions from, by GitHub's `author_association`. A ticket body is what the implementer executes, and a PR comment is what the reviewer and implement-pr read, so on a public target the dispatcher runs only tickets written by a trusted author, and every agent reads only trusted authors' comments, review threads and linked-ticket comments, with a count in place of what was dropped. Default: the repo owner alone.
_Avoid_: allowlist, whitelist.

**Trust policy**:
One target's answer to "whose words does an agent get to read", built once per run from `trusted_author_associations` and passed down as a required argument, so no read path can fall back to a policy of its own.
_Avoid_: trust list, trusted authors list (say trust policy for the object, trusted author for the person).

**Proof run**:
The acceptance test for the factory: seven tickets in two chains on a fixture repo, two accounts, one rate limit, zero human actions. Passed in #19; the switch that forced its rate limit is gone (#49), so a re-run needs a real one.

**Fixture repo**:
A throwaway target repo with a tiny project, used only by the proof run and ticket demos.

**Rotation**:
Choosing which subscription account a run uses, by remaining quota, and retrying once on the next one when a run is rate limited.

**Agent workflow**:
A workflow that runs a model. Named with sandcastle's `agent-` prefix, so the prefix is how a reader tells which jobs spend a subscription: `agent-implement`, `agent-review`, `agent-implement-pr`, `agent-audit`. Everything else under `.github/workflows/` runs no model and keeps a plain name.
_Avoid_: agent job (Actions' word for a step group inside a workflow).

**Harness**:
The CLI a run drives the model through, by sandcastle's provider name: `claude-code` today, `codex` or another vendor's under ADR 0001. What it bundles is the factory's to work around: skills the factory needs and the harness does not ship are vendored under `factory/plugins/`.
_Avoid_: runner (Actions' word for the machine), provider (sandcastle's word for the object), CLI.
