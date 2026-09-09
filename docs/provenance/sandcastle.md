# Sandcastle 0.12.0 and this factory: what is his, what is ours, what changed

Not a fork of [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle), and not an original pipeline either. Three of his GitHub Actions workflows, their scripts and their prompts were copied in and extended; his npm library is a pinned dependency, unmodified; everything else was written here. This document says which is which, file by file, and it is the evidence for ADR 0002 (`docs/adr/0002-vendored-sandcastle-engine.md`), which cites it.

- **Verified against the tree of 2026-09-09.** Every "Ours now" count, every repo path and every tree enumerated below was re-derived from the tree that day rather than carried forward, covering the boundary move (#47), the workflow rename (#61), the tarball move (#48), the writing-for-agents pass over the prompts (#56) and the prompt audit (story 14 of #75). The surviving-line figures come from the 2026-09-08 comparison against his clone, except the three prompt rows, which the prompt audit re-counted against him. A change under `factory/agent-workflows/` or `.github/workflows/agent-*.yml` updates this file, and sections 5 and 6 say which counts it moves.
- **Reference for the comparison**: a clone of sandcastle at tag `v0.12.0`, commit `e99f832`, plus `npm pack @ai-hero/sandcastle@0.12.0`. Repo HEAD and the tag are the same commit; `git log v0.12.0..HEAD` is empty.
- **Other sources**: this repo's `git log --follow`, ADRs 0001 to 0004, spec #9, spec #46, and the two dated research snapshots in `docs/research/`.
- **Line counting method, used everywhere below**: non-blank, non-comment lines, whitespace normalised; one of his lines survives if the same normalised line appears anywhere in our version of that file. Coarse: it undercounts a line reindented into a different shape.
- Matt's YouTube demonstration of the pipeline could not be fetched, so every claim about his intent comes from his README, his workflow files or his code.

## 1. What sandcastle is

Two things share the name, and only one was copied.

- **The npm library** (`src/`, published as `dist/`, `@ai-hero/sandcastle`). His README calls it "A TypeScript library for orchestrating AI coding agents in isolated sandboxes". `run()` resolves a prompt file, runs `claude -p` in a sandbox provider (Docker, Podman, Vercel, Daytona, or none), waits for `<promise>COMPLETE</promise>`, collects commits and usage, and can extract a JSON `<output>` block.
- **The dogfood pipeline in his own repo**: `.github/workflows/agent-*.yml` plus `.sandcastle/agent-workflows/**`. Label-driven Actions calling `run()` with `noSandbox()`. His README and docs site never mention it. This is what was copied.

The library is a dependency, unmodified. `package.json` pins it to exactly `0.12.0`; `package-lock.json`'s `integrity` for `node_modules/@ai-hero/sandcastle` is the live check `npm ci` verifies every run; the tarball is cold storage on this repo's `engine-0.12.0` release and nothing fetches it, where #48 moved it (ADR 0002's 2026-09-08 amendment).

Nothing from `src/` was copied. Re-verified on 2026-09-08 by grepping all 161 exported names of his `src/*.ts` against `factory/`: the only matches are `run`, `claudeCode` and `Output`, all reached through the package, plus `create` and `remove` in unrelated contexts. Add the sub-path export `noSandbox` (`@ai-hero/sandcastle/sandboxes/no-sandbox`), absent from that list, and the whole contract is four names and a few types, as `docs/research/sandcastle-inventory-2026-09.md` proposed:

| Used | Where |
|---|---|
| `run()` | `factory/agent-workflows/shared/run-with-extraction.ts` and `factory/agent-workflows/implement/implement.ts`. The reviewer, implement-pr and the audit reach it through `runWithExtraction` |
| `claudeCode()` | `factory/agent-workflows/shared/common.ts` |
| `noSandbox()` | the four scripts that build a `run()` call: `implement/implement.ts`, `review/review.ts`, `implement-pr/implement-pr.ts` and `factory/audit/audit.ts` |
| `Output.object()` | `review/review.ts`, `implement-pr/implement-pr.ts` and `factory/audit/audit.ts`; `shared/run-with-extraction.ts` takes the definition they build and never calls it |
| types `RunOptions`, `RunResult`, `OutputObjectDefinition`, `AgentProvider`, `AgentStreamEvent`, `LoggingOption` | the same files |

## 2. His pipeline's autonomy, honestly

The section a stranger needs, because "sandcastle already does this" and "sandcastle does almost none of this" are both said about the same repo.

**Sandcastle's autonomy lives in a local Ralph loop.** His `simple-loop` template is the autonomous product: an agent picks the next unblocked issue, commits directly, closes it, and a human QAs the app afterwards. The dispatcher here is that loop distributed across cloud runners with a judge in the way. His loop is one machine a person watches; this one is many jobs nobody watches, so everything the factory adds is the cost of removing the person.

His Actions pipeline, the part that was copied, is less autonomous than that loop. It runs with no human for exactly three things: the implement run, once `agent:implement` is on an issue, which adds `agent:review` itself; the review agent, whose prompt says "Actively improve the branch when a concrete improvement is warranted" and whose workflow pushes its commits and runs `gh pr ready`; and the update-branch agent, which merges main into the branch and resolves conflicts once labeled.

A human does everything else, quoted from his workflow files because his README is silent on it:

- Applying `agent:implement` and `agent:update-branch`. Nothing labels an issue.
- Merging. PRs open with `--draft`, and no step merges or enables auto-merge.
- Failure: "`agent:implement` run failed... Re-add `agent:implement` to retry." The same text in all five workflows. One attempt, then `agent:blocked`.
- Refusals: "Close it first, then re-add `agent:implement`."

Section 9 has the rest story by story. In short: no dependency ordering, no escalation, no accounts or rotation, one token secret, and a `verdict.txt` that is only `improved` or `clean`.

## 3. The file map: every file to its origin

One rule, and then the lists that make it checkable file by file, so nobody has to trust the rule on its own.

> Under `factory/`, the folder `agent-workflows/` is sandcastle's and everything else is this repo's. Under `.github/workflows/`, the three named below are his and the rest are this repo's.

A provenance boundary, not a dependency one: factory-authored modules import his primitives (`fail`, `sh`, `outputDir` from `shared/common.ts`), and his `gh` wrapper now re-exports ours.

### Vendored from sandcastle 0.12.0

Sixteen files, each with a row further down: three workflows, `.github/workflows/agent-implement.yml`, `.github/workflows/agent-review.yml` and `.github/workflows/agent-implement-pr.yml`, stepped through in section 5; thirteen scripts and prompts under `factory/agent-workflows/`, one row each in section 6's table. His path is `.sandcastle/agent-workflows/<same>` for a script or prompt and `.github/workflows/<same>` for a workflow.

Every line differing from his carries a comment naming the ticket or ADR that forced it (#47). A vendored `.md` carries none, because a comment in a prompt is context the model reads; the sibling script's header accounts for the prompt too.

Three files in that subtree are ours, because he ships no tests: `factory/agent-workflows/shared/diff-lines.test.ts`, `factory/agent-workflows/shared/review-output.test.ts` and `factory/agent-workflows/shared/review-context.test.ts`, the last added by #52 to prove the trust filtering over fixtures with no network. The first two say so in their opening comment; `review-context.test.ts` does not, so this paragraph is the only record that it is ours.

### Written here, no sandcastle counterpart

| Path | What it is |
|---|---|
| `.github/workflows/agent-audit.yml` | the first-20 audit; an agent workflow with no counterpart of his |
| `.github/workflows/dispatch.yml` | the dispatcher |
| `.github/workflows/gate.yml` | the gate checks |
| `.github/workflows/update-branch.yml` | the merge-queue stand-in |
| `.github/workflows/ci.yml` | this repo's own CI |
| `.github/dependabot.yml` | watches the sandcastle and Claude Code pins |
| `factory/audit/` | `audit.ts`, `decide.ts`, `fill-links.ts`, `output.ts`, `plan.ts`, `plan.test.ts`, `report.ts`, `report.test.ts`, `prompt.md`, `extraction.md`, `state.sh` |
| `factory/dispatch/` | `dispatch.ts`, `sweep.ts`, `select.ts`, `reconcile.ts`, `gh-read.ts`, a `.test.ts` for the last three, `workflow-names.test.ts`, `fixtures/pages/*.json` |
| `factory/gate/` | `gate.ts`, `changed-files.ts`, `red-green.ts`, `removes.ts`, `test-integrity.ts`, their four `.test.ts` |
| `factory/retry/` | `retry.ts`, `context.ts`, `checks.ts`, `decide.ts`, `escalation.ts`, `checks.test.ts`, `decide.test.ts`, `escalation.test.ts` |
| `factory/update-branch/` | `update-branch.ts`, `plan.ts`, `plan.test.ts` |
| `factory/onboard/` | `onboard.test.ts`, which runs `scripts/onboard.sh` against a stub `gh` (story 7 of #75). The script it tests lives under `scripts/`, but `npm test` globs `factory/**/*.test.ts`, so the test lives here |
| `factory/guards/` | `require-worktree-isolation.test.ts`, the hook contract for `scripts/guards/require-worktree-isolation.sh` (story 15 of #75), here for the same globbing reason |
| `factory/lib/` | `accounts.ts`, `conflicts.ts`, `errors.ts`, `factory-pr.ts`, `gh.ts`, `harness.ts`, `labels.ts`, `linked-issue.ts`, `model.ts`, `plugins.ts`, `preflight.ts`, `read-only.ts`, `rotation.ts`, `run-log.ts`, `ticket-context.ts`, `trusted-authors.ts`, `usage.ts`, `usage-record.ts`, `verdict.ts`, a `.test.ts` sibling for each of those except `errors.ts`, `labels.ts` and `read-only.ts`, plus `strip-types-cone.test.ts` (which reads workflow files, so it has no source sibling), `upsert-comment.sh` and `fixtures/` |
| `factory/plugins/` | `README.md`, plus `mattpocock-skills/` vendored whole at 1.2.3 (`LICENSE`, `.claude-plugin/plugin.json`, and all 25 skills under `skills/engineering/` and `skills/productivity/`). A different upstream, not sandcastle. A one-skill subset until #54 took the whole plugin (story 11 of #46), so which of Matt's skills the factory carries is visible rather than cherry-picked |
| `templates/factory.yml` | the caller a target copies. The file is ours; `templates/` is sandcastle's word for the folder |
| `scripts/onboard.sh` | labels, auto-merge, and the `factory` ruleset on a target |
| `scripts/guards/require-worktree-isolation.sh` | the `PreToolUse` hook that refuses a subagent call handing over a worktree path (story 15 of #75) |
| `.claude/settings.json` | wires that hook in through `$CLAUDE_PROJECT_DIR`, so it survives the repo going public with no local path in it |
| `AGENTS.md`, `CONTEXT.md`, `README.md`, `docs/**` | all this repo's, including this file |
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` | this repo's |

`factory/lib/` is where the boundary move (#47) put the factory-authored modules that used to sit in his `shared/` folder: `preflight.ts`, `conflicts.ts` and `errors.ts` moved out of the vendored subtree, and `gh.ts` is now the repo's one gh wrapper, which `shared/common.ts` re-exports.

## 4. His five agent workflows, and what happened to each

| Workflow | Trigger | What it does | Copied? |
|---|---|---|---|
| agent-implement | `issues: labeled` `agent:implement` | refuse sub-issues, PRD issues, and issues with an open collaborator PR; branch `agent/issue-N-slug`; run implement.ts; force push; open a draft PR; add `agent:review` | yes |
| agent-review | `pull_request_target: labeled` `agent:review` | run review.ts, which may commit; push with lease; post a review; `gh pr ready`; reply to threads | yes |
| agent-implement-pr | `pull_request_target: labeled` `agent:implement` | run implement-pr.ts against unresolved threads; push; post replies and comments | yes |
| agent-update-branch | `pull_request_target: labeled` `agent:update-branch` | merge base into the branch; on conflict an agent resolves; push | no |
| agent-explore | `issues: labeled` `agent:explore` | agent investigates, posts one comment | no |

### What was not copied, and why

- **`agent-update-branch.yml` and `.sandcastle/agent-workflows/update-branch/`** (`update-branch.ts`, `prompt.md`, `extraction.md`). #9's Out of Scope said "the update-branch agent for true conflicts... conflicts escalate in v0", and #21 agreed. #19 then reversed that and built conflict resolution into implement-pr rather than copying his: the largest avoidable rewrite in the vendoring, kept as built for the reason section 8's "Conflict resolution reinvented in implement-pr" gives.
- **`agent-explore.yml` and `.sandcastle/agent-workflows/explore/`**. #21 called it "safe to ignore" and #9 excludes "any planner that invents work".
- **`release.yml`**. Changesets publish to npm; this repo publishes nothing.
- **His `ci.yml`**. `npm ci`, build and test for his own library.
- **`.sandcastle/run.ts` and `plan-prompt.md`, `implement-prompt.md`, `merge-prompt.md`, `review-prompt.md`**. His dogfood parallel-planner loop over Docker, excluded with the planner.
- **`.sandcastle/CODING_STANDARDS.md`**. His house rules, cited by his prompts. The target repo's own `CLAUDE.md`, `CONTEXT.md` and `docs/adr/` take that role (story 23 of #9), so the reference was stripped from the copied prompts.
- **`.sandcastle/Dockerfile`, `test-interactive.ts`, `test-podman.ts`, `test-vercel.ts`, `.env.example`, `.gitignore`**. Image and manual smoke scripts for sandbox providers v0 does not use, plus local-run config.
- **`src/`, `dist/templates/**`, the `sandcastle` CLI (`dist/main.js`), his `docs/` site and his own 20 ADRs.** The library is installed, not copied; the CLI and the scaffolding templates are unused; his docs are his.

## 5. The three copied workflows, step by step

**Changing a step in one of his three workflows starts here.** Find it in that workflow's table, its kept list, or the shared list below. A step of his is vendored text, so section 3 says what changing it obliges; a step in an "Added" list is ours and free to change.

Line survival, by the method at the top:

| Workflow | His lines surviving | Ours now | His share of ours |
|---|---|---|---|
| agent-implement.yml | 129 of 188 (69%) | 392 | 33% |
| agent-review.yml | 81 of 112 (72%) | 287 | 28% |
| agent-implement-pr.yml | 123 of 155 (79%) | 356 | 35% |

The "10 to 20 percent of sandcastle is left" impression comes from growth, not deletion: the files are two to two and a half times longer because of the added steps, so his share falls while the count of his surviving lines barely moves.

Some changes landed identically in every workflow, so they are stated once rather than in all three tables:

- **Removed everywhere**: **Install dependencies** and **Build**, which exist only so his scripts can self-reference his own `dist/`. The factory installs the pinned package instead, folding **Install Claude Code** in with them as "Install factory (pinned sandcastle, tsx, Claude Code)", from this repo's lockfile rather than `npm i -g` unpinned (#21, `8f0c3f1`).
- **Added everywhere**: the `slot` job, "Enumerate accounts" and "Always remove the accounts file" (`27d972e`, stories 15, 17), "Checkout factory" (`8f0c3f1`, story 24), "Upload run log" (`8f0c3f1`, story 12), "Post usage comment" (`ef60ebd`, story 27). `trusted_author_associations` is an input on all four agent workflows (#52).
- **Added to review and implement-pr**: `refuse-fork` (`20e5f95`), since `pull_request_target` runs with secrets on a fork's head.
- **Added to implement and implement-pr**: "Collect the retry handoff" and the separate `retry:` job behind it (#51, story 20 of #46).

### agent-implement.yml

Kept as his: **Refuse existing PR**, **Transition labels**, **Compute branch name**.

| His step | Ours | Why, cited |
|---|---|---|
| Detect issue shape | changed | sub-issue half dropped (`594fc6a`, story 22, ADR 0002 "sub-issue refusal is removed"); closed-issue check added (`65abf07`, #19) |
| Refuse PRD-shaped issue | kept | wording only. `CONTEXT.md` cites this row: his step name stays, because the glossary binds the factory's own prose, not a vendored step name (story 13 of #75) |
| Refuse sub-issue | removed | same |
| Preflight existing PR | changed | moved into `factory/lib/preflight.ts`, so the closing-keyword regex is shared with the gate, the reviewer and the retry handler (`c722a10`) |
| Checkout main | changed | `path: target`, FACTORY_PAT, `persist-credentials: false` (`8f0c3f1`, `20e5f95`, "no PAT in the agent's reach") |
| Create branch | changed | resume the pushed branch on a retry (`87d0eb0`, story 12). His bot identity `sandcastle-agent[bot]` is back (#47) |
| Setup Node.js | changed | `node_version` input (`4d2ca78`). Also runs earlier than he runs it, next to our "Checkout factory", because the preflight is now a Node script |
| Run implementation agent | changed | env for model, trusted authors, OUTPUT_DIR (`8f0c3f1`, `5de4ebd`, `27d972e`, `4d2ca78`). The turn cap and the forced-rate-limit knob were here too until #49 deleted both (#46, stories 18 and 19) |
| Push branch | changed | PAT in the URL, push `refs/heads/$BRANCH` (`20e5f95`, `c722a10`); ADR 0002 "pushes use a PAT so CI runs" |
| Open draft PR | changed | renamed "Open PR" and not a draft: GitHub refuses auto-merge on drafts (`0431d99`, ADR 0003 amendment) |
| Request automated review | kept in shape | his AGENT_PAT-or-GITHUB_TOKEN fallback restored with FACTORY_PAT in AGENT_PAT's place, plus a warning that a GITHUB_TOKEN label fires no event (#47) |
| Mark blocked on failure | moved out | his step became the factory's retry-and-escalate path, which #51 moved into the `retry:` job, on `needs: implement` and `always()`: a `timeout-minutes` kill cancels the implement job, so a step gated on `failure()` never runs and a stuck agent stranded its ticket. The blocked comment is still the fallback (`87d0eb0`, story 12) |
| Always remove in-progress | changed | now "Remove in-progress" and no longer `always()`, as in implement-pr: on a failure the retry job owns the label and drops it one step before it relabels, so a ticket is never left with no `agent:*` label for the minutes that job spends starting, which is the shape the dispatcher's sweep re-dispatches (`b595b36`, #51) |

Added here alone: "Refuse closed issue" (`65abf07`), "Enable auto-merge" (`a17609c`, story 10), "Keep partial work on failure" (`87d0eb0`, story 12).

### agent-review.yml

Kept as his: **Transition labels**, **Post PR review** (path under `factory-out`), **Post thread replies**, **Mark blocked on failure**, **Always remove in-progress**.

| His step | Ours | Why, cited |
|---|---|---|
| Checkout PR branch | changed | path, PAT, no persisted credentials (`20e5f95`) |
| Prepare branch | changed | `git branch -f main origin/main` instead of a network fetch, since no credentials remain (`20e5f95`) |
| Setup Node.js | changed | `node_version` (`4d2ca78`) |
| Run review agent | changed | env for model, test output, OUTPUT_DIR (`594fc6a`) |
| Push branch | removed | the reviewer is read-only (`594fc6a`, story 5, ADR 0003, "a reviewer that pushes commits is a second implementer nobody reviews") |
| Mark PR ready | removed | `594fc6a`; then no drafts at all (`0431d99`) |

Added here alone: "Mark verdict pending", "Run target tests", "Write verdict into the PR body", "Set verdict status" (`594fc6a`, `1d4dc25`, stories 5, 6), "Trigger update-branch on a passing verdict" (`421a1b5`, story 11), "Retry or escalate on a failing verdict or gate" (`87d0eb0`, story 12).

### agent-implement-pr.yml

Kept as his: **Refuse closed PR** (his per-step `state == 'open'` conditions are back too; the `PR_OPEN` env refactor was undone by #47), **Transition labels**, **Post thread replies**, **Post inline comments**, **Post top-level comments** (verbatim apart from paths).

| His step | Ours | Why, cited |
|---|---|---|
| Checkout PR branch, Prepare branch, Setup Node.js | changed | as in review |
| Run implement-PR agent | changed | env for model, OUTPUT_DIR |
| Push branch | changed | PAT URL, `refs/heads` (`20e5f95`, `c722a10`); his `has_commits` guard kept |
| Mark blocked on failure | changed | "Retry or escalate" wraps it (`87d0eb0`) |
| Always remove in-progress | changed | now "Remove in-progress", since the retry job owns the failure path |

Added here alone: "Request review" after a push (`87d0eb0`, "every push is judged again").

## 6. The vendored scripts and prompts

**Changing a script or prompt under `factory/agent-workflows/` starts here.** Find its row. The last column is the standing list of reasons a difference from him is allowed to exist. The change is done when that row carries the new reason and both of its counts, recounted by the method at the top, in the same PR as the change.

| File | His lines surviving | Ours now | What was forced |
|---|---|---|---|
| `shared/run-with-extraction.ts` | 41 of 41 (100%) | 41 | nothing. Identical to his below the provenance header #87 added, which moves no count because this method excludes comments. |
| `shared/review-output.ts` | 117 of 117 (100%) | 146 | `verdict` and one `criteria` entry per acceptance criterion in the review schema (story 5, ADR 0003). His implement-PR schema is untouched. |
| `shared/review-context.ts` | 110 of 159 (69%) | 258 | `issueBody` for criteria parsing (story 5); the closing-keyword regex moved to `lib/linked-issue.ts` (#13, #16); the linked issue read through `--json` and rendered by `lib/ticket-context.ts`, since the text view carries no `author_association` and gh 2.95 prints only comments under `--comments`; the body read throws rather than falling back to `""`, so an API error cannot read as "no criteria"; an optional `diff` for the audit (story 18); #52's required `TrustPolicy` and the assembly split out of the fetch as the pure `pullRequestContext`, dropping everything a stranger can write before the reviewer, implement-pr or the audit reads it (story 27, ADR 0002's trust amendment); #80's channel on each of its three reads, so this file no longer decides where the factory-login exemption applies. None of his lines moved under #52 or #80. |
| `shared/diff-lines.ts` | 28 of 30 (93%) | 35 | `+++ /dev/null` and `--- ` headers handled explicitly, no phantom trailing line. No story forced it; section 8's "`diff-lines.ts` edge cases" says why it stays. |
| `shared/common.ts` | 88 of 96 (92%) | 111 | `claudeAgent()` takes the model and the account instead of hardcoding `claude-opus-4-8` and one token (stories 17, 20, ADR 0004); a config dir per account, session dir pointed there so extraction can resume; API-key and GitHub-token vars blanked (ADR 0001); `gh` re-exports `lib/gh.ts` and its 64 MB buffer (#19). |
| `implement/implement.ts` | 24 of 33 (73%) | 74 | account rotation; model input plus `model:` label; the ticket document with parent spec (stories 22, 23); trusted-author filtering (ADR 0002 amendment); the retry section (stories 12, 13); the plugin install (story 4); commits counted on `refs/heads/$BRANCH`. His `run()` call and his zero-commit check are the core and are his. |
| `review/review.ts` | 54 of 78 (69%) | 154 | read-only plus `assertReadOnly` (story 5, ADR 0003); the verdict, the criteria parse, the PR body section and the status files (stories 5, 6); the target's test output in the prompt; rotation and the model input. His REST review payload, his inline-comment filtering and his reply filtering are intact. |
| `implement-pr/implement-pr.ts` | 73 of 79 (92%) | 125 | the conflict hand-off with `git merge-tree` and a re-check after the run (#19); the retry section; the model label; rotation. His flow is otherwise intact. |
| `implement/prompt.md` | 10 of 26 (38%) | 41 | his sections (TASK, ISSUE, CONTEXT, EXECUTION, COMMIT) are back and the paragraphs inside them are ours: parent spec, target-repo docs binding (story 23), never push or label, no network git or gh. Two sections have no counterpart of his: NO PLACEHOLDERS (stories 7, 8, 9, #13) and REVIEW AND FIX. EXECUTION and REVIEW AND FIX invoke `mattpocock-skills:tdd` and `mattpocock-skills:code-review` by name rather than restating them, and TASK fences the run to the skills the prompt names, the whole plugin being installed (story 12 of #46). #56's `writing-for-agents` pass made NO PLACEHOLDERS name the target to hit before each guardrail (story 14 of #46), and story 14 of #75 cut the gate's and the reviewer's own descriptions out of it, both reporting themselves. Three of his four trailing prohibitions are back verbatim; the fourth reads `ticket` for his "close the issue", because `CONTEXT.md` binds the factory's own prose and the method above normalises whitespace and nothing else, so a word swapped is a line lost. His shorter TASK line stayed ours because the clause it would have dropped, the branch a retry inherits, is not always in the retry section: `retrySectionForRun` renders nothing when the marker cannot be read. The run's 60 minutes stayed too, because a `timeout-minutes` kill reports nothing to the agent. |
| `review/prompt.md` | 18 of 33 (55%) | 40 | his sections (TASK, LINKED ISSUE, DIFF TO MAIN, PR COMMENTS, REVIEW PROCESS) are back and in his order; the paragraphs turn "actively improve the branch" into a read-only judge ticking criteria (story 5, ADR 0003). ACCEPTANCE CRITERIA and TEST OUTPUT have no counterpart of his, and the verdict needs both. Read-only is stated once with the check that enforces it and the trailing rules are positive (story 14 of #46); TASK no longer describes how that check works, `assertReadOnly` in `factory/lib/read-only.ts` being the check, and his four flat prohibitions sit beside the read-only ones (story 14 of #75). Story 8 of #75 built the reviewer half of #13 into review step 4: a deleted test is judged against the ticket's `## Removes` section, which the gate can only approximate by token match. |
| `implement-pr/prompt.md` | 26 of 28 (93%) | 31 | the CONFLICT and RETRY placeholders (#19); the no-credentials line (ADR 0002); his `npm run typecheck` widened to the repo's own typecheck and full suite; and the same fence to the named skills the implementer prompt carries (story 12 of #46). Story 14 of #75 cut the gate description, the trailing "Done when every thread carries one of those four outcomes", which restated the sentence above it, and the sentence sending the agent at a conflict first, which `conflictSection` in `factory/lib/conflicts.ts` says only when there is a conflict; it restored his TASK opener, his fourth outcome and his four flat prohibitions. Two of his lines are gone on purpose: his `npm run typecheck` line, which story 23 of #9 forbids hardcoding, and his PROCESS opener, which #56 replaced with an exhaustive one and #75 kept. |
| `review/extraction.md` | 16 of 18 (89%) | 27 | `verdict` and `criteria`, and a `summary` field that asks what the PR does and why the verdict is what it is, where his asked what the reviewer changed: he has no verdict (story 5). |
| `implement-pr/extraction.md` | 20 of 20 (100%) | 20 | nothing. Untouched. |

Five of the eight scripts are over 90 percent his. The three that are not are the three the spec changed most, and `review-context.ts` moved furthest, 97 percent to 69 under #52.

Only the prompt counts have ever moved, never a script row, because those passes touched prose and comment text and this method excludes comments. The rows above say what each difference is for; here is how the counts got where they are. #47 put his section skeletons back, taking `implement/prompt.md` from 3 surviving lines to 7 and `review/prompt.md` from 12 to 14. #54 moved no line of his, leaving `implement/prompt.md` shorter (42 lines to 40) and `implement-pr/prompt.md` one longer. #56 cost him five lines in `implement-pr/prompt.md`, 89 percent down to 71, and moved neither of the other two, since what survives in them is headings, placeholders, code fences and his closing promise line. Story 14 of #75 then moved all three the other way, restoring his wording wherever a factory line said what the gate, the reviewer or a workflow step already says: `implement/prompt.md` 7 to 10, `review/prompt.md` 14 to 18, and `implement-pr/prompt.md` 20 to 26, which at 93 percent is above the 89 it had before #56. Both `extraction.md` files were left alone as a format contract, and `implement-pr/extraction.md` is still the only vendored file that is his to the line.

Story 14 of #75 moved all three prompt rows the other way, on one test: a line the gate, the reviewer, `conflictSection` or a workflow step already enforces, renders or reports does not belong in a prompt. A line only the prompt can carry stays, whatever enforces it afterwards: the run's 60 minutes, the vendored plugin's out-of-scope skills, and the branch a retry inherits are all in that class. `implement-pr/prompt.md` went past where #56 found it, 71 percent to 93; `implement/prompt.md` 27 to 38; `review/prompt.md` 42 to 55. `factory/audit/prompt.md` took the same audit and has no row here, because it has no counterpart of his. Every script row is unchanged again, for the same reason as #56: the pass touched prompt prose and comment text only, and this table's method excludes comments.

## 7. Added with no sandcastle counterpart

| Piece | Story, ADR | Could his code have served? |
|---|---|---|
| dispatch (`factory/dispatch/`) | 1, 2, 21, 28, 30; #15 | No. His pipeline has no dispatcher; a human applies the label, and his `simple-loop` lets an agent pick issues, which #9 excludes ("any planner that invents work"). Story 21 is the exception: the `agent:*` label vocabulary is his, and only the thing applying it is new. |
| gate (`factory/gate/`) | 7, 8, 9; ADR 0003; #13 | No. His pipeline trusts the agent's "ran the tests". `diff-lines.ts` was reused as a seed. |
| audit (`factory/audit/`) | 18, 19; ADR 0003; #18 | Partly. It reuses his `review-context.ts` and `run-with-extraction.ts`; the trigger and the revert logic have no counterpart. |
| retry (`factory/retry/`) | 12, 13; #16 | No. His failure path is `agent:blocked` plus "re-add the label". |
| rotation and accounts (`factory/lib/rotation.ts`, `accounts.ts`) | 15, 16, 17; ADR 0004; #17 | No. `claudeCode()` takes one token, and the library drops `is_error` from the result event so a rate limit reads as success (#21, gap 2). |
| usage comment (`factory/lib/usage.ts`) | 27; #18 | Half. The numbers come from his `RunResult.iterations[].usage`; the summing and the comment are ours. |
| trusted authors (`factory/lib/trusted-authors.ts`) | ADR 0002's two trust amendments, no story of #9's | No. His only trust check is "PR author is a collaborator" in the preflight. It began on the implementer path; #52 extended it into his `review-context.ts`, so the reviewer, implement-pr and the audit read only trusted words too. |
| update-branch, API and no agent (`factory/update-branch/`) | 11; ADR 0003 amendment | No for the routine case: his update-branch is an agent on a label, ours an API call on push with a verdict carry. The conflict case is section 8. |
| run log (`factory/lib/run-log.ts`) | 12, 13 and rotation; #10 | No. Needed to read raw result events and to have a file to attach; his scripts log to stdout. |

One row has left this table: the turn cap (`factory/lib/turn-cap.ts`, story 14, #12), ten lines wrapping his public `AgentProvider` type to append `--max-turns`, since `claudeCode()` cannot pass a flag through. #49 deleted it under story 18 of #46, so the module is in the history and not in the tree.

## 8. Where rewriting was avoidable, and what has been undone since

**"Fixing" a difference from him that no ticket asked for, anywhere in `factory/` or `.github/workflows/`, starts here.** No story or ADR forced any of these, so each looks like a mistake and some are not. **Kept** means it was examined and left on purpose: leave it, and raise a ticket of its own. **Undone** means it is already gone and the entry is history. Most consequential first, with their state as of 2026-09-08.

- **Conflict resolution reinvented in implement-pr** (`3f21533`, `factory/lib/conflicts.ts`, the prompt's CONFLICT section). His `update-branch.ts` plus `agent-update-branch.yml` do exactly this: merge base, agent resolves, push with lease. #9 said conflicts escalate in v0; #19 reversed that and wrote new code. **Kept as built**: story 5 of #46 says reconciliation does not re-prove working code, and the proof run exercised this path.
- **Prompt rewrites went wholesale where edits would have done.** **Undone by #47**, then further by #54 and story 14 of #75, whose rows in section 6 carry the detail: his skeletons, then his wording wherever ours said nothing his did not.
- **Cosmetic renames that break line-for-line comparison**, all from `8f0c3f1`: `sandcastle-agent[bot]` to `factory-agent[bot]`, "Run implementation agent" to "Run implementer", "Checkout main" to "Checkout target repo", "Open draft PR" to "Open PR", the workflow names. **Undone by #61 and #47**: his `agent-` workflow names, his bot identity, and his step names wherever the step is his.
- **The `PR_OPEN` env refactor in implement-pr.yml** (`8f0c3f1`), replacing his per-step `github.event.pull_request.state == 'open'` conditions with one env var. Same behaviour, different text. **Undone by #47.**
- **`refuse-fork` jobs on review and implement-pr** (`20e5f95`). Sound, for the reason section 5's shared list gives, but no story or ADR asked for them. **Kept, with a comment**: removing them would remove a real control.
- **`diff-lines.ts` edge cases** (`20e5f95`). Real bugs (a deleted file's hunk attributed to the previous file, a phantom trailing line on every file), but not a story. **Kept, with a comment**: the gate maps findings onto changed lines, so reverting would change behaviour. Covered by `diff-lines.test.ts`, which has no upstream counterpart.
- **`errorMessage` and `GH_MAX_BUFFER` added to `common.ts`** (`b0b79ed`, `c1addc1`). The buffer fixed a real ENOBUFS in the dispatcher but belonged in the gh wrapper alone. **Undone by #47**: `errorMessage` lives in `factory/lib/errors.ts` with its callers, and the buffer in `factory/lib/gh.ts`, which `common.ts` re-exports.
- **Dropping his `AGENT_PAT || GITHUB_TOKEN` fallback** in "Request automated review" (`8f0c3f1`). Keeping his shape cost nothing. **Undone by #47**: the fallback is back, with `FACTORY_PAT` in `AGENT_PAT`'s place.

## 9. Spec #9's stories on sandcastle

The mapping that answers "how much of this did sandcastle already do".

**He has it, and it was taken as it stands:**

- Story 3, one issue to one PR, with an existing-PR preflight.
- Story 21, the `agent:*` state labels. The whole label vocabulary is his.
- Story 25, the agent registry: the library's provider slot already holds Codex, Copilot, Cursor, OpenCode and Pi.

**He has a version that had to change:**

- Story 5, the reviewer. His edits the branch; ours must not.
- Story 11, update-branch. His is an agent on a label; ours an API call on push.
- Story 12, failure handling. His is `agent:blocked` plus a comment, with no retry, no `needs-human` and no push of the partial branch.
- Story 14, limits. His 60 minute job timeout, yes; a turn cap, no. The factory built one and deleted it (#49, story 18 of #46), so on both sides the stop on a run is the job timeout plus sandcastle's own idle timeout.
- Story 15, concurrency. His is per issue; ours per account.
- Story 20, the model. His is hardcoded.
- Story 22, sub-issues. He refuses them; `/to-tickets` output is sub-issues by design.
- Story 23, coding standards. His prompts cite `.sandcastle/CODING_STANDARDS.md`; ours cite the target repo's own docs.
- Story 27, usage. His library returns usage per entry in `RunResult.iterations[]` and nothing posts it.

**Absent from his pipeline entirely:** stories 1, 2, 4, 6, 7, 8, 9, 10, 13, 16, 17, 18, 19, 24, 26, 28, 29, 30.

So: the spine is his and roughly two thirds of his pipeline's lines are still in the tree, while every large addition is a numbered story with no counterpart on his side. That is the honest answer to "why not just fork it": the fork would have been the three workflows, and the three workflows are exactly the part that was copied.
