# software-factory

Reusable GitHub Actions workflows that turn a labeled ticket into a draft PR, review it, and (soon) merge it with no human in the path. Glossary in `CONTEXT.md`, decisions in `docs/adr/`, spec in issue #9.

## Onboard a target repo

1. Copy `examples/factory.yml` to `.github/workflows/factory.yml` in the target. That file is the only factory file the target carries.
2. Add secrets: `FACTORY_PAT` (a classic PAT with `repo` and `workflow`, so pushes trigger CI) and one `CLAUDE_CODE_OAUTH_TOKEN_<n>` per account from `claude setup-token`. Optional: a `CLAUDE_ACCOUNT_<n>` variable naming each account for the logs.
3. Run `scripts/onboard.sh owner/repo` to create the `agent:*` and `needs-human` labels.
4. Label a ticket `ready-for-agent`. The dispatcher adds `agent:implement` once every blocker is closed; a draft PR with `Closes #N` appears on `agent/issue-N-<slug>`, then the reviewer runs. Labeling `agent:implement` by hand still works.
5. Require the two gate statuses on `main`: `factory/red-green` and `factory/test-integrity`. They post on every `pull_request` event next to the target's own checks.

Models per role are inputs on each reusable workflow (`implementer_model`, `reviewer_model`, defaults `claude-opus-5`). A `model:<name>` label on a ticket overrides the implementer model for that run.

## Reviewer and verdict

- The reviewer is read-only: it judges the PR head against the ticket's acceptance criteria (the checklist under `## Acceptance criteria` in the issue the PR closes) with the diff to main and the target's test output (`test_command` input, default `npm ci && npm run typecheck --if-present && npm test`, captured before the agent starts). Any commit, dirty file, or moved HEAD fails the run; the workflow never pushes.
- Output: a `<!-- factory:verdict -->` section in the PR body with one ticked or unticked line per criterion and its evidence (replaced on re-review), a review comment with the summary, and a commit status `factory/verdict` on the PR head: `success` when every criterion is met, `failure` otherwise, including when the ticket has no criteria or the reviewer run failed. Make it a required check on the target's main.
- The caller must grant `statuses: write` (see `examples/factory.yml`); a called workflow cannot exceed the caller's permissions. Targets onboarded before this need that one line added.
- Tickets are sub-issues of their spec and are picked up as such; an issue that itself has sub-issues is refused as a spec.

## Gate

`gate.yml` runs no agent. It reads the PR diff and the linked ticket (`Closes #N` in the PR body) and posts two commit statuses on the PR head:

- `factory/red-green`: the PR's new or changed test files (`test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `_test.go`, `test_*.py`) are copied onto a checkout of the base branch and run alone; they must fail there and pass on the head. Passes vacuously when the diff touches only docs, or when the ticket has a `## Removes` section and the diff changes no tests. A source change with no test change fails.
- `factory/test-integrity`: fails on a deleted test file and on a new `skip`, `only`, or `todo` marker in a test file. A ticket with a `## Removes` section may delete the tests of the subjects it lists, one per list item, matched by name (`- \`src/slugify.js\`` covers `test/slugify.test.js`).

Inputs: `test_command` (default `node --test`, receives the test files as arguments), `install_command` (default `npm ci`, empty to skip), `node_version`. Decisions are pure functions in `factory/gate/` with `node --test` coverage; `gate.ts` only gathers inputs and runs tests.

## Layout

- `.github/workflows/implement.yml`, `review.yml`, `implement-pr.yml`: the reusable workflows, one per vendored sandcastle workflow. `gate.yml`: the factory's own gate checks. `dispatch.yml`: the dispatcher, factory-owned.
- `factory/`: the vendored scripts and prompts (`shared`, `implement`, `review`, `implement-pr`) plus factory-owned modules (`model.ts`, `run-log.ts`, `gate/`, `dispatch/`). Treated as our code.
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
- The private factory repo must allow its workflows to be used by other repos: Settings, Actions, General, Access.

## Develop

```
npm ci
npm run typecheck
npm test
```
