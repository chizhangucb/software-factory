import assert from "node:assert/strict";
import { test } from "node:test";

import { describeDropped, pullRequestContext, type PullRequestReads } from "./review-context";
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
    // The factory's own reviewer, posted with GITHUB_TOKEN: NONE on every repo.
    { user: { login: "github-actions[bot]" }, author_association: "NONE", body: "Verdict: fail (1 of 2).", state: "COMMENTED" },
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
          { id: "C4", path: "a.ts", line: 5, originalLine: null, body: "Reviewer finding on line 5.", author: { login: "github-actions" }, authorAssociation: "NONE" },
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
    dropped_untrusted?: {
      pr_comments: number;
      review_summaries: number;
      review_threads: number;
      linked_issue_comments: number;
      note: string;
    };
  };
  const { note, ...counts } = payload.dropped_untrusted ?? ({} as never);
  assert.deepEqual(counts, {
    pr_comments: 2,
    review_summaries: 1,
    review_threads: 1,
    linked_issue_comments: 1,
  });
  assert.ok(note.length > 0, "the note stands in for what was dropped");
  assert.match(context.linkedIssue, /1 comment\(s\)/, "the ticket says how many it dropped");
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
  // C2 is the stranger's, C3 sits on a resolved thread. C1 is the owner's and
  // C4 is the factory's own reviewer.
  assert.deepEqual([...context.validReplyIds], ["C1", "C4"]);
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

test("a thread nobody was dropped from carries no dropped block at all", () => {
  const context = pullRequestContext(reads(), trustPolicy("OWNER,COLLABORATOR,NONE"));
  assert.deepEqual(context.dropped, {
    prComments: 0,
    reviewSummaries: 0,
    reviewThreadComments: 0,
    issueComments: 0,
  });
  assert.doesNotMatch(context.prCommentsJson, /dropped_untrusted/);
});

test("the factory's own review survives the filter, or implement-pr would lose its feedback", () => {
  // agent-review.yml posts the review and its inline comments with GITHUB_TOKEN,
  // so they arrive as github-actions with author_association NONE. Dropping them
  // would leave implement-pr with a dropped count in place of the findings it
  // exists to address, and no thread it is allowed to reply to.
  const context = pullRequestContext(reads(), OWNER_ONLY);
  assert.match(context.prCommentsJson, /Verdict: fail \(1 of 2\)\./);
  assert.match(context.prCommentsJson, /Reviewer finding on line 5\./);
  assert.deepEqual([...context.validReplyIds], ["C1", "C4"]);
  assert.equal(context.dropped.reviewSummaries, 1, "only the stranger's summary goes");
  assert.equal(context.dropped.reviewThreadComments, 1, "only the stranger's thread comment goes");
});

test("the job log names what was dropped, so a cut thread is visible without the prompt", () => {
  const context = pullRequestContext(reads(), OWNER_ONLY);
  const line = describeDropped(context.dropped);
  assert.match(line, /PR comments 2/);
  assert.match(line, /review summaries 1/);
  assert.match(line, /review threads 1/);
  assert.match(line, /ticket comments 1/);
  assert.match(describeDropped({ prComments: 0, reviewSummaries: 0, reviewThreadComments: 0, issueComments: 0 }), /none/);
});
