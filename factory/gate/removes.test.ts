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

/** chronicle#297's own Removes section, verbatim: prose hyphenates what the filename concatenates. */
const viewLogBody = [
  "## Removes",
  "",
  "- The view-log module, route, client hook, and Settings block",
  "- The view-log unit test and e2e spec",
  "- The view-log cache exception and boot prune",
  "",
].join("\n");

test("a hyphenated subject covers the concatenated test filename (chronicle#297)", () => {
  for (const subject of parseRemoves(viewLogBody)!) {
    assert.equal(subjectCovers(subject, "test/viewlog.test.mjs"), true, subject);
  }
});

test("every separator style of one name covers every other, both directions", () => {
  const spellings = ["view-log", "view_log", "viewlog", "viewLog"];
  for (const subject of spellings) {
    for (const path of spellings) {
      assert.equal(subjectCovers(subject, `test/${path}.test.mjs`), true, `${subject} vs ${path}`);
    }
  }
});

// Every test below is the false-positive side of the trade-off: matches the fix
// deliberately still refuses. All of them hold on the merge-base too, which is
// what makes them the evidence that the fix did not loosen the gate.

test("no part of a concatenated name covers it, and it covers no part", () => {
  assert.equal(subjectCovers("the view module", "test/viewlog.test.mjs"), false);
  assert.equal(subjectCovers("the log module", "test/viewlog.test.mjs"), false);
  assert.equal(subjectCovers("the viewlog module", "test/view.test.mjs"), false);
  assert.equal(subjectCovers("the viewlog module", "test/log.test.mjs"), false);
});

test("a piece of a spelled-out path name still matches, so coverage is one-sided", () => {
  // Pre-existing and left alone: `view` reaches a path that spells the name in
  // pieces, and not the same name concatenated. The line above is the pair.
  assert.equal(subjectCovers("the view module", "test/view-log.test.mjs"), true);
  assert.equal(subjectCovers("the view module", "test/viewlog.test.mjs"), false);
});

test("separators are never stripped across whitespace", () => {
  // The deliberate false negative. The hyphenated spelling of the same subject
  // does cover it, in the chronicle#297 test above.
  assert.equal(subjectCovers("the view log module", "test/viewlog.test.mjs"), false);
});

test("a dot ends a name, so a dotted spelling is not one of the separator styles", () => {
  // Not an accident: prose cannot tell `view.log` from a filename plus its
  // extension without a list of known extensions, and the subject's own
  // extension strip has already taken the tail off before matching starts.
  assert.equal(subjectCovers("the view.log module", "test/viewlog.test.mjs"), false);
  assert.equal(subjectCovers("the viewlog module", "test/view.log.test.mjs"), false);
});

test("a subject sharing only stop names with the path does not cover it", () => {
  assert.equal(subjectCovers("The unit test and e2e spec", "test/viewlog.test.mjs"), false);
  assert.equal(subjectCovers("the src and lib specs", "src/lib/viewlog.test.mjs"), false);
});

test("a stripped form passes the same filter its pieces do", () => {
  // Both sides collapse to `test`, a stop name, and to `ab`, under the minimum
  // length. Drop the filter on the stripped form and both of these match.
  assert.equal(subjectCovers("the te_st module", "spec/te-st.test.mjs"), false);
  assert.equal(subjectCovers("the a_b module", "spec/a-b.test.mjs"), false);
});

test("uncoveredDeletedTests clears the deleted test chronicle#297 hyphenates", () => {
  assert.deepEqual(uncoveredDeletedTests(["test/viewlog.test.mjs"], parseRemoves(viewLogBody)!), []);
});

test("uncoveredDeletedTests lists deleted tests no subject covers", () => {
  const subjects = parseRemoves(body)!;
  assert.deepEqual(
    uncoveredDeletedTests(["test/slugify.test.js", "test/truncate.test.js", "test/other.test.js"], subjects),
    ["test/other.test.js"],
  );
});
