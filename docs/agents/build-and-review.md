# Build and review

Every ticket goes through the same skills, in the same order, invoked by name with the Skill tool. This page is the rule, and it binds two readers:

- **A subagent brief.** Whoever writes a brief for a ticket in this repo copies the rule paragraph below into it, verbatim.
- **An implementer run.** `factory/agent-workflows/implement/prompt.md` carries the same order, and `factory/lib/plugins.ts` puts the skills into the account's config dir before every attempt. Change the order here and change it there in the same PR.

## The rule

> Implement with `mattpocock-skills:tdd` at the seams the ticket names, then `mattpocock-skills:code-review` against the merge-base with the ticket as the spec path, fix both axes, then the bundled `code-review medium --fix`, then typecheck and full tests. `mattpocock-skills:implement` is disable-model-invocation, so follow its steps with `tdd` loaded directly and say so in your report.

## The order

1. **Build.** Invoke `mattpocock-skills:tdd`. The seams are the ones the ticket names, or the ones the repo already tests. Done when every acceptance criterion has a test that goes red on the merge-base and green on the branch.
2. **Review on two axes.** Invoke `mattpocock-skills:code-review` with the merge-base as the fixed point and the ticket as the spec path. Done when every finding on the standards axis and the spec axis is fixed, or answered in writing with the reason it is wrong.
3. **Review with the harness's own.** Invoke the bundled `code-review` with `medium --fix`. It hunts bugs and simplifications the first review is not looking for. A harness that bundles no code review skips this step and says so. Done when its changes are read and the suite is green.
4. **Prove it.** Run the repo's typecheck and its full test suite. Done when both pass.

Commit each review's fixes on their own, after the implementation commits, with a message starting `review:`. A review that finds nothing gets no commit; say that it ran clean.

## Name every invocation

Name each skill you invoked, in full, in the PR body and in the final report. That naming is the evidence the rule was followed. On an implementer run the job log carries the same evidence: `run-log.ts` echoes every skill invocation as `skill <name> <args>`.

## Why the rule lives here

Tickets #10 to #18 were briefed without it and built without it; #57 exists to repair them. A rule that lives only in a brief is a rule the next brief can omit.
