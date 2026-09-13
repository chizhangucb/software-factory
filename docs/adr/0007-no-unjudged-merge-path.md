---
status: accepted
date: 2026-09-10
---

# No unjudged merge path

The rule is no *unjudged* merge, not no human merge (ADR 0003 refuses a human one and still does). Any producer (anyone but the factory opening a PR: an interactive session, a cloud agent) gets a verdict by pushing to the target itself (a fork PR is refused, since `pull_request_target` runs with secrets), opening with `Closes #N`, labelling `agent:review`, and arming auto-merge; the reviewer then judges it exactly as a factory PR. Authorship stops deciding whether anything reads a PR, because the producers are multiplying and each opens a PR GitHub cannot tell from a person's.

The factory judges any PR but writes only to its own: every action that closes a PR or puts the implementer on its branch first asks `isFactoryAuthoredPr` (`factory/lib/factory-pr.ts`). Bringing a branch up to date (ADR 0006) is not such a write, since it is GitHub's API making the merge with no agent on the branch. A PR that closes no ticket has no acceptance criteria, so its verdict is a mechanical fail; judging a PR against its own description is rejected, since that is the same claim as an agent's "done".

Two escapes past the gate remain, both visible: the admin bypass (kept for the one case with no other exit, a PR repairing a caller that cannot post the checks) and a waiver (a human takes the three factory contexts off one target until they restore them).

## Consequences

- The judged path costs one reviewer run per producer PR, on work an interactive session already reviewed. What it buys is a reader that never saw the code written, and a result GitHub can gate on.
- The reviewer reads a linked ticket's body as criteria, so the judged path is a second route past the dispatcher's author check (mostly closed in #179); the reviewer is read-only, so the exposure is a verdict talked into passing, not code execution.
