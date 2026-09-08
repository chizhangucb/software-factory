import assert from "node:assert/strict";
import { test } from "node:test";

import { escalationLabels, prCloseLabels } from "./escalation.ts";

test("an escalated ticket is left carrying needs-human and nothing else of the factory's", () => {
  assert.deepEqual(
    escalationLabels(["ready-for-agent", "agent:in-progress", "agent:blocked", "factory:retry-1"]),
    { remove: ["ready-for-agent", "agent:in-progress", "agent:blocked"], add: "needs-human" },
  );
});

test("escalationLabels names only labels the subject carries", () => {
  assert.deepEqual(escalationLabels([]), { remove: [], add: "needs-human" });
  assert.deepEqual(escalationLabels(["bug", "factory:retry-1"]), { remove: [], add: "needs-human" });
});

test("a PR the factory closes keeps no agent:* label", () => {
  assert.deepEqual(prCloseLabels(["agent:review", "agent:blocked", "enhancement"]), {
    remove: ["agent:review", "agent:blocked"],
  });
  assert.deepEqual(prCloseLabels([]), { remove: [] });
});

test("closing a PR touches nothing but the factory's own labels", () => {
  // ready-for-agent is the ticket's intent, never the PR's, so a stray one is left alone.
  assert.deepEqual(prCloseLabels(["ready-for-agent", "factory:retry-1"]), { remove: [] });
});
