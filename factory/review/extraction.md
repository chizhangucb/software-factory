Emit a single `<output>` block as the last thing in your response.

Do not change files.
Do not run commands.
Do not include text outside the `<output>` block.

```json
<output>
{
  "summary": "1-3 paragraphs: what the PR does, what you checked, and why the verdict is what it is.",
  "verdict": "pass or fail; pass only when every criterion below is met",
  "criteria": [
    {
      "index": 1,
      "criterion": "the criterion text as numbered in ACCEPTANCE CRITERIA",
      "met": true,
      "evidence": "one line: the file and line, test name, or test output line that proves it, or what is missing"
    }
  ],
  "inlineComments": [
    { "path": "relative/file.ts", "line": 123, "body": "Markdown comment" }
  ],
  "replies": [
    { "commentId": "GraphQL node id from PR_COMMENTS_JSON", "body": "Markdown reply" }
  ]
}
</output>
```

`criteria` must have exactly one entry per numbered acceptance criterion, in order, with `met` a JSON boolean. Use empty arrays when there are no inline comments or replies.
