/**
 * The one list of targets (#222). Structure, not a sentence of the file: which
 * repos are on the list is the maintainer's to change one line at a time, and a
 * test quoting the list would fail on that instead of on a regression.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { TARGET_REPOS } from "./targets.ts";

test("every target on the list is one owner/repo, named once", () => {
  assert.ok(TARGET_REPOS.length > 0, "the list carries the targets the heartbeat considers");
  for (const target of TARGET_REPOS) assert.match(target, /^[\w.-]+\/[\w.-]+$/, `${target} is owner/repo`);
  assert.equal(new Set(TARGET_REPOS).size, TARGET_REPOS.length, "no target is answered twice a pass");
});
