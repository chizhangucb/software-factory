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

test("a test file's own helper option is not a marker", () => {
  // The case chronicle#298 was refused for: `sweep` is the file's own helper,
  // `function sweep(report, { skip = () => false } = {})`, and its options bag
  // names paths to exempt from a scan. The enclosing test still runs and asserts.
  const markers = findNewMarkers(
    diffOf("test/repo-shape.test.mjs", [
      "    const offenders = sweep(",
      "      (rel, src) => scan(rel, src),",
      "      { skip: (rel) => WORD_EXEMPT.get(word) === rel },",
      "    );",
    ]),
  );
  assert.deepEqual(markers, []);
});

test("a brace before the options object does not hide a silenced test", () => {
  // A positional "runner before the `{`" rule is defeated by any earlier brace,
  // and the shapes that produce one are routine rather than adversarial: a
  // template-literal title, a `.each` table, a hoisted options object.
  const hidden = [
    'test("a {brace} title", { skip: true }, fn);',
    "it(`renders ${name}`, { skip: true }, fn);",
    'test.each([{ a: 1 }])("x", { skip: true }, fn);',
    'const o = { skip: true }; test("x", o, fn);',
  ];
  assert.deepEqual(
    findNewMarkers(diffOf("test/a.test.js", hidden)).map((m) => m.text),
    hidden,
  );
});

test("a test path in a string is not a runner call", () => {
  // chronicle's own main carries this line. A bare `\\btest\\b` anywhere on the
  // line matches `'test/removed-routes.test.mjs'`, so the runner has to be a
  // call, not a mention.
  assert.deepEqual(
    findNewMarkers(
      diffOf("test/repo-shape.test.mjs", [
        "    { skip: (rel) => rel === 'test/removed-routes.test.mjs' },",
      ]),
    ),
    [],
  );
});

test("an options object on any runner call is still a marker, and skip: false still passes", () => {
  // Guards the narrowing in #134: the runner vocabulary keeps its options form.
  // These were caught before that change too, so they are a regression net
  // rather than a driver for it.
  const runners = [
    'it("x", { skip: true }, () => {});',
    'describe("x", { only: true }, () => {});',
    'suite("x", { todo: "later" }, () => {});',
    'context("x", { skip: true }, () => {});',
    'bench("x", { only: true }, () => {});',
    't.test("x", { skip: true });',
    'test.each([1])("x", { skip: true }, () => {});',
  ];
  assert.deepEqual(
    findNewMarkers(diffOf("test/a.test.js", runners)).map((m) => m.text),
    runners,
  );
  assert.deepEqual(
    findNewMarkers(diffOf("test/a.test.js", ['test("on", { skip: false }, () => {});'])),
    [],
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
