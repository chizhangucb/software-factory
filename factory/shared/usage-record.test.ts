import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { appendUsageRecord, readUsageRecords, usageCommentFile } from "./usage-record";
import type { RunUsageRecord } from "./usage";

const record = (over: Partial<RunUsageRecord>): RunUsageRecord => ({
  role: "reviewer",
  name: "review-3",
  model: "claude-opus-5",
  account: "alpha",
  attempt: 1,
  wallMs: 1000,
  calls: 2,
  turns: 9,
  usage: { inputTokens: 1, cacheCreationInputTokens: 2, cacheReadInputTokens: 3, outputTokens: 4 },
  costUsd: 0.5,
  ...over,
});

test("records accumulate in usage.json and the role's comment is re-rendered after each", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-usage-"));
  assert.deepEqual(readUsageRecords(dir), []);
  appendUsageRecord(record({ attempt: 1, failure: "rate limited" }), { runUrl: "u", dir });
  const all = appendUsageRecord(record({ attempt: 2, account: "beta" }), { runUrl: "u", dir });
  assert.equal(all.length, 2);
  assert.equal(readUsageRecords(dir).length, 2);
  const comment = fs.readFileSync(path.join(dir, usageCommentFile("reviewer")), "utf8");
  assert.equal(comment.split("\n")[0], "<!-- factory:usage:reviewer -->");
  assert.match(comment, /review-3 \(attempt 1, failed\)/);
  assert.match(comment, /review-3 \(attempt 2\) \| claude-opus-5 \| beta/);
  assert.match(comment, /\| total \|/);
  fs.rmSync(dir, { recursive: true, force: true });
});
