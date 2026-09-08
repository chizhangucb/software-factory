# TASK

Address unresolved review feedback on PR #{{PR_NUMBER}} on branch `{{BRANCH}}`.

PR title: {{PR_TITLE}}
Linked issue: #{{ISSUE_NUMBER}} {{ISSUE_TITLE}}

Your subject is the PR conversation: the unresolved threads and the comments below, with the diff there to read them against. When a CONFLICT section is present, resolving the conflict with the base branch comes first and may be the whole task.

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

Read every comment and unresolved thread, and end each one in exactly one of these four:

- Change code when the reviewer is right.
- Reply when a reply adds useful context.
- Decline clearly when the requested change is wrong or out of scope.
- Pass over it when it is stale or context only.

Done when every thread carries one of those four outcomes.

Run the repo's typecheck and its full test suite before committing, using the repo's own commands. On a retry (see the RETRY section, when present) the gate around this PR re-runs on your push: a new test must fail on `main` and pass here, and every existing test stays as it is: a deleted, skipped, or narrowed one fails it.

If you change code, commit with a conventional commit message.

Your replies and comments travel in the `<output>` block, and the workflow posts them, pushes the branch, and moves the labels with its own credentials once this run ends. You have none: `git fetch`, `git pull`, `git push`, and every `gh` call fail here, so work from the checkout and the context you were given.

Never:

- Never push, and never edit labels.
- Never resolve a review thread, and never create a GitHub comment yourself.

When complete, output `<promise>COMPLETE</promise>`.
