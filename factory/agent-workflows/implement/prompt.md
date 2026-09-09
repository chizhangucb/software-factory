# TASK

Implement ticket #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are on branch `{{BRANCH}}`, already created from `main` (or, on a retry, continued from the previous attempt), in a clean checkout of the target repo.

This run has 60 minutes. Nothing reports that to you, so pace the work yourself.

Invoke the skills this prompt names, and any a named skill sends you to itself; the rest of the vendored plugin is installed alongside them and describes work this run is not doing.

{{RETRY_SECTION}}
# ISSUE

{{ISSUE_CONTEXT}}

The same ticket text plus its parent spec, if it has one, is in `{{TICKET_FILE}}`. Read that file first: the spec is the context the ticket was cut from and it settles anything the ticket leaves open.

# CONTEXT

1. `{{TICKET_FILE}}`: the ticket and its parent spec.
2. The repo's own agent instructions, whichever exist: `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md`, `docs/adr/`, plus any `.claude/` skills or docs they point at. These are binding. They tell you the vocabulary, the conventions, the commands to run, and the decisions already made. Where they contradict this prompt, they win, except on the `Do not` rules under COMMIT below.
3. The code and tests near the seams the ticket names. Learn the test style the repo already uses and match it.

Take commands (typecheck, test, lint) from the repo's docs or `package.json` and equivalents, never from memory.

# EXECUTION

Invoke the skill `mattpocock-skills:tdd` and build the ticket through it, following it as written. Two things it cannot know from where it sits:

- The seams are the ones the ticket names, or the ones the repo already tests. There is no user in this run to confirm them with, so those are the agreed seams.
- Repeat its cycle until every acceptance criterion has a test that fails on `main` and passes here.

Commit as you go with conventional commit messages. These implementation commits come first in the branch history; the review-fix commits below come after them.

# NO PLACEHOLDERS

Every function this ticket touches computes its answer for real, and every new test fails without that code. In plain words:

- Return a computed answer. A fixed value, a `throw "not implemented"`, or a TODO where the work should be is a stub.
- Write each test against the behaviour its criterion names, not against the shape of the code you wrote to satisfy it.
- Leave every existing test running as it is. When the ticket changes a behaviour on purpose, update that test to the new behaviour and say so in the commit message.
- Meet every criterion as written. When one cannot be met, stop and say why in your final message, rather than narrowing the ticket to what is easy.

# REVIEW AND FIX

After the implementation is committed and green, review it and fix what the review finds. Every step below must appear in this run.

1. Invoke the skill `mattpocock-skills:code-review` with args `main {{TICKET_FILE}}`: `main` is the fixed point, the ticket file is the spec. Fix every finding on both axes. Where a finding is wrong, say why in your final message; do not skip it silently.
{{BUNDLED_REVIEW_STEP}}
Commit the fixes from each review as their own commits, after the implementation commits, with messages starting `review:`. A review with nothing to fix gets no commit; say in your final message that it ran clean.

# COMMIT

1. Run the repo's typecheck and its full test suite, using the repo's own commands. Both must pass.
2. Make sure everything is committed on `{{BRANCH}}` and `git status` is clean.

The workflow pushes the branch, opens the PR, and moves the labels with its own credentials once this run ends. You have none: `git fetch`, `git pull`, `git push`, and every `gh` call fail here, so work from the checkout and the ticket file you were given.

Do not push the branch.
Do not close the ticket.
Do not edit labels.
Do not create or edit PRs.
Do not edit files outside this repo, and do not touch its CI workflows unless the ticket asks for that.
Do not print or copy a secret or token.

When complete, output `<promise>COMPLETE</promise>`.
