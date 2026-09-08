---
status: accepted
date: 2026-09-06
---

# Vendor sandcastle's Actions pipeline, pinned, as the engine

Matt Pocock's sandcastle has been silent since 2026-06-29 (no commits, releases, or maintainer replies; 109 open issues, 51 open PRs) but its GitHub Actions dogfood pipeline runs for him today and its library already provides the multi-agent slot (Claude, Codex, Pi, Cursor, OpenCode, Copilot) and every sandbox provider (none, Docker, Podman, Vercel, Daytona). The evidence is two dated snapshots: `docs/research/sandcastle-peers-2026-09.md` for the silence and for what the alternatives do, `docs/research/sandcastle-inventory-2026-09.md` for the library's surface. We copy three of his five agent workflows (implement, review, implement-pr), their scripts, and their prompts into this repo, depend on the library from npm pinned to 0.12.0 with a lockfile and a committed tarball, and treat all of it as our code: edited freely, never upgraded automatically. Dependabot watches the pin and opens a PR when Matt releases; the upgrade itself is a deliberate bump plus a proof run.

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
- The factory's own voice is exempt, and it has to be. `agent-review.yml` posts its review summary and its thread comments with `GITHUB_TOKEN`, and GitHub reports `author_association: NONE` for that identity on every repo, so the association alone would drop the reviewer's own findings before implement-pr, whose whole job is to address them, ever read them. The exemption is on the login, normalised because REST spells it `github-actions[bot]` and gh's JSON and GraphQL spell it `github-actions`. Comments posted with `FACTORY_PAT` come from the owner and need no exemption.
- That login is not proof of trust, and the exemption is safe only because of where it is applied. `github-actions` is what every workflow in the target posts under, the target's own as much as the factory's, and a coverage reporter or a size-diff bot routinely quotes a fork PR's branch name, commit message or failing test output. Trusting the login wherever it appeared would launder a stranger's words straight through this control, under the default `OWNER` policy, where a target owner would least expect it. So the login is passed on the two channels the factory itself writes, its review summaries and its review-thread comments, and nowhere else: a top-level PR comment, a ticket comment and the retry marker are judged on the association alone. The marker especially, since it is posted with `FACTORY_PAT` and needs no exemption, and the newest comment that parses wins, so an exemption there would be the forgery route this amendment says must not exist.
- Every run logs one line naming what its policy took out, the implementer included, so a thread cut to nothing is visible in the job log and not only inside the prompt.

### What this still does not cover

- The linked issue's own title and body are read whatever their author's association, on all three paths. The issue number comes from the PR body's closing keyword, so this is not the dispatcher's vetted ticket by construction: on the factory's own PRs it is, because the dispatcher labeled that ticket, but a PR labeled by hand can link any issue. That is the hand-labeled case ADR 0002 already records as deliberate, since the label needs write access and the person adding it is making the trust decision. Closing it properly needs the issue's own `author_association`, which `gh issue view --json` does not expose, so it is a second read and a behaviour change (a stranger's ticket would have no criteria and fail mechanically). Not done here; it is a follow-up, not a rationale.
- The 2026-09-07 amendment's remaining items stand: a ticket labeled `agent:implement` by hand skips the dispatcher, and `OWNER` is nobody on an org-owned repo.

## Amendment, 2026-09-08: the copy count, the provenance document, and the local orchestrator as a second execution path

Two records and one v1 note, from the reconciliation of 2026-09-08 (#46, stories 9 and 26).

**The copy count above was wrong when written.** It said "the five workflows"; three were copied (`agent-implement`, `agent-review`, `agent-implement-pr`). `agent-update-branch` and `agent-explore` were left behind on purpose, for reasons #9 and #21 gave at the time. The sentence is corrected in place rather than left standing, because a stranger counting files would find three.

**The provenance document is `docs/provenance/sandcastle.md`.** It maps every file in this repo to its origin, lists what was not copied and why, records where a rewrite was avoidable and which of those have since been undone, and maps spec #9's stories onto sandcastle's pipeline. It is the answer to "why not just fork it", and it carries the line counts. Read it before changing anything under `factory/agent-workflows/`.

**Sandcastle's local Docker orchestrator becomes a second execution path, not a second product.** The considered-options list above defers it, not rejects it. Recording now what "undeferred" would mean, so the shape is decided before the story exists:

- Shared, unchanged: the dispatcher decides what runs, the gate decides what may merge, the reviewer decides the verdict. None of the three runs a model over a sandbox; they read and write GitHub. A local path changes where `sandcastle.run()` happens, not who says go and who says ship.
- Swapped: the sandbox provider (`noSandbox()` to `docker()` or `podman()`, one line in `factory/agent-workflows/shared/common.ts`) and the machine the job sits on. Both are sandcastle's own options and both are already inside the pinned package, so this costs no new dependency.
- Bought: Actions minutes stop being the price of a private target, and a real sandbox around the agent becomes available, which is what the first consequence above and the 2026-09-07 amendment both keep pointing at.
- Paid: the Mini has to be awake. That is why v0 is cloud-only and why this is a note and not a path.

The point of writing it down is that sandcastle's templates and sandbox providers can arrive later as options on this product rather than as a second one. Nothing here ships in v0: no local path exists until a story asks for it, and this amendment changes no file.
