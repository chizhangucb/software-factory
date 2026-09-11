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

test("the fixture repo is on the list, since an idle target costs nothing now", () => {
  // It came off as a stopgap while an idle private target billed a minute every
  // interval (#221), and the idle skip is what put it back (#212). Taking it off
  // again is a decision to say out loud here, as its absence was.
  assert.ok(TARGET_REPOS.includes("chizhangucb/factory-fixture"), "the fixture is considered every pass");
});
