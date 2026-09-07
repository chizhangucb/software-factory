import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import type { ResultEvent } from "./run-log";
import {
  formatDuration,
  formatUsageComment,
  summarizeResultEvents,
  totalUsage,
  usageMarker,
  usageOfResultEvent,
  type RunUsageRecord,
} from "./usage";

const fixture = (name: string): ResultEvent =>
  JSON.parse(
    fs.readFileSync(
      path.join(import.meta.dirname, "fixtures", "result-events", `${name}.json`),
      "utf8",
    ),
  ) as ResultEvent;

test("usage comes from the result event's usage block, zero when it has none", () => {
  assert.deepEqual(usageOfResultEvent(fixture("success-with-usage")), {
    inputTokens: 2,
    cacheCreationInputTokens: 16046,
    cacheReadInputTokens: 10121,
    outputTokens: 4,
  });
  assert.deepEqual(usageOfResultEvent(fixture("success")), {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  });
});

test("an attempt sums every result event: produce, extraction, retries", () => {
  const produce = fixture("success-with-usage");
  const extraction: ResultEvent = {
    ...produce,
    num_turns: 2,
    total_cost_usd: 0.05,
    usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 26000, output_tokens: 300 },
  };
  const summary = summarizeResultEvents([produce, extraction]);
  assert.equal(summary.calls, 2);
  assert.equal(summary.turns, 3);
  assert.deepEqual(summary.usage, {
    inputTokens: 12,
    cacheCreationInputTokens: 16046,
    cacheReadInputTokens: 36121,
    outputTokens: 304,
  });
  assert.ok(Math.abs(summary.costUsd - 0.2165735) < 1e-9);
});

test("no events means zero usage, not a crash", () => {
  assert.deepEqual(summarizeResultEvents([]), {
    calls: 0,
    turns: 0,
    usage: { inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 },
    costUsd: 0,
  });
});

test("durations read as seconds, minutes, or hours", () => {
  assert.equal(formatDuration(4210), "4s");
  assert.equal(formatDuration(725_000), "12m 05s");
  assert.equal(formatDuration(3_723_000), "1h 02m 03s");
  assert.equal(formatDuration(-5), "0s");
});

const record = (over: Partial<RunUsageRecord>): RunUsageRecord => ({
  role: "implementer",
  name: "implement-7",
  model: "claude-opus-5",
  account: "alpha",
  attempt: 1,
  wallMs: 90_000,
  calls: 1,
  turns: 40,
  usage: { inputTokens: 1200, cacheCreationInputTokens: 50000, cacheReadInputTokens: 900000, outputTokens: 8000 },
  costUsd: 1.5,
  ...over,
});

test("the comment starts with the role marker, one row per attempt, a total when there are several", () => {
  const comment = formatUsageComment(
    "implementer",
    [
      record({ attempt: 1, account: "alpha", failure: "rate limited", usage: { inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 }, costUsd: 0, turns: 0, wallMs: 3000 }),
      record({ attempt: 2, account: "beta" }),
      record({ role: "reviewer", name: "review-8" }),
    ],
    { runUrl: "https://example.test/run/1" },
  );
  const lines = comment.split("\n");
  assert.equal(lines[0], usageMarker("implementer"));
  assert.equal(lines[1], "## Factory usage: implementer");
  assert.match(comment, /\| implement-7 \(attempt 1, failed\) \| claude-opus-5 \| alpha \| 3s \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \| \$0\.00 \|/);
  assert.match(comment, /\| implement-7 \(attempt 2\) \| claude-opus-5 \| beta \| 1m 30s \| 1 \| 40 \| 1,200 \| 50,000 \| 900,000 \| 8,000 \| \$1\.50 \|/);
  assert.match(comment, /\| total \| \| \| 1m 33s \| 2 \| 40 \| 1,200 \| 50,000 \| 900,000 \| 8,000 \| \$1\.50 \|/);
  assert.match(comment, /Attempt 1 on alpha: rate limited/);
  assert.doesNotMatch(comment, /review-8/);
  assert.match(comment, /https:\/\/example\.test\/run\/1/);
});

test("a single attempt gets no total row", () => {
  const comment = formatUsageComment("reviewer", [record({ role: "reviewer", name: "review-8" })], {
    runUrl: "u",
  });
  assert.doesNotMatch(comment, /\| total \|/);
  assert.match(comment, /review-8 \(attempt 1\)/);
});

test("a role with no records says so instead of rendering an empty table", () => {
  const comment = formatUsageComment("audit", [record({})], { runUrl: "u" });
  assert.equal(comment.split("\n")[0], "<!-- factory:usage:audit -->");
  assert.match(comment, /No agent run was recorded for the audit/);
});

test("totals add wall time, calls, turns, tokens, and cost", () => {
  const total = totalUsage([record({}), record({ attempt: 2, wallMs: 10_000, calls: 2, turns: 5, costUsd: 0.25 })]);
  assert.equal(total.wallMs, 100_000);
  assert.equal(total.calls, 3);
  assert.equal(total.turns, 45);
  assert.equal(total.usage.outputTokens, 16000);
  assert.equal(total.costUsd, 1.75);
});
