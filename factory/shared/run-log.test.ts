import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseResultEvent,
  parseSkillInvocations,
  runFailure,
  type ResultEvent,
} from "./run-log";

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

test("a turn cap stop reports the message from errors, not the whole event", () => {
  const capped: ResultEvent = {
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    errors: ["Reached maximum number of turns (5)"],
    num_turns: 6,
  };
  assert.equal(
    runFailure([capped]),
    "Agent reported an error (error_max_turns): Reached maximum number of turns (5)",
  );
});

test("a run that produced no result event is a failure", () => {
  assert.match(runFailure([]) ?? "", /No result event/);
});

test("parseSkillInvocations finds Skill tool uses in an assistant line", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Reviewing now." },
        {
          type: "tool_use",
          name: "Skill",
          input: { skill: "mattpocock-skills:code-review", args: "main" },
        },
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
        { type: "tool_use", name: "Skill", input: { skill: "code-review", args: "" } },
      ],
    },
  });
  assert.deepEqual(parseSkillInvocations(line), [
    { skill: "mattpocock-skills:code-review", args: "main" },
    { skill: "code-review", args: "" },
  ]);
});

test("parseSkillInvocations ignores everything else", () => {
  assert.deepEqual(parseSkillInvocations(JSON.stringify(success)), []);
  assert.deepEqual(
    parseSkillInvocations(JSON.stringify({ type: "assistant", message: { content: "x" } })),
    [],
  );
  assert.deepEqual(parseSkillInvocations("not json"), []);
});
