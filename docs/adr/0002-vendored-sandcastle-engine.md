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

## Amendment, 2026-09-08: the reviewer, implement-pr and the audit read only trusted authors too

The 2026-09-07 amendment above left one hole open, named there as follow-up #43: `factory/agent-workflows/shared/review-context.ts` was unfiltered, so the reviewer, implement-pr and the audit read a stranger's PR comments, review threads and linked-issue comments. That is now closed (#52), and #43 with it. The history above stands as written; this is what changed.

- Everything a stranger can write is dropped before it reaches one of those three agents: the PR's top-level comments, the submitted review summaries, the unresolved review threads, and the linked ticket's comments. A dropped thread comment is not a reply target either, so an agent cannot answer words it never read.
- The count goes in place of what was dropped, on the PR context and on the ticket, so an agent reads a cut thread as cut rather than as the whole of it.
- The linked issue moved to the `gh issue view --json` path. The text view carries no `author_association`, so nothing on it could be filtered; one JSON read now brings the title, the acceptance criteria and the comments with their associations, and `lib/ticket-context.ts` renders it, the same code the implementer's ticket goes through.
- The trust policy is one type, `TrustPolicy`, built once at each entrypoint from that job's `trusted_author_associations` and passed down as a required argument. It was threaded as optional parameters with defaults, which meant a call site could read a stranger's words by forgetting one. `author_association` is a union, and a value GitHub does not send reads as `NONE`.
- `agent-review.yml`, `agent-implement-pr.yml` and `agent-audit.yml` take `trusted_author_associations`, default `OWNER`, the dispatcher's default. Setting it widens all of it together. The retry marker read on the PR path follows the same policy, which it did not before: `agent-implement-pr.yml` had no input, so it was pinned to a hardcoded `OWNER`.
- An untrusted parent spec now withholds its title as well as its body. A title is the same untrusted channel as a body, and quoting it put a stranger's words in the prompt.
- The factory's own voice is exempt, and it has to be. A workflow posting with `GITHUB_TOKEN` comments as the Actions bot, and GitHub reports `author_association: NONE` for it on every repo, so the association alone would drop the reviewer's own summary and inline findings before implement-pr, whose whole job is to address them, ever read them. The exemption is on the login, normalised because REST spells it `github-actions[bot]` and gh's JSON and GraphQL spell it `github-actions`. It is not a widening: posting under that login needs a workflow in the target, which needs write access, the same bar as adding the `agent:implement` label. Comments posted with `FACTORY_PAT` come from the owner and need no exemption.
- Each of the three runs logs one line naming what its policy took out, so a thread cut to nothing is visible in the job log and not only inside the prompt.

### What this still does not cover

- The linked issue's own title and body are read whatever their author's association, on all three paths. The issue number comes from the PR body's closing keyword, so this is not the dispatcher's vetted ticket by construction: on the factory's own PRs it is, because the dispatcher labeled that ticket, but a PR labeled by hand can link any issue. That is the hand-labeled case ADR 0002 already records as deliberate, since the label needs write access and the person adding it is making the trust decision. Closing it properly needs the issue's own `author_association`, which `gh issue view --json` does not expose, so it is a second read and a behaviour change (a stranger's ticket would have no criteria and fail mechanically). Not done here; it is a follow-up, not a rationale.
- The 2026-09-07 amendment's remaining items stand: a ticket labeled `agent:implement` by hand skips the dispatcher, and `OWNER` is nobody on an org-owned repo.
