# Software Factory

Autonomous pipeline that turns well-scoped tickets into merged code with as little human time as possible.

This file is the glossary: the words the specs, prompts, and docs all use for the same things. Name a concept here and every document names it the same way. Definitions only; how a thing is built lives in `docs/pipeline.md` and `docs/adr/`.

It binds the factory's own prose, not vendored text: where a name is sandcastle's and the behaviour under it is his, his name stays and the term's `_Except_` line says so.

## Language

**Spec**:
A grilled, human-approved description of a feature. Produced by a grilling session then /to-spec. The parent issue of its tickets.
_Avoid_: PRD (Matt's word, same thing), plan.
_Except_ as a vendored step name: the `Refuse PRD-shaped issue` step in `.github/workflows/agent-implement.yml` stays sandcastle's. `docs/provenance/sandcastle-files.md` records that row as kept, wording only.

**Ticket**:
One vertical slice of a spec, sized to one fresh context window, carrying acceptance criteria. Produced by /to-tickets. The unit the factory picks up.
_Avoid_: task, issue (the tracker's word for the container), sub-issue.
_Except_ as a heading: `# ISSUE` and `# LINKED ISSUE` are the vendored prompts' section headings and stay sandcastle's. The prose under them says ticket.

**Acceptance criteria**:
The checklist on a ticket that says what done means. Written before any agent starts. The reviewer ticks each one with evidence.

**Run**:
One agent's attempt at one ticket in one fresh sandbox, ending in a PR or an escalation.
_Avoid_: iteration (Ralph's word for a loop pass), session.

**Merge gate**:
The mechanical checks a PR must pass before it can merge. Lives in CI as required status checks, never only in an agent prompt. Its own name is `merge-gate`: the workflow, the job and the module folder all carry it, while the checks it posts keep the `factory/` prefix that says whose they are.
_Avoid_: gate on its own, because a target's own CI is often called one too (chronicle's is literally titled `CI Gate`) and because a guard is the other thing the bare word suggests; verification, validation, definition of done (say merge gate plus acceptance criteria).

**Guard**:
A check that refuses one action before it happens, in the harness rather than in CI. Lives under `scripts/guards/` and is wired from `.claude/settings.json`. Distinct from a merge gate: a merge gate blocks a merge after the work, a guard blocks a tool call before it. An accident net, never a security boundary.
_Avoid_: merge gate (the merge word), gate on its own (too broad to name either), hook (the harness's word for how a guard is wired).

**Test command**:
The one command a target's caller hands the merge gate to run a changed test file with, defaulting to `node --test`. Each file gets its own invocation of it, so a failure names the file that failed and no other. The whole-suite command the reviewer and the audit run shares the caller input's name and is a different thing.
_Avoid_: runner, test runner (the Harness entry reserves runner as Actions' word for the machine).

**Placeholder**:
Code that satisfies the merge gate without doing the work: a stub, a hardcoded return, a test that asserts the stub, a skipped test, or a deleted test the ticket does not remove.
_Avoid_: cheating, slop.

**Escalation**:
A ticket the factory gives up on after its retry cap. Labeled for a human, branch kept, log attached. The only queue a human must read.
_Avoid_: failure, blocked (the tracker's dependency word).

**Requeue**:
A run handed back to the queue because what stopped it was not the ticket's failure: every account rate limited, or a check still pending when the wait for it runs out. A comment naming the cause, no retry spent, and no label for a human. One meaning on both sides (#148): a ticket is left with no factory label for the dispatcher, a PR in `agent:in-progress` for the reconciler, which re-adds the start label at its stuck deadline.
_Avoid_: retry (the attempt that is counted), hand-off (the implementer's, for a conflict), blocked (a human's).

**Hand-off**:
A PR given back to the implementer because it conflicts with its base: a comment naming the cause, then `agent:implement`, with no retry spent. Made by update-branch when the API cannot bring the branch up to date, and by the retry handler when GitHub reports the conflict during its wait for checks. Never for a human: that is `agent:blocked`.
_Avoid_: requeue (the retry handler's other no-retry path: a ticket goes back to the dispatcher, a PR to the reconciler), escalation (the human queue).

**Target repo**:
A repo the factory is allowed to work on. First one is chronicle.

**Caller**:
The one workflow file a target repo carries, at its own `.github/workflows/factory.yml`. It calls the factory's reusable workflows and holds that target's inputs. Copied from `templates/factory.yml`.
_Avoid_: client, consumer, the target's workflow.

**Maintainer**:
The human who owns a target repo and the factory working on it. Sets the trust policy and answers what the factory escalates. The actor every spec's user stories are written for, so a spec stays readable when somebody else holds the role.
_Avoid_: owner (GitHub's word for the account holder), user, a personal name.

**Implementer**:
The agent that runs one ticket and produces the PR. Never approves anything.

**Reviewer**:
The agent that judges a PR against its acceptance criteria and emits the verdict. Read-only on the branch.

**Verdict**:
The reviewer's pass or fail, delivered as a required status check. Merge needs the merge gate green plus verdict pass.

**Factory PR**:
A PR the factory opened or worked on: a branch under `agent/`, the marker the implement workflow writes in the body, or the reviewer's verdict section in the body. A human can open one and the factory still owns it, so a PR implement-pr worked on counts. One definition, `factory/lib/factory-pr.ts`, read by the audit and the reconciler.
_Avoid_: agent PR, bot PR.

**Audit**:
A re-review of a merged PR against its ticket, read-only, run by an agent on the model the maintainer configured, which should be the strongest the subscription serves. Every merged factory PR for the first 20; a sampled cadence after that (deferred). A miss reverts. Reported in the digest.

**Digest**:
The daily Telegram message listing merges, escalations, and audit findings. The human's inbox for the factory.

**Dispatcher**:
The step that moves a ticket into the factory once its blockers close. Bridges the human intent label to the factory's state labels.

**Heartbeat**:
The `factory-sweep` dispatch sent to a target on an interval from outside GitHub, because the caller's own `schedule` does not reliably fire. It is what actually drives the dispatcher's sweep and the reconciler, so it is required and the `schedule` is the fallback, not the other way round. One sender covers any number of targets.
_Avoid_: cron (GitHub's word for the `schedule` trigger), the sweep (what the heartbeat triggers, not the heartbeat itself).

**Trusted author**:
Whoever the factory will take instructions from, by GitHub's `author_association`. A ticket body is what the implementer executes, and a PR comment is what the reviewer and implement-pr read, so on a public target the dispatcher runs only tickets written by a trusted author, and every agent reads only trusted authors' comments, review threads and linked-ticket comments, with a count in place of what was dropped. Default: the repo owner alone.
_Avoid_: allowlist, whitelist.

**Trust policy**:
One target's answer to "whose words does an agent get to read", built once per run from `trusted_author_associations` and passed down as a required argument, so no read path can fall back to a policy of its own.
_Avoid_: trust list, trusted authors list (say trust policy for the object, trusted author for the person).

**Channel**:
One place the factory reads words an agent will act on: a PR comment, a review summary, a review thread, a ticket comment, a ticket's author, a parent spec, the retry marker. The trust policy owns the list and judges by it, so which channels carry the factory's own voice is the policy's answer rather than a reader's (#80).
_Avoid_: source, surface.

**Spec run**:
Every ticket of one spec worked to a merged PR or an escalation on a target repo, with no human action except reading what escalates. Composed of many runs; the first is chronicle spec #294.
_Avoid_: proof run (the fixture repo's acceptance test, a different thing), end-to-end run, real run, production run.

**Proof run**:
The acceptance test for the factory: seven tickets in two chains on a fixture repo, two accounts, one rate limit, zero human actions. Passed in #19; the switch that forced its rate limit is gone (#49), so a re-run needs a real one.
_Avoid_: spec run (a real spec on a real target, judged by what it ships rather than by what it proves).

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
