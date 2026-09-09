---
status: accepted
date: 2026-09-06
---

# The gate lives in CI, the reviewer is read-only, and auto-merge is on from day one

Every AFK pipeline we studied, sandcastle included, tells the agent to run tests and trusts that it did. Dex Horthy's evidence (his own lights-off outage, SlopCodeBench's 24% strict pass for Opus 5) and Huntley's placeholder warning say the same thing: an agent's "done" is a claim.

So the gate is required status checks on the PR: the target repo's own CI, a red-green proof (new tests must fail on main and pass on the branch), and a test-integrity check (no deleted, skipped, only, or todo tests). A separate fresh-context reviewer that never edits the branch ticks each acceptance criterion with evidence and emits a verdict as a required check. Merge is GitHub's native auto-merge plus merge queue, with no human and no LLM merger. Because the maintainer will not have a human merge path, the first 20 merges are each re-reviewed by an audit run on the strongest configured model, with a revert PR on a miss.

## Considered options

- **Human at the PR boundary, calibrate, then flip.** The industry default. Rejected by the maintainer: with 50 PRs a month they will not read them, and unread human review is auto-merge in disguise.
- **Edit-in-place reviewer (sandcastle's).** Rejected: a reviewer that pushes commits is a second implementer nobody reviews, and GitHub will not let it approve its own changes.
- **LLM merger agent.** Rejected: GitHub's merge queue does the rebase and re-test deterministically; an agent is needed only for true conflicts, which escalate in v0.

## Consequences

- Review-and-fix still happens, inside the implementer run (Matt's standards-and-spec review, then Anthropic's bugs-and-simplification review with fix) before any PR exists. One polish pass, one judge, never recursive reviews.
- Human surfaces are exactly four: grilling specs, the escalation queue, the first-20 audit findings, the digest.
- Maintainability backpressure (complexity and duplication deltas) is deferred but expected; RL never penalises erosion, so the gate must.

## Amendments

### 2026-09-07: no merge queue on user-owned repos, v0 uses auto-merge plus update-branch

GitHub offers merge queues only on organization-owned repos (public, or private on Enterprise Cloud). factory-fixture and chronicle are user-owned, so the queue half of this decision cannot ship in v0. Moving the repos under an organization is #26; switching to the real queue once they are there is #27. Until then the merge path is:

- Auto-merge, squash, enabled by the implement workflow with FACTORY_PAT the moment the PR is created. GitHub refuses auto-merge on a draft (verified: `enablePullRequestAutoMerge` answers "Pull request is a draft"), so factory PRs open ready, not draft; the required `factory/verdict` status, absent until the reviewer posts it and `failure` on a fail, is what holds the merge. Auto-merge fires when every required check is green on the head.
- A ruleset named `factory` on the target's default branch, created by `scripts/onboard.sh`: a PR is required, squash is the only merge method, and `factory/verdict`, `factory/red-green`, `factory/test-integrity` plus the target's own CI checks must pass on a head that is up to date with the branch (strict). Repository admins bypass so a human can push the caller workflow; auto-merge never bypasses.
- Deterministic branch updating in place of the queue's rebase: on every push to main, and on a `repository_dispatch` (`factory-update-branch`) the review workflow sends with FACTORY_PAT after a passing `factory/verdict`, `update-branch.yml` calls GitHub's update-branch API with FACTORY_PAT for each open PR that has auto-merge enabled and is behind main. The merge commit is made by the PAT, so the target's CI and the gate run again on the new head, and auto-merge lands the PR on the latest main. The decision (which PRs to update) is a pure function with unit tests, `factory/update-branch/plan.ts`. No LLM anywhere in this path.
- The passing `factory/verdict` is carried from the old head to the new one by the same job, with its provenance in the status description. The reviewer judged the PR's diff against its ticket; merging main into the head leaves that diff as it was, and the checks that can change (tests) do re-run. The verdict that governs a head is the one on the head itself, else the one found by walking first parents through two-parent merge commits GitHub itself made (committer `web-flow`); the walk stops at the first commit a person or an agent pushed, so such a commit never inherits a verdict. A failing or pending verdict is never carried; a PR whose governing verdict is pending or failed is not updated until its re-review.
- A conflict the API cannot resolve gets a comment and `agent:blocked`; escalation proper is #16. Amended 2026-09-07 (#19): conflicts no longer escalate at once. Attempt 1 of the proof run stalled here: the two concurrent chain heads had each appended to the target's README, so with chains running side by side a README-style conflict is routine, not rare, and parking the PR kills the whole chain behind it. A conflict update-branch cannot resolve now hands the PR to the implementer (`agent:implement` on the PR, with FACTORY_PAT so `agent-implement-pr.yml` fires); implement-pr detects the conflict with `git merge-tree` against the local `main` and the agent merges `main` into the branch, resolves keeping both sides, tests, and commits; the push re-runs CI, the gate, and the review, and auto-merge lands the new head. Escalation happens only if that run fails, through the #16 retry path. The "LLM merger agent" rejection above stands for the routine case; true conflicts are exactly where it said an agent is needed.

#### Consequences of the amendment

- Two PRs opened together both land: the first merges, its push to main triggers update-branch for the second, whose new head is re-tested and then merged. Each extra in-flight PR costs one more CI round per merge ahead of it, where a queue would batch; acceptable at the factory's v0 volume.
- The update happens in the target's workflow, so a target that does not carry the `push` and `repository_dispatch` triggers in its caller file stalls PRs behind main. `templates/factory.yml` has both.
- Commit statuses are always posted with GITHUB_TOKEN: the fine-grained FACTORY_PAT cannot write them (verified, 403), which also rules out a `status` event as the trigger.
- #27 removes the update-branch call, its triggers, and the verdict carry, and makes the three factory checks report on `merge_group`.

### 2026-09-07: the verdict walk trusts only merges the factory requested

GitHub also commits as `web-flow` when a person resolves a conflict in the web editor, and that merge changes the PR's diff. So update-branch posts a `factory/update-branch` status on the old head the moment its update call is accepted, and the first-parent walk crosses a GitHub merge only when the parent carries that marker. A walk that hits its hop limit reports `exhausted` and the PR is skipped with a request for a re-review, rather than being updated again with no verdict to carry.

### 2026-09-09: one section shape across the four ADRs (#75, story 10)

Every ADR now reads: front matter, title, the decision as made, `Considered options`, `Consequences`, `Amendments`. One dated `###` per amendment, oldest first; `####` for a section inside one. `Note` is gone as a heading. A correction to a single bullet stays inline with its own date, which is why "Amended 2026-09-07 (#19)" is still inside the conflict bullet rather than a section of its own. Applied to this file:

- The `Amendment, 2026-09-07` and `Note, 2026-09-07` sections moved under `Amendments` as dated `###` headings, in the order they were written, and `Consequences of the amendment` moved to `####`. The note was the second half of the same verdict-carry reasoning, so it is an amendment like the first.
- The opening paragraph was split in two, the evidence for distrusting an agent's "done" first and the gate that answers it second.
- `agent-implement-pr.yml` is now in backticks in the conflict bullet, matching how every other file in this ADR is written.
- Two sentences named the maintainer: the opening paragraph's reason for having no human merge path, and the first `Considered options` bullet. Both read "the maintainer" now, and the gendered pronoun in the second reads "they".

Nothing was cut from this file, and no decision it records about the gate, auto-merge or the audit changed. The required checks, the read-only reviewer, the squash-only ruleset, the verdict carry and the first-20 audit all read as they did.
