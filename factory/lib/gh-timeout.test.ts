import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The timeout is one number for the process, read once when the wrapper is
 * imported, so the test that proves the kill has to set it before that import
 * and cannot share a process with the tests that prove everything else.
 * `node --test` runs each file in its own process, which is what this second
 * file buys: `gh.test.ts` runs under the real 60s and is untouched by this.
 */
process.env.FACTORY_GH_TIMEOUT_MS = "500";
const { GhError, gh } = await import("./gh.ts");

let stubDir: string;
let realPath: string | undefined;

before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-timeout-stub-"));
  realPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${realPath ?? ""}`;
  const file = path.join(stubDir, "gh");
  // Hangs far past the timeout under test and answers nothing, as a stalled
  // call does. `exec`, so the process the wrapper kills is the sleeping one:
  // a forked sleep would outlive the kill and hold the pipes open.
  fs.writeFileSync(file, "#!/bin/sh\nexec sleep 60\n");
  fs.chmodSync(file, 0o755);
});

after(() => {
  process.env.PATH = realPath;
  fs.rmSync(stubDir, { recursive: true, force: true });
});

const thrownBy = (call: () => string): InstanceType<typeof GhError> => {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof GhError, `a timed-out gh call throws a GhError, got ${String(error)}`);
    return error;
  }
  return assert.fail("the call was expected to be killed");
};

test("a call that never answers is killed, and the error says it timed out", () => {
  const error = thrownBy(() => gh(["api", "repos/o/r/issues"]));
  assert.equal(error.timedOut, true);
  assert.deepEqual(error.args, ["api", "repos/o/r/issues"]);
  // The command and the cause, not Node's exact spawnSync wording.
  assert.match(error.message, /^gh api repos\/o\/r\/issues failed: ETIMEDOUT\b/);
});

test("no token reaches a timed-out call's message or args", () => {
  const error = thrownBy(() => gh(["api", "user"], { ...process.env, GH_TOKEN: "ghp_notatoken" }));
  assert.equal(error.timedOut, true);
  assert.ok(!error.message.includes("ghp_notatoken"), "the token is in env, so it is in no part of the description");
  assert.ok(!error.args.includes("ghp_notatoken"));
  assert.ok(!error.stderr.includes("ghp_notatoken"));
});
