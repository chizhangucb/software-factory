/**
 * The pause the heartbeat reads before waking a target (#256): the one read it
 * makes per target, and the line a maintainer sees for a target it skipped.
 *
 * The variable's name is imported, never spelled here, and pinned against the
 * caller template: the gate a human sets and the read that finds it have to
 * name the same variable, and a test that quoted it would pass while they
 * drifted.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { PAUSE_VARIABLE, pauseLine, pauseReadArgs, pauseReason } from "./pause.ts";

test("the read is a GET of one repository variable, so asking whether a target is paused cannot start a job on it", () => {
  const args = pauseReadArgs("owner/repo");
  assert.ok(!args.includes("--method"), "the read writes nothing");
  assert.deepEqual(args, ["api", `repos/owner/repo/actions/variables/${PAUSE_VARIABLE}`, "--jq", ".value"]);
});

test("the variable is the one the caller's jobs gate on", () => {
  // The heartbeat's skip and the caller's gate are two halves of one pause. A
  // heartbeat reading a name the caller does not gate on would stop waking a
  // target that was never paused.
  const template = fs.readFileSync(new URL("../../templates/factory.yml", import.meta.url), "utf8");
  assert.match(template, new RegExp(`vars\\.${PAUSE_VARIABLE}`), "the caller gates on the variable the heartbeat reads");
});

test("the value is the reason, trimmed of the newline gh prints", () => {
  assert.equal(pauseReason("runaway sweep, see #123\n"), "runaway sweep, see #123");
  assert.equal(pauseReason("  runaway sweep, see #123  \n"), "runaway sweep, see #123");
});

test("only the empty value is no pause, exactly as the caller reads it", () => {
  // The caller's gate is `vars.FACTORY_PAUSED == ''`, a string comparison, so
  // the empty value is the whole of what runs. A heartbeat that read more than
  // that as running would stop waking a target no job on it is willing to work
  // for, which is the bill #256 removes, still being paid behind a pass that
  // reports the target as woken.
  assert.equal(pauseReason("\n"), undefined);
  assert.equal(pauseReason(""), undefined);
});

test("a pause set to whitespace is still a pause, because the caller stops for it", () => {
  // `gh variable set FACTORY_PAUSED --body " "` is not the empty string, so
  // every gated job on the target is skipped. Trimming first and calling the
  // result no pause is how the two halves of one pause come apart.
  assert.notEqual(pauseReason(" \n"), undefined);
  assert.notEqual(pauseReason("\t\n"), undefined);
});

test("a pause with no readable reason says so, rather than printing a blank one", () => {
  // The line is what a maintainer acts on, and `paused ()` names nothing. The
  // target is still paused: what is missing is the reason, not the pause.
  const line = pauseLine("owner/repo", pauseReason(" \n")!);
  assert.match(line, /paused \(\S/, "the line carries something a maintainer can read");
  assert.doesNotMatch(line, /undefined/, "and a word, not a missing value rendered");
  assert.ok(line.includes(PAUSE_VARIABLE), "and still names the variable to clear");
});

test("a paused target's line carries the reason and the variable to clear", () => {
  const line = pauseLine("owner/repo", "runaway sweep, see #123");
  assert.ok(line.includes("owner/repo"), "the line names the target");
  assert.ok(line.includes("runaway sweep, see #123"), "the line carries the reason");
  assert.ok(line.includes(PAUSE_VARIABLE), "the line names the variable to clear");
});
