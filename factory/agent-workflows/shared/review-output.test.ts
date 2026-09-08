// Factory-authored: sandcastle ships no tests for review-output.ts. Covers the factory's
// forced differences and his behaviour underneath them (#47).
import assert from "node:assert/strict";
import { test } from "node:test";

import { reviewOutputSchema } from "./review-output";

const validate = (value: unknown) => reviewOutputSchema["~standard"].validate(value);

test("reviewOutputSchema accepts a verdict with one entry per criterion", async () => {
  const result = await validate({
    summary: "Looks right.",
    verdict: "pass",
    criteria: [
      { index: 1, criterion: "exports clamp", met: true, evidence: "src/clamp.js:3" },
      { index: 2, met: "false", evidence: "no bound test" },
    ],
  });
  assert.ok("value" in result);
  assert.deepEqual(result.value.criteria, [
    { index: 1, criterion: "exports clamp", met: true, evidence: "src/clamp.js:3" },
    { index: 2, criterion: undefined, met: false, evidence: "no bound test" },
  ]);
  assert.equal(result.value.verdict, "pass");
  assert.deepEqual(result.value.inlineComments, []);
  assert.deepEqual(result.value.replies, []);
});

test("reviewOutputSchema rejects a verdict that is not pass or fail", async () => {
  const result = await validate({ summary: "s", verdict: "maybe", criteria: [] });
  assert.ok("issues" in result);
});

test("reviewOutputSchema rejects a criterion without evidence", async () => {
  const result = await validate({
    summary: "s",
    verdict: "pass",
    criteria: [{ index: 1, met: true }],
  });
  assert.ok("issues" in result);
});
