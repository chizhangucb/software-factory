import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentProvider } from "@ai-hero/sandcastle";

import { maxTurnsCommand, withMaxTurns } from "./turn-cap";

const fakeProvider: AgentProvider = {
  name: "fake",
  env: { A: "1" },
  captureSessions: true,
  buildPrintCommand: ({ prompt }) => ({
    command: "claude --print --model 'm' -p -",
    stdin: prompt,
  }),
  parseStreamLine: () => [],
};

test("maxTurnsCommand appends the CLI turn cap to the print command", () => {
  assert.equal(
    maxTurnsCommand("claude --print -p -", 40),
    "claude --print -p - --max-turns 40",
  );
});

test("maxTurnsCommand rejects a cap that is not a positive integer", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => maxTurnsCommand("claude", bad), /positive integer/);
  }
});

test("withMaxTurns patches only the print command and keeps the rest of the provider", () => {
  const capped = withMaxTurns(fakeProvider, 25);
  const printed = capped.buildPrintCommand({
    prompt: "do it",
    dangerouslySkipPermissions: true,
  });
  assert.equal(printed.command, "claude --print --model 'm' -p - --max-turns 25");
  assert.equal(printed.stdin, "do it");
  assert.equal(capped.name, "fake");
  assert.deepEqual(capped.env, { A: "1" });
  assert.equal(capped.captureSessions, true);
  assert.equal(capped.parseStreamLine, fakeProvider.parseStreamLine);
});
