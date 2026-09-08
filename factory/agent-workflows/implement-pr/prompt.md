# TASK

Address unresolved review feedback on PR #{{PR_NUMBER}} on branch `{{BRANCH}}`.

PR title: {{PR_TITLE}}
Linked issue: #{{ISSUE_NUMBER}} {{ISSUE_TITLE}}

This is not a fresh review. Focus on the PR conversation and unresolved feedback. When a CONFLICT section is present, resolving the conflict with the base branch comes first and may be the whole task.

Invoke the skills this prompt names, and any a named skill sends you to itself. The rest of the vendored plugin is installed alongside them and describes work this run is not doing: there is no user here to grill, question, or walk through a wizard, and no network beyond the checkout.

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

For each actionable comment or unresolved thread:

- Change code when the reviewer is right.
- Reply when a reply adds useful context.
- Decline clearly when the requested change is wrong or out of scope.
- Ignore stale/context-only comments.

Run the repo's typecheck and its full test suite before committing, using the repo's own commands. On a retry (see the RETRY section, when present) the gate around this PR re-runs on your push: a new test must fail on `main` and pass here, and no test may be deleted, skipped, or narrowed.

If you change code, commit with a conventional commit message.

Do not push. You have no GitHub credentials during this run: `git fetch`, `git pull`, `git push`, and every `gh` call fail, so work from the checkout and the context you were given.
Do not edit labels.
Do not resolve review threads.
Do not create GitHub comments yourself.

When complete, output `<promise>COMPLETE</promise>`.
