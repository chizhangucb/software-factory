---
status: accepted
date: 2026-09-06
---

# Vendor sandcastle's Actions pipeline, pinned, as the engine

Copy three of Matt Pocock's five sandcastle agent workflows (implement, review, implement-pr), their scripts and prompts into this repo, depend on the `@ai-hero/sandcastle` library pinned to 0.12.0 with a lockfile, and treat all of it as our code: edited freely, never upgraded automatically. sandcastle has been silent since 2026-06-29 (109 open issues, 51 open PRs), but its Actions pipeline still runs and its library already provides the multi-agent slot (Claude, Codex, Pi, Cursor, OpenCode, Copilot) and every sandbox provider, which is more than a fresh build would give for the effort. Dependabot watches the pin; the upgrade itself is a deliberate bump plus a proof run. What was copied and why lives in `docs/provenance/sandcastle.md` (the essay) and `docs/provenance/sandcastle-files.md` (the file-by-file map, with line counts); read them before changing anything under `factory/agent-workflows/`.

## Considered Options

- **Anthropic's official GitHub action as the engine.** Rejected for v0: it is Claude-only and the maintainer wants the agent slot open. Kept as the fallback if the frozen library breaks or Anthropic blocks subscription use.
- **Sandcastle's local Docker orchestrator on the Mini.** Deferred, not rejected: v0 is cloud so the factory runs when the Mini sleeps. It stays a live option for private repos where Actions minutes cost money, and undeferring it swaps the sandbox provider and the machine, not the dispatcher, gate, or reviewer.
- **Turnkey agents (Copilot, Codex, Cursor).** Rejected: none merge, read blocked-by, or accept a Claude subscription token.
- **A fresh build on the Agent SDK.** Closed by ADR 0001.

## Consequences

- Isolation in v0 is GitHub's ephemeral runner, no sandbox provider; the trust model that makes that safe is ADR 0008.
- Pushes use a personal access token so GitHub runs CI on the agent's pushes; the default token would not.
- A rate-limited `claude -p` run exits 0 with the error in its JSON result, so every workflow checks the result, never the exit code.
- Sandcastle's sub-issue refusal is removed: `/to-tickets` output is sub-issues by design.
- The committed tarball is a release asset (`engine-0.12.0`), not a tree file: `package-lock.json`'s `integrity` is what `npm ci` verifies, and the asset is cold storage in case the registry copy vanishes.
