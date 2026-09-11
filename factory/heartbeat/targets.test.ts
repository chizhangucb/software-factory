/**
 * The one list of targets (#222). Structure, not a sentence of the file: which
 * repos are on the list is the maintainer's to change one line at a time, and a
 * test quoting the list would fail on that instead of on a regression.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { TARGET_REPOS } from "./targets.ts";

const source = fs.readFileSync(new URL("./targets.ts", import.meta.url), "utf8");

test("every target on the list is one owner/repo, named once", () => {
  assert.ok(TARGET_REPOS.length > 0, "the list carries the targets the heartbeat wakes");
  for (const target of TARGET_REPOS) assert.match(target, /^[\w.-]+\/[\w.-]+$/, `${target} is owner/repo`);
  assert.equal(new Set(TARGET_REPOS).size, TARGET_REPOS.length, "no target is woken twice a pass");
});

test("the fixture repo is off the list, and the list still records it", () => {
  // Off since 2026-09-11: private, so every sweep bills a whole Actions minute
  // and an idle fixture ate most of the month's included minutes (#221). Taking
  // the record out with it would lose why, so the file keeps naming it.
  assert.ok(!TARGET_REPOS.includes("chizhangucb/factory-fixture"), "the fixture is not woken");
  assert.match(source, /factory-fixture/, "the list records the fixture and why it is off");
});
