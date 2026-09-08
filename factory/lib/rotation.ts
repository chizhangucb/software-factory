/**
 * Rotation: which account a run uses, and whether a run was rate limited.
 *
 * Two pure functions, no I/O, no network (ADR 0004 and its amendment). The
 * caller enumerates the account tokens, injects headroom if it has a feed
 * (#24; none in v0), and re-runs once on the next token when a run comes back
 * rate limited.
 */
import type { ResultEvent } from "./run-log";

/** One configured account: the CLAUDE_CODE_OAUTH_TOKEN_<index> secret, labeled by CLAUDE_ACCOUNT_<index>. */
export interface AccountToken {
  readonly index: number;
  /** Shown in logs instead of the token. */
  readonly label: string;
  readonly token: string;
}

/** Remaining quota for one account, as a future feed reports it. */
export interface Headroom {
  /** Percent left in the binding window: 100 minus the max of the 5-hour and 7-day utilization. */
  readonly remaining: number;
  /** When the binding window resets, ISO 8601 or epoch milliseconds. Unknown when absent. */
  readonly resetsAt?: string | number;
}

/** Headroom keyed by account index. Accounts absent from the map are unknown. */
export type HeadroomByAccount = Readonly<Record<string | number, Headroom>>;

/**
 * The token the next attempt should use, or undefined when none is left.
 *
 * Tokens marked rate-limited in this job are never returned. With no
 * headroom the order is the configured index. With headroom the ranking
 * follows claude-swap's autoswitch candidate order: most remaining first;
 * accounts the feed knows nothing about next; spent accounts last, earliest
 * reset first. Configured index breaks every tie.
 */
export const pickToken = (
  tokens: readonly AccountToken[],
  headroom?: HeadroomByAccount,
  rateLimited: Iterable<number> = [],
): AccountToken | undefined => {
  const excluded = new Set(rateLimited);
  const candidates = tokens
    .filter((token) => !excluded.has(token.index))
    .sort((a, b) => a.index - b.index);
  if (!headroom) return candidates[0];
  return candidates.sort(
    (a, b) => rankOf(headroom[a.index]) - rankOf(headroom[b.index]) ||
      compareWithinRank(headroom[a.index], headroom[b.index]),
  )[0];
};

const rankOf = (headroom: Headroom | undefined): number => {
  if (!headroom) return 1;
  return headroom.remaining > 0 ? 0 : 2;
};

const compareWithinRank = (a?: Headroom, b?: Headroom): number => {
  if (!a || !b) return 0;
  if (a.remaining > 0) return b.remaining - a.remaining;
  return resetTime(a) - resetTime(b);
};

const resetTime = ({ resetsAt }: Headroom): number => {
  if (resetsAt === undefined) return Number.POSITIVE_INFINITY;
  const time = typeof resetsAt === "number" ? resetsAt : Date.parse(resetsAt);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

/**
 * Rate-limit text as Claude Code 2.1.263 renders it into the result event
 * (`You've hit your session limit · resets ...`, `You're out of usage
 * credits`, `Request rejected (429)`) plus the API's own `rate_limit_error`
 * type. Deliberately narrower than Chi's local wrapper: a bare "rate limit"
 * or "limit reached" also appears in tool output and budget errors, and a
 * false positive here re-runs a deterministic failure on another account.
 */
const RATE_LIMIT_TEXT =
  /usage limit|hit your [a-z0-9 ]*limit|out of (extra )?usage|rate_limit_error|\(429\)/i;

/**
 * Whether a raw result event reports a rate limit. Reads the event only:
 * `claude -p` exits 0 on a usage limit, so the exit code says nothing. An
 * event without `is_error` is never a rate limit, whatever its text says.
 * Auth failures (401, 403) and budget stops are errors but not rate limits;
 * rotating to another account would not fix them.
 */
export const isRateLimited = (result: ResultEvent): boolean => {
  if (result.is_error !== true) return false;
  if (result.api_error_status === 429) return true;
  return RATE_LIMIT_TEXT.test(errorText(result));
};

const errorText = (result: ResultEvent): string => {
  const parts: string[] = [];
  if (typeof result.result === "string") parts.push(result.result);
  if (Array.isArray(result.errors)) {
    parts.push(...result.errors.filter((e): e is string => typeof e === "string"));
  }
  return parts.join("\n");
};
