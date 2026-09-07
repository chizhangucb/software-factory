import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyFile,
  isDocFile,
  isTestFile,
  parseNameStatus,
} from "./changed-files";

test("test files are found by directory or by name, code extensions only", () => {
  for (const p of [
    "test/slugify.test.js",
    "tests/unit/x.js",
    "src/__tests__/y.ts",
    "src/thing.test.ts",
    "lib/thing.spec.mjs",
    "pkg/a/b/test/deep.py",
    "pkg/x_test.go",
    "app/test_models.py",
  ]) {
    assert.equal(isTestFile(p), true, p);
  }
  for (const p of [
    "src/slugify.js",
    "test/fixtures/sample.json",
    "test/README.md",
    "testing/x.js",
    "contest/x.js",
    "src/latest.js",
  ]) {
    assert.equal(isTestFile(p), false, p);
  }
});

test("doc files are markdown, text, license files, and anything under docs/", () => {
  for (const p of ["README.md", "docs/adr/0001.md", "LICENSE", "notes.txt", "CHANGELOG"]) {
    assert.equal(isDocFile(p), true, p);
  }
  for (const p of ["src/a.js", "package.json", ".github/workflows/ci.yml", "test/a.test.js"]) {
    assert.equal(isDocFile(p), false, p);
  }
});

test("classifyFile picks test, then doc, else source", () => {
  assert.equal(classifyFile("test/a.test.js"), "test");
  assert.equal(classifyFile("test/README.md"), "doc");
  assert.equal(classifyFile("test/fixtures/x.json"), "source");
  assert.equal(classifyFile("src/a.js"), "source");
});

test("parseNameStatus reads git diff --name-status with renames", () => {
  const out = [
    "A\ttest/truncate.test.js",
    "M\tsrc/slugify.js",
    "D\ttest/slugify.test.js",
    "R087\tsrc/old.js\tsrc/new.js",
    "",
  ].join("\n");
  assert.deepEqual(parseNameStatus(out), [
    { status: "A", path: "test/truncate.test.js", kind: "test" },
    { status: "M", path: "src/slugify.js", kind: "source" },
    { status: "D", path: "test/slugify.test.js", kind: "test" },
    { status: "R", path: "src/new.js", oldPath: "src/old.js", kind: "source" },
  ]);
});
