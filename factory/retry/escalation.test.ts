import assert from "node:assert/strict";
import { test } from "node:test";

import { VERDICT_SECTION_START } from "../lib/factory-pr.ts";
import { escalationLabels, prEscalation } from "./escalation.ts";

const agentBranch = { headRef: "agent/issue-7-thing", body: "" };
const handAuthored = { headRef: "maintainer/flaky-login", body: "Fixes the flaky login test." };

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
  assert.deepEqual(prEscalation({ ...agentBranch, labels: ["agent:review", "agent:blocked", "enhancement"] }), {
    remove: ["agent:review", "agent:blocked"],
    close: true,
  });
  assert.deepEqual(prEscalation({ ...agentBranch, labels: [] }), { remove: [], close: true });
});

test("escalating a PR touches nothing but the factory's own labels", () => {
  // ready-for-agent is the ticket's intent, never the PR's, so a stray one is left alone.
  assert.deepEqual(prEscalation({ ...agentBranch, labels: ["ready-for-agent", "factory:retry-1"] }), {
    remove: [],
    close: true,
  });
});

test("escalation never closes a PR the factory did not author", () => {
  // #174: a hand-authored PR labelled agent:review gets a failing verdict for
  // want of acceptance criteria, which is unretryable, which escalates. Closing
  // it here throws away work nothing can recreate.
  assert.equal(prEscalation({ ...handAuthored, labels: ["agent:review"] }).close, false);
  // An outside agent's PR is no more the factory's to close than a person's.
  assert.equal(prEscalation({ headRef: "bot/dependabot-bump", body: "", labels: [] }).close, false);
});

test("a PR the reviewer judged is still not the factory's to close", () => {
  // The verdict section makes it a factory PR, so the audit and the reconciler
  // see it. It is the one arm authorship drops: the factory wrote the section,
  // not the branch.
  const judged = { headRef: "maintainer/flaky-login", body: `body\n\n${VERDICT_SECTION_START}\n## Verdict: fail` };
  assert.equal(prEscalation({ ...judged, labels: ["agent:review"] }).close, false);
});

test("escalation stands a PR down whether or not it closes it", () => {
  // The agent:* labels come off either way. A label left on is a run that picks
  // the PR up again, and escalation is the factory saying it is done with it.
  assert.deepEqual(prEscalation({ ...handAuthored, labels: ["agent:review", "bug"] }).remove, ["agent:review"]);
});
