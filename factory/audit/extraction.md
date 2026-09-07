Emit a single `<output>` block as the last thing in your response.

Do not change files.
Do not run commands.
Do not include text outside the `<output>` block.

```json
<output>
{
  "summary": "1-3 paragraphs: what the merged change does, what you checked and how, and why the verdict is what it is.",
  "verdict": "pass or fail; pass only when every criterion below is met and placeholders is empty",
  "criteria": [
    {
      "index": 1,
      "criterion": "the criterion text as numbered in ACCEPTANCE CRITERIA",
      "met": true,
      "evidence": "one line: the file and line, test name, command output, or what is missing"
    }
  ],
  "placeholders": [
    { "path": "relative/file.js", "line": 12, "description": "what the placeholder is and which criterion it fakes" }
  ]
}
</output>
```

`criteria` must have exactly one entry per numbered acceptance criterion, in order, with `met` a JSON boolean. Use an empty array for `placeholders` when you found none.
