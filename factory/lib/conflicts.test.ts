import assert from "node:assert/strict";
import { test } from "node:test";

import { conflictSection, parseMergeTreeConflicts } from "./conflicts";

const conflicting = [
  "35810ed027306feab01d844f1e7b433d69c73",
  "100644 422c2b7ab3b3c668038da977e4e93a5fc623169c 1\tREADME.md",
  "100644 dca917f3f9346f8d3689f066c9447e3d007c57fd 2\tREADME.md",
  "100644 ef034634125f775ced1c97b7104ce07955d04822 3\tREADME.md",
  "",
  "Auto-merging README.md",
  "CONFLICT (content): Merge conflict in README.md",
  "Auto-merging src/index.js",
  "CONFLICT (content): Merge conflict in src/index.js",
  "",
].join("\n");

test("a clean merge-tree means no conflicts whatever it printed", () => {
  assert.deepEqual(parseMergeTreeConflicts({ status: 0, stdout: "abc\n" }), []);
});

test("conflicting files are read from the CONFLICT lines, once each", () => {
  assert.deepEqual(parseMergeTreeConflicts({ status: 1, stdout: conflicting }), ["README.md", "src/index.js"]);
  const more = conflicting + "CONFLICT (content): Merge conflict in README.md\nCONFLICT (modify/delete): a.js deleted in HEAD and modified in main\n";
  assert.deepEqual(parseMergeTreeConflicts({ status: 1, stdout: more }), [
    "README.md",
    "src/index.js",
    "CONFLICT (modify/delete): a.js deleted in HEAD and modified in main",
  ]);
});

test("a conflict that names no file still reports something", () => {
  assert.deepEqual(
    parseMergeTreeConflicts({ status: 1, stdout: "abc\n\nCONFLICT (rename/rename): something odd\n" }),
    ["CONFLICT (rename/rename): something odd"],
  );
  assert.equal(parseMergeTreeConflicts({ status: 1, stdout: "" }).length, 1);
});

test("a probe that exits with an unexpected code fails, naming the exit", () => {
  // 128 is git's own "bad ref"; 129 is git rejecting --write-tree on an old version.
  assert.throws(
    () => parseMergeTreeConflicts({ status: 128, stdout: "", stderr: "fatal: not something we can merge\n" }),
    (error: Error) => {
      assert.match(error.message, /exit 128/);
      assert.match(error.message, /fatal: not something we can merge/);
      return true;
    },
  );
  assert.throws(() => parseMergeTreeConflicts({ status: 129, stdout: "" }), /exit 129/);
  // spawnSync reports no status at all when a signal killed the probe.
  assert.throws(() => parseMergeTreeConflicts({ status: null, stdout: "", signal: "SIGKILL" }), /killed by SIGKILL/);
  // And when the spawn itself failed, there is neither an exit nor a signal to name.
  assert.throws(() => parseMergeTreeConflicts({ status: null, stdout: "" }), /no exit status/);
});

test("the prompt section names the base, the files, and the merge command; empty without conflicts", () => {
  assert.equal(conflictSection("main", []), "");
  const section = conflictSection("main", ["README.md"]);
  assert.match(section, /^# CONFLICT WITH MAIN/);
  assert.match(section, /- README\.md/);
  assert.match(section, /`git merge main`/);
  assert.match(section, /commit the merge/);
});
