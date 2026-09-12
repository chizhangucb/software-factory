/**
 * The read both of a target's switches share. `pause.test.ts` and
 * `waiver.test.ts` each check that their own variable is the one the thing
 * that writes it names; this is the shape underneath, and in particular the
 * one predicate the module exists to keep single.
 *
 * Tested here rather than through either consumer, because a rule pinned only
 * through one of the two is a rule the other can be changed out from under.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isUnset, variableReadArgs, variableValue, variablesReadableArgs } from "./variable.ts";

test("the read is a GET, so asking a target about its own settings cannot start a job on it", () => {
  const args = variableReadArgs("owner/repo", "SOME_VARIABLE");
  assert.ok(!args.includes("--method"), "the read writes nothing");
  assert.deepEqual(args, ["api", "repos/owner/repo/actions/variables/SOME_VARIABLE", "--jq", ".value"]);
});

test("the value is what a human typed, trimmed of the newline gh prints", () => {
  assert.equal(variableValue("runaway sweep, see #123\n"), "runaway sweep, see #123");
  // Trimmed at both ends, and the inner spacing left alone: the value is a
  // sentence a human wrote and the whole of it is the reason.
  assert.equal(variableValue("  PAT expired,  see #244  \n"), "PAT expired,  see #244");
});

test("a variable set to blank carries nothing to act on", () => {
  assert.equal(variableValue("   \n"), undefined);
  assert.equal(variableValue(""), undefined);
});

test("the readable check is a GET of the collection, not of a variable in it", () => {
  const args = variablesReadableArgs("owner/repo");
  assert.ok(!args.includes("--method"), "the read writes nothing");
  // The collection itself: a path ending in a variable's name would be the
  // read it exists to disambiguate, and would answer 404 in both of the cases
  // it has to tell apart.
  assert.deepEqual(args, ["api", "repos/owner/repo/actions/variables", "--jq", ".total_count"]);
  assert.notDeepEqual(args, variableReadArgs("owner/repo", "FACTORY_PAUSED"));
});

test("an unset variable is a 404, and no other failure is one", () => {
  // The one case that is not a failure. Both switches turn on it and they turn
  // opposite ways: a 404 means "not paused", so the heartbeat wakes the target,
  // and it means "not waived", so the nag stays quiet. Anything else is a read
  // that went wrong, and neither may take it for an answer.
  assert.equal(isUnset("gh: Not Found (HTTP 404)"), true);
  assert.equal(isUnset("gh: API rate limit exceeded (HTTP 403)"), false);
  assert.equal(isUnset("gh: Bad credentials (HTTP 401)"), false);
  assert.equal(isUnset(""), false);
});
