import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { ACCOUNTS_FILE_VAR, parseAccounts, runOnAccounts } from "./accounts";
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

/**
 * The reason reaches the requeue comment on the target, so it names both
 * accounts by index and carries neither a token nor a label (#126).
 */
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
  assert.match(outcome.ok ? "" : outcome.reason, /account 1.*account 2/s);
  assert.doesNotMatch(outcome.ok ? "" : outcome.reason, /tok-/);
  assert.doesNotMatch(outcome.ok ? "" : outcome.reason, /alpha|beta|gamma/);
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

/**
 * `loadAccounts` masks nothing of its own: every workflow that writes the
 * accounts file has already masked every token in its `Enumerate accounts`
 * step. Nothing in the type system knows that, so this is what holds the two
 * halves together. A workflow that copies the jq and drops the mask loop puts
 * a live OAuth token in the job log the first time anything prints one.
 */
test("every workflow step that hands over the accounts file masks every token first", () => {
  const dir = new URL("../../.github/workflows/", import.meta.url);
  const files = fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length > 0, "there are workflow files to read");
  let writers = 0;
  for (const file of files) {
    const yaml = fs.readFileSync(new URL(file, dir), "utf8");
    // One step per `- ` at six-space indent, the way lib/strip-types-cone.test.ts splits them.
    for (const step of yaml.split(/\n(?= {6}- )/)) {
      const handoverAt = step.indexOf(`${ACCOUNTS_FILE_VAR}=`);
      if (handoverAt < 0) continue;
      writers++;
      const maskAt = step.indexOf("::add-mask::");
      assert.ok(maskAt >= 0, `${file}: the step that writes ${ACCOUNTS_FILE_VAR} never masks a token`);
      assert.ok(
        maskAt < handoverAt,
        `${file}: ${ACCOUNTS_FILE_VAR} is handed over before the tokens are masked`,
      );
    }
  }
  assert.ok(writers > 0, `no workflow writes ${ACCOUNTS_FILE_VAR}; this check would pass vacuously`);
});
