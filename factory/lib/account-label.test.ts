/**
 * The `CLAUDE_ACCOUNT_<n>` label names an account for the operator, and a
 * public target's Actions log is world-readable, so the factory prints the
 * account index and never the label (#126). The surfaces are the four agent
 * workflows' `Enumerate accounts` step and every line `runOnAccounts` logs:
 * the retry handler attaches a failed run's step log to the escalation
 * comment it posts on the target, so the job log is a published surface too.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { runOnAccounts } from "./accounts";
import { type ResultEvent, type RunLog, runFailure } from "./run-log";
import type { AccountToken } from "./rotation";

const workflowsDir = new URL("../../.github/workflows/", import.meta.url);

/** The four workflows that enumerate accounts before running a model. */
const AGENT_WORKFLOWS = [
  "agent-implement.yml",
  "agent-implement-pr.yml",
  "agent-review.yml",
  "agent-audit.yml",
];

const enumerateEcho = (workflow: string): string => {
  const source = fs.readFileSync(new URL(workflow, workflowsDir), "utf8");
  const line = source.split("\n").find((l) => l.includes("account(s) configured"));
  assert.ok(line, `${workflow} has no "account(s) configured" line to check`);
  return line;
};

test("the Enumerate accounts step logs the account index and not the label", () => {
  for (const workflow of AGENT_WORKFLOWS) {
    const line = enumerateEcho(workflow);
    assert.ok(line.includes(".index"), `${workflow} must log the account index: ${line}`);
    assert.ok(
      !line.includes(".label"),
      `${workflow} logs the CLAUDE_ACCOUNT_<n> label, which a public target publishes: ${line}`,
    );
  }
});

const event = (name: string): ResultEvent =>
  JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "fixtures", "result-events", `${name}.json`),
      "utf8",
    ),
  ) as ResultEvent;

/** A run log that touches no disk; only the lines the loop logs are under test. */
const silentLog = (): RunLog => {
  const resultEvents: ResultEvent[] = [];
  return {
    logging: { type: "file", path: "/dev/null/x.log" },
    logPath: "/dev/null/x.log",
    resultEvents,
    record: (event) => resultEvents.push(event),
    wallMs: () => 0,
    finish: () => runFailure(resultEvents),
  };
};

/**
 * Every line the rotation loop logs. The label is identifying free text an
 * operator chose, so no line may carry it; the index names the account
 * instead. The first account is scripted to rate-limit, so the configured
 * line, both attempt lines, the rate-limit line and the finished line are all
 * exercised.
 */
test("runOnAccounts names accounts by index, never by the CLAUDE_ACCOUNT_<n> label", async () => {
  const label = "operator@example.com";
  const lines: string[] = [];
  const accounts: readonly AccountToken[] = [
    { index: 1, label, token: "tok-1" },
    { index: 2, label: `${label} - second`, token: "tok-2" },
  ];
  const outcome = await runOnAccounts({
    name: "t",
    accounts,
    agentFor: (a) => a.token,
    run: async (agent, log) => {
      if (agent === "tok-1") {
        log.record(event("rate-limit-session"));
        throw new Error("rate limited");
      }
      log.record(event("success"));
      return "done";
    },
    createLog: silentLog,
    log: (line) => lines.push(line),
  });
  assert.equal(outcome.ok, true);
  assert.ok(lines.length >= 4, `expected the loop to log; got ${lines.length} line(s)`);
  for (const line of lines) {
    assert.ok(!line.includes(label), `a logged line carries the account label: ${line}`);
  }
  assert.ok(
    lines.some((line) => line.includes("account 1")),
    `no line names account 1 by index: ${lines.join(" | ")}`,
  );
});
