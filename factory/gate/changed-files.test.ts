import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyFile,
  isConfigFile,
  isDocFile,
  isTestFile,
  parseNameStatus,
} from "./changed-files";

test("test files are found by name (or under __tests__), code extensions only", () => {
  for (const p of [
    "test/slugify.test.js",
    "tests/unit/x.spec.js",
    "src/__tests__/y.ts",
    "src/thing.test.ts",
    "lib/thing.spec.mjs",
    "pkg/a/b/test/test_deep.py",
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

test("a helper under test/ is a source change, not a test to run", () => {
  assert.equal(isTestFile("test/helpers.js"), false);
  assert.equal(isTestFile("tests/unit/setup.ts"), false);
  assert.equal(classifyFile("test/helpers.js"), "source");
});

test("doc files are markdown, text, license files, and anything under docs/", () => {
  for (const p of ["README.md", "docs/adr/0001.md", "LICENSE", "notes.txt", "CHANGELOG"]) {
    assert.equal(isDocFile(p), true, p);
  }
  for (const p of ["src/a.js", "package.json", ".github/workflows/ci.yml", "test/a.test.js"]) {
    assert.equal(isDocFile(p), false, p);
  }
});

test("config files are workflows, manifests, lockfiles and dotfiles", () => {
  for (const p of [
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "Cargo.toml",
    "pnpm-lock.yaml",
    ".gitignore",
    ".npmrc",
  ]) {
    assert.equal(isConfigFile(p), true, p);
  }
  // real source stays source, so a change to it with no test still fails the gate:
  // a script, an action shipped under .github/, and a fixture the tests own
  for (const p of [
    "src/a.js",
    "scripts/onboard.sh",
    ".github/actions/setup/index.js",
    ".github/scripts/release.sh",
    "test/fixtures/x.json",
    "src/__tests__/fixtures/y.yml",
  ]) {
    assert.equal(isConfigFile(p), false, p);
  }
});

test("classifyFile picks test, then doc, then config, else source", () => {
  assert.equal(classifyFile("test/a.test.js"), "test");
  assert.equal(classifyFile("test/README.md"), "doc");
  assert.equal(classifyFile(".github/workflows/gate.yml"), "config");
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
