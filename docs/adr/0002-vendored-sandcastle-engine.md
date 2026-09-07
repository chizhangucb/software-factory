---
status: accepted
date: 2026-09-06
---

# Vendor sandcastle's Actions pipeline, pinned, as the engine

Matt Pocock's sandcastle has been silent since 2026-06-29 (no commits, releases, or maintainer replies; 109 open issues, 51 open PRs) but its GitHub Actions dogfood pipeline runs for him today and its library already provides the multi-agent slot (Claude, Codex, Pi, Cursor, OpenCode, Copilot) and every sandbox provider (none, Docker, Podman, Vercel, Daytona). We copy the five workflows, their scripts, and their prompts into this repo, depend on the library from npm pinned to 0.12.0 with a lockfile and a committed tarball, and treat all of it as our code: edited freely, never upgraded automatically. Dependabot watches the pin and opens a PR when Matt releases; the upgrade itself is a deliberate bump plus a proof run.

## Considered options

- **Anthropic's official GitHub action as the engine.** Sanctioned auth, daily releases, GitHub App commits that trigger CI. Rejected for v0 because it is Claude-only and Chi wants the agent slot open; kept as the fallback if the frozen library breaks or Anthropic blocks subscription use.
- **Sandcastle's local Docker orchestrator on the Mini.** Deferred, not rejected: v0 is cloud so the factory runs when the Mini sleeps. It stays a live option for private repos where Actions minutes cost money; the package already carries it.
- **Turnkey agents (Copilot, Codex, Cursor).** Rejected: none merge, none read blocked-by, none accept a Claude subscription token.
- **A fresh build on the Agent SDK.** Closed by ADR 0001.

## Consequences

- Isolation in v0 is GitHub's ephemeral runner (sandcastle's no-sandbox provider). A sandbox inside the runner, or a hosted one, is a one-line provider change later, worth doing once the agent reads untrusted issue text under auto-merge.
- Pushes use a personal access token so GitHub runs CI on the agent's pushes; the default token would not.
- A rate-limited `claude -p` run exits 0 with the error in its JSON result. Every workflow checks the result, never the exit code.
- Sandcastle's sub-issue refusal is removed: `/to-tickets` output is sub-issues by design.
