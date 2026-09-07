# software-factory

Reusable GitHub Actions workflows that turn a labeled ticket into a draft PR, review it, and (soon) merge it with no human in the path. Glossary in `CONTEXT.md`, decisions in `docs/adr/`, spec in issue #9.

## Onboard a target repo

1. Copy `examples/factory.yml` to `.github/workflows/factory.yml` in the target. That file is the only factory file the target carries.
2. Add secrets: `FACTORY_PAT` (a classic PAT with `repo` and `workflow`, so pushes trigger CI) and one `CLAUDE_CODE_OAUTH_TOKEN_<n>` per account from `claude setup-token`. Optional: a `CLAUDE_ACCOUNT_<n>` variable naming each account for the logs.
3. Run `scripts/onboard.sh owner/repo` to create the `agent:*` and `needs-human` labels.
4. Label a ticket `agent:implement`. A draft PR with `Closes #N` appears on `agent/issue-N-<slug>`, then the reviewer runs.

Models per role are inputs on each reusable workflow (`implementer_model`, `reviewer_model`, defaults `claude-opus-5`). A `model:<name>` label on a ticket overrides the implementer model for that run.

## Layout

- `.github/workflows/implement.yml`, `review.yml`, `implement-pr.yml`: the reusable workflows, one per vendored sandcastle workflow.
- `factory/`: the vendored scripts and prompts (`shared`, `implement`, `review`, `implement-pr`) plus factory-owned modules (`model.ts`, `run-log.ts`). Treated as our code.
- `vendor/`: the `@ai-hero/sandcastle@0.12.0` tarball, integrity-checked against the lockfile in CI.
- `.github/dependabot.yml`: opens a PR when a new sandcastle or Claude Code version ships. The pin only moves by hand.

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
