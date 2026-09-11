/**
 * Which open subjects mean a target has something waiting (#212), and the one
 * read that answers it.
 *
 * The label sets are imported, never quoted: a test that spelled `hold` here
 * would pass while the heartbeat and the reconciler disagreed. Same tie, same
 * reason as `dispatch/triggers.test.ts` pinning the caller's prefixes to
 * `lib/labels.ts`.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { PROJECTIONS } from "../dispatch/gh-read.ts";
import { PARKED_LABELS } from "../dispatch/reconcile.ts";
import { FACTORY_STATE_LABELS } from "../dispatch/select.ts";
import { HOLD_LABELS, READY_LABEL } from "../lib/labels.ts";
import { type OpenSubject, fromGitHub, needsSweep, openWorkArgs } from "./work.ts";

const ticket = (...labels: string[]): OpenSubject => ({ pullRequest: false, labels });
const pullRequest = (...labels: string[]): OpenSubject => ({ pullRequest: true, labels });

test("the read is one paginated GET, projected as the sweep's own issue read", () => {
  const args = openWorkArgs("owner/repo");
  // No `--method`, so the read cannot be the thing that starts a job on the
  // target it is asking about.
  assert.ok(!args.includes("--method"), "the read writes nothing");
  assert.deepEqual(args, ["api", "--paginate", "repos/owner/repo/issues?state=open&per_page=100", "--jq", PROJECTIONS.issues]);
});

test("a projected item becomes the subject the rules read, pull requests included", () => {
  // The shape `PROJECTIONS.issues` prints, one line per item.
  const raw = [
    { number: 7, title: "a ticket", pull_request: false, labels: [{ name: READY_LABEL }] },
    { number: 8, title: "a PR", pull_request: true, labels: [] },
  ];
  assert.deepEqual(fromGitHub(raw), [
    { pullRequest: false, labels: [READY_LABEL] },
    { pullRequest: true, labels: [] },
  ]);
});

test("nothing open is nothing waiting", () => {
  assert.equal(needsSweep([]), false);
});

test("a ready ticket is work, and every label that holds one takes it back off", () => {
  assert.equal(needsSweep([ticket(READY_LABEL)]), true);
  for (const held of HOLD_LABELS) {
    assert.equal(needsSweep([ticket(READY_LABEL, held)]), false, `${held} holds the ticket, so there is nothing to start`);
  }
});

test("a ticket in a factory state label is work, unless the factory has parked it", () => {
  for (const state of FACTORY_STATE_LABELS) {
    const parked = PARKED_LABELS.some((label) => label === state);
    assert.equal(needsSweep([ticket(state)]), !parked, `${state} on a ticket`);
  }
});

test("any open pull request is work, whoever produced it, unless it is parked", () => {
  // No factory label on it at all: the reconciler asks for a verdict on an
  // unjudged PR from any producer, so a target whose only open work is
  // somebody else's PR is still swept.
  assert.equal(needsSweep([pullRequest()]), true);
  for (const label of PARKED_LABELS) assert.equal(needsSweep([pullRequest(label)]), false, `${label} on a PR`);
});

test("a parked ticket is nothing waiting even while a human's ready label is still on it", () => {
  // `agent:blocked` takes nothing off (ADR 0005), so a blocked ticket keeps
  // `ready-for-agent`. Reading the ready rule without the parked one would wake
  // the target every interval for a subject no sweep repairs.
  for (const label of PARKED_LABELS) assert.equal(needsSweep([ticket(READY_LABEL, label)]), false, `${label} beside ${READY_LABEL}`);
});

test("one subject waiting is enough, whatever else is open", () => {
  assert.equal(needsSweep([ticket(), ticket(READY_LABEL, ...HOLD_LABELS), ticket(READY_LABEL)]), true);
  assert.equal(needsSweep([ticket(), ticket(READY_LABEL, ...HOLD_LABELS)]), false);
});

test("the rules name no label of their own", () => {
  // The sets come from the factory's definitions or they drift. A label spelled
  // here is that drift, whatever the tests above say today.
  const source = fs.readFileSync(new URL("./work.ts", import.meta.url), "utf8");
  for (const label of [READY_LABEL, ...HOLD_LABELS, ...PARKED_LABELS, ...FACTORY_STATE_LABELS]) {
    assert.doesNotMatch(source, new RegExp(`["'\`]${label.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `${label} is quoted in work.ts rather than imported`);
  }
});
