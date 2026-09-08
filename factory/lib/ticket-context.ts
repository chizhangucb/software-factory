import { gh } from "../agent-workflows/shared/common";
import {
  DEFAULT_TRUSTED_AUTHORS,
  isTrustedAuthor,
  trustedAuthorsFromEnv,
} from "./trusted-authors";

/**
 * What the implementer reads before touching code: the ticket and, when the
 * ticket is a sub-issue of a spec, that spec. The agent has no GitHub token,
 * so the script fetches both before the run and writes them to one file the
 * prompt points at; the review skill reads the same file as its spec source.
 */
export interface ParentIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  /** GitHub's `authorAssociation` for whoever wrote the spec. Absent reads as an outsider. */
  readonly authorAssociation: string;
}

const PARENT_QUERY =
  "query($owner: String!, $repo: String!, $num: Int!) { repository(owner: $owner, name: $repo) { issue(number: $num) { parent { number title body authorAssociation } } } }";

/** The parent issue in a GraphQL response for PARENT_QUERY, if any. */
export const parentIssueFromGraphql = (json: string): ParentIssue | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const parent = (
    parsed as { data?: { repository?: { issue?: { parent?: unknown } } } }
  )?.data?.repository?.issue?.parent;
  if (typeof parent !== "object" || parent === null) return undefined;
  const { number, title, body, authorAssociation } = parent as Record<string, unknown>;
  if (typeof number !== "number" || typeof title !== "string") return undefined;
  return {
    number,
    title,
    body: typeof body === "string" ? body : "",
    authorAssociation: String(authorAssociation ?? "NONE").toUpperCase(),
  };
};

/** Fetch the parent issue of `owner/repo#issueNumber` with the job's gh token. */
export const fetchParentIssue = (
  repo: string,
  issueNumber: string,
): ParentIssue | undefined => {
  const [owner, name] = repo.split("/");
  if (!owner || !name) return undefined;
  try {
    const json = gh([
      "api",
      "graphql",
      "-f",
      `query=${PARENT_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${name}`,
      "-F",
      `num=${issueNumber}`,
    ]);
    return parentIssueFromGraphql(json);
  } catch {
    return undefined;
  }
};

export interface IssueView {
  readonly number: number;
  readonly title: string;
  readonly body?: string | null;
  readonly comments?: readonly {
    readonly author?: { readonly login: string } | null;
    /** GitHub's `author_association` for the commenter. Absent reads as an outsider. */
    readonly authorAssociation?: string | null;
    readonly body: string;
  }[];
}

/**
 * The ticket as text. Rendered from `--json` rather than gh's own text view:
 * gh 2.95 prints only the comments under `--comments`, so a ticket with no
 * comments would arrive empty.
 *
 * Comments from untrusted authors are dropped, not hidden: on a public target
 * anyone can comment on the owner's ticket, and this text is what the
 * implementer follows. The count of what was dropped stays in, so the agent
 * knows the thread is not the whole thread. The ticket body itself is the
 * dispatcher's business (only a trusted author's ticket is ever dispatched).
 */
export const trustedComments = <T extends { readonly authorAssociation?: string | null }>(
  comments: readonly T[],
  trustedAuthors: readonly string[] = DEFAULT_TRUSTED_AUTHORS,
): T[] =>
  comments.filter((comment) => isTrustedAuthor(comment.authorAssociation, trustedAuthors));

export const renderIssue = (
  issue: IssueView,
  trustedAuthors: readonly string[] = DEFAULT_TRUSTED_AUTHORS,
): string => {
  const parts = [`Issue #${issue.number}: ${issue.title}`, (issue.body ?? "").trim()];
  const comments = issue.comments ?? [];
  const trusted = trustedComments(comments, trustedAuthors);
  if (trusted.length > 0) {
    parts.push("## Comments");
    for (const comment of trusted) {
      parts.push(`### ${comment.author?.login ?? "unknown"}\n\n${comment.body.trim()}`);
    }
  }
  const dropped = comments.length - trusted.length;
  if (dropped > 0) {
    parts.push(
      `## Dropped comments\n\n${dropped} comment(s) from untrusted authors were dropped. The factory acts only on ${trustedAuthors.join(", ")}. If one of them mattered, a maintainer must restate it in the ticket.`,
    );
  }
  return parts.join("\n\n");
};

/** Fetch and render the ticket with the job's gh token. Throws on an API error. */
export const fetchIssue = (
  issueNumber: string,
  trustedAuthors: readonly string[] = trustedAuthorsFromEnv(),
): string =>
  renderIssue(
    JSON.parse(
      gh(["issue", "view", issueNumber, "--json", "number,title,body,comments"]),
    ) as IssueView,
    trustedAuthors,
  );

/**
 * The ticket and its spec, as one file the prompt points at. A spec written by
 * an untrusted author is named but not quoted: the dispatcher vouches for the
 * ticket's author, not the parent's, and a sub-issue link needs only write
 * access on the child.
 */
export const ticketDocument = (input: {
  readonly number: number | string;
  readonly issueContext: string;
  readonly parent: ParentIssue | undefined;
  readonly trustedAuthors?: readonly string[];
}): string => {
  const trusted = input.trustedAuthors ?? DEFAULT_TRUSTED_AUTHORS;
  const { parent } = input;
  const parentSection = !parent
    ? "# Parent spec\n\nThis ticket has no parent spec. The ticket above is the whole brief.\n"
    : isTrustedAuthor(parent.authorAssociation, trusted)
      ? `# Parent spec #${parent.number}: ${parent.title}\n\n${parent.body.trim()}\n`
      : `# Parent spec #${parent.number}: ${parent.title}\n\nNot included: it was written by an untrusted author (${parent.authorAssociation}), and the factory acts only on ${trusted.join(", ")}. Work from the ticket above.\n`;
  return `# Ticket #${input.number}\n\n${input.issueContext.trim()}\n\n${parentSection}`;
};
