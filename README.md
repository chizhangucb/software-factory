# software-factory

Reusable GitHub Actions workflows that turn a labeled ticket into a PR, review it, and merge it with no human in the path. Glossary in `CONTEXT.md`, decisions in `docs/adr/`, spec in issue #9.

## Onboard a target repo

1. Copy `examples/factory.yml` to `.github/workflows/factory.yml` in the target. That file is the only factory file the target carries.
2. Add secrets: `FACTORY_PAT` (a classic PAT with `repo` and `workflow`, so pushes trigger CI) and one `CLAUDE_CODE_OAUTH_TOKEN_<n>` per account from `claude setup-token`. Optional: a `CLAUDE_ACCOUNT_<n>` variable naming each account for the logs. Adding an account later is adding one more secret.
3. Run `scripts/onboard.sh owner/repo <own-check ...>` (e.g. `scripts/onboard.sh chizhangucb/factory-fixture check`). It creates the `agent:*`, `needs-human`, and `factory:retry-1` labels, allows auto-merge on the repo, and puts a `factory` ruleset on the default branch: PR required, squash only, and `factory/verdict`, `factory/red-green`, `factory/test-integrity` plus the listed own checks required on a head that is up to date with main. Re-run it to update the ruleset.
4. Label a ticket `ready-for-agent`. The dispatcher adds `agent:implement` once every blocker is closed; a PR with `Closes #N` and auto-merge enabled appears on `agent/issue-N-<slug>`, then the reviewer runs. Labeling `agent:implement` by hand still works.
5. Auto-merge squashes the PR once `factory/verdict` and the other required checks are green on the head. Nothing else touches the merge button.

Models per role are inputs on each reusable workflow (`implementer_model`, `reviewer_model`, defaults `claude-opus-5`). A `model:<name>` label on a ticket overrides the implementer model for that run. `implementer_max_turns` (default 200) caps the implementer's turns on top of the 60 minute job timeout.

## Implementer run

One ticket, one branch, one PR. The script fetches the ticket and its parent spec (the agent has no GitHub token) into one file, then the agent reads the target repo's own `CLAUDE.md` or `AGENTS.md`, `CONTEXT.md`, and `docs/adr/`, which are binding, and works test-first at the seams the ticket names. Before any PR exists it runs `mattpocock-skills:code-review` (standards and spec) and fixes every finding, then the bundled `code-review` with `--fix`, then typecheck and the full suite. Implementation commits come first, `review:` commits after. The prompt forbids placeholders in plain words; the gate checks (#13) and the reviewer (#11) verify. The agent never pushes, labels, or opens PRs.

## Reviewer and verdict

- The reviewer is read-only: it judges the PR head against the ticket's acceptance criteria (the checklist under `## Acceptance criteria` in the issue the PR closes) with the diff to main and the target's test output (`test_command` input, default `npm ci && npm run typecheck --if-present && npm test`, captured before the agent starts). Any commit, dirty file, or moved HEAD fails the run; the workflow never pushes.
- Output: a `<!-- factory:verdict -->` section in the PR body with one ticked or unticked line per criterion and its evidence (replaced on re-review), a review comment with the summary, and a commit status `factory/verdict` on the PR head: `success` when every criterion is met, `failure` otherwise, including when the ticket has no criteria or the reviewer run failed. Make it a required check on the target's main.
- The caller must grant `statuses: write` (see `examples/factory.yml`); a called workflow cannot exceed the caller's permissions. Targets onboarded before this need that one line added.
- Tickets are sub-issues of their spec and are picked up as such; an issue that itself has sub-issues is refused as a spec.

## Merge

No merge queue in v0 (unavailable on user-owned repos; #26, #27), so ADR 0003's amendment stands in with three deterministic pieces:

- Auto-merge (squash) is enabled on every factory PR the moment `implement.yml` creates it, with `FACTORY_PAT`. GitHub refuses auto-merge on drafts, so factory PRs open ready; the required `factory/verdict` status, absent until the reviewer posts it, holds the merge.
- The `factory` ruleset from `scripts/onboard.sh` requires a PR and the checks above on an up-to-date head, so a PR behind main cannot merge.
- `update-branch.yml` runs on every `push` to main and on the `repository_dispatch` event `factory-update-branch`, which `review.yml` sends with `FACTORY_PAT` after a passing verdict. It calls GitHub's update-branch API for each open PR that has auto-merge enabled and is behind main, then carries the passing `factory/verdict` onto the merge commit GitHub made, with its provenance in the description. The verdict that governs a head is found by walking first parents through GitHub-made update merges only (two parents, committer `web-flow`), so a commit a person or an agent pushed never inherits one. A PR whose governing verdict is pending or failed is left alone until its re-review. The merge commit is made with `FACTORY_PAT`, so the target's CI and the gate run again on the new head and auto-merge lands the PR on the latest main. A conflict the API cannot resolve gets a comment and `agent:blocked` (escalation is #16). Decisions are pure functions in `factory/update-branch/plan.ts` with `node --test` coverage; no agent, no npm install, strip-types only like the dispatcher.

## Gate

`gate.yml` runs no agent. It reads the PR diff and the linked ticket (`Closes #N` in the PR body) and posts two commit statuses on the PR head:

- `factory/red-green`: the PR's new or changed test files (`test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `_test.go`, `test_*.py`) are copied onto a checkout of the base branch and run alone; they must fail there and pass on the head. Passes vacuously when the diff touches only docs, or when the ticket has a `## Removes` section and the diff changes no tests. A source change with no test change fails.
- `factory/test-integrity`: fails on a deleted test file and on a new `skip`, `only`, or `todo` marker in a test file. A ticket with a `## Removes` section may delete the tests of the subjects it lists, one per list item, matched by name (`- \`src/slugify.js\`` covers `test/slugify.test.js`).

Inputs: `test_command` (default `node --test`, receives the test files as arguments), `install_command` (default `npm ci`, empty to skip), `node_version`. Decisions are pure functions in `factory/gate/` with `node --test` coverage; `gate.ts` only gathers inputs and runs tests.

## Retry and escalation

- A run fails when the implementer run failed (no commits, an agent error, the turn cap), or when the PR's gate (`factory/red-green`, `factory/test-integrity`, the target's own CI) or `factory/verdict` came back failing. The first failure earns one retry; the second escalates. Decision: `factory/retry/decide.ts`, pure and unit-tested; handler: `factory/retry/retry.ts`, run by the failure paths of `implement.yml` and `implement-pr.yml` and, for the PR side, by `review.yml` right after it posts the verdict (it waits for the head's gate and CI to settle, then judges all of them at once, so no `status` or `check_run` trigger is needed in the caller).
- Retry: the failing output (the reviewer's checklist, the failing check's `--log-failed` excerpt, or the run's failure reason plus its log tail) is posted on the ticket as a `<!-- factory:retry -->` marker comment, the ticket gets `factory:retry-1` (the durable attempt count), and `agent:implement` goes on the PR when one is open (implement-pr continues on the branch) or on the ticket otherwise (implement continues on the pushed branch when there is one). The next implementer run reads the marker back into a `RETRY` prompt section and echoes it to the job log. After implement-pr pushes it labels `agent:review`, so the retry is judged like a first attempt.
- Escalation: every `agent:*` label comes off, `needs-human` goes on, the draft PR is closed, the branch is kept, and a comment on the ticket links the run, the uploaded run log, and the failure output. A failed implement run pushes whatever it committed so the branch exists for the human. To hand a ticket back, remove `needs-human` and `factory:retry-1`.
- A crashed reviewer (rate limited on every account, say) is not the implementer's failure: it keeps the `agent:blocked` comment and a human re-adds `agent:review`.

## Layout

- `.github/workflows/implement.yml`, `review.yml`, `implement-pr.yml`: the reusable workflows, one per vendored sandcastle workflow. `gate.yml`: the factory's own gate checks. `dispatch.yml`: the dispatcher. `update-branch.yml`: the merge-queue stand-in. All three factory-owned.
- `factory/`: the vendored scripts and prompts (`shared`, `implement`, `review`, `implement-pr`) plus factory-owned modules (`model.ts`, `run-log.ts`, `turn-cap.ts`, `ticket-context.ts`, `plugins.ts`, `gate/`, `dispatch/`, `update-branch/`, `retry/`). Treated as our code.
- `factory/plugins/`: skills the prompts call by name, vendored and pinned (`mattpocock-skills:code-review` from mattpocock-skills 1.2.3). Copied into the account's `CLAUDE_CONFIG_DIR/skills/` before each attempt, where Claude Code loads them as plugins. Bump by hand.
- `vendor/`: the `@ai-hero/sandcastle@0.12.0` tarball, integrity-checked against the lockfile in CI.
- `.github/dependabot.yml`: opens a PR when a new sandcastle or Claude Code version ships. The pin only moves by hand.

## Dispatcher

- Runs on `issues: closed` and `issues: labeled` (ready-for-agent), every 10 minutes as the fallback for missed events, and on `workflow_dispatch`.
- Dispatches an open issue when it carries `ready-for-agent`, has zero open blockers (GitHub native issue dependencies, `issue_dependencies_summary.blocked_by`), no assignee, no sub-issues, no `agent:*` or `needs-human` label, and no open PR already closing it. Refuses `ready-for-human` and `needs-triage`.
- Labels with `FACTORY_PAT`: a label added with `GITHUB_TOKEN` fires no `issues: labeled` event, so the implementer would never start.
- Selection is `factory/dispatch/select.ts`, pure and unit-tested. The job installs nothing; it runs the script on Node's type stripping, so the 10-minute cron costs seconds (billed as a minute on private repos).

## Engine notes

- Sandcastle 0.12.0 pinned exactly, Claude Code CLI pinned in `package.json`, both installed from the lockfile on every run.
- Every run logs to a file with the stream event hook and keeps Claude's raw `result` events. Success is decided from those (`is_error`), never from the library's return value or the CLI exit code, because a rate-limited `claude -p` exits 0.
- Runs pass `--dangerously-skip-permissions` on a bare ephemeral runner (ADR 0002). Pushes and PR creation use `FACTORY_PAT` so the target's CI fires on the agent's work.
- The library's Claude provider has no flag passthrough, so `turn-cap.ts` wraps it and appends `--max-turns`; hitting the cap is an `is_error` result, so the run fails instead of stalling.
- Skill invocations (`Skill` tool uses) are echoed to the job log as `skill <name> <args>`; the library's parser only surfaces Bash, WebSearch, WebFetch, and Agent calls.

## Rotation

- The workflow enumerates `CLAUDE_CODE_OAUTH_TOKEN_<n>` secrets, masks every token, and hands the list to the run script as a file. The script picks the lowest-indexed account, deletes the file, runs, and if the result event says rate limited it re-runs once on the next account. The job log names accounts by their `CLAUDE_ACCOUNT_<n>` label, never by token. Module: `factory/shared/rotation.ts` (`pickToken`, `isRateLimited`, pure, no network); run path: `factory/shared/accounts.ts`. Quota-aware ranking is #24.
- `per_account_slots` (input, default 3) caps runs in flight per account as `account-slot-<i>` concurrency groups; raise it in the caller's `with:`. ADR 0004 records the one-pending-per-group trade-off.
- Proof-run switch: set the caller repo variable `FACTORY_FORCE_RATE_LIMIT_ON=1` to make every job treat account 1's first attempt as rate limited (no agent run on it) and finish on account 2. Unset by default; `gh variable delete FACTORY_FORCE_RATE_LIMIT_ON` turns it off. Accepts a comma-separated list of indexes.
- The private factory repo must allow its workflows to be used by other repos: Settings, Actions, General, Access.

## Develop

```
npm ci
npm run typecheck
npm test
```
