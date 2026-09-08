import assert from "node:assert/strict";
import { test } from "node:test";

import { FACTORY_HARNESS, bundledReviewStep } from "./harness";

test("the implementer's second review step invokes the bundled code review on a harness that has one", () => {
  const step = bundledReviewStep(FACTORY_HARNESS);
  assert.match(step, /`code-review`/);
  assert.match(step, /medium --fix/);
});

test("the second review step is skipped cleanly on a harness with no bundled code review", () => {
  assert.equal(bundledReviewStep("codex"), "");
});
