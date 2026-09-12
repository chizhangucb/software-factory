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

const workflow = (jobs: string): string => ["name: CI", "on:", "  pull_request:", "jobs:", jobs].join("\n");

test("an added job no required name stands for fails, naming the job and the roll-up", () => {
  const base = workflow("  check:\n    runs-on: x");
  const verdict = checkTestIntegrity({
    files: parseNameStatus("M\t.github/workflows/ci.yml\n"),
    diff: "",
    workflows: [{ path: ".github/workflows/ci.yml", head: `${base}\n  lint:\n    runs-on: x`, base }],
    requiredContexts: ["check"],
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, [
    "new CI job `lint` in .github/workflows/ci.yml is required by nothing: add it to the `needs:` of the roll-up `check`",
  ]);
});

test("a silenced test and an added unrequired job report both reasons", () => {
  const base = workflow("  check:\n    runs-on: x");
  const verdict = checkTestIntegrity({
    files: parseNameStatus("M\ttest/truncate.test.js\nM\t.github/workflows/ci.yml\n"),
    diff: diffOf("test/truncate.test.js", ['test.skip("truncates", () => {});']),
    workflows: [{ path: ".github/workflows/ci.yml", head: `${base}\n  lint:\n    runs-on: x`, base }],
    requiredContexts: ["check"],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reasons.length, 2);
  assert.match(verdict.reasons[0], /new skip\/only\/todo marker/);
  assert.match(verdict.reasons[1], /new CI job `lint`/);
});

test("an added job with no roll-up in its file names the required checks instead", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("A\t.github/workflows/lint.yml\n"),
    diff: "",
    workflows: [{ path: ".github/workflows/lint.yml", head: workflow("  lint:\n    runs-on: x") }],
    requiredContexts: ["check"],
  });
  assert.deepEqual(verdict.reasons, [
    "new CI job `lint` in .github/workflows/lint.yml is required by nothing: roll it up under one of the required checks (check)",
  ]);
});

test("a clean diff passes", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("A\ttest/truncate.test.js\nM\tsrc/truncate.js\n"),
    diff: diffOf("test/truncate.test.js", ['test("truncates", () => {});']),
  });
  assert.deepEqual(verdict, { ok: true, reasons: [], deletedTests: [] });
});

test("a deleted test file passes, whatever the ticket holds, and is listed as information", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("D\ttest/slugify.test.js\nD\tsrc/slugify.js\n"),
    diff: "",
  });
  assert.deepEqual(verdict, { ok: true, reasons: [], deletedTests: ["test/slugify.test.js"] });
});

test("a test renamed out of the test tree is listed as deleted, and still passes", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("R100\ttest/slugify.test.js\tsrc/slugify.old.js\n"),
    diff: "",
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.deletedTests, ["test/slugify.test.js"]);
});

test("a deleted test file does not excuse a new marker", () => {
  const verdict = checkTestIntegrity({
    files: parseNameStatus("D\ttest/old.test.js\nM\ttest/a.test.js\n"),
    diff: diffOf("test/a.test.js", ['test.skip("later", () => {});']),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /new skip\/only\/todo marker at test\/a\.test\.js:2/);
  assert.deepEqual(verdict.deletedTests, ["test/old.test.js"]);
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
    // chronicle's repo-shape.test.mjs names its tests exactly this way, so a
    // skip added there was invisible to a required merge gate.
    'test(`no tracked file names "${word}"`, { skip: true }, () => {});',
    'test.each([{ a: 1 }])("x", { skip: true }, fn);',
    'it.each([{ n: 1 }])("case %s", { skip: true }, () => {});',
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

test("a type argument on the runner does not hide a silenced test", () => {
  // A TypeScript target names the test context on the call, and the runner is
  // still a call: `test<Ctx>(`, `it<A & B>(`, `test.each<Row>([...])(`.
  const hidden = [
    'test<Ctx>("x", { skip: true }, () => {});',
    'it<{ a: number }>("x", { skip: true }, () => {});',
    'test.each<Row>([1])("x", { only: true }, () => {});',
    'it<Fixtures<Db>>("x", { todo: "later" }, () => {});',
  ];
  assert.deepEqual(
    findNewMarkers(diffOf("test/a.test.ts", hidden)).map((m) => m.text),
    hidden,
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
