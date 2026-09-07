import assert from "node:assert/strict";
import { test } from "node:test";

import { parseResultEvent, runFailure, type ResultEvent } from "./run-log";

const success: ResultEvent = {
  type: "result",
  subtype: "success",
  is_error: false,
  result: "OK",
};
const rateLimited: ResultEvent = {
  type: "result",
  subtype: "error_during_execution",
  is_error: true,
  result: "You've hit your usage limit. Resets at 5pm.",
};

test("parseResultEvent keeps only result lines", () => {
  assert.deepEqual(parseResultEvent(JSON.stringify(success)), success);
  assert.equal(
    parseResultEvent(JSON.stringify({ type: "assistant", message: {} })),
    undefined,
  );
  assert.equal(parseResultEvent("not json"), undefined);
  assert.equal(parseResultEvent(""), undefined);
});

test("a run with only successful result events has no failure", () => {
  assert.equal(runFailure([success, success]), undefined);
});

test("an error flag on any result event fails the run, exit code aside", () => {
  const failure = runFailure([success, rateLimited]);
  assert.ok(failure);
  assert.match(failure, /error_during_execution/);
  assert.match(failure, /usage limit/);
});

test("a run that produced no result event is a failure", () => {
  assert.match(runFailure([]) ?? "", /No result event/);
});
