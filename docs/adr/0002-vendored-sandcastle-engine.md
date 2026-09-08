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

## Amendment, 2026-09-07: no sandbox for chronicle in v0, the factory reads only trusted authors

Chronicle is the first public target (#20). The consequence above says isolation is worth revisiting "once the agent reads untrusted issue text under auto-merge", and a public repo is exactly that: anyone can open an issue or comment on one, and a ticket is the implementer's instructions. v0 still ships without a sandbox provider, for two reasons and with one control.

- A sandbox inside the runner does not protect what is actually at risk. The runner job holds `FACTORY_PAT` and the account tokens outside the agent process, and the push, label, and PR calls are workflow steps, not agent actions. An agent boxed inside the same job still writes the branch the workflow then pushes. The exposure a sandbox removes is the runner's own filesystem and network, which are ephemeral and hold nothing else.
- The control that fits the threat is refusing to act on a stranger's words. Trust is GitHub's `author_association`, one policy in `factory/lib/trusted-authors.ts`, default `OWNER`, widened per target with `trusted_author_associations`. Everything the implementer run reads goes through it: the dispatcher never dispatches an untrusted author's ticket; the ticket keeps only trusted comments, with a line saying how many were dropped so the agent knows the thread was cut; an untrusted parent spec is named but not quoted; and the retry marker is read only from a trusted comment, so nobody can forge a "previous attempt failed" section into the prompt.

### What this does not cover

- The reviewer, implement-pr, and the audit read the PR's comments, its review threads, and the linked issue through `factory/agent-workflows/shared/review-context.ts`, which is still unfiltered. The reviewer is read-only by ADR 0003 and implement-pr acts on a PR the factory itself opened, so the worst case is a wrong verdict rather than injected code, but implement-pr does write code from that text and it is the same class of hole. Follow-up ticket #43.
- A ticket labeled `agent:implement` by hand skips the dispatcher, so it skips the gate. That is deliberate: adding that label needs write access, and a maintainer doing it by hand is making the trust decision themselves. The reconciler re-adds the label on stranded work for the same reason, and the ticket it re-labels was dispatched under the gate in the first place.
- `OWNER` is nobody on an org-owned repo, where the owner's own issues read `MEMBER`. Moving these repos to an org (#26) means setting `OWNER,MEMBER` in the same change.

Deferred, not rejected: a sandbox provider is still one line in `factory/agent-workflows/shared/common.ts`, and the case for it returns when a target has contributors whose tickets the factory should run, or when the factory gets a credential worth stealing. Nothing here changes ADR 0001 or the vendoring decision.

## Amendment, 2026-09-08: the tarball is a release asset, not a tree file

The decision above says "a lockfile and a committed tarball". The tarball is no longer committed. It is attached to the `engine-0.12.0` release on this repo, and `vendor/` is gone along with the CI step that recomputed its hash (#48).

- The live check is `package-lock.json`: the `integrity` field for `node_modules/@ai-hero/sandcastle` is what `npm ci` verifies on every run, in CI and in every factory job. A second hash comparison in CI checked a file nothing installed from.
- The release asset is cold storage, in case the registry copy of 0.12.0 goes away. No workflow, script, or install path fetches it. Its sha512 matches the lockfile's integrity, recorded in the release notes.
- Dependabot is unchanged: it still watches `@ai-hero/sandcastle` and `@anthropic-ai/claude-code` in `package.json`, and still merges nothing by itself.
