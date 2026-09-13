---
status: accepted
date: 2026-09-07
---

# Trust is author association, not a sandbox

The factory reads issue and PR text from public repos, and a ticket is the implementer's instructions, so a stranger's words are the threat. The control is refusing to act on them, not boxing the agent: trust is GitHub's `author_association`, one policy in `factory/lib/trusted-authors.ts` (default `OWNER`, widened per target with `trusted_author_associations`), and everything the implementer, reviewer, implement-pr and audit read goes through it (the dispatcher never dispatches an untrusted author's ticket; untrusted comments and parent-spec text are dropped with a count in their place; the retry marker is read only from a trusted comment).

A sandbox inside the runner is not the answer, because it does not protect what is at risk: the runner job holds `FACTORY_PAT` and the account tokens outside the agent process, and the push, label and PR calls are workflow steps, so an agent boxed in the same job still writes the branch the workflow pushes. What a sandbox removes is the runner's own ephemeral filesystem and network, which hold nothing else. It stays one line per `run()` call site, deferred (not rejected) until a target has contributors whose tickets the factory should run, or the factory gets a credential worth stealing.

## Consequences

- A ticket labelled `agent:implement` by hand skips the dispatcher and so skips this check. That is deliberate: adding the label needs write access, so the person is making the trust decision themselves.
- `OWNER` is nobody on an org-owned repo, where the owner's own issues read `MEMBER`, so moving a repo to an org means setting `OWNER,MEMBER` in the same change.
- The factory's own voice is exempt on the two channels it writes (review summaries and review-thread comments), keyed on the `github-actions` login, since GitHub reports its association as `NONE`. A target bot posting reviews under the same login is a known gap (a follow-up).
