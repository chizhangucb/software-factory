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
process.env.FACTORY_GH_TIMEOUT_MS = "1500";
const { GhError, gh } = await import("./gh.ts");

let stubDir: string;
let realPath: string | undefined;

before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-timeout-stub-"));
  realPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${realPath ?? ""}`;
  const file = path.join(stubDir, "gh");
  // Hangs far past the timeout under test, and answers nothing, as a stalled call does.
  fs.writeFileSync(file, "#!/bin/sh\nsleep 60\n");
  fs.chmodSync(file, 0o755);
});

after(() => {
  process.env.PATH = realPath;
  fs.rmSync(stubDir, { recursive: true, force: true });
});

test("a call that never answers is killed, and the error says it timed out", () => {
  let error: unknown;
  try {
    gh(["api", "repos/o/r/issues"]);
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof GhError, `a timed-out gh call throws a GhError, got ${String(error)}`);
  assert.equal(error.timedOut, true);
  assert.deepEqual(error.args, ["api", "repos/o/r/issues"]);
  assert.equal(error.message, "gh api repos/o/r/issues failed: ETIMEDOUT (spawnSync gh ETIMEDOUT)");
});

test("no token reaches a timed-out call's message or args", () => {
  let error: unknown;
  try {
    gh(["api", "user"], { ...process.env, GH_TOKEN: "ghp_notatoken" });
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof GhError);
  assert.equal(error.timedOut, true);
  assert.ok(!error.message.includes("ghp_notatoken"), "the token is in env, so it is in no part of the description");
  assert.ok(!error.args.includes("ghp_notatoken"));
  assert.ok(!error.stderr.includes("ghp_notatoken"));
});
