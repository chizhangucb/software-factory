import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  createRunLog,
  parseResultEvent,
  parseSkillInvocations,
  runFailure,
  settleRun,
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

test("an error flag on the last result event fails the run, exit code aside", () => {
  const failure = runFailure([success, rateLimited]);
  assert.ok(failure);
  assert.match(failure, /error_during_execution/);
  assert.match(failure, /usage limit/);
});

test("an errored turn the library retried to success is a success", () => {
  assert.equal(runFailure([rateLimited, success]), undefined);
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

/** A log in a scratch OUTPUT_DIR; the raw stream hook is what the library calls. */
const scratchLog = (name: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-log-test-"));
  process.env.OUTPUT_DIR = dir;
  const log = createRunLog(name);
  const hook = (log.logging as { onAgentStreamEvent: (e: unknown) => void }).onAgentStreamEvent;
  const raw = (event: ResultEvent) => hook({ type: "raw", line: JSON.stringify(event) });
  const eventsFile = path.join(dir, "logs", `${name}.result-events.jsonl`);
  return { log, raw, eventsFile };
};

test("each result event lands in the jsonl file as it arrives, before finish", () => {
  const { log, raw, eventsFile } = scratchLog("stream");
  raw(rateLimited);
  assert.deepEqual(
    fs.readFileSync(eventsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)),
    [rateLimited],
  );
  raw(success);
  assert.deepEqual(log.resultEvents, [rateLimited, success]);
  assert.equal(fs.readFileSync(eventsFile, "utf8").trim().split("\n").length, 2);
  assert.equal(log.finish(), undefined);
  assert.equal(log.finish(), undefined, "finish is idempotent");
});

test("settleRun reports the library's error when no result event arrived", async () => {
  const { log } = scratchLog("threw");
  const settled = await settleRun(log, async () => {
    throw new Error("Claude Code exited with code 1");
  });
  assert.equal(settled.ok, false);
  assert.match(settled.ok ? "" : settled.failure, /exited with code 1/);
  assert.match(settled.ok ? "" : settled.failure, /No result event/);
});

test("settleRun reports the errored last event over the library's error", async () => {
  const { log, raw } = scratchLog("errored");
  const settled = await settleRun(log, async () => {
    raw(rateLimited);
    throw new Error("No <output> block found");
  });
  assert.equal(settled.ok, false);
  assert.match(settled.ok ? "" : settled.failure, /usage limit/);
  assert.doesNotMatch(settled.ok ? "" : settled.failure, /output/);
});

test("settleRun reports the library's error when the events say success but it threw", async () => {
  const { log, raw } = scratchLog("threw-after-success");
  const settled = await settleRun(log, async () => {
    raw(success);
    throw new Error("No <output> block found");
  });
  assert.deepEqual(settled, { ok: false, failure: "No <output> block found" });
});
