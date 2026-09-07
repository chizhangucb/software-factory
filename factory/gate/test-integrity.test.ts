import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNameStatus } from "./changed-files";
import { checkTestIntegrity, findNewMarkers } from "./test-integrity";

const diffOf = (file: string, added: string[]): string =>
  [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,1 +1,9 @@",
    ' import { test } from "node:test";',
    ...added.map((l) => `+${l}`),
    "",
  ].join("\n");

test("a clean diff passes", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("A\ttest/truncate.test.js\nM\tsrc/truncate.js\n"),
    diff: diffOf("test/truncate.test.js", ['test("truncates", () => {});']),
    removes: null,
  });
  assert.deepEqual(verdict, { ok: true, reasons: [] });
});

test("a deleted test file fails without a Removes section", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("D\ttest/slugify.test.js\nD\tsrc/slugify.js\n"),
    diff: "",
    removes: null,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /deleted test file test\/slugify\.test\.js/);
  assert.match(verdict.reasons[0], /no `## Removes` section/);
});

test("a deleted test file passes when a Removes subject covers it, fails when none does", () => {
  const files = parseNameStatus("D\ttest/slugify.test.js\nD\tsrc/slugify.js\n");
  assert.equal(checkTestIntegrity({ files, diff: "", removes: ["`src/slugify.js`"] }).ok, true);
  const strict = checkTestIntegrity({ files, diff: "", removes: ["the truncate helper"] });
  assert.equal(strict.ok, false);
  assert.match(strict.reasons[0], /not covered by any Removes subject/);
});

test("a test renamed out of the test tree counts as deleted", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("R100\ttest/slugify.test.js\tsrc/slugify.old.js\n"),
    diff: "",
    removes: null,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /deleted test file test\/slugify\.test\.js/);
});

test("new skip, only, and todo markers in test files fail, each reported with its line", () => {
  const markers = findNewMarkers(
    diffOf("test/a.test.js", [
      'test.skip("later", () => {});',
      'it.only("just me", () => {});',
      'test.todo("someday");',
      'test("opt", { skip: true }, () => {});',
      'test("opt2", { todo: "reason" }, () => {});',
      'describe("d", () => { t.skip("x"); });',
      'xit("legacy", () => {});',
      "// test.skip is fine in a comment",
      'test("ok", () => { assert.ok(true); });',
    ]),
  );
  assert.deepEqual(
    markers.map((m) => [m.path, m.line]),
    [
      ["test/a.test.js", 2],
      ["test/a.test.js", 3],
      ["test/a.test.js", 4],
      ["test/a.test.js", 5],
      ["test/a.test.js", 6],
      ["test/a.test.js", 7],
      ["test/a.test.js", 8],
    ],
  );
});

test("markers outside test files and on unchanged lines are ignored", () => {
  const diff = [
    diffOf("src/options.js", ['const only = opts.only; if (opts.skip) return;']),
    [
      "diff --git a/test/b.test.js b/test/b.test.js",
      "--- a/test/b.test.js",
      "+++ b/test/b.test.js",
      "@@ -1,2 +1,3 @@",
      ' test.skip("already skipped", () => {});',
      '+test("new", () => {});',
      ' test("old", () => {});',
      "",
    ].join("\n"),
  ].join("");
  assert.deepEqual(findNewMarkers(diff), []);
  const verdict = checkTestIntegrity({
    files: parseNameStatus("M\tsrc/options.js\nM\ttest/b.test.js\n"),
    diff,
    removes: null,
  });
  assert.equal(verdict.ok, true);
});

test("python and go skips are caught too", () => {
  const markers = findNewMarkers(
    diffOf("tests/test_x.py", ["@pytest.mark.skip(reason='slow')", "def test_x(): pass"]) +
      diffOf("pkg/x_test.go", ["func TestX(t *testing.T) {", "\tt.Skip()", "}"]),
  );
  assert.deepEqual(markers.map((m) => m.path), ["tests/test_x.py", "pkg/x_test.go"]);
});
