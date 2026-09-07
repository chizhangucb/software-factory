/**
 * The run path around `rotation.ts`: read the accounts the workflow
 * enumerated, pick one, run, and re-run once on the next account when the
 * result event says rate limited. Logs name accounts by label, never by
 * token.
 */
import * as fs from "node:fs";
import type { AgentProvider } from "@ai-hero/sandcastle";
import { asArray, asRecord, asString, claudeAgent, fail, required } from "./common";
import {
  createRunLog,
  type ResultEvent,
  type RunLog,
  settleRun,
} from "./run-log";
import { type AccountToken, isRateLimited, pickToken } from "./rotation";

/** Path of the JSON file the workflow writes: `[{ index, label, token }]`. */
export const ACCOUNTS_FILE_VAR = "FACTORY_ACCOUNTS_FILE";

/**
 * Comma-separated account indexes whose first attempt in a job is treated
 * as rate limited without running the agent. Off unless set; used by the
 * proof run (#19) to force one rotation.
 */
export const FORCE_RATE_LIMIT_VAR = "FACTORY_FORCE_RATE_LIMIT_ON";

/** Attempts per run: the first, plus one re-run on the next account. */
const MAX_ATTEMPTS = 2;

export const parseAccounts = (value: unknown): AccountToken[] =>
  asArray(value, "accounts")
    .map((entry, i) => {
      const record = asRecord(entry, `accounts[${i}]`);
      const index = Number(record.index);
      if (!Number.isInteger(index) || index < 1) {
        throw new Error(`accounts[${i}].index must be a positive integer`);
      }
      return {
        index,
        label: asString(record.label, `accounts[${i}].label`),
        token: asString(record.token, `accounts[${i}].token`),
      };
    })
    .sort((a, b) => a.index - b.index);

export const parseForcedAccounts = (value: string | undefined): Set<number> =>
  new Set(
    (value ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );

/**
 * Read the accounts file, mask every token before anything else prints, and
 * delete the file so the tokens live only in this process and in the env of
 * the one agent run that uses each of them.
 */
export const loadAccounts = (file = required(ACCOUNTS_FILE_VAR)): AccountToken[] => {
  let accounts: AccountToken[];
  try {
    accounts = parseAccounts(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    return fail(
      `Could not read the accounts file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const account of accounts) console.log(`::add-mask::${account.token}`);
  fs.rmSync(file, { force: true });
  if (accounts.length === 0) {
    return fail(
      "No CLAUDE_CODE_OAUTH_TOKEN_<n> secret is available. Pass secrets: inherit from the caller.",
    );
  }
  return accounts;
};

/** The exact event shape `isRateLimited` detects, as Claude Code 2.1.263 emits it on a usage limit. */
export const forcedRateLimitEvent = (account: AccountToken): ResultEvent => ({
  type: "result",
  subtype: "success",
  is_error: true,
  api_error_status: 429,
  num_turns: 0,
  stop_reason: null,
  result: `You've hit your session limit · resets in 5h (forced by ${FORCE_RATE_LIMIT_VAR} for account ${account.index})`,
});

export interface RunOnAccountsOptions<A, T> {
  readonly name: string;
  readonly accounts: readonly AccountToken[];
  readonly forced?: ReadonlySet<number>;
  readonly agentFor: (account: AccountToken) => A;
  readonly run: (agent: A, log: RunLog) => Promise<T>;
  readonly createLog?: (name: string) => RunLog;
  readonly log?: (line: string) => void;
}

export type RunOnAccountsOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly account: AccountToken }
  | { readonly ok: false; readonly reason: string };

const describe = (account: AccountToken): string =>
  `account ${account.index} (${account.label})`;

/**
 * Pick, run, and rotate once. Rate limits are read from the raw result
 * events the run log captured, never from an exit code. Any other failure
 * stays on the account it happened on.
 */
export const runOnAccounts = async <A, T>(
  options: RunOnAccountsOptions<A, T>,
): Promise<RunOnAccountsOutcome<T>> => {
  const {
    name,
    accounts,
    forced = new Set<number>(),
    createLog = createRunLog,
    log = console.log,
  } = options;
  const rateLimited = new Set<number>();
  const limits: string[] = [];
  log(
    `[${name}] ${accounts.length} account(s) configured: ` +
      accounts.map((a) => `${a.index} (${a.label})`).join(", "),
  );

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const account = pickToken(accounts, undefined, rateLimited);
    if (!account) break;
    log(`[${name}] attempt ${attempt} on ${describe(account)}`);
    const runLog = createLog(`${name}.account-${account.index}`);

    let settled;
    if (forced.has(account.index)) {
      log(
        `[${name}] ${FORCE_RATE_LIMIT_VAR} includes ${account.index}: treating this attempt as rate limited without running the agent`,
      );
      runLog.resultEvents.push(forcedRateLimitEvent(account));
      settled = { ok: false as const, failure: runLog.finish() ?? "forced" };
    } else {
      settled = await settleRun(runLog, () =>
        options.run(options.agentFor(account), runLog),
      );
    }

    const limit = runLog.resultEvents.find(isRateLimited);
    if (limit) {
      rateLimited.add(account.index);
      limits.push(`${describe(account)}: ${limit.result ?? limit.subtype}`);
      log(
        `[${name}] ${describe(account)} rate-limited; detected from the result event ` +
          `(is_error=${limit.is_error}, subtype=${limit.subtype}, api_error_status=${limit.api_error_status ?? "none"}), ` +
          `not from the exit code: ${limit.result ?? JSON.stringify(limit.errors ?? [])}`,
      );
      continue;
    }
    if (!settled.ok) {
      log(`[${name}] failed on ${describe(account)}`);
      return { ok: false, reason: settled.failure };
    }
    log(`[${name}] finished on ${describe(account)}`);
    return { ok: true, value: settled.value, account };
  }

  return {
    ok: false,
    reason:
      `Rate limited on every account tried (${limits.length} of ${accounts.length} configured; one re-run allowed): ` +
      limits.join("; "),
  };
};

/**
 * The scripts' entry point: accounts from the workflow's file, the forced
 * set from the repo variable, the factory's Claude provider per account.
 * Exits the process on failure, like `runOrFail`.
 */
export const runWithRotation = async <T>(
  name: string,
  model: string,
  run: (agent: AgentProvider, log: RunLog) => Promise<T>,
): Promise<T> => {
  const outcome = await runOnAccounts({
    name,
    accounts: loadAccounts(),
    forced: parseForcedAccounts(process.env[FORCE_RATE_LIMIT_VAR]),
    agentFor: (account) => claudeAgent(model, account),
    run,
  });
  return outcome.ok ? outcome.value : fail(outcome.reason);
};
