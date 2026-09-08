import assert from "node:assert/strict";
import { test } from "node:test";

import { pullRequestContext, type PullRequestReads } from "./review-context";
import { trustPolicy } from "../../lib/trusted-authors";

const OWNER_ONLY = trustPolicy("OWNER");

/**
 * One PR as the four reads see it: the owner and a stranger have each written
 * a PR comment, a review summary, a review-thread comment, and a comment on
 * the linked ticket. This is the context the reviewer, implement-pr and the
 * audit all build (they call `fetchPullRequestContext`, which is this
 * function plus the `gh` calls).
 */
const reads = (): PullRequestReads => ({
  pr: {
    title: "Add a helper",
    body: "Closes #4",
    comments: [
      { author: { login: "chi" }, authorAssociation: "OWNER", body: "Owner on the PR." },
      { author: { login: "stranger" }, authorAssociation: "NONE", body: "Stranger on the PR." },
      { author: { login: "mate" }, authorAssociation: "COLLABORATOR", body: "Collaborator on the PR." },
    ],
  },
  issue: {
    number: 4,
    title: "Add a helper",
    body: "## Acceptance criteria\n\n- [ ] It helps",
    comments: [
      { author: { login: "chi" }, authorAssociation: "OWNER", body: "Owner on the ticket." },
      { author: { login: "stranger" }, authorAssociation: "NONE", body: "Stranger on the ticket." },
    ],
  },
  reviews: [
    { user: { login: "chi" }, author_association: "OWNER", body: "Owner review summary.", state: "COMMENTED" },
    { user: { login: "stranger" }, author_association: "NONE", body: "Stranger review summary.", state: "COMMENTED" },
    { user: { login: "chi" }, author_association: "OWNER", body: "   ", state: "APPROVED" },
  ],
  threads: [
    {
      id: "T1",
      isResolved: false,
      comments: {
        nodes: [
          { id: "C1", path: "a.ts", line: 3, originalLine: null, body: "Owner in the thread.", author: { login: "chi" }, authorAssociation: "OWNER" },
          { id: "C2", path: "a.ts", line: 4, originalLine: null, body: "Stranger in the thread.", author: { login: "stranger" }, authorAssociation: "NONE" },
        ],
      },
    },
    {
      id: "T2",
      isResolved: true,
      comments: {
        nodes: [
          { id: "C3", path: "a.ts", line: 9, originalLine: null, body: "Resolved thread.", author: { login: "chi" }, authorAssociation: "OWNER" },
        ],
      },
    },
  ],
  diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n+const helper = 1;\n",
});

test("a stranger's PR comment, review-thread comment and ticket comment never reach the context", () => {
  const context = pullRequestContext(reads(), OWNER_ONLY);
  assert.doesNotMatch(context.prCommentsJson, /Stranger on the PR/);
  assert.doesNotMatch(context.prCommentsJson, /Stranger in the thread/);
  assert.doesNotMatch(context.prCommentsJson, /Stranger review summary/);
  assert.doesNotMatch(context.linkedIssue, /Stranger on the ticket/);
  assert.deepEqual(context.dropped, {
    prComments: 2,
    reviewSummaries: 1,
    reviewThreadComments: 1,
    issueComments: 1,
  });
});

test("what was dropped is reported as a count, so the agent knows the thread was cut", () => {
  const context = pullRequestContext(reads(), OWNER_ONLY);
  const payload = JSON.parse(context.prCommentsJson) as {
    dropped_untrusted?: { pr_comments: number; review_summaries: number; review_threads: number; note: string };
  };
  assert.deepEqual(
    { ...payload.dropped_untrusted, note: undefined },
    { pr_comments: 2, review_summaries: 1, review_threads: 1, note: undefined },
  );
  assert.match(String(payload.dropped_untrusted?.note), /untrusted authors were dropped/);
  assert.match(context.linkedIssue, /1 comment\(s\) on the ticket from untrusted authors were dropped/);
});

test("a trusted author's words are unchanged", () => {
  const context = pullRequestContext(reads(), OWNER_ONLY);
  assert.match(context.prCommentsJson, /Owner on the PR\./);
  assert.match(context.prCommentsJson, /Owner review summary\./);
  assert.match(context.prCommentsJson, /Owner in the thread\./);
  assert.match(context.linkedIssue, /Owner on the ticket\./);
  assert.equal(context.prTitle, "Add a helper");
  assert.equal(context.issueNumber, "4");
  assert.equal(context.issueTitle, "Add a helper");
  assert.match(context.issueBody, /- \[ \] It helps/);
});

test("widening the policy lets a collaborator through and drops one fewer", () => {
  const context = pullRequestContext(reads(), trustPolicy("OWNER,COLLABORATOR"));
  assert.match(context.prCommentsJson, /Collaborator on the PR\./);
  assert.doesNotMatch(context.prCommentsJson, /Stranger on the PR/);
  assert.equal(context.dropped.prComments, 1);
});

test("a dropped thread comment is not a reply target, and a resolved thread is still out", () => {
  const context = pullRequestContext(reads(), OWNER_ONLY);
  assert.deepEqual([...context.validReplyIds], ["C1"]);
});

test("a PR that links no ticket says so and carries no criteria", () => {
  const raw = reads();
  const context = pullRequestContext(
    { ...raw, pr: { ...raw.pr, body: "No keyword here" }, issue: undefined },
    OWNER_ONLY,
  );
  assert.equal(context.issueNumber, "");
  assert.equal(context.issueBody, "");
  assert.equal(context.linkedIssue, "(no linked issue found)");
  assert.equal(context.dropped.issueComments, 0);
});

test("the audit's own diff is judged, and it is filtered the same way", () => {
  const raw = reads();
  const merged = "diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1,2 @@\n+const merged = 2;\n";
  const context = pullRequestContext({ ...raw, diff: merged }, OWNER_ONLY);
  assert.equal(context.diff, merged);
  assert.ok(context.diffLines.get("b.ts")?.has(1));
  assert.doesNotMatch(context.prCommentsJson, /Stranger/);
});
