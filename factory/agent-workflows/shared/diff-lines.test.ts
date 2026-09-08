// Factory-authored: sandcastle ships no tests for diff-lines.ts. Covers the factory's
// forced differences and his behaviour underneath them (#47).
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDiffLines } from "./diff-lines";

test("added lines starting with ++ are counted and the last hunk line is not overrun", () => {
  const diff = [
    "diff --git a/post.md b/post.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/post.md",
    "@@ -0,0 +1,5 @@",
    "+++",
    "+title = 'x'",
    "+++",
    "+",
    "+body",
    "",
  ].join("\n");
  assert.deepEqual([...parseDiffLines(diff).get("post.md")!].sort(), [1, 2, 3, 4, 5]);
});

test("a deleted file contributes no lines and does not swallow the next file", () => {
  const diff = [
    "diff --git a/old.js b/old.js",
    "--- a/old.js",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-a",
    "-b",
    "diff --git a/new.js b/new.js",
    "--- a/new.js",
    "+++ b/new.js",
    "@@ -10,3 +10,4 @@",
    " keep",
    "+added",
    " keep",
    " keep",
    "",
  ].join("\n");
  const lines = parseDiffLines(diff);
  assert.equal(lines.has("old.js"), false);
  assert.deepEqual([...lines.get("new.js")!].sort(), [10, 11, 12, 13]);
});
