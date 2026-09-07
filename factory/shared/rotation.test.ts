import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import type { ResultEvent } from "./run-log";
import {
  type AccountToken,
  type HeadroomByAccount,
  isRateLimited,
  pickToken,
} from "./rotation";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const resultEvent = (name: string): ResultEvent =>
  JSON.parse(
    fs.readFileSync(path.join(fixturesDir, "result-events", `${name}.json`), "utf8"),
  ) as ResultEvent;
const headroom = (name: string): HeadroomByAccount =>
  JSON.parse(
    fs.readFileSync(path.join(fixturesDir, "headroom", `${name}.json`), "utf8"),
  ) as HeadroomByAccount;

const tokens: readonly AccountToken[] = [
  { index: 1, label: "alpha", token: "tok-1" },
  { index: 2, label: "beta", token: "tok-2" },
  { index: 3, label: "gamma", token: "tok-3" },
];

test("no headroom: configured order, lowest index first", () => {
  assert.equal(pickToken(tokens)?.index, 1);
  // Input order does not matter, the configured index does.
  assert.equal(pickToken([tokens[2], tokens[0], tokens[1]])?.index, 1);
});

test("no headroom: a token marked rate-limited in this job is never returned", () => {
  assert.equal(pickToken(tokens, undefined, [1])?.index, 2);
  assert.equal(pickToken(tokens, undefined, new Set([1, 2]))?.index, 3);
  assert.equal(pickToken(tokens, undefined, [1, 2, 3]), undefined);
});

test("no tokens configured picks nothing", () => {
  assert.equal(pickToken([]), undefined);
});

test("headroom: most remaining wins", () => {
  assert.equal(pickToken(tokens, headroom("fresh"))?.index, 2);
});

test("headroom: rate-limited tokens are skipped even with the most remaining", () => {
  assert.equal(pickToken(tokens, headroom("fresh"), [2])?.index, 3);
});

test("headroom: when every account is spent, the earliest reset wins", () => {
  assert.equal(pickToken(tokens, headroom("all-spent"))?.index, 2);
});

test("headroom: a partial feed ranks known headroom first, unknown next, spent last", () => {
  const partial = headroom("partial");
  assert.equal(pickToken(tokens, partial)?.index, 3);
  assert.equal(pickToken(tokens, partial, [3])?.index, 2);
  assert.equal(pickToken(tokens, partial, [2, 3])?.index, 1);
});

test("headroom: ties on remaining fall back to configured order", () => {
  const tied: HeadroomByAccount = {
    1: { remaining: 50, resetsAt: "2026-09-07T20:00:00Z" },
    2: { remaining: 50, resetsAt: "2026-09-07T18:00:00Z" },
  };
  assert.equal(pickToken(tokens, tied)?.index, 1);
});

test("isRateLimited: a usage limit reported with subtype success and HTTP 429 is a rate limit", () => {
  assert.equal(isRateLimited(resultEvent("rate-limit-session")), true);
  assert.equal(isRateLimited(resultEvent("rate-limit-out-of-credits")), true);
});

test("isRateLimited: the older error_during_execution shape with rate_limit_error text is a rate limit", () => {
  assert.equal(isRateLimited(resultEvent("rate-limit-during-execution")), true);
});

test("isRateLimited: limit text without an HTTP status still counts", () => {
  assert.equal(
    isRateLimited({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "You've hit your weekly limit. Resets Tue 3am.",
    }),
    true,
  );
});

test("isRateLimited: a successful run is not a rate limit", () => {
  assert.equal(isRateLimited(resultEvent("success")), false);
});

test("isRateLimited: auth errors are not rate limits", () => {
  assert.equal(isRateLimited(resultEvent("auth-invalid")), false);
  assert.equal(isRateLimited(resultEvent("auth-revoked")), false);
});

test("isRateLimited: other errors are not rate limits", () => {
  assert.equal(isRateLimited(resultEvent("max-turns")), false);
});

test("isRateLimited: limit-shaped text on a successful result is ignored", () => {
  assert.equal(
    isRateLimited({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Done. Note: the API has a rate limit of 50 requests per minute.",
    }),
    false,
  );
});
