# software-factory

Reusable GitHub Actions workflows that turn a labeled ticket into a merged PR with no human in the path. A maintainer writes the ticket and reads what the factory escalates; everything in between is agents and required status checks.

The factory lives in this repo. A target repo carries one workflow file that calls it.

Glossary in `CONTEXT.md`, decisions in `docs/adr/`, spec in issue #9. What is sandcastle's and what is ours, file by file, in `docs/provenance/sandcastle.md`; the dated research the ADRs rest on in `docs/research/`.

## How a ticket becomes a merge

1. A maintainer labels a ticket `ready-for-agent`.
2. The **dispatcher** picks it up once every blocker is closed and adds `agent:implement`.
3. The **implementer** builds it on `agent/issue-N-<slug>` and opens a PR with `Closes #N` and auto-merge already enabled.
4. The **gate** runs no agent. It posts `factory/red-green` and `factory/test-integrity` on the PR head, alongside the target's own CI.
5. The **reviewer** judges the head against the ticket's acceptance criteria and posts `factory/verdict`.
6. **Auto-merge** squashes the PR once every required check is green. Nothing else touches the merge button.
7. **update-branch** keeps auto-merge PRs current as main moves, and hands a real conflict back to the implementer.
8. The **audit** re-reviews each of the first 20 merges and opens a revert PR on a miss.

A failure in steps 3 to 5 earns one informed retry, then escalates to `needs-human`.

## Onboard a target repo

1. **Copy the caller.** `templates/factory.yml` goes to `.github/workflows/factory.yml` in the target. That file is the only factory file the target carries. Every job passes `factory_ref`, and it must equal the ref in that job's `uses:` (both `main` in the template): GitHub gives a cross-repo reusable workflow an empty `job_workflow_sha`, so the scripts are checked out at `factory_ref` while the workflow file comes from `uses:`. Change one without the other and they drift. Onboarded before #61? Re-copy: a caller still naming `implement.yml`, `review.yml`, `implement-pr.yml` or `audit.yml` fails at startup and kills the whole caller run, because those four took sandcastle's `agent-` names.

2. **Add the secrets.**
   - `FACTORY_PAT`, a fine-grained PAT, so pushes trigger the target's CI. It needs contents, issues, pull requests and workflows write. It cannot write commit statuses or repo variables, hence statuses on `GITHUB_TOKEN` and the factory's own state on a `factory-state` branch.
   - One `CLAUDE_CODE_OAUTH_TOKEN_<n>` per subscription account, from `claude setup-token`. Adding an account later is adding one more secret. Optional: a `CLAUDE_ACCOUNT_<n>` variable naming each account in the logs.
   - One `FACTORY_PAT` covers every target in v0 (#20). Per-target tokens buy nothing while the same machine and the same workflows hold them all; split when a target is owned by someone else.

3. **Run the onboarding script.** `scripts/onboard.sh owner/repo [own-check ...]`, for example `scripts/onboard.sh chizhangucb/factory-fixture check`. It creates the label vocabulary (`ready-for-agent`, `ready-for-human`, `needs-triage`, `agent:*`, `needs-human`, `factory:retry-1`), allows auto-merge on the repo, and puts a `factory` ruleset on the default branch: PR required, squash only, and `factory/verdict`, `factory/red-green`, `factory/test-integrity` plus the own checks you listed, all required on a head up to date with main. Each own check is a job name the target's CI already posts, and passing them matters: with no own check the script warns that the ruleset will gate on the factory's checks alone, so a PR that breaks the target's build can still merge. Re-run the script to update the ruleset.

4. **Check the caller's permissions.** It must grant `statuses: write`, `checks: read` and `actions: read`. They are in `templates/factory.yml`, and a called workflow cannot exceed its caller's permissions, so targets onboarded before those lines existed need them added.

5. **Let this repo serve its workflows.** Settings, Actions, General, Access. A private factory repo will not serve them otherwise.

Then label a ticket `ready-for-agent` and the pipeline above runs. Labeling `agent:implement` by hand still works.

## Caller inputs

Every input has a default, so the template works as copied. Set them in the calling job's `with:`. Models are resolved by `factory/lib/model.ts`.

| Input | Jobs | Default | What it does |
| --- | --- | --- | --- |
| `factory_ref` | all | `main` | Ref of the factory scripts. Must equal the ref in that job's `uses:`. |
| `factory_repo` | all | `chizhangucb/software-factory` | Repo holding the factory scripts. |
| `node_version` | implement, implement-pr, review, gate, audit | `"22"` | The Node the agent, `test_command`, the gate's test runs and the factory's own engine get. Match the target's CI, on every one of those jobs (chronicle needs `"24"`). |
| `implementer_model` | implement, implement-pr | `claude-opus-5` | Model for the implementer. A `model:<name>` label on a ticket overrides it for that run only. |
| `reviewer_model` | review | `claude-opus-5` | Model for the reviewer. Never overridden by a label. |
| `audit_model` | audit | `claude-opus-5` | Model for the audit. Never overridden by a label. |
| `test_command` | review, audit | `npm ci && npm run typecheck --if-present && npm test` | The target's tests, run before the agent starts; the output is evidence for the verdict. |
| `test_command` | gate | `node --test` | Receives the gate's test files as arguments. |
| `install_command` | gate | `npm ci` | Empty to skip. |
| `per_account_slots` | implement, implement-pr, review, audit | `5` | Runs in flight per account, as `account-slot-<i>` concurrency groups. Setting it on dispatch, gate or update-branch fails the caller at parse time. ADR 0004 records the one-pending-per-group trade-off. |
| `checks_timeout_minutes` | review | `15` | How long the retry handler waits after the verdict for the head's gate and CI to settle. A check still pending then is requeued, not failed. |
| `trusted_author_associations` | dispatch, implement, implement-pr, review, audit | `OWNER` | Whose words the factory acts on. Set all five together. |
| `audit_limit` | audit | `20` | How many merges get a full re-review. |
| `stuck_minutes`, `verdict_minutes`, `update_minutes` | dispatch | `15`, `30`, `30` | The reconciler's deadlines. |

## Dispatcher

Runs on `issues: closed` and `issues: labeled` (ready-for-agent), on `workflow_dispatch`, on the `repository_dispatch` event `factory-sweep`, and every 10 minutes as the fallback for missed events. GitHub's cron is unreliable on some accounts, so a cron on any machine can drive the sweep: `gh api repos/<owner>/<repo>/dispatches -f event_type=factory-sweep`, with a PAT that has contents write on the target.

- It dispatches an open, `ready-for-agent` ticket from a trusted author with no open blockers (GitHub native issue dependencies, `issue_dependencies_summary.blocked_by`), no assignee, no sub-issues, no `agent:*` or `needs-human` label and no open PR already closing it. `ready-for-human` and `needs-triage` are refused. A ticket is a sub-issue of its spec and is picked up as one; an issue with sub-issues of its own is refused as a spec.
- The issues listing is eventually consistent, so before each label the dispatcher re-reads that issue (state, labels, blockers, open PRs) and skips it with `closed since the snapshot` or the usual reason when anything changed; the summary line counts them. `agent-implement.yml` is the backstop, refusing a closed issue (label removed, comment) before it touches a branch. Both exist because #19 labeled and implemented two closed tickets, and merged one.
- Labels go on with `FACTORY_PAT`. A label added with `GITHUB_TOKEN` fires no `issues: labeled` event, so the implementer would never start.
- A skipped ticket is not commented on; the reason is one line per issue in the job log and the `dispatch.json` artifact, so a sweep every 10 minutes does not become a comment every 10 minutes.

### Reconciler

Every sweep (schedule, `workflow_dispatch`, `factory-sweep`, not the issue-event runs) also repairs states stuck past their deadline, so a lost event costs at most one sweep (#35). A second sweep over a healthy repo changes nothing.

- A ticket in `agent:implement` or `agent:in-progress` with no live implement run, or a PR in `agent:review` (`agent:implement`, `agent:in-progress`) with no live review run, gets its label removed and re-added with `FACTORY_PAT` so the event fires. A second miss on the same stranding escalates to `needs-human` with a comment, on the retry handler's escalation label set, and a PR's ticket is parked with it.
- A cancel is read from the run's job names, never from its conclusion, since a superseded push reads as `CANCELLED` too. A slot-contention cancel is re-dispatched without counting as a miss; any other cancel counts as one. The marker also carries a re-dispatch count that caps re-dispatches of any cause at two on one stranding, one sweep more than the miss path allows, so a repeatedly cancelled ticket escalates instead of looping.
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

The prompt forbids placeholders in plain words; the gate (#13) and the reviewer (#11) are what verify it. The agent never pushes, labels, or opens PRs.

## Gate

`gate.yml` runs no agent. It reads the PR diff and the linked ticket (`Closes #N` in the PR body) and posts two commit statuses on the PR head.

- `factory/red-green`: the PR's new or changed test files (`*.test.*`, `*.spec.*`, `_test.go`, `test_*.py`, anything under `__tests__/`) are copied onto a checkout of the base branch and run alone. They must fail there and pass on the head. A helper or fixture under `test/` is a source change, not a test, and a source change with no test change fails.

  It passes vacuously twice over: when the diff changes no source file, and when the ticket has a `## Removes` section and the diff changes no tests. Not source: a doc, a dotfile anywhere, and a data or manifest file (`.yml`, `.json`, `.toml`, `.lock`, and the rest of `CONFIG_EXTENSIONS`) at the repo root or under a dot directory. The same extension nested deeper is data the code reads, and stays source.
- `factory/test-integrity`: fails on a deleted test file and on a new `skip`, `only` or `todo` marker in a test file. A ticket with a `## Removes` section may delete the tests of the subjects it lists, one per list item, matched by name (`- \`src/slugify.js\`` covers `test/slugify.test.js`).

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

For each open PR that has auto-merge enabled and is behind main, update-branch calls GitHub's update-branch API, then carries the passing `factory/verdict` onto the merge commit GitHub made, with its provenance in the status description. That merge commit is made with `FACTORY_PAT`, so the target's CI and the gate run again on the new head and auto-merge lands the PR on the latest main.

A verdict travels only across merges GitHub itself made, so a commit a person or an agent pushed never inherits one, and a PR whose governing verdict is pending or failed waits for its re-review. ADR 0003 has the walk in full.

A conflict the API cannot resolve is handed to the implementer (#19): a comment plus `agent:implement` on the PR, so `agent-implement-pr.yml` runs, sees the conflict, and the agent merges `main` into the branch, resolves and commits. The push re-runs CI, the gate and the review, and auto-merge lands the new head. A conflict still present after that run fails it, so the hand-off cannot loop and #16 counts the attempt. A PR already in `agent:implement`, `agent:in-progress`, `agent:review` or `agent:blocked` is left alone, and a resolution that fails takes the normal retry and escalation path (#16).

## Retry and escalation

A run fails when the implementer run failed (no commits, an agent error, the 30 minute idle timeout), when it was killed at the 60 minute job timeout, or when the PR's gate (`factory/red-green`, `factory/test-integrity`, the target's own CI) or `factory/verdict` came back failing. First failure, one retry; second, escalation. Decision: `factory/retry/decide.ts`; handler: `factory/retry/retry.ts`.

**Where it runs.** On the two implement workflows the handler is a `retry` job of its own, not a step, so a `timeout-minutes` kill still reaches it (#51; the workflow files carry the reasoning). A killed attempt and one that stopped itself both count as the implementer's failure. The attempt keeps `agent:in-progress` until the handler is about to relabel, or the sweep would re-dispatch from main before the marker and `factory:retry-1` exist; a handler that dies first leaves the label on for the reconciler. `agent-review.yml` runs it as a step instead, after the verdict and once the head's gate and CI have settled, so the caller needs no `status` or `check_run` trigger. A reviewer killed at its own timeout posted no verdict, so its PR becomes the reconciler's `verdict_minutes` case.

**The retry.** The failing output (the reviewer's checklist, the failing check's `--log-failed` excerpt, or the failure reason plus the run's log tail) goes on the ticket as a `<!-- factory:retry -->` marker comment. The ticket gets `factory:retry-1`, the durable attempt count, and `agent:implement` goes on the PR if one is open, so implement-pr continues on the branch, else on the ticket, where implement continues on the pushed branch when there is one. The next run reads the marker into a `RETRY` prompt section and echoes it to the job log. implement-pr labels `agent:review` after it pushes, so the retry is judged like a first attempt.

**Escalation.** Every `agent:*` label comes off the ticket, `ready-for-agent` with them; `needs-human` goes on; the PR is closed with its own `agent:*` labels off and auto-merge with them; the branch is kept; and a comment on the ticket links the run, the run log and the failure output. An escalated ticket carries `needs-human` and nothing else of the factory's, and the closed PR carries no state: the dispatcher refuses `needs-human`, and a ticket that also still said `ready-for-agent` would be saying two things at once. Both label sets are one decision, `factory/retry/escalation.ts`, over `factory/lib/labels.ts`, which the reconciler's escalation reads too, so a parked ticket looks the same whichever path parked it. A failed implement run pushes whatever it committed, so the branch is there. To hand a ticket back: remove `needs-human` and `factory:retry-1`, add `ready-for-agent`. The next run starts from main and ignores the old marker.

**What does not spend it.** Only the implementer's own failure does.

- A crashed reviewer, a failed push or PR step, or a handler that could not reach GitHub gets the `agent:blocked` comment for a human to re-label.
- An implementer rate limited on every account is requeued: the ticket gets a comment and no factory label, so the dispatcher re-dispatches it next sweep, while a PR gets the comment plus `agent:blocked`, nothing else re-dispatching a PR.
- A check still pending when the review's wait runs out (`checks_timeout_minutes`) is requeued the same way and spends nothing, because nothing failed: there is no log to inform a retry, and a slow target CI would burn it uninformed. That path uses the PR while one is open and falls back to the ticket when the PR closed or merged as the handler waited. A check that actually failed outranks a pending one and still spends the retry, with its log.
- A verdict that failed for want of acceptance criteria escalates at once, no implementer run being able to fix the ticket.

## Audit

Auto-merge from day one is survivable because the first 20 merges are each re-reviewed (ADR 0003). `agent-audit.yml` is called on `pull_request: closed`; the example caller filters to merged PRs.

- A serialized `decide` job asks whether this merge is one of the first `audit_limit`: the PR must be merged and a factory PR (`CONTEXT.md` defines that; `factory/lib/factory-pr.ts` is the one definition, which the reconciler reads too), and the counter must be under the limit. Past the limit the job logs `audit limit reached` and exits.
- The counter is factory state in the target: `.factory/state.json` (`{"auditedMerges": N}`) on the orphan `factory-state` branch, read and written through the contents API with `FACTORY_PAT` by `factory/audit/state.sh` (`get`, `set <n>`), absent meaning 0. A branch of its own keeps it away from main's ruleset and CI. It advances before the audit runs, so a crashed audit still counts.
- It runs the reviewer prompt in audit mode (`factory/audit/prompt.md`) with `audit_model` on a read-only checkout of the merge commit, against the merged diff (`merge^..merge`), the ticket's acceptance criteria, and the target's test output on that commit. The run log names the model. Same account rotation and `account-slot-<i>` cap as the other runs.
- It comments the result on the merged PR (`<!-- factory:audit -->`, one comment, replaced on re-run): one ticked line per criterion with evidence, placeholders found, and the audit's own usage.
- A miss is any unmet criterion or any placeholder. It opens a revert PR (`git revert` of the merge commit on `factory/revert-pr-<n>`, pushed and opened with `FACTORY_PAT`, never auto-merged) and a `needs-human` issue linking the PR, the audit comment and the revert PR. A revert that does not apply cleanly is reported in the issue instead.

To audit with a model stronger than the reviewer, set `audit_model`. `claude-fable-5-1` and `claude-fable-5` were verified on the subscription on 2026-09-07 (account 1, `claude -p --model <name>`, `is_error: false`, `modelUsage` naming the model). The other accounts were not checked, so a rotation onto them with that alias is unverified.

## Usage

Every factory PR carries one usage comment per role: `<!-- factory:usage:implementer -->` from implement and implement-pr, `<!-- factory:usage:reviewer -->` from review. The audit's usage sits inside its own comment.

Rows are attempts: model, account, wall time, `claude -p` calls, turns, input, cache write, cache read and output tokens, and Claude Code's list-price cost as a reference figure, since the factory runs on subscription tokens. The source is the raw `result` event of every `claude -p` call, summed in `factory/lib/usage.ts` and recorded by `runWithRotation` after each attempt to `OUTPUT_DIR/usage.json` and `usage-<role>.md`, so a run that fails afterwards still reports. sandcastle's own `iterations[].usage` is a context snapshot rather than a total, so it is not used. `factory/lib/upsert-comment.sh` posts the file, editing the existing comment for the marker rather than adding one.

## Rotation

The workflow enumerates the `CLAUDE_CODE_OAUTH_TOKEN_<n>` secrets, masks every token, and hands the list to the run script as a file. The script picks the lowest-indexed account, deletes the file, runs, and re-runs once on the next account if the result event says rate limited. The job log names accounts by their `CLAUDE_ACCOUNT_<n>` label, never by token. Module: `factory/lib/rotation.ts` (`pickToken`, `isRateLimited`, no network); run path: `factory/lib/accounts.ts`. Quota-aware ranking is #24.

## Engine notes

- Sandcastle 0.12.0 pinned exactly, Claude Code CLI pinned in `package.json`, both installed from the lockfile on every run. `package-lock.json`'s `integrity` for `node_modules/@ai-hero/sandcastle` is the live check on what a run installs, so `npm ci` is the check and CI needs no hash step of its own.
- The 0.12.0 tarball is also attached to the `engine-0.12.0` release as cold storage, should the npm copy go away. Nothing fetches it: no workflow, no script, no install path. A bump cuts the next `engine-<version>` release the same way (ADR 0002, amendment "the tarball is a release asset, not a tree file").
- Every run logs to a file with the stream event hook and appends Claude's raw `result` events to `<name>.result-events.jsonl` in the log artifact as they arrive. Success is decided from the last of them (`is_error`), never from the library's return value or the CLI exit code, because a rate-limited `claude -p` exits 0. Every event is still read for rate-limit detection.
- Runs pass `--dangerously-skip-permissions` on a bare ephemeral runner (ADR 0002). Pushes and PR creation use `FACTORY_PAT` so the target's CI fires on the agent's work.
- Skill invocations (`Skill` tool uses) are echoed to the job log as `skill <name> <args>`; the library's parser only surfaces Bash, WebSearch, WebFetch and Agent calls.

## Layout

- `.github/workflows/`: an `agent-` prefix means the workflow runs a model, sandcastle's convention. `agent-implement.yml`, `agent-review.yml` and `agent-implement-pr.yml` are the reusable workflows, one per vendored sandcastle workflow, under his names, each ending in the `retry` job the section above describes. `agent-audit.yml` is the first-20 audit, factory-owned, with no sandcastle counterpart. The rest run no model and are all factory-owned: `gate.yml`, `dispatch.yml`, `update-branch.yml`, and `ci.yml`, this repo's own CI.
- `factory/agent-workflows/`: the vendored sandcastle 0.12.0 scripts and prompts, under his own folder name and laid out as his `.sandcastle/agent-workflows/` (`implement/`, `review/`, `implement-pr/`, `shared/`). One path, one rule: under `factory/`, this folder is his and everything else is ours. It is a provenance boundary, not a dependency one: our modules use his primitives (`fail`, `sh`, `outputDir` in `shared/common.ts`) and his `gh` is now ours. His section headings stay his so an upstream diff stays readable, so a vendored prompt heads its ticket section `# ISSUE` while a factory-authored one uses `# TICKET`. `docs/provenance/sandcastle.md` maps every file to its origin and holds the rules for changing one; `CONTEXT.md` records the heading exception.
- `factory/lib/`: the factory-authored modules the workflows run on, the ones that are not a workflow of their own (`gh.ts`, `labels.ts`, `factory-pr.ts`, `model.ts`, `run-log.ts`, `harness.ts`, `ticket-context.ts`, `plugins.ts`, `usage.ts`, `usage-record.ts`, `read-only.ts`, `rotation.ts`, `accounts.ts`, `trusted-authors.ts`, `linked-issue.ts`, `verdict.ts`, `errors.ts`, `conflicts.ts`, `preflight.ts`, `upsert-comment.sh`).
- `factory/gate/`, `factory/dispatch/`, `factory/update-branch/`, `factory/retry/`, `factory/audit/`: one folder per factory-owned workflow. Each keeps its workflow's decisions as pure, `node --test` covered functions, and the script beside them only gathers inputs and calls GitHub: `dispatch/select.ts` and `dispatch/reconcile.ts`, `update-branch/plan.ts`, `retry/decide.ts` and `retry/escalation.ts`, `audit/plan.ts`, and the modules under `gate/` that `gate.ts` runs. The dispatch, update-branch and audit-decide jobs install nothing and run on Node's type stripping, so the 10-minute cron costs seconds, billed as a minute on private repos.
- `factory/guards/` and `factory/onboard/`: tests for things that live outside `factory/`, the harness guards under `scripts/guards/` and `scripts/onboard.sh`, here because `npm test` globs `factory/**/*.test.ts`.
- `factory/plugins/`: skills the prompts call by name, vendored whole and pinned (mattpocock-skills 1.2.3, all 25 skills its manifest declares, including `tdd`, `code-review` and `resolving-merge-conflicts`). Copied into the account's `CLAUDE_CONFIG_DIR/skills/` before each attempt, where Claude Code loads them as plugins. The marketplace installer takes no version, so vendoring is the pin, and `factory/plugins/README.md` says how to bump it.
- `scripts/`: `onboard.sh`, and `guards/` for the checks that refuse a tool call in a maintainer's own harness, wired from `.claude/settings.json`.
- `templates/`: `factory.yml`, the caller a target copies into its `.github/workflows/`. sandcastle's word for it.
- `.github/dependabot.yml`: opens a PR when a new sandcastle or Claude Code version ships. The pin only moves by hand.
- `docs/`: `adr/` the decisions, `agents/` the rules binding an agent working in this repo, `provenance/sandcastle.md` every file mapped to its origin plus what was not copied and why and spec #9's stories on sandcastle, `research/` dated snapshots an ADR cites, never updated.

## Develop

```
npm ci
npm run typecheck
npm test
```
