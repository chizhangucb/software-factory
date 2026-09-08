import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { gh } from "./gh.ts";

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

test("throws on a non-zero exit, carrying the child's stderr", () => {
  stubGh('echo "gh: not found" >&2; exit 1');
  assert.throws(
    () => gh(["pr", "view", "1"]),
    (error: unknown) => {
      const { status, stderr } = error as { status?: number; stderr?: string };
      assert.equal(status, 1);
      assert.match(String(stderr), /gh: not found/);
      return true;
    },
  );
});

test("never inherits stdin, so a gh prompt cannot hang the job", () => {
  stubGh('if [ -t 0 ]; then echo tty; else cat >/dev/null 2>&1; echo eof; fi');
  assert.equal(gh(["auth", "status"]), "eof\n");
});
