import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { parseAccounts, runOnAccounts } from "./accounts";
import { type ResultEvent, type RunLog, runFailure } from "./run-log";
import type { AccountToken } from "./rotation";

const fixture = (name: string): ResultEvent =>
  JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "fixtures", "result-events", `${name}.json`),
      "utf8",
    ),
  ) as ResultEvent;

const accounts: readonly AccountToken[] = [
  { index: 1, label: "alpha", token: "tok-1" },
  { index: 2, label: "beta", token: "tok-2" },
  { index: 3, label: "gamma", token: "tok-3" },
];

/** A run log that records nothing on disk; finish() is the real runFailure. */
const fakeLogs = (): { logs: string[]; createLog: (name: string) => RunLog } => {
  const logs: string[] = [];
  return {
    logs,
    createLog: (name) => {
      logs.push(name);
      const resultEvents: ResultEvent[] = [];
      return {
        logging: { type: "file", path: `/dev/null/${name}.log` },
        logPath: `/dev/null/${name}.log`,
        resultEvents,
        record: (event) => resultEvents.push(event),
        wallMs: () => 0,
        finish: () => runFailure(resultEvents),
      };
    },
  };
};

/** Each attempt's agent is the token it ran on, so the outcome per account is scripted. */
const scripted = (outcomes: Record<string, ResultEvent | ResultEvent[]>) =>
  async (agent: string, log: RunLog): Promise<string> => {
    const scripted = outcomes[agent];
    if (!scripted) throw new Error(`unexpected attempt on ${agent}`);
    const events = Array.isArray(scripted) ? scripted : [scripted];
    for (const event of events) log.record(event);
    if (events[events.length - 1]?.is_error) throw new Error("library threw, as it does on a bad turn");
    return `ran on ${agent}`;
  };

test("a rate-limited first attempt restores the tree and re-runs once on the next account", async () => {
  const { logs, createLog } = fakeLogs();
  const attempted: string[] = [];
  let restored = 0;
  const run = scripted({
    "tok-1": fixture("rate-limit-session"),
    "tok-2": fixture("success"),
  });
  const outcome = await runOnAccounts({
    name: "t",
    accounts,
    agentFor: (a) => a.token,
    run: (agent, log) => {
      attempted.push(agent);
      return run(agent, log);
    },
    createLog,
    log: () => {},
    restore: () => {
      restored++;
    },
  });
  assert.deepEqual(outcome, {
    ok: true,
    value: "ran on tok-2",
    account: accounts[1],
  });
  assert.deepEqual(logs, ["t.account-1", "t.account-2"]);
  // Both accounts were actually run: rotation follows a rate-limited result,
  // and nothing can mark an account limited without running the agent on it.
  assert.deepEqual(attempted, ["tok-1", "tok-2"]);
  assert.equal(restored, 1);
});

test("a run that succeeds first time never touches a second account or the tree", async () => {
  const { logs, createLog } = fakeLogs();
  const outcome = await runOnAccounts({
    name: "t",
    accounts,
    agentFor: (a) => a.token,
    run: scripted({ "tok-1": fixture("success") }),
    createLog,
    log: () => {},
    restore: () => assert.fail("restore must not run without a re-run"),
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(logs, ["t.account-1"]);
});

test("a rate-limited turn the library retried to success stays on its account", async () => {
  const { logs, createLog } = fakeLogs();
  const outcome = await runOnAccounts({
    name: "t",
    accounts,
    agentFor: (a) => a.token,
    run: scripted({ "tok-1": [fixture("rate-limit-session"), fixture("success")] }),
    createLog,
    log: () => {},
    restore: () => assert.fail("a run whose last event succeeded must not re-run"),
  });
  assert.deepEqual(outcome, { ok: true, value: "ran on tok-1", account: accounts[0] });
  assert.deepEqual(logs, ["t.account-1"]);
});

test("two rate limits in a row stop after the single re-run and name both accounts", async () => {
  const { createLog } = fakeLogs();
  const outcome = await runOnAccounts({
    name: "t",
    accounts,
    agentFor: (a) => a.token,
    run: scripted({
      "tok-1": fixture("rate-limit-session"),
      "tok-2": fixture("rate-limit-out-of-credits"),
    }),
    createLog,
    log: () => {},
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok || outcome.rateLimited, true, "exhaustion is flagged for the retry handler");
  assert.match(outcome.ok ? "" : outcome.reason, /alpha.*beta/s);
  assert.doesNotMatch(outcome.ok ? "" : outcome.reason, /tok-/);
});

test("an auth error does not rotate; it fails on the account it happened on", async () => {
  const { logs, createLog } = fakeLogs();
  const outcome = await runOnAccounts({
    name: "t",
    accounts,
    agentFor: (a) => a.token,
    run: scripted({ "tok-1": fixture("auth-invalid") }),
    createLog,
    log: () => {},
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok || outcome.rateLimited, false);
  assert.deepEqual(logs, ["t.account-1"]);
});

test("parseAccounts validates the workflow's file and sorts by index", () => {
  assert.deepEqual(
    parseAccounts([
      { index: 3, label: "c", token: "t3" },
      { index: 1, label: "a", token: "t1" },
    ]),
    [
      { index: 1, label: "a", token: "t1" },
      { index: 3, label: "c", token: "t3" },
    ],
  );
  assert.throws(() => parseAccounts([{ index: 1, label: "a", token: "" }]));
  assert.throws(() => parseAccounts([{ index: 0, label: "a", token: "t" }]));
  assert.throws(() => parseAccounts({ index: 1 }));
});

test("parseAccounts falls back to account-<n> when the label variable is empty", () => {
  assert.equal(parseAccounts([{ index: 2, label: "", token: "t" }])[0].label, "account-2");
});
