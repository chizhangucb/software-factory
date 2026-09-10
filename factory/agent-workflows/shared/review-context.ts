/**
 * Vendored from sandcastle 0.12.0, `.sandcastle/agent-workflows/shared/review-context.ts`.
 * Forced differences, each named (#47, #52):
 *
 * - `issueBody`, so the reviewer can parse acceptance criteria: story 5.
 * - the closing-keyword regex moved to `lib/linked-issue.ts`, one definition for
 *   the reviewer, the merge gate, the preflight and the retry handler (#13, #16).
 * - the linked issue read through `--json` and rendered by `lib/ticket-context.ts`:
 *   the text view carries no `author_association`, so nothing on it could be
 *   filtered, and gh 2.95 prints only the comments under `--comments` anyway, so
 *   a ticket with none arrived empty. One read now, body and comments together
 *   (story 27, ADR 0002 amendment).
 * - the `gh issue view --json` read throws instead of falling back to "", so an
 *   API error can never read as "this ticket has no criteria": story 5.
 * - a required `TrustPolicy`, and the assembly split out of the fetch as the pure
 *   `pullRequestContext`: everything a stranger can write is dropped before it
 *   reaches an agent, the count goes in its place, and the split is what lets a
 *   unit test prove it over fixtures with no network (story 27, ADR 0002
 *   amendment).
 * - an optional `diff`, so the audit can pass the merged commit's: story 18.
 * - the ticket read asks for `labels` as well, and `issueLabels` carries them on
 *   the context: #10's rule is that a `model:` label on the ticket moves the
 *   implementer, and implement-pr read that list off the PR (#119). The subject
 *   swapped on the read that was already there rather than a second one.
 */
import { gh, safeSh, sh } from "./common";
import { parseDiffLines } from "./diff-lines";
import { linkedIssueNumber } from "../../lib/linked-issue";
import { renderIssue, type IssueView } from "../../lib/ticket-context";
import type { TrustPolicy } from "../../lib/trusted-authors";

export interface ReviewThreadComment {
  readonly commentId: string;
  readonly threadId: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly author: string;
  readonly body: string;
}

/** A top-level comment on the PR, as `gh pr view --json comments` returns it. */
export interface PullRequestComment {
  readonly author?: { readonly login: string } | null;
  /** GitHub's `author_association` for the commenter. Absent reads as an outsider. */
  readonly authorAssociation?: string | null;
  readonly body: string;
  readonly createdAt?: string;
}

/** A submitted review, as `GET /pulls/{n}/reviews` returns it: REST, so snake_case. */
export interface PullRequestReview {
  readonly user?: { readonly login: string } | null;
  readonly author_association?: string | null;
  readonly body?: string | null;
  readonly state: string;
  readonly submitted_at?: string | null;
}

/** A review thread, as the GraphQL query below returns it. */
export interface PullRequestReviewThread {
  readonly id: string;
  readonly isResolved: boolean;
  readonly comments: {
    readonly nodes: readonly {
      readonly id: string;
      readonly path: string | null;
      readonly line: number | null;
      readonly originalLine: number | null;
      readonly body: string;
      readonly author?: { readonly login: string } | null;
      readonly authorAssociation?: string | null;
    }[];
  };
}

/** How much of each channel the trust policy dropped. */
export interface DroppedComments {
  readonly prComments: number;
  readonly reviewSummaries: number;
  readonly reviewThreadComments: number;
  readonly issueComments: number;
}

export interface PullRequestContext {
  readonly prTitle: string;
  readonly prBody: string;
  readonly issueNumber: string;
  readonly issueTitle: string;
  /** The linked issue's body alone, for parsing its acceptance criteria. */
  readonly issueBody: string;
  /**
   * The linked ticket's label names, empty when the PR links none. The
   * implementer model is resolved from these, so a `model:` label on the PR
   * alone moves nothing (#10, #119).
   */
  readonly issueLabels: readonly string[];
  readonly linkedIssue: string;
  readonly diff: string;
  readonly prCommentsJson: string;
  readonly diffLines: Map<string, Set<number>>;
  readonly validReplyIds: Set<string>;
  /** What the trust policy kept out of all of the above (story 27). */
  readonly dropped: DroppedComments;
}

/** The four reads `fetchPullRequestContext` makes, before any judgement. */
export interface PullRequestReads {
  readonly pr: {
    readonly title: string;
    readonly body?: string | null;
    readonly comments: readonly PullRequestComment[];
  };
  /** The linked ticket, or undefined when the PR body links none. */
  readonly issue: IssueView | undefined;
  readonly reviews: readonly PullRequestReview[];
  readonly threads: readonly PullRequestReviewThread[];
  readonly diff: string;
}

const REVIEW_THREADS_QUERY = `
query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:50) {
            nodes {
              id
              path
              line
              originalLine
              body
              authorAssociation
              author { login }
            }
          }
        }
      }
    }
  }
}`;


/** One line per run naming what the policy took out, so a cut thread is visible in the job log (#52). */
export const describeDropped = (dropped: DroppedComments): string => {
  const total =
    dropped.prComments +
    dropped.reviewSummaries +
    dropped.reviewThreadComments +
    dropped.issueComments;
  return total === 0
    ? "Untrusted comments dropped: none."
    : `Untrusted comments dropped: ${total} (PR comments ${dropped.prComments}, review summaries ${dropped.reviewSummaries}, review threads ${dropped.reviewThreadComments}, ticket comments ${dropped.issueComments}).`;
};

/**
 * The context an agent gets, from the reads, under one trust policy. Pure, so
 * the filter is provable over fixtures with no network.
 *
 * The policy is a required argument, not an option with a default: the
 * reviewer, implement-pr and the audit all come through here, and a call site
 * that could omit it would read a stranger's words in silence (story 27).
 */
export const pullRequestContext = (
  reads: PullRequestReads,
  policy: TrustPolicy,
): PullRequestContext => {
  const issueNumber = linkedIssueNumber(reads.pr.body);
  // One application of the policy to the ticket, not two: the rendered text and
  // the count come back together, so they cannot drift apart.
  const issue = reads.issue
    ? renderIssue(reads.issue, policy)
    : { text: "(no linked issue found)", droppedComments: 0 };

  // Each read names its channel and reports what it has. Whether the factory's
  // own login counts for anything here is the policy's answer, not this file's
  // (#80): both of #52's shipped bugs were this file getting it wrong.
  const prComments = policy.keep("pr-comment", reads.pr.comments, (comment) => ({
    association: comment.authorAssociation,
    login: comment.author?.login,
  }));
  const reviewSummaries = policy.keep(
    "review-summary",
    reads.reviews.filter((review) => review.body && review.body.trim().length > 0),
    (review) => ({
      association: review.author_association,
      login: review.user?.login,
    }),
  );
  const threadComments = policy.keep(
    "review-thread",
    reads.threads
      .filter((thread) => !thread.isResolved)
      .flatMap((thread) =>
        thread.comments.nodes.map((comment) => ({ thread, comment })),
      ),
    ({ comment }) => ({
      association: comment.authorAssociation,
      login: comment.author?.login,
    }),
  );

  const reviewThreads: ReviewThreadComment[] = threadComments.kept.map(
    ({ thread, comment }) => ({
      commentId: comment.id,
      threadId: thread.id,
      path: comment.path,
      line: comment.line ?? comment.originalLine,
      author: comment.author?.login ?? "unknown",
      body: comment.body,
    }),
  );

  const dropped: DroppedComments = {
    prComments: prComments.dropped,
    reviewSummaries: reviewSummaries.dropped,
    reviewThreadComments: threadComments.dropped,
    issueComments: issue.droppedComments,
  };
  const droppedInAll =
    dropped.prComments +
    dropped.reviewSummaries +
    dropped.reviewThreadComments +
    dropped.issueComments;

  const payload = {
    issue_comments: prComments.kept.map((comment) => ({
      author: comment.author?.login ?? "unknown",
      body: comment.body,
      createdAt: comment.createdAt,
    })),
    review_summaries: reviewSummaries.kept.map((review) => ({
      author: review.user?.login ?? "unknown",
      state: review.state,
      body: review.body,
      submittedAt: review.submitted_at,
    })),
    review_threads: reviewThreads,
    // The count stands in for what was taken out, so the agent reads a cut
    // thread as cut rather than as the whole of it (story 27).
    ...(droppedInAll > 0
      ? {
          dropped_untrusted: {
            // Keyed as the lists above are, so a count cannot be read as
            // belonging to a different list. `review_threads` is a list of
            // comments, so its count says comments.
            issue_comments: dropped.prComments,
            review_summaries: dropped.reviewSummaries,
            review_thread_comments: dropped.reviewThreadComments,
            // The ticket's own count, also written into LINKED ISSUE above.
            linked_issue_comments: dropped.issueComments,
            note: policy.droppedNote(droppedInAll, "comment(s) on this PR and its ticket"),
          },
        }
      : {}),
  };

  return {
    prTitle: reads.pr.title,
    prBody: reads.pr.body ?? "",
    issueNumber,
    issueTitle: reads.issue?.title ?? "",
    issueBody: reads.issue?.body ?? "",
    issueLabels: (reads.issue?.labels ?? []).map((label) => label.name),
    linkedIssue: issue.text,
    diff: reads.diff,
    prCommentsJson: JSON.stringify(payload, null, 2),
    diffLines: parseDiffLines(reads.diff),
    validReplyIds: new Set(reviewThreads.map((comment) => comment.commentId)),
    dropped,
  };
};

export const fetchPullRequestContext = (
  prNumber: string,
  policy: TrustPolicy,
  options: {
    /** The diff to judge; defaults to the branch's diff to main. The audit passes the merged commit's. */
    readonly diff?: string;
  } = {},
): PullRequestContext => {
  const prView = JSON.parse(
    gh(["pr", "view", prNumber, "--json", "title,body,comments"]),
  ) as {
    title: string;
    body?: string | null;
    comments: PullRequestComment[];
  };

  const issueNumber = linkedIssueNumber(prView.body);
  // One JSON read for the ticket: its title, its criteria, its comments with
  // the association the policy filters on, and its labels, which decide the
  // implementer's model (#119). Throws on an API error, since a missing body
  // must never read as "no criteria".
  const issue = issueNumber
    ? (JSON.parse(
        gh(["issue", "view", issueNumber, "--json", "number,title,body,comments,labels"]),
      ) as IssueView)
    : undefined;

  const reviews = JSON.parse(
    gh(["api", `repos/{owner}/{repo}/pulls/${prNumber}/reviews`]),
  ) as PullRequestReview[];

  const [owner, repo] = (process.env.GH_REPO ?? "").split("/");

  const threadsParsed = JSON.parse(
    gh([
      "api",
      "graphql",
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${prNumber}`,
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
    ]),
  ) as {
    data?: {
      repository?: {
        pullRequest?: {
          reviewThreads?: { nodes?: PullRequestReviewThread[] };
        };
      };
    };
  };

  const diff =
    options.diff ?? (safeSh("git diff main...HEAD") || sh("git diff main..HEAD"));

  return pullRequestContext(
    {
      pr: prView,
      issue,
      reviews,
      threads:
        threadsParsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [],
      diff,
    },
    policy,
  );
};
