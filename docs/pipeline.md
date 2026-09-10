# The factory pipeline

The reference behind README: every caller input, every stage of the pipeline in full, the engine the runs sit on, and the layout of this tree. README is the front door and says what the factory is and how to onboard a target repo; this page says what each part does and why.

## Onboarding details

The reasoning behind README's six onboarding steps, plus the caveats a target onboarded before #61 needs. None of it changes the steps.

- **`factory_ref` and the ref in `uses:` move together.** GitHub gives a cross-repo reusable workflow an empty `job_workflow_sha`, so the scripts are checked out at `factory_ref` while the workflow file comes from `uses:`. Change one without the other and they drift.
- **Onboarded before #61? Re-copy the caller.** One still naming `implement.yml`, `review.yml`, `implement-pr.yml` or `audit.yml` fails at startup and kills the whole caller run, because every workflow that runs a model took the `agent-` prefix, sandcastle's convention.
- **What `FACTORY_PAT` cannot do.** It cannot write commit statuses or repo variables, hence statuses on `GITHUB_TOKEN` and the factory's own state on a `factory-state` branch.
- **One `FACTORY_PAT` covers every target in v0** (#20). Per-target tokens buy nothing while the same machine and the same workflows hold them all; split when a target is owned by someone else.
- **The label vocabulary `scripts/onboard.sh` creates**: `ready-for-agent`, `ready-for-human`, `needs-triage`, `agent:*`, `needs-human`, `factory:retry-1`.
- **A called workflow cannot exceed its caller's permissions**, so a target onboarded before `statuses: write`, `checks: read` and `actions: read` were in `templates/factory.yml` needs them added by hand.
- **The trigger set lives in the caller, so it drifts silently.** A target still subscribing to `closed` and `labeled` alone keeps working and just waits up to ten minutes for the heartbeat instead of dispatching the moment a human removes a blocker. Nothing in the factory can see the target's copy, so re-copy the `on:` block and the `dispatch` job's `if:` together.

## Caller inputs

Every input has a default, so the template works as copied. Set them in the calling job's `with:`. Models are resolved by `factory/lib/model.ts`.

| Input | Jobs | Default | What it does |
| --- | --- | --- | --- |
| `factory_ref` | all | `main` | Ref of the factory scripts. Must equal the ref in that job's `uses:`. |
| `factory_repo` | all | `chizhangucb/software-factory` | Repo holding the factory scripts. |
| `node_version` | implement, implement-pr, review, merge-gate, audit | `"22"` | The Node the agent, `test_command`, the merge gate's test runs and the factory's own engine get. Match the target's CI, on every one of those jobs (chronicle needs `"24"`). |
| `implementer_model` | implement, implement-pr | `claude-opus-5` | Model for the implementer. A `model:<name>` label on a ticket overrides it for that run only. |
| `reviewer_model` | review | `claude-opus-5` | Model for the reviewer. Never overridden by a label. |
| `audit_model` | audit | `claude-opus-5` | Model for the audit. Never overridden by a label. |
| `test_command` | review, audit | `npm ci && npm run typecheck --if-present && npm test` | The target's whole suite, run before the agent starts; the output is evidence for the verdict. It stays an input because how a target is built and tested is a fact about that target rather than a choice a maintainer could get wrong, the same class as `node_version`, and a target that is not an npm project would otherwise give the reviewer and the audit no test evidence to read. |
| `test_command` | merge-gate | `node --test` | A different input sharing the name: it receives one changed test file as an argument, once per file, rather than running the whole suite. It stays for the same reason as the row above, how a target runs one test file being a fact about the target, and without it the merge gate cannot run the new tests of a target whose test command is not `node --test`. |
| `install_command` | merge-gate | `npm ci` | Empty to skip. |
| `checks_timeout_minutes` | review | `15` | How long the retry handler waits after the verdict for the head's merge gate and CI to settle. A check still pending then is requeued, not failed. |
| `trusted_author_associations` | dispatch, implement, implement-pr, review, audit | `OWNER` | Whose words the factory acts on. Set all five together. |
| `stuck_minutes`, `verdict_minutes`, `update_minutes` | dispatch | `15`, `30`, `30` | The reconciler's deadlines. |

## Dispatcher

Runs on the caller's `issues: [closed, labeled, unassigned, unlabeled]`, on `workflow_dispatch`, on the `repository_dispatch` event `factory-sweep`, and on the caller's `schedule` every 10 minutes.

A `labeled` run is for `ready-for-agent` and nothing else, but `unlabeled` and `unassigned` runs are admitted whatever was removed, so that a ticket held back by `ready-for-human` or by an assignee reaches the factory the moment the human lets go of it instead of waiting up to ten minutes for the next heartbeat. Which removals can actually unblock a ticket is `select.ts`'s answer, and the rules below are its only copy: a caller that named them would be a second copy drifting quietly out of step, so a run over a ticket nothing unblocked labels nothing. The caller's condition says which action each of its clauses is for, because an `unassigned` payload carries no label and a clause reading `github.event.label.name` off one would compare against null and drop the event with no error anywhere.

**The `schedule` is the fallback. The heartbeat is what drives the sweep.** Measured on `chizhangucb/factory-fixture` over 21 and a half hours from 2026-09-08T21:07Z: the `schedule` fired 6 times against about 129 expected at six an hour, while the heartbeat sending `factory-sweep` fired on every interval in the same window. So the heartbeat is required, not belt and braces: `gh api repos/<owner>/<repo>/dispatches -f event_type=factory-sweep`, every 10 minutes, with a token that has contents write on the target and nothing else. One sender covers any number of targets. Without it the dispatcher and the reconciler below run only as often as GitHub's cron fires.

Two caveats on that number. It is one measurement, and it is from a private repo; the caller's `schedule` runs in the target, so the rate on a public target is not yet known. Where the heartbeat should run, and how it reports its own failures, is #111.

- It dispatches an open, `ready-for-agent` ticket from a trusted author with no open blockers (GitHub native issue dependencies, `issue_dependencies_summary.blocked_by`), no assignee, no sub-issues, no `agent:*` or `needs-human` label and no open PR already closing it. `ready-for-human` and `needs-triage` are refused. A ticket is a sub-issue of its spec and is picked up as one; an issue with sub-issues of its own is refused as a spec.
- The issues listing is eventually consistent, so before each label the dispatcher re-reads that issue (state, labels, blockers, open PRs) and skips it with `closed since the snapshot` or the usual reason when anything changed; the summary line counts them. `agent-implement.yml` is the backstop, refusing a closed issue (label removed, comment) before it touches a branch. Both exist because #19 labeled and implemented two closed tickets, and merged one.
- Labels go on with `FACTORY_PAT`. A label added with `GITHUB_TOKEN` fires no `issues: labeled` event, so the implementer would never start.
- A skipped ticket is not commented on; the reason is one line per issue in the job log and the `dispatch.json` artifact, so a sweep every 10 minutes does not become a comment every 10 minutes.

### Reconciler

Every sweep (schedule, `workflow_dispatch`, `factory-sweep`, not the issue-event runs) also repairs states stuck past their deadline, so a lost event costs at most one sweep (#35). A second sweep over a healthy repo changes nothing.

- A ticket in `agent:implement` or `agent:in-progress` with no live implement run, or a PR in `agent:review` (`agent:implement`, `agent:in-progress`) with no live review run, gets its label removed and re-added with `FACTORY_PAT` so the event fires. A second miss on the same stranding escalates to `needs-human` with a comment, on the retry handler's escalation label set, and a PR's ticket is parked with it.
- A cancelled run is a lost event like any other and counts as a miss: nothing cancels a run for a reason to forgive now that the per-account cap is gone (#149). The marker also carries a re-dispatch count that caps re-dispatches of any cause at two on one stranding, which is what ends a stranding carrying markers the cap wrote as `miss=0`.
- A factory PR still without auto-merge past the stuck deadline has it re-armed, so a refusal on the implement run's non-fatal step cannot leave the PR unmergeable and skipped by update-branch forever. A refused re-arm is a `::warning::` naming the PR and `scripts/onboard.sh`, not a failed sweep, for the same reason that step is non-fatal; `needs-human` or `agent:blocked` is how a maintainer keeps auto-merge off a factory PR.
- A factory PR with auto-merge armed and no `factory/verdict` on its head gets `agent:review`. A PR with a passing verdict sitting behind main with no update-branch run in the window gets a `factory-update-branch` dispatch.
- The counts are a `<!-- factory:sweep miss=n tries=m -->` comment on the subject, and one log line per decision names the state, the deadline and the action. A sweep that cannot read the repo aborts with one `::error::` line rather than repairing from a partial snapshot.

## Trust policy

`CONTEXT.md` defines it: one policy per run, in `factory/lib/trusted-authors.ts`, passed down as a required argument, deciding whose tickets run and whose comments an agent reads. It is the v0 control that stands in for a sandbox (ADR 0002). What the glossary does not say:

- An untrusted parent spec is named by number alone, title as well as body withheld. The retry marker is read only from a trusted comment, on the ticket path and the PR path alike. Each run logs one line naming what it dropped.
- Widen it only to people who could already push (`OWNER,MEMBER,COLLABORATOR`), and set all five jobs together: the retry marker is a comment the factory posted with `FACTORY_PAT`, so a list that excludes that account's association drops the marker and a retry runs with no failure context.
- Two channels are exempt and only two: the reviewer's own summary and thread comments, posted with `GITHUB_TOKEN`, which GitHub reports as `NONE` on every repo. Without the exemption the reviewer's findings would be dropped before implement-pr read them. Every other workflow in the target posts under that same `github-actions` login, so a bot echoing a fork PR's branch name or test output is judged like any stranger. The policy owns that list, not the call sites: `keep` and `trusts` take a channel name, every read reports the association and whatever login it has, and nothing outside `trusted-authors.ts` can opt a channel into the exemption.
- An empty value falls back to `OWNER`; a payload with no association, or one GitHub does not send, reads as `NONE`. On an org-owned repo nobody is `OWNER` (the owner's issues read `MEMBER`), so #26 means changing this too.

## Implementer run

One ticket, one branch, one PR. The script fetches the ticket and its parent spec into one file, because the agent has no GitHub token. The agent reads the target repo's own `CLAUDE.md` or `AGENTS.md`, `CONTEXT.md` and `docs/adr/`, which are binding, then builds through the order in `docs/agents/build-and-review.md`: `mattpocock-skills:tdd` at the seams the ticket names, then `mattpocock-skills:code-review` on both axes with every finding fixed, then the harness's own `code-review medium --fix` when the harness bundles one, then typecheck and the full suite. All of that happens before any PR exists. Implementation commits come first, `review:` commits after.

The prompt forbids placeholders in plain words; the merge gate (#13) and the reviewer (#11) are what verify it. The agent never pushes, labels, or opens PRs.

## Merge gate

`merge-gate.yml` runs no agent. It reads the PR diff, notes the linked ticket's number (`Closes #N` in the PR body) for its summary, and posts two commit statuses on the PR head. Neither check reads the ticket's body: whether a deletion was owed is the reviewer's and the audit's judgment, and a wrong refusal on a required check has no judge after it.

- `factory/red-green`: the PR's new or changed test files (`*.test.*`, `*.spec.*`, `_test.go`, `test_*.py`, anything under `__tests__/`) are copied onto a checkout of the base branch and run alone. At least one of them must fail there, and all of them must pass on the head. A helper or fixture under `test/` is a source change, not a test.

  Each file is run in its own invocation of the target's **test command**, on the base and on the head alike, so a failure names the file that failed and nothing else. Install runs once per checkout, not once per file. Requiring only one file to go red on the base is today's meaning kept: a batch's non-zero exit meant at least one file failed there, and requiring every file would newly refuse a PR that adds a real new test in one file and tidies the wording of another. The per-file exit statuses reach the status summary, `merge-gate.json` as `redGreen.runs`, and the retry marker; each side's log holds one section per file, the head's failures last, because a retry quotes that log's tail.

  A changed test file the merge gate could not run at all is passed over rather than failed, named in the status with the reason, and left to the reviewer and the audit the way a deleted test is. **Unrunnable** means the file's process died before any test reported a result; a file that ran and failed still fails the check. Such a file is excluded from the base-red count, since it proved nothing either way, and a change whose touched test files are all unrunnable passes with a reason saying plainly that nothing was proved. `merge-gate.json` carries each file's answer as `redGreen.runs[].runnability` and the whole list as `redGreen.unrunnable`.

  Only the default test command gets that detection. The merge gate chooses that invocation, so it appends `--test-reporter=tap` and reads the report: a file whose process died is reported as one entry named after the file carrying the dead process's exit status, where a genuine failure carries the assertion and no exit status. A caller's own test command is never parsed, because a wrong guess about output the merge gate does not understand would either hide a real failure or invent a fake excuse; under one of those every file counts as having run, a dying file simply fails, and the per-file split alone means it names only itself.

  Two costs come with the per-file rule. The test command's startup is paid once per file per side, so a PR touching many test files on a target whose command boots a real test framework can run long enough to reach the merge gate job's 30 minute timeout, and a job killed there posts no status at all, leaving both checks pending rather than red. And a test command that cannot run one file alone now reports its own failure as the file's: `go test` will not compile a single `_test.go` without the rest of its package, and pytest exits 5 on a file that collects no tests. On the default command a file like that reads as unrunnable and is passed over; under a caller's own command it fails, and the answer is a test command that maps each file to the invocation its kind needs.

  It passes vacuously twice over: when the diff changes no source file, and when the diff deletes a source or test file (a test renamed out of the test tree counts; a deleted doc or config file does not), while adding or changing no test, with a reason that says nothing was proved. Not source: a doc, a dotfile anywhere, and a data or manifest file (`.yml`, `.json`, `.toml`, `.lock`, and the rest of `CONFIG_EXTENSIONS`) at the repo root or under a dot directory. The same extension nested deeper is data the code reads, and stays source. Outside those two passes, a source change with no test change fails.
- `factory/test-integrity`: fails on a new `skip`, `only` or `todo` marker in a test file. A deleted test file, or a test renamed out of the test tree, never fails it; the check lists each one in its summary and in `merge-gate.json` as `deletedTests`, for the reviewer and the audit to judge against the ticket.

## Reviewer and verdict

The reviewer is read-only. It judges the PR head against the ticket's acceptance criteria (the checklist under `## Acceptance criteria` in the issue the PR closes), with the diff to main and the target's test output. Any commit, dirty file or moved HEAD fails the run; the workflow never pushes. It writes three things:

- a `<!-- factory:verdict -->` section in the PR body, one ticked or unticked line per criterion with its evidence, replaced on re-review;
- a review comment with the summary;
- the commit status `factory/verdict` on the PR head: `success` when every criterion is met, `failure` otherwise, including when the ticket has no criteria or the reviewer run itself failed.

## Merge

No merge queue in v0 (unavailable on user-owned repos; #26, #27), so ADR 0003's amendment stands in with three deterministic pieces.

- Auto-merge (squash) is enabled on every factory PR the moment `agent-implement.yml` creates it, with `FACTORY_PAT`. GitHub refuses auto-merge on drafts, so factory PRs open ready; the required `factory/verdict`, absent until the reviewer posts it, is what holds the merge.
- The `factory` ruleset requires a PR and the checks above on an up-to-date head, so a PR behind main cannot merge.
- `update-branch.yml` runs on every `push` to main and on the `repository_dispatch` event `factory-update-branch`, which `agent-review.yml` sends with `FACTORY_PAT` after a passing verdict.

For each open PR that has auto-merge enabled and is behind main, update-branch calls GitHub's update-branch API, then carries the passing `factory/verdict` onto the merge commit GitHub made, with its provenance in the status description. That merge commit is made with `FACTORY_PAT`, so the target's CI and the merge gate run again on the new head and auto-merge lands the PR on the latest main.

A verdict travels only across merges GitHub itself made, so a commit a person or an agent pushed never inherits one, and a PR whose governing verdict is pending or failed waits for its re-review. ADR 0003 has the walk in full.

A conflict the API cannot resolve is handed to the implementer (#19): a comment plus `agent:implement` on the PR, so `agent-implement-pr.yml` runs, sees the conflict, and the agent merges `main` into the branch, resolves and commits. The push re-runs CI, the merge gate and the review, and auto-merge lands the new head. A conflict still present after that run fails it, so the hand-off cannot loop and #16 counts the attempt. A PR already in `agent:implement`, `agent:in-progress`, `agent:review` or `agent:blocked` is left alone, and a resolution that fails takes the normal retry and escalation path (#16).

## Retry and escalation

A run fails when the implementer run failed (no commits, an agent error, the 30 minute idle timeout), when it was killed at the 60 minute job timeout, or when the PR's merge gate (`factory/red-green`, `factory/test-integrity`, the target's own CI) or `factory/verdict` came back failing. First failure, one retry; second, escalation. Decision: `factory/retry/decide.ts`; handler: `factory/retry/retry.ts`.

**Where it runs.** On the two implement workflows the handler is a `retry` job of its own, not a step, so a `timeout-minutes` kill still reaches it (#51; the workflow files carry the reasoning). A killed attempt and one that stopped itself both count as the implementer's failure. The attempt keeps `agent:in-progress` until the handler is about to relabel, or the sweep would re-dispatch from main before the marker and `factory:retry-1` exist; a handler that dies first leaves the label on for the reconciler. `agent-review.yml` runs it as a step instead, after the verdict and once the head's merge gate and CI have settled, so the caller needs no `status` or `check_run` trigger. A reviewer killed at its own timeout posted no verdict, so its PR becomes the reconciler's `verdict_minutes` case.

**The retry.** The failing output (the reviewer's checklist, the failing check's `--log-failed` excerpt, or the failure reason plus the run's log tail) goes on the ticket as a `<!-- factory:retry -->` marker comment. The ticket gets `factory:retry-1`, the durable attempt count, and `agent:implement` goes on the PR if one is open, so implement-pr continues on the branch, else on the ticket, where implement continues on the pushed branch when there is one. The next run reads the marker into a `RETRY` prompt section and echoes it to the job log. implement-pr labels `agent:review` after it pushes, so the retry is judged like a first attempt.

**Escalation.** Every `agent:*` label comes off the ticket, `ready-for-agent` with them; `needs-human` goes on; the PR is closed with its own `agent:*` labels off and auto-merge with them; the branch is kept; and a comment on the ticket links the run, the run log and the failure output. An escalated ticket carries `needs-human` and nothing else of the factory's, and the closed PR carries no state: the dispatcher refuses `needs-human`, and a ticket that also still said `ready-for-agent` would be saying two things at once. Both label sets are one decision, `factory/retry/escalation.ts`, over `factory/lib/labels.ts`, which the reconciler's escalation reads too, so a parked ticket looks the same whichever path parked it. A failed implement run pushes whatever it committed, so the branch is there. To hand a ticket back: remove `needs-human` and `factory:retry-1`, add `ready-for-agent`. The next run starts from main and ignores the old marker.

**What does not spend it.** Only the implementer's own failure does.

- A crashed reviewer, a failed push or PR step, or a handler that could not reach GitHub gets the `agent:blocked` comment for a human to re-label. `agent:blocked` has one meaning wherever it appears: a human must look.
- A run rate limited on every account is requeued, and a requeue means the same thing whichever side it is on (#148): a comment naming the cause, no retry spent, and no `agent:blocked`, because a quota is nobody's failure and no human can clear it. What differs is only which sweep picks the subject up, so each side is left in the state its own sweep reads. A ticket is left with no factory label, and the dispatcher re-dispatches it next sweep. A PR is left in `agent:in-progress`, the one label the reconciler sweeps on a PR no run is on, and it re-adds the start label at the stuck deadline (`stuck_minutes`), which starts the run again. That label is why a requeue is the one way out of a run that does not drop it: the handler adds it back where implement-pr's retry job already dropped it, and `requeued.txt` in the output dir (`REQUEUED_FILE` in `factory/retry/decide.ts`) tells `agent-review.yml`'s last step to leave it on. A PR left with no `agent:*` label at all would be swept by nothing, which is the one outcome worse than the `agent:blocked` this replaced.
- `agent-review.yml` has its own failure step, reached where the retry handler is not: a reviewer that crashed, or that never got an account. It reads the fact the handler reads, `rate_limited.txt` in the output dir (`RATE_LIMITED_FILE` in `factory/lib/accounts.ts`), and a rate limit on every account there gets that same requeue comment, no label, and the PR left in `agent:in-progress`. Every other failure keeps `agent:blocked` and the comment above, and so does a requeue whose comment could not be rendered: neither comment nor label is the shape that step exists to prevent.
- A check still pending when the review's wait runs out (`checks_timeout_minutes`) is requeued the same way and spends nothing, because nothing failed: there is no log to inform a retry, and a slow target CI would burn it uninformed. That path uses the PR while one is open and falls back to the ticket when the PR closed or merged as the handler waited. A check that actually failed outranks a pending one and still spends the retry, with its log.
- A PR that conflicts with its base while that wait is on is handed to the implementer, not to a human (#144, ADR 0003). GitHub runs no `pull_request` workflow on a conflicting PR, so its checks never posting is a fact about the merge, not the ticket: the handler reads the PR's mergeability on every poll of that wait, and a definite conflict gets the comment plus `agent:implement`, the same hand-off update-branch makes, with no retry spent and no `factory:retry-<n>` added. The wait ends early on the poll that sees the conflict (#145), not at `checks_timeout_minutes`, which is unchanged. A mergeability GitHub has not decided yet is never acted on: it keeps waiting, and at the deadline it stays a requeue.
- A verdict that failed for want of acceptance criteria escalates at once, no implementer run being able to fix the ticket.

## Audit

Auto-merge from day one is survivable because the first 20 merges are each re-reviewed (ADR 0003). `agent-audit.yml` is called on `pull_request: closed`; the example caller filters to merged PRs.

- A serialized `decide` job asks whether this merge falls inside the first-20 window (`AUDIT_LIMIT` in `factory/audit/plan.ts` is the one place the number is written, and the job publishes the limit it applied as an output so no workflow file carries it): the PR must be merged and a factory PR (`CONTEXT.md` defines that; `factory/lib/factory-pr.ts` is the one definition, which the reconciler reads too), and the counter must be under the limit. Past the limit the job logs `audit limit reached` and exits.
- The counter is factory state in the target: `.factory/state.json` (`{"auditedMerges": N}`) on the orphan `factory-state` branch, read and written through the contents API with `FACTORY_PAT` by `factory/audit/state.sh` (`get`, `set <n>`), absent meaning 0. A branch of its own keeps it away from main's ruleset and CI. It advances before the audit runs, so a crashed audit still counts.
- It runs the reviewer prompt in audit mode (`factory/audit/prompt.md`) with `audit_model` on a read-only checkout of the merge commit, against the merged diff (`merge^..merge`), the ticket's acceptance criteria, and the target's test output on that commit. The run log names the model. Same account rotation as the other runs, and the same subject key: the audit shares the PR's concurrency group with a review or implement-pr run on it, while the `decide` job keeps its own group for the counter.
- It comments the result on the merged PR (`<!-- factory:audit -->`, one comment, replaced on re-run): one ticked line per criterion with evidence, placeholders found, and the audit's own usage.
- A miss is any unmet criterion or any placeholder. It opens a revert PR (`git revert` of the merge commit on `factory/revert-pr-<n>`, pushed and opened with `FACTORY_PAT`, never auto-merged) and a `needs-human` issue linking the PR, the audit comment and the revert PR. A revert that does not apply cleanly is reported in the issue instead.

To audit with a model stronger than the reviewer, set `audit_model`. `claude-fable-5-1` and `claude-fable-5` were verified on the subscription on 2026-09-07 (account 1, `claude -p --model <name>`, `is_error: false`, `modelUsage` naming the model). The other accounts were not checked, so a rotation onto them with that alias is unverified.

## Usage

Every factory PR carries one usage comment per role: `<!-- factory:usage:implementer -->` from implement and implement-pr, `<!-- factory:usage:reviewer -->` from review. The audit's usage sits inside its own comment.

Rows are attempts: model, wall time, `claude -p` calls, turns, input, cache write, cache read and output tokens, and Claude Code's list-price cost as a reference figure, since the factory runs on subscription tokens. The account never appears here; see Rotation below. The source is the raw `result` event of every `claude -p` call, summed in `factory/lib/usage.ts` and recorded by `runWithRotation` after each attempt to `OUTPUT_DIR/usage.json` and `usage-<role>.md`, so a run that fails afterwards still reports. sandcastle's own `iterations[].usage` is a context snapshot rather than a total, so it is not used. `factory/lib/upsert-comment.sh` posts the file, editing the existing comment for the marker rather than adding one.

## Rotation

The workflow enumerates the `CLAUDE_CODE_OAUTH_TOKEN_<n>` secrets, masks every token, and hands the list to the run script as a file. The script picks the lowest-indexed account, deletes the file, runs, and re-runs once on the next account if the result event says rate limited. The job log names accounts by their `CLAUDE_ACCOUNT_<n>` label, never by token. The usage comment posted to the target's PR (#18) does not carry the label at all, so "which account paid for this" is answerable only from the job log. Module: `factory/lib/rotation.ts` (`pickToken`, `isRateLimited`, no network); run path: `factory/lib/accounts.ts`. Quota-aware ranking is #24.

**Nothing caps how many runs are in flight.** Rotation on a real rate limit is the only thing that moves a run off an account; the per-account cap that used to bound it is gone, and no cap of any shape comes back until a real rate limit is observed (#149, ADR 0004's 2026-09-10 amendment). What the workflows still serialise is one subject: each agent job's concurrency group is its own issue number (implement) or PR number (review, implement-pr, audit), with `cancel-in-progress` false, so two runs on one ticket or PR never overlap while two different subjects never wait on each other. The audit's `decide` job has a group of its own for the counter, which is not a cap.

## Engine notes

- Sandcastle 0.12.0 pinned exactly, Claude Code CLI pinned in `package.json`, both installed from the lockfile on every run. `package-lock.json`'s `integrity` for `node_modules/@ai-hero/sandcastle` is the live check on what a run installs, so `npm ci` is the check and CI needs no hash step of its own.
- The 0.12.0 tarball is also attached to the `engine-0.12.0` release as cold storage, should the npm copy go away. Nothing fetches it: no workflow, no script, no install path. A bump cuts the next `engine-<version>` release the same way (ADR 0002, amendment "the tarball is a release asset, not a tree file").
- Every run logs to a file with the stream event hook and appends Claude's raw `result` events to `<name>.result-events.jsonl` in the log artifact as they arrive. Success is decided from the last of them (`is_error`), never from the library's return value or the CLI exit code, because a rate-limited `claude -p` exits 0. Every event is still read for rate-limit detection.
- Runs pass `--dangerously-skip-permissions` on a bare ephemeral runner (ADR 0002). Pushes and PR creation use `FACTORY_PAT` so the target's CI fires on the agent's work.
- Skill invocations (`Skill` tool uses) are echoed to the job log as `skill <name> <args>`; the library's parser only surfaces Bash, WebSearch, WebFetch and Agent calls.

## Layout

- `.github/workflows/`: an `agent-` prefix means the workflow runs a model, sandcastle's convention. `agent-implement.yml`, `agent-review.yml` and `agent-implement-pr.yml` are the reusable workflows, one per vendored sandcastle workflow, under his names, each ending in the `retry` job the section above describes. `agent-audit.yml` is the first-20 audit, factory-owned, with no sandcastle counterpart. The rest run no model and are all factory-owned: `merge-gate.yml`, `dispatch.yml`, `update-branch.yml`, and `ci.yml`, this repo's own CI.
- `factory/agent-workflows/`: the vendored sandcastle 0.12.0 scripts and prompts, under his own folder name and laid out as his `.sandcastle/agent-workflows/` (`implement/`, `review/`, `implement-pr/`, `shared/`). One path, one rule: under `factory/`, this folder is his and everything else is ours. It is a provenance boundary, not a dependency one: our modules use his primitives (`fail`, `sh`, `outputDir` in `shared/common.ts`) and his `gh` is now ours. His section headings stay his so an upstream diff stays readable, so a vendored prompt heads its ticket section `# ISSUE` while a factory-authored one uses `# TICKET`. `docs/provenance/sandcastle-files.md` maps every file to its origin and holds the rules for changing one; `CONTEXT.md` records the heading exception.
- `factory/lib/`: the factory-authored modules the workflows run on, the ones that are not a workflow of their own (`gh.ts`, `labels.ts`, `factory-pr.ts`, `model.ts`, `run-log.ts`, `harness.ts`, `ticket-context.ts`, `plugins.ts`, `usage.ts`, `usage-record.ts`, `read-only.ts`, `rotation.ts`, `accounts.ts`, `trusted-authors.ts`, `linked-issue.ts`, `verdict.ts`, `errors.ts`, `conflicts.ts`, `preflight.ts`, `upsert-comment.sh`).
- `factory/merge-gate/`, `factory/dispatch/`, `factory/update-branch/`, `factory/retry/`, `factory/audit/`: one folder per factory-owned job, `retry/` being the `retry` job of the two implement workflows rather than a workflow of its own. Each keeps its workflow's decisions as pure, `node --test` covered functions, and the script beside them only gathers inputs and calls GitHub: `dispatch/select.ts` and `dispatch/reconcile.ts`, `update-branch/plan.ts`, `retry/decide.ts` and `retry/escalation.ts`, `audit/plan.ts`, and the modules under `merge-gate/` that `merge-gate.ts` runs. The dispatch, update-branch and audit-decide jobs install nothing and run on Node's type stripping, so a 10-minute sweep costs seconds, billed as a minute on private repos.
- `factory/guards/` and `factory/onboard/`: tests for things that live outside `factory/`, the harness guards under `scripts/guards/` and `scripts/onboard.sh`, here because `npm test` globs `factory/**/*.test.ts`.
- `factory/plugins/`: skills the prompts call by name, vendored whole and pinned (mattpocock-skills 1.2.3, all 25 skills its manifest declares, including `tdd`, `code-review` and `resolving-merge-conflicts`). Copied into the account's `CLAUDE_CONFIG_DIR/skills/` before each attempt, where Claude Code loads them as plugins. The marketplace installer takes no version, so vendoring is the pin, and `factory/plugins/README.md` says how to bump it.
- `scripts/`: `onboard.sh`, and `guards/` for the checks that refuse a tool call in a maintainer's own harness, wired from `.claude/settings.json`.
- `templates/`: `factory.yml`, the caller a target copies into its `.github/workflows/`. sandcastle's word for it.
- `.github/dependabot.yml`: opens a PR when a new sandcastle or Claude Code version ships. The pin only moves by hand.
- `docs/`: `pipeline.md` this page, `adr/` the decisions, `agents/` the rules binding an agent working in this repo, `provenance/sandcastle.md` why the engine is vendored rather than forked plus what was not copied and why and spec #9's stories on sandcastle, `provenance/sandcastle-files.md` every file mapped to its origin plus the rule that changing a vendored file updates that row's counts, `research/` dated snapshots an ADR cites, never updated.

## Develop

```
npm ci
npm run typecheck
npm test
```
