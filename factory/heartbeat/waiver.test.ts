/**
 * The waiver the heartbeat nags about (#244): the one read it makes per target,
 * and the line a maintainer sees until the waiver is closed.
 *
 * The variable's name is imported, never spelled here: the script that writes it
 * and the read that finds it have to agree, and a test that quoted it would pass
 * while they drifted.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isUnset } from "./variable.ts";
import { WAIVER_VARIABLE, waiverLine, waiverReason, waiverReadArgs } from "./waiver.ts";

test("the read is a GET of one repository variable, so it cannot start a job on the target", () => {
  const args = waiverReadArgs("owner/repo");
  assert.ok(!args.includes("--method"), "the read writes nothing");
  assert.deepEqual(args, ["api", `repos/owner/repo/actions/variables/${WAIVER_VARIABLE}`, "--jq", ".value"]);
});

test("the variable is the one the script writes", () => {
  const script = fs.readFileSync(fileURLToPath(new URL("../../scripts/waive-factory-checks.sh", import.meta.url)), "utf8");
  assert.match(script, new RegExp(WAIVER_VARIABLE), "the script sets the variable the heartbeat reads");
});

test("the value is the reason, trimmed of the newline gh prints", () => {
  assert.equal(waiverReason("PAT expired, see #244\n"), "PAT expired, see #244");
});

test("an empty value is no waiver", () => {
  // A variable set to nothing is not a reason, and nagging with no reason is
  // the one line a maintainer cannot act on.
  assert.equal(waiverReason("   \n"), undefined);
  assert.equal(waiverReason(""), undefined);
});

test("an open waiver is one line naming the target and the reason", () => {
  const line = waiverLine("owner/repo", "PAT expired, see #244");
  assert.ok(line?.includes("owner/repo"), "the line names the target");
  assert.ok(line?.includes("PAT expired, see #244"), "the line carries the reason");
  assert.ok(line?.includes(WAIVER_VARIABLE), "the line names the variable to clear");
});

test("a target with no waiver produces no line", () => {
  assert.equal(waiverLine("owner/repo", undefined), undefined);
});

test("an unset variable is 404, and any other failure is not a missing waiver", () => {
  assert.equal(isUnset("gh: Not Found (HTTP 404)"), true);
  assert.equal(isUnset("gh: API rate limit exceeded (HTTP 403)"), false);
});
