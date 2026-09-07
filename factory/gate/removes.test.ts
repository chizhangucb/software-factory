import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRemoves, subjectCovers, uncoveredDeletedTests } from "./removes";

const body = [
  "## What to build",
  "",
  "Drop the slugify helper, nothing uses it.",
  "",
  "## Removes",
  "",
  "- `src/slugify.js` and its tests",
  "* the truncate helper",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] slugify is gone",
  "",
].join("\n");

test("parseRemoves returns the list items under the Removes heading", () => {
  assert.deepEqual(parseRemoves(body), ["`src/slugify.js` and its tests", "the truncate helper"]);
});

test("parseRemoves is null without the section, and empty for an empty section", () => {
  assert.equal(parseRemoves("## What to build\n\n- delete stuff\n"), null);
  assert.equal(parseRemoves(""), null);
  assert.deepEqual(parseRemoves("## Removes\n\n## Next\n- x\n"), []);
});

test("parseRemoves accepts any heading level and trailing text, case-insensitive", () => {
  assert.deepEqual(parseRemoves("### removes (v0)\n- a\n- b\n#### Not this\n- c"), ["a", "b"]);
});

test("a subject covers a deleted test when they share a name token", () => {
  assert.equal(subjectCovers("`src/slugify.js` and its tests", "test/slugify.test.js"), true);
  assert.equal(subjectCovers("the truncate helper", "tests/unit/truncate/index.spec.ts"), true);
  assert.equal(subjectCovers("slugify", "src/__tests__/slugify.js"), true);
  assert.equal(subjectCovers("the truncate helper", "test/slugify.test.js"), false);
  // test dir names and the test/spec suffix never count as a match
  assert.equal(subjectCovers("test helpers", "test/slugify.test.js"), false);
  assert.equal(subjectCovers("the", "test/the.test.js"), false);
});

test("uncoveredDeletedTests lists deleted tests no subject covers", () => {
  const subjects = parseRemoves(body)!;
  assert.deepEqual(
    uncoveredDeletedTests(["test/slugify.test.js", "test/truncate.test.js", "test/other.test.js"], subjects),
    ["test/other.test.js"],
  );
});
