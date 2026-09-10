---
status: accepted
date: 2026-09-06
---

# Vendor sandcastle's Actions pipeline, pinned, as the engine

Matt Pocock's sandcastle has been silent since 2026-06-29: no commits, releases, or maintainer replies, with 109 open issues and 51 open PRs. Its GitHub Actions dogfood pipeline still runs for him today, and its library already provides the multi-agent slot (Claude, Codex, Pi, Cursor, OpenCode, Copilot) and every sandbox provider (none, Docker, Podman, Vercel, Daytona). The evidence is two dated snapshots: `docs/research/sandcastle-peers-2026-09.md` for the silence and for what the alternatives do, `docs/research/sandcastle-inventory-2026-09.md` for the library's surface.

So: copy three of his five agent workflows (implement, review, implement-pr), their scripts and their prompts into this repo, depend on the library from npm pinned to 0.12.0 with a lockfile and a committed tarball, and treat all of it as our code, edited freely and never upgraded automatically. Dependabot watches the pin and opens a PR when Matt releases; the upgrade itself is a deliberate bump plus a proof run.

## Considered options

- **Anthropic's official GitHub action as the engine.** Sanctioned auth, daily releases, GitHub App commits that trigger CI. Rejected for v0 because it is Claude-only and the maintainer wants the agent slot open; kept as the fallback if the frozen library breaks or Anthropic blocks subscription use.
- **Sandcastle's local Docker orchestrator on the Mini.** Deferred, not rejected: v0 is cloud so the factory runs when the Mini sleeps. It stays a live option for private repos where Actions minutes cost money; the package already carries it.
- **Turnkey agents (Copilot, Codex, Cursor).** Rejected: none merge, none read blocked-by, none accept a Claude subscription token.
- **A fresh build on the Agent SDK.** Closed by ADR 0001.

## Consequences

- Isolation in v0 is GitHub's ephemeral runner (sandcastle's no-sandbox provider). A sandbox inside the runner, or a hosted one, is a one-line provider change later, worth doing once the agent reads untrusted issue text under auto-merge.
- Pushes use a personal access token so GitHub runs CI on the agent's pushes; the default token would not.
- A rate-limited `claude -p` run exits 0 with the error in its JSON result. Every workflow checks the result, never the exit code.
- Sandcastle's sub-issue refusal is removed: `/to-tickets` output is sub-issues by design.

## Amendments

### 2026-09-07: no sandbox for chronicle in v0, the factory reads only trusted authors

Chronicle is the first public target (#20). The consequence above says isolation is worth revisiting "once the agent reads untrusted issue text under auto-merge", and a public repo is exactly that: anyone can open an issue or comment on one, and a ticket is the implementer's instructions. v0 still ships without a sandbox provider, for two reasons and with one control.

- A sandbox inside the runner does not protect what is actually at risk. The runner job holds `FACTORY_PAT` and the account tokens outside the agent process, and the push, label and PR calls are workflow steps, not agent actions, so an agent boxed inside the same job still writes the branch the workflow then pushes. The exposure a sandbox removes is the runner's own filesystem and network, which are ephemeral and hold nothing else.
- The control that fits the threat is refusing to act on a stranger's words. Trust is GitHub's `author_association`, one policy in `factory/lib/trusted-authors.ts`, default `OWNER`, widened per target with `trusted_author_associations`. Everything the implementer run reads goes through it: the dispatcher never dispatches an untrusted author's ticket; the ticket keeps only trusted comments, with a line saying how many were dropped so the agent knows the thread was cut; an untrusted parent spec is named but not quoted; and the retry marker is read only from a trusted comment, so nobody can forge a "previous attempt failed" section into the prompt.

#### What this does not cover

- The reviewer, implement-pr, and the audit read the PR's comments, its review threads, and the linked issue through `factory/agent-workflows/shared/review-context.ts`, which is still unfiltered. The reviewer is read-only by ADR 0003 and implement-pr acts on a PR the factory itself opened, so the worst case is a wrong verdict rather than injected code, but implement-pr does write code from that text and it is the same class of hole. Follow-up ticket #43.
- A ticket labeled `agent:implement` by hand skips the dispatcher, so it skips the gate. That is deliberate: adding that label needs write access, and a maintainer doing it by hand is making the trust decision themselves. The reconciler re-adds the label on stranded work for the same reason, and the ticket it re-labels was dispatched under the gate in the first place.
- `OWNER` is nobody on an org-owned repo, where the owner's own issues read `MEMBER`. Moving these repos to an org (#26) means setting `OWNER,MEMBER` in the same change.

Deferred, not rejected: a sandbox provider is still one line per script that calls `run()`, and the 2026-09-08 amendment on the local orchestrator names the four. The case for it returns when a target has contributors whose tickets the factory should run, or when the factory gets a credential worth stealing. Nothing here changes ADR 0001 or the vendoring decision.

### 2026-09-08: the tarball is a release asset, not a tree file (#48)

The decision above says "a lockfile and a committed tarball". The tarball is no longer committed. It is attached to the `engine-0.12.0` release on this repo, and `vendor/` is gone along with the CI step that recomputed its hash.

- The live check is `package-lock.json`: the `integrity` field for `node_modules/@ai-hero/sandcastle` is what `npm ci` verifies on every run, in CI and in every factory job. A second hash comparison in CI checked a file nothing installed from.
- The release asset is cold storage, in case the registry copy of 0.12.0 goes away. No workflow, script, or install path fetches it. Its sha512 matches the lockfile's integrity, recorded in the release notes.
- Dependabot is unchanged: it still watches `@ai-hero/sandcastle` and `@anthropic-ai/claude-code` in `package.json`, and still merges nothing by itself.

### 2026-09-08: the reviewer, implement-pr and the audit read only trusted authors too (#52)

The 2026-09-07 amendment left one hole open, named there as follow-up #43: `factory/agent-workflows/shared/review-context.ts` was unfiltered, so the reviewer, implement-pr and the audit read a stranger's PR comments, review threads and linked-issue comments. That is now closed, and #43 with it. The history above stands as written; this is what changed.

- Everything a stranger can write is dropped before it reaches those three agents: the PR's top-level comments, the submitted review summaries, the unresolved review threads, and the linked ticket's comments. A dropped thread comment is not a reply target either, so an agent cannot answer words it never read. The count goes in place of what was dropped, on the PR context and on the ticket, so a cut thread reads as cut rather than as the whole of it, and every run logs one line naming what its policy took out, the implementer included, so a thread cut to nothing is visible in the job log too and not only inside the prompt.
- The linked issue moved to the `gh issue view --json` path. The text view carries no `author_association`, so nothing on it could be filtered; one JSON read now brings the title, the acceptance criteria and the comments with their associations, and `factory/lib/ticket-context.ts` renders it, the same code the implementer's ticket goes through.
- An untrusted parent spec now withholds its title as well as its body. A title is the same untrusted channel as a body, and quoting it put a stranger's words in the prompt.
- The trust policy is one type, `TrustPolicy`, built once at each entrypoint from that job's `trusted_author_associations` and passed down as a required argument. It was threaded as optional parameters with defaults, which meant a call site could read a stranger's words by forgetting one. `author_association` is a union, and a value GitHub does not send reads as `NONE`.
- `agent-review.yml`, `agent-implement-pr.yml` and `agent-audit.yml` take `trusted_author_associations`, default `OWNER`, the dispatcher's default, so setting it widens all of it together. The retry marker read on the PR path follows the same policy, which it did not before: `agent-implement-pr.yml` had no input, so it was pinned to a hardcoded `OWNER`.
- The factory's own voice is exempt, and it has to be. `agent-review.yml` posts its review summary and its thread comments with `GITHUB_TOKEN`, and GitHub reports `author_association: NONE` for that identity on every repo, so the association alone would drop the reviewer's own findings before implement-pr, whose whole job is to address them, ever read them. The exemption is on the login, normalised because REST spells it `github-actions[bot]` and gh's JSON and GraphQL spell it `github-actions`. Comments posted with `FACTORY_PAT` come from the owner and need none.
- That login is not proof of trust, and the exemption is safe only because of where it is applied. `github-actions` is what every workflow in the target posts under, the target's own as much as the factory's, and a coverage reporter or a size-diff bot routinely quotes a fork PR's branch name, commit message or failing test output. Trusting it wherever it appeared would launder a stranger's words through this control under the default `OWNER` policy, where a target's maintainer would least expect it. So it is passed on the two channels the factory itself writes, its review summaries and its review-thread comments, and nowhere else: a top-level PR comment, a ticket comment and the retry marker are judged on the association alone. The marker especially, since it is posted with `FACTORY_PAT`, needs no exemption, and the newest comment that parses wins, so an exemption there would be the forgery route this amendment says must not exist.
- **Amended 2026-09-09 (#80).** The two bullets above stand as written; what changed is who answers them. Both of the bugs they record were a call site deciding whether the exemption applied, so that decision moved into `factory/lib/trusted-authors.ts`: `keep` and `trusts` take a channel from a closed list the module owns, every read reports the association and whatever login it has, and the module holds the two channels the factory writes. A call site names a channel and gets the policy's judgement; it has no way to ask for a different one, so neither bug can be written again. `Author.factoryLogin`, the field a call site set to opt a channel in, is gone.

#### What this still does not cover

- The login exemption on `review-summary` and `review-thread` is per channel, not per workflow. `github-actions` is the login every workflow in the target posts under, and a target that runs a review-posting bot (reviewdog with `reporter: github-pr-review`, say, or any action that calls `gh pr review` or the review-comments API with `GITHUB_TOKEN`) writes those two channels under the same identity as `agent-review.yml`. Such a comment is kept, and a review-thread one becomes a reply target in `validReplyIds`, so a fork PR's file content or failing test output that the bot quotes reaches implement-pr as if it were the factory's own finding. The bullet above rules out the coverage and size-diff case because those bots post top-level PR comments, which are judged on the association; it does not rule out a bot that posts reviews. Closing it needs the factory to mark its own review output (a marker in the body, as the sweep does) and the policy to check the marker rather than the login alone. Not done here; a follow-up.
- The linked issue's own title, body and, since #119, labels are read whatever their author's association, on all three paths. The labels join this list because implement-pr resolves the implementer model from them, so on a hand-labeled PR the linked issue's `model:` label picks the model the run spends, which is a model name rather than words an agent acts on. The issue number comes from the PR body's closing keyword, so this is not the dispatcher's vetted ticket by construction: on the factory's own PRs it is, because the dispatcher labeled that ticket, but a PR labeled by hand can link any issue. That is the hand-labeled case this ADR already records as deliberate, since the label needs write access and the person adding it is making the trust decision. Closing it properly needs the issue's own `author_association`, which `gh issue view --json` does not expose, so it is a second read and a behaviour change (a stranger's ticket would have no criteria and fail mechanically). Not done here; it is a follow-up, not a rationale.
- The 2026-09-07 amendment's remaining items stand: a ticket labeled `agent:implement` by hand skips the dispatcher, and `OWNER` is nobody on an org-owned repo.

### 2026-09-08: three workflows were copied, not five, and the provenance document says which (#46, story 9)

Two corrections of record from the reconciliation of 2026-09-08. Neither changes the decision.

**The copy count above was wrong when written.** It said "the five workflows"; three were copied (`agent-implement`, `agent-review`, `agent-implement-pr`). `agent-update-branch` and `agent-explore` were left behind on purpose, for reasons #9 and #21 gave at the time. The sentence is corrected in place rather than left standing, because a stranger counting files would find three.

**The provenance document is `docs/provenance/sandcastle.md`.** It maps every file in this repo to its origin, lists what was not copied and why, records where a rewrite was avoidable and which of those have since been undone, and maps spec #9's stories onto sandcastle's pipeline. It is the answer to "why not just fork it", and it carries the line counts. Read it before changing anything under `factory/agent-workflows/`.

**Amended 2026-09-09 (#90).** The paragraph above is superseded on three points, and stands on the rest. A maintainer authorised the split that #90 recommended and could not make on its own authority, because the sentence above describes two audiences: the record is two files now, not one. Superseded: "maps every file in this repo to its origin", "it carries the line counts", and "Read it before changing anything under `factory/agent-workflows/`". All three are true of the second file, not the first. What the paragraph says about the essay, that it lists what was not copied and why, records where a rewrite was avoidable, maps spec #9's stories onto sandcastle's pipeline and answers "why not just fork it", stands as written, apart from the avoidable-rewrite list, which went with the file map.

- `docs/provenance/sandcastle.md` keeps its path and is the essay a stranger meets: what sandcastle is, his pipeline's real autonomy, his five workflows and what happened to each, what was not copied and why, what the factory added with no counterpart of his, spec #9's stories on him, and the answer to "why not just fork it".
- `docs/provenance/sandcastle-files.md` is the file-by-file half, the part an agent reads a row at a time: the file map with every tree enumerated, the three copied workflows stepped through, the vendored scripts and prompts row by row, and the avoidable-rewrite list. **The line counts are here**, and so is the rule that a change to a vendored script, prompt or workflow updates that row's counts in the same PR. Read it before changing anything under `factory/agent-workflows/`.
- Each file opens by naming the other. Nothing was cut in the move: every count, row, forced reason, identifier, ticket, SHA and step name is in one of the two.

### 2026-09-08: the local orchestrator is a second execution path, not a second product (#46, story 26)

The considered-options list above defers sandcastle's local Docker orchestrator, it does not reject it. Recording now what "undeferred" would mean, so the shape is settled before the story exists and a local path cannot arrive as a second product:

- Shared, unchanged: the dispatcher decides what runs, the gate decides what may merge, the reviewer decides the verdict. None of the three runs a model over a sandbox; they read and write GitHub. A local path changes where `sandcastle.run()` happens, not who says go and who says ship.
- Swapped: the sandbox provider (`noSandbox()` to `docker()` or `podman()`, one line in each of the four scripts that pass a sandbox to `run()`: `factory/agent-workflows/implement/implement.ts`, `factory/agent-workflows/review/review.ts`, `factory/agent-workflows/implement-pr/implement-pr.ts`, `factory/audit/audit.ts`) and the machine the job sits on. Both are sandcastle's own options and both are already inside the pinned package, so this costs no new dependency.
- Bought: Actions minutes stop being the price of a private target, and a real sandbox around the agent becomes available, which is what the first consequence above and the 2026-09-07 amendment both keep pointing at.
- Paid: the Mini has to be awake. That is why v0 is cloud-only and why this is a note and not a path.

Nothing here ships in v0 and this amendment changes no file. It is written down because the alternative is deciding it under pressure later, when someone wants the Mini's compute and the fastest route is a second pipeline beside this one.

### 2026-09-09: one section shape across the four ADRs (#75, story 10)

Every ADR now reads: front matter, title, the decision as made, `Considered options`, `Consequences`, `Amendments`. One dated `###` per amendment, oldest first, naming its ticket where the amendment's own text named one; `####` for a section inside one. `Note` is gone as a heading. Applied to this file:

- The five appended sections moved under `Amendments` as `###` headings, dated, in the order they were written. Their sub-headings (`What this does not cover`, `What this still does not cover`) moved to `####`.
- The `Note, 2026-09-08` on the copy count became an amendment. It was a correction of record, which is what the other four are.
- Each heading now names its ticket where the prose underneath it named one, taken from that prose, so the ticket is not buried in a first sentence. The 2026-09-07 amendment names no originating ticket, only the target (#20) and the follow-up (#43) it opened, so its heading carries none.
- Five paths were written relative to a directory the reader had to guess and are now fully qualified: the three sandbox call sites under `factory/agent-workflows/`, the ticket-context module as `factory/lib/ticket-context.ts`, and, in the 2026-09-09 (#80) bullet, the trust policy module as `factory/lib/trusted-authors.ts`. No file moved.
- The 2026-09-09 (#80) amendment bullet and the `What this still does not cover` bullet on the per-channel login exemption both landed in this file while this reshaping was in flight. Both are carried through with their text unchanged apart from that one path. The #80 bullet now sits directly under the two bullets it says stand as written, because the run-log bullet that used to separate them was merged into the first bullet of the list; "the two bullets above" therefore points at exactly the two it means.
- `vendor/` above is a path that no longer resolves. That is the point of the sentence naming it, not a stale reference.
- The decision paragraph was split in two, the evidence first and the resulting rule second. No fact, count or file name changed.
- The first `Considered options` bullet named the maintainer. It reads "the maintainer wants the agent slot open".
- The 2026-09-08 trusted-authors amendment's bullets were reordered: the untrusted-parent-spec bullet now sits with the other two bullets about what an agent reads, above the two about how the policy is plumbed. No bullet was added and none was dropped.

Cut or reworded cross-references, in full:

1. The 2026-09-07 amendment closed with "a sandbox provider is still one line per script that calls `run()` (see the 2026-09-08 amendment below for the four)". "Below" is gone; it names that amendment instead, since the amendments are headed sections now.
2. Four ticket references that the new headings carry were dropped from the prose under them: "(#48)", "(#52)", "(#46, story 9)" and the opening "Story 26 of #46.". #43, which is closed rather than named, still appears in its sentence.
3. `What this still does not cover` said "That is the hand-labeled case ADR 0002 already records as deliberate". It says "this ADR", since ADR 0002 is the file it sits in.

Nothing else was removed. No decision, date, count, file name or reason left this file.

Prose was tightened throughout, at the level of sentences and punctuation rather than content: the 2026-09-08 trusted-authors amendment said the same thing across three bullets, the list of what is dropped, the count that replaces it and the line each run logs, and those are one bullet now, with no clause of the three gone; elsewhere sentences were joined, a serial comma or two went, and "need no exemption" reads "need none". No decision, date, count, file name or reason went with any of it.

What made this file long is the reasoning, which a record may not drop. What was wrong with it was five sections appended under two different words with no order to them, and that is what changed.

One rewording, for the glossary: "where a target owner would least expect it" reads "where a target's maintainer would least expect it", because `CONTEXT.md` defines maintainer for that role and marks `owner` as GitHub's word for the account holder.
