/**
 * The routing test command a target copies. Covered the way the caller template
 * is covered: the shipped file is the fixture, because it is the only place
 * this exists. It is run as well as read, since the one thing it must do that
 * reading cannot show is fail when a file it ran failed. A target that copies
 * an example which swallows a failure gets a green merge gate over a red test.
 *
 * The commands it dispatches to are stubbed on PATH, the way `onboard.test.ts`
 * stubs `gh`, so nothing here installs a browser or reaches the network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const routing = fileURLToPath(new URL("../../templates/routing-test-command.sh", import.meta.url));

/** A stub for each command the shipped example dispatches to: it records its arguments and obeys FAIL_ON. */
const stub = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$CALLS"
for doomed in $FAIL_ON; do
  case "$*" in *"$doomed"*) exit 1 ;; esac
done
exit 0
`;

type Run = { code: number; output: string; calls: string[] };

/** Run the example over these files, with the named ones failing under whatever command they route to. */
const route = (files: readonly string[], failOn: readonly string[] = []): Run => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "routing-"));
  try {
    const calls = path.join(dir, "calls");
    for (const command of ["node", "npx"]) fs.writeFileSync(path.join(dir, command), stub, { mode: 0o755 });
    // Exactly how the merge gate invokes a target's test command, so a copy
    // that is not executable, or whose shebang does not resolve, fails here.
    const result = spawnSync("sh", ["-c", `${routing} "$@"`, "sh", ...files], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CALLS: calls, FAIL_ON: failOn.join(" ") },
    });
    if (result.error) assert.fail(`the routing test command did not run: ${result.error.message}`);
    return {
      code: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      calls: fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : [],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("a file that failed fails the whole command, so the merge gate still sees a real result", () => {
  const run = route(["test/unit.test.js"], ["test/unit.test.js"]);
  // That the file was dispatched is asserted too: a missing or unrunnable
  // example also exits non-zero, and that would pass this test proving nothing.
  assert.equal(run.calls.length, 1);
  assert.match(run.calls[0]!, /test\/unit\.test\.js$/);
  assert.notEqual(run.code, 0);
});

test("two kinds of test reach two different commands, which is the whole of what routing means", () => {
  const run = route(["test/browser/login.spec.js", "test/slugify.test.js"]);
  // Which command each kind gets is the mapping the target edits, so nothing
  // here pins it. That the kinds are told apart at all is the example's job.
  assert.deepEqual(run.calls.map((call) => call.replace(/ .*/, "")).sort(), ["node", "npx"]);
  assert.equal(run.code, 0);
});

test("a failing file never stops the ones after it, since the merge gate judges each on its own", () => {
  const files = ["test/a.test.js", "test/b.test.js", "test/c.test.js"];
  const run = route(files, ["test/a.test.js"]);
  assert.deepEqual(run.calls.map((call) => call.replace(/^.* /, "")), files);
  // Named as it goes, which is what a maintainer debugging it by hand reads.
  for (const file of files) assert.match(run.output, new RegExp(`== ${file}`));
  assert.notEqual(run.code, 0);
});

test("the one mapping a target must edit is the only thing marked for editing", () => {
  const shipped = fs.readFileSync(routing, "utf8");
  const marked = shipped.split("\n").filter((line) => line.includes("EDIT THIS"));
  assert.equal(marked.length, 1, "a second edit point makes it two mappings that can drift");
  // It points at the target's own classification rather than inviting a second copy of it.
  assert.match(shipped, /Reuse whatever your own CI already uses/);
});
