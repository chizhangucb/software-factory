import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GhError, gh } from "./gh.ts";

/**
 * A stub `gh` on PATH, so the wrapper's own behaviour is what is observed: no
 * network, no real gh, no mock of the thing under test.
 */
let stubDir: string;
let realPath: string | undefined;

const stubGh = (script: string): void => {
  const file = path.join(stubDir, "gh");
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(file, 0o755);
};

before(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-stub-"));
  realPath = process.env.PATH;
  process.env.PATH = `${stubDir}:${realPath ?? ""}`;
});

after(() => {
  process.env.PATH = realPath;
  fs.rmSync(stubDir, { recursive: true, force: true });
});

test("returns the command's stdout as a utf8 string", () => {
  stubGh('printf "%s\\n" "$1 $2"');
  assert.equal(gh(["pr", "list"]), "pr list\n");
});

test("reads a listing far past Node's 1 MB default without ENOBUFS (#19)", () => {
  // 8 MB: well past the 1 MB default that killed the reconciler, well inside the wrapper's buffer.
  const bytes = 8 * 1024 * 1024;
  stubGh(`head -c ${bytes} /dev/zero | tr '\\0' 'x'`);
  assert.equal(gh(["api", "--paginate", "runs"]).length, bytes);
});

test("passes the caller's env to the child, so a second token can be used for one read", () => {
  stubGh('printf "%s" "$GH_TOKEN_LABEL"');
  assert.equal(gh(["api", "status"], { ...process.env, GH_TOKEN_LABEL: "read-token" }), "read-token");
});

const thrownBy = (call: () => string): GhError => {
  try {
    call();
  } catch (error) {
    assert.ok(error instanceof GhError, `a failed gh call throws a GhError, got ${String(error)}`);
    return error;
  }
  return assert.fail("the call was expected to fail");
};

test("a failed call throws a GhError carrying the command, the exit status, stderr and the signal", () => {
  stubGh('echo "gh: not found" >&2; exit 3');
  const error = thrownBy(() => gh(["pr", "view", "1"]));
  assert.deepEqual(error.args, ["pr", "view", "1"]);
  assert.equal(error.status, 3);
  assert.match(error.stderr, /gh: not found/);
  assert.equal(error.signal, null);
  assert.equal(error.timedOut, false);
});

test("a killed call carries the signal and no exit status", () => {
  stubGh("kill -TERM $$");
  const error = thrownBy(() => gh(["api", "x"]));
  assert.equal(error.signal, "SIGTERM");
  assert.equal(error.status, null);
  assert.equal(error.timedOut, false, "a call killed from outside is not a call the wrapper timed out");
});

test("the description names the command and never the token, which travels in env", () => {
  stubGh('echo "gh: Bad credentials (HTTP 401)" >&2; exit 1');
  const error = thrownBy(() => gh(["api", "user"], { ...process.env, GH_TOKEN: "ghp_notatoken" }));
  assert.equal(error.message, "gh api user failed: exit 1, gh: Bad credentials (HTTP 401)");
  assert.ok(!error.message.includes("ghp_notatoken"), "the token is in env, so it is in no part of the description");
  assert.ok(!error.args.includes("ghp_notatoken"));
  assert.ok(!error.stderr.includes("ghp_notatoken"));
});

test("a gh failure is described by its command and cause, never a stack", () => {
  const enobufs = Object.assign(new Error("spawnSync gh ENOBUFS"), { code: "ENOBUFS", stdout: "x".repeat(2000), stderr: "" });
  assert.equal(
    new GhError(["api", "repos/o/r/actions/runs"], enobufs).message,
    "gh api repos/o/r/actions/runs failed: ENOBUFS (spawnSync gh ENOBUFS)",
  );

  const http = Object.assign(new Error("Command failed: gh api ..."), { status: 1, stderr: "gh: Not Found (HTTP 404)\n" });
  assert.equal(new GhError(["api", "repos/o/r/nope"], http).message, "gh api repos/o/r/nope failed: exit 1, gh: Not Found (HTTP 404)");

  const killed = Object.assign(new Error("Command failed: gh api x"), { status: null, signal: "SIGTERM", stderr: "" });
  assert.equal(new GhError(["api", "x"], killed).message, "gh api x failed: killed by SIGTERM");

  assert.equal(new GhError(["pr", "list"], "boom").message, "gh pr list failed: boom");
});

test("a failure that is not a failed call at all is still described and still carries the fields", () => {
  // The sweep describes its own non-JSON output this way, rather than defining an error of its own.
  const error = new GhError(["api", "x"], new Error("printed something other than JSON: <html>"));
  assert.equal(error.message, "gh api x failed: printed something other than JSON: <html>");
  assert.equal(error.status, null);
  assert.equal(error.stderr, "");
  assert.equal(error.signal, null);
  assert.equal(error.timedOut, false);
});

test("a spawn that never happened is a failure, and not a timeout", () => {
  const enoent = Object.assign(new Error("spawnSync gh ENOENT"), { code: "ENOENT", status: null, stderr: "" });
  const error = new GhError(["pr", "list"], enoent);
  assert.equal(error.timedOut, false);
  assert.equal(error.message, "gh pr list failed: ENOENT (spawnSync gh ENOENT)");
});

test("never inherits stdin, so a gh prompt cannot hang the job", () => {
  stubGh('if [ -t 0 ]; then echo tty; else cat >/dev/null 2>&1; echo eof; fi');
  assert.equal(gh(["auth", "status"]), "eof\n");
});
