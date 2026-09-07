import { gh } from "./common";

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
}

const PARENT_QUERY =
  "query($owner: String!, $repo: String!, $num: Int!) { repository(owner: $owner, name: $repo) { issue(number: $num) { parent { number title body } } } }";

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
  const { number, title, body } = parent as Record<string, unknown>;
  if (typeof number !== "number" || typeof title !== "string") return undefined;
  return { number, title, body: typeof body === "string" ? body : "" };
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

export const ticketDocument = (input: {
  readonly number: number | string;
  readonly issueContext: string;
  readonly parent: ParentIssue | undefined;
}): string => {
  const parentSection = input.parent
    ? `# Parent spec #${input.parent.number}: ${input.parent.title}\n\n${input.parent.body.trim()}\n`
    : "# Parent spec\n\nThis ticket has no parent spec. The ticket above is the whole brief.\n";
  return `# Ticket #${input.number}\n\n${input.issueContext.trim()}\n\n${parentSection}`;
};
