/**
 * Whose words the factory will act on.
 *
 * A ticket body, a PR comment, a review thread and the linked issue's
 * comments are all instructions an agent reads, so on a public target, where
 * anyone can open an issue, comment on one, or review a PR, the factory acts
 * only on text written by an author it trusts. Trust is GitHub's
 * `author_association` on the issue, comment or review, and the default is
 * the repo owner alone. Targets widen it with `trusted_author_associations`.
 *
 * One module so the dispatcher and the run scripts cannot drift apart on the
 * policy, and one type: a `TrustPolicy` is built once at each entrypoint from
 * the caller's input and passed as a required argument from there down, so no
 * call site can silently skip the filter (#52). No imports, and callers may
 * import it with or without the `.ts` extension, so the strip-types jobs
 * (dispatch) and the tsx jobs (implement, review, implement-pr, audit) both
 * get it.
 *
 * On an org-owned target nobody is `OWNER`: the owner's own issues read
 * `MEMBER`. Set `OWNER,MEMBER` there (#26 moves these repos to an org).
 */

/** The `author_association` values GitHub sends. One list, and the type of it. */
const ASSOCIATIONS = [
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIME_CONTRIBUTOR",
  "FIRST_TIMER",
  "MANNEQUIN",
  "NONE",
] as const;

export type AuthorAssociation = (typeof ASSOCIATIONS)[number];

/**
 * What GitHub sent, as one of its own values. Absent, or a value GitHub does
 * not send, is an outsider: a payload we do not recognise is not a licence.
 */
export const authorAssociation = (
  value: string | null | undefined,
): AuthorAssociation => {
  const upper = String(value ?? "NONE").toUpperCase();
  return (ASSOCIATIONS as readonly string[]).includes(upper)
    ? (upper as AuthorAssociation)
    : "NONE";
};

/** The default: only the repo owner's own words. */
export const DEFAULT_TRUSTED_AUTHORS = ["OWNER"] as const;

/** The env var the workflows pass the caller's input through. */
export const TRUSTED_AUTHORS_VAR = "TRUSTED_AUTHOR_ASSOCIATIONS";

/**
 * The factory's own voice. A workflow that posts with GITHUB_TOKEN comments as
 * the Actions bot, and GitHub reports `author_association: NONE` for it on
 * every repo, so the association alone would drop the reviewer's own summary
 * and inline findings before implement-pr ever read them. The login is spelled
 * two ways across the reads (`github-actions[bot]` on REST, `github-actions` on
 * gh's JSON and on GraphQL), so it is normalised before the comparison.
 * Comments posted with FACTORY_PAT come from the owner and need no exemption.
 *
 * Not a widening: posting under this login needs a workflow in the target,
 * which needs write access, the same bar as adding the `agent:implement` label.
 */
export const FACTORY_LOGINS: readonly string[] = ["github-actions"];

const normaliseLogin = (login: string | null | undefined): string =>
  String(login ?? "")
    .toLowerCase()
    .replace(/\[bot\]$/, "");

/** Who wrote something: GitHub's association, and the login it was posted under. */
export interface Author {
  readonly association?: string | null;
  readonly login?: string | null;
}

/** What survived the policy, and how much did not. */
export interface TrustedSelection<T> {
  readonly kept: readonly T[];
  readonly dropped: number;
}

/**
 * One target's answer to "whose words does an agent get to read". Built once
 * per run and passed down; every consumer takes it as a required argument.
 */
export interface TrustPolicy {
  /** The associations this target acts on, uppercased, as the caller wrote them. */
  readonly associations: readonly string[];
  /** Would the factory act on words from this author? */
  readonly trusts: (author: Author) => boolean;
  /** Keep what a trusted author wrote and count what was dropped. */
  readonly keep: <T>(
    items: readonly T[],
    authorOf: (item: T) => Author,
  ) => TrustedSelection<T>;
  /**
   * The line that stands in for what was dropped, so an agent knows the
   * thread was cut rather than silently seeing less. Empty when nothing was.
   */
  readonly droppedNote: (dropped: number, what: string) => string;
}

/**
 * Build the policy from the caller's comma-separated input. Empty or blank
 * falls back to the default, closed. A value GitHub never sends is kept as
 * written and simply matches nothing, which is also closed: a typo parks work
 * rather than releasing it.
 */
export const trustPolicy = (value: string | undefined): TrustPolicy => {
  const parsed = (value ?? "")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  const associations: readonly string[] =
    parsed.length > 0 ? parsed : [...DEFAULT_TRUSTED_AUTHORS];
  const trusts = (author: Author): boolean =>
    FACTORY_LOGINS.includes(normaliseLogin(author.login)) ||
    associations.includes(authorAssociation(author.association));
  return {
    associations,
    trusts,
    keep: <T>(
      items: readonly T[],
      authorOf: (item: T) => Author,
    ): TrustedSelection<T> => {
      const kept = items.filter((item) => trusts(authorOf(item)));
      return { kept, dropped: items.length - kept.length };
    },
    droppedNote: (dropped: number, what: string): string =>
      dropped > 0
        ? `${dropped} ${what} from untrusted authors were dropped. The factory acts only on ${associations.join(", ")}. If one of them mattered, a maintainer must restate it in a place the factory reads.`
        : "",
  };
};

/** The policy from the environment, for the scripts the workflows run. */
export const trustPolicyFromEnv = (
  env: Record<string, string | undefined> = process.env,
): TrustPolicy => trustPolicy(env[TRUSTED_AUTHORS_VAR]);
