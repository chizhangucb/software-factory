/**
 * The fixtures are captured output from real `node --test --test-reporter=tap`
 * runs on Node 26, cross-checked on Node 22, one file per run; only the
 * absolute checkout path was rewritten. They are captured rather than written
 * because the obvious guess about this format was wrong once already: a file
 * that crashes does not report zero tests, it reports one named after the file
 * carrying the dead process's exit status.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

import { reportArgs, runnability } from "./unrunnable";

/** One captured run, as the merge gate would have seen it. */
const captured = (name: string, exitCode: number) => ({
  exitCode,
  output: fs.readFileSync(new URL(`fixtures/node-test-tap/${name}.tap`, import.meta.url), "utf8"),
});

test("the default test command is asked for a report the merge gate can read", () => {
  assert.deepEqual(reportArgs("node --test"), ["--test-reporter=tap"]);
});

test("a caller's own test command is asked for nothing", () => {
  assert.deepEqual(reportArgs("npm run test:factory --"), []);
});

test("a file whose process died before any test reported is unrunnable", () => {
  assert.equal(runnability("node --test", captured("crashed-on-import", 1)), "unrunnable");
});

test("a file whose test failed an assertion ran, even when the values it compared carry an exit status", () => {
  // The discriminator is the dead process's own exit status, which the report
  // writes at the failing entry's own level. A test comparing objects with an
  // exitCode field prints one too, nested inside the values it dumps, and
  // reading that as a dead process would excuse a real failure.
  assert.equal(runnability("node --test", captured("assertion-failure-over-an-exit-status", 1)), "ran");
});

test("a file that registered a test before crashing at import is unrunnable, since the test never reported", () => {
  assert.equal(runnability("node --test", captured("crashed-after-registering", 1)), "unrunnable");
});

test("a file whose test failed an assertion ran", () => {
  assert.equal(runnability("node --test", captured("assertion-failure", 1)), "ran");
});

test("a file whose tests all passed ran", () => {
  assert.equal(runnability("node --test", captured("all-passing", 0)), "ran");
});

test("a file containing no tests ran, which is what the report says of it", () => {
  assert.equal(runnability("node --test", captured("no-tests", 0)), "ran");
});

test("with a caller's own test command nothing is ever judged unrunnable, whatever the output looks like", () => {
  // The same captured crash, which is unrunnable under the default command.
  assert.equal(runnability("npm run test:factory --", captured("crashed-on-import", 1)), "unknown");
});

test("a file whose test failed comparing a report of its own ran: the report inside it opens no entry", () => {
  // The dumped value is itself well-formed report text, so a scan that starts a
  // fresh entry wherever one appears finds a dead process's exit status inside a
  // failing test's own data and excuses the failure. Nested content belongs to
  // the key that holds it and is never read as the entry's own.
  assert.equal(runnability("node --test", captured("assertion-failure-over-a-report", 1)), "ran");
});

test("a file whose test reported before the process died ran: unrunnable is about reporting nothing, not about dying", () => {
  // Otherwise a file whose tests pass and whose process then dies is passed
  // over, and "the merge gate could not run it" becomes a way through for a
  // change nothing proved.
  assert.equal(runnability("node --test", captured("reported-then-died", 1)), "ran");
});
