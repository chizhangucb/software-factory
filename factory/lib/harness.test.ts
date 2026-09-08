import assert from "node:assert/strict";
import { test } from "node:test";

import { bundledReviewStep } from "./harness";

// sandcastle's own provider names: `claudeCode()` is "claude-code", `codex()` is "codex".
test("the implementer's second review step invokes the bundled code review on Claude Code", () => {
  const step = bundledReviewStep("claude-code");
  assert.match(step, /`code-review`/);
  assert.match(step, /--fix/);
});

test("the second review step is skipped cleanly on a harness with no bundled code review", () => {
  assert.equal(bundledReviewStep("codex"), "");
});
