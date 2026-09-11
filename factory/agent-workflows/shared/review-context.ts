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
 * - the ticket's author read beside the ticket, and its body and title put
 *   through the policy on the `ticket-author` channel: that body is the
 *   reviewer's acceptance criteria and the audit's, the dispatcher's own author
 *   check is on neither path, and gh's `--json` view has no `authorAssociation`
 *   to filter on, so the association comes from a second REST read (#179).
 * - the ticket read asks for `labels` as well, and `issueLabels` carries them on
 *   the context: #10's rule is that a `model:` label on the ticket moves the
 *   implementer, and implement-pr read that list off the PR (#119). The subject
 *   swapped on the read that was already there rather than a second one.
 */
import { gh, safeSh, sh } from "./common";
import { parseDiffLines } from "./diff-lines";
import { linkedIssueNumber } from "../../lib/linked-issue";
import { renderIssue, type IssueView } from "../../lib/ticket-context";
import type { Author, TrustPolicy } from "../../lib/trusted-authors";

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

/**
 * How much of each channel the trust policy dropped. Comments are counted per
 * channel; the ticket's body is one thing or nothing, so `issueBody` is 1 or 0
 * and it counts the title with it, which goes the same way (#179).
 */
export interface DroppedUntrusted {
  readonly prComments: number;
  readonly reviewSummaries: number;
  readonly reviewThreadComments: number;
  readonly issueComments: number;
  readonly issueBody: number;
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
  readonly dropped: DroppedUntrusted;
}

/**
 * The linked ticket as the reads see it: the ticket, and who opened it.
 *
 * The author is its own field because it comes from its own read. gh's
 * `issue view --json` offers `author` but no `authorAssociation`, and the
 * association is what the policy judges, so the ticket read alone could not
 * filter the body even in principle (#179). Required rather than optional, for
 * the reason the `Author` fields themselves are: a read that could omit it
 * would hand the policy less than it has and pass a stranger's body in silence.
 */
export interface LinkedIssueRead {
  /** The ticket, as `gh issue view --json` returns it. */
  readonly view: IssueView;
  /** Whoever opened it, judged on the `ticket-author` channel. */
  readonly author: Author;
}

/** The five reads `fetchPullRequestContext` makes, before any judgement. */
export interface PullRequestReads {
  readonly pr: {
    readonly title: string;
    readonly body?: string | null;
    readonly comments: readonly PullRequestComment[];
  };
  /** The linked ticket, or undefined when the PR body links none. */
  readonly issue: LinkedIssueRead | undefined;
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


/**
 * One line per run naming what the policy took out, so a cut thread is visible
 * in the job log (#52). The body gets its own sentence rather than a fifth
 * count: it is not a comment, and a run that loses it loses its criteria, which
 * is the thing a reader of the log is trying to explain (#179).
 */
export const describeDropped = (dropped: DroppedUntrusted): string => {
  const total =
    dropped.prComments +
    dropped.reviewSummaries +
    dropped.reviewThreadComments +
    dropped.issueComments;
  const comments =
    total === 0
      ? "Untrusted comments dropped: none."
      : `Untrusted comments dropped: ${total} (PR comments ${dropped.prComments}, review summaries ${dropped.reviewSummaries}, review threads ${dropped.reviewThreadComments}, ticket comments ${dropped.issueComments}).`;
  return dropped.issueBody === 0
    ? comments
    : `${comments} The linked ticket's own body and title were dropped: an untrusted author opened it, so this run reads no acceptance criteria from it.`;
};

/** What stands where an untrusted ticket's title was, so the ticket still reads as a ticket. */
const UNTRUSTED_TICKET_TITLE = "(title not included: untrusted author)";

/**
 * What stands where an untrusted ticket's body was. A dropped comment leaves a
 * note saying the thread was cut; this is the same note for the body, in the
 * policy's own words, so an agent reads a missing checklist as refused rather
 * than as a ticket that never had one (#179).
 */
const untrustedTicketNote = (policy: TrustPolicy): string =>
  `This ticket was opened by an untrusted author, so neither its title nor its body is included: the factory acts only on ${policy.associations.join(", ")}. There are no acceptance criteria to judge here. If this ticket is genuine, a maintainer must restate it in a place the factory reads.`;

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
  // The ticket's body is the reviewer's ACCEPTANCE_CRITERIA and the audit's, so
  // it goes through the policy like every other channel here (#179).
  const ticketAuthorTrusted = reads.issue
    ? policy.trusts("ticket-author", reads.issue.author)
    : true;
  // The title goes with the body: a title is the same untrusted channel as a
  // body, which is how an untrusted parent spec is already handled (#52).
  const view =
    reads.issue && !ticketAuthorTrusted
      ? {
          ...reads.issue.view,
          title: UNTRUSTED_TICKET_TITLE,
          body: untrustedTicketNote(policy),
        }
      : reads.issue?.view;
  // One application of the policy to the ticket, not two: the rendered text and
  // the count come back together, so they cannot drift apart.
  const issue = view
    ? renderIssue(view, policy)
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

  const dropped: DroppedUntrusted = {
    prComments: prComments.dropped,
    reviewSummaries: reviewSummaries.dropped,
    reviewThreadComments: threadComments.dropped,
    issueComments: issue.droppedComments,
    issueBody: ticketAuthorTrusted ? 0 : 1,
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
    // The placeholder rather than "": implement-pr renders an empty title as
    // "(no linked issue)", and there is a linked ticket, it is just not one the
    // factory reads (#179).
    issueTitle: view?.title ?? "",
    // Empty, not the note above: an untrusted ticket must reach the same
    // outcome as a ticket with no acceptance criteria, which `review.ts` and
    // `audit.ts` already turn into a mechanical fail (#179).
    issueBody: ticketAuthorTrusted ? (reads.issue?.view.body ?? "") : "",
    issueLabels: (reads.issue?.view.labels ?? []).map((label) => label.name),
    linkedIssue: issue.text,
    diff: reads.diff,
    prCommentsJson: JSON.stringify(payload, null, 2),
    diffLines: parseDiffLines(reads.diff),
    validReplyIds: new Set(reviewThreads.map((comment) => comment.commentId)),
    dropped,
  };
};

/**
 * The linked ticket and whoever opened it, with the job's gh token.
 *
 * Two reads, because they carry different things and both are needed. gh's
 * `--json` view gives the title, the criteria, the comments with the
 * association the policy filters on, and the labels, which decide the
 * implementer's model (#119); it has no `authorAssociation` field for the
 * ticket itself, so it cannot say whose ticket this is. REST does, on
 * `author_association`, and that is the field the `ticket-author` channel is
 * judged on everywhere else (`dispatch/select.ts`).
 *
 * Both throw on an API error, since a missing body must never read as "no
 * criteria", and a missing author must never read as a trusted one.
 */
const readLinkedIssue = (issueNumber: string): LinkedIssueRead => {
  const view = JSON.parse(
    gh(["issue", "view", issueNumber, "--json", "number,title,body,comments,labels"]),
  ) as IssueView;
  const rest = JSON.parse(
    gh(["api", `repos/{owner}/{repo}/issues/${issueNumber}`]),
  ) as {
    author_association?: string | null;
    user?: { login?: string | null } | null;
  };
  return {
    view,
    author: { association: rest.author_association, login: rest.user?.login },
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
  const issue = issueNumber ? readLinkedIssue(issueNumber) : undefined;

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
