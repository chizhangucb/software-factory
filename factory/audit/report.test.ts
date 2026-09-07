import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUDIT_MARKER,
  isMiss,
  missReason,
  renderAuditComment,
  renderNeedsHumanIssue,
  renderRevertPrBody,
  type AuditResult,
} from "./report";

const pass: AuditResult = {
  verdict: {
    verdict: "pass",
    criteria: [
      { criterion: "adds slugify", met: true, evidence: "src/slugify.js:1" },
      { criterion: "tests pass", met: true, evidence: "npm test: 4 passing" },
    ],
  },
  placeholders: [],
  summary: "Both criteria are met.\nNothing to flag.",
};

const unmet: AuditResult = {
  ...pass,
  verdict: {
    verdict: "fail",
    criteria: [
      pass.verdict.criteria[0]!,
      { criterion: "tests pass", met: false, evidence: "the test asserts the stub" },
    ],
  },
};

const placeholder: AuditResult = {
  ...pass,
  placeholders: [{ path: "src/slugify.js", line: 3, description: "returns a hardcoded string" }],
};

const ctx = {
  prNumber: "45",
  issueNumber: "44",
  mergeSha: "abcdef0123456789",
  model: "claude-fable-5-1",
  ordinal: 7,
  limit: 20,
  runUrl: "https://example.test/run/9",
};

test("a miss is any unmet criterion or any placeholder", () => {
  assert.equal(isMiss(pass), false);
  assert.equal(isMiss(unmet), true);
  assert.equal(isMiss(placeholder), true);
  assert.equal(isMiss({ ...pass, verdict: { verdict: "fail", criteria: [] } }), true);
});

test("the miss reason names what was missed", () => {
  assert.equal(missReason(unmet), "1 of 2 acceptance criteria unmet");
  assert.equal(missReason(placeholder), "1 placeholder(s) found");
  assert.equal(
    missReason({ ...unmet, placeholders: placeholder.placeholders }),
    "1 of 2 acceptance criteria unmet, 1 placeholder(s) found",
  );
  assert.equal(
    missReason({ ...pass, verdict: { verdict: "fail", criteria: [] } }),
    "no acceptance criteria to judge against",
  );
  assert.equal(missReason(pass), "audit passed");
});

test("the audit comment starts with its marker, names the model and the ordinal, ticks each criterion", () => {
  const comment = renderAuditComment(pass, { ...ctx, usageSection: "| usage table |" });
  const lines = comment.split("\n");
  assert.equal(lines[0], AUDIT_MARKER);
  assert.equal(lines[1], "## Audit: pass");
  assert.match(comment, /Merged factory PR 7 of the first 20/);
  assert.match(comment, /Audited abcdef0 against the acceptance criteria of #44 with claude-fable-5-1, read-only/);
  assert.match(comment, /- \[x\] adds slugify\. Evidence: src\/slugify\.js:1/);
  assert.match(comment, /Both criteria are met\. Nothing to flag\./);
  assert.doesNotMatch(comment, /Miss:/);
  assert.ok(comment.endsWith("| usage table |"));
});

test("a miss comment lists placeholders and announces the revert", () => {
  const comment = renderAuditComment({ ...unmet, placeholders: placeholder.placeholders }, ctx);
  assert.match(comment, /^## Audit: miss$/m);
  assert.match(comment, /- \[ \] tests pass\. Evidence: the test asserts the stub/);
  assert.match(comment, /- `src\/slugify\.js:3`: returns a hardcoded string/);
  assert.match(comment, /Miss: 1 of 2 acceptance criteria unmet, 1 placeholder\(s\) found\. A revert PR and a needs-human issue follow/);
});

test("the revert PR body and the needs-human issue link the PR, the audit comment, and the revert PR", () => {
  const links = {
    prNumber: "45",
    prTitle: "Fix #44: add slugify",
    mergeSha: "abcdef0123456789",
    auditCommentUrl: "https://example.test/pr/45#issuecomment-1",
    revertPrUrl: "https://example.test/pr/46",
    runUrl: ctx.runUrl,
  };
  const body = renderRevertPrBody(unmet, links);
  assert.match(body, /Reverts #45 \(abcdef0\)/);
  assert.match(body, /1 of 2 acceptance criteria unmet/);
  assert.match(body, /Audit: https:\/\/example\.test\/pr\/45#issuecomment-1/);
  assert.match(body, /Not auto-merged/);

  const issue = renderNeedsHumanIssue(unmet, links);
  assert.equal(issue.title, "Audit miss: PR #45 Fix #44: add slugify");
  assert.match(issue.body, /- PR: #45 \(merged as abcdef0\)/);
  assert.match(issue.body, /- Audit comment: https:\/\/example\.test\/pr\/45#issuecomment-1/);
  assert.match(issue.body, /- Revert PR: https:\/\/example\.test\/pr\/46 \(not auto-merged\)/);
});

test("when the revert did not apply the issue says so instead of linking a PR", () => {
  const issue = renderNeedsHumanIssue(unmet, {
    prNumber: "45",
    prTitle: "t",
    mergeSha: "abcdef0123456789",
    auditCommentUrl: "u",
    revertFailure: "conflict in src/slugify.js",
    runUrl: "r",
  });
  assert.match(issue.body, /- Revert PR: none, `git revert` did not apply cleanly: conflict in src\/slugify\.js/);
});
