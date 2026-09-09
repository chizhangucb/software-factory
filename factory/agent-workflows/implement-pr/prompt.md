# TASK

Address unresolved review feedback on PR #{{PR_NUMBER}} on branch `{{BRANCH}}`.

PR title: {{PR_TITLE}}
Linked issue: #{{ISSUE_NUMBER}} {{ISSUE_TITLE}}

This is not a fresh review. Focus on the PR conversation and unresolved feedback.

Invoke the skills this prompt names, and any a named skill sends you to itself.

{{CONFLICT_SECTION}}{{RETRY_SECTION}}
# LINKED ISSUE

{{LINKED_ISSUE}}

# CURRENT DIFF TO MAIN

```diff
{{DIFF_TO_MAIN}}
```

# PR COMMENTS

```json
{{PR_COMMENTS_JSON}}
```

# PROCESS

Read every comment and unresolved thread, and end each one in exactly one of these four:

- Change code when the reviewer is right.
- Reply when a reply adds useful context.
- Decline clearly when the requested change is wrong or out of scope.
- Ignore stale/context-only comments.

Run the repo's typecheck and its full test suite before committing, using the repo's own commands.

If you change code, commit with a conventional commit message.

Your replies and comments travel in the `<output>` block, and the workflow posts them, pushes the branch, and moves the labels with its own credentials once this run ends. You have none: `git fetch`, `git pull`, `git push`, and every `gh` call fail here, so work from the checkout and the context you were given.

Do not push.
Do not edit labels.
Do not resolve review threads.
Do not create GitHub comments yourself.

When complete, output `<promise>COMPLETE</promise>`.
