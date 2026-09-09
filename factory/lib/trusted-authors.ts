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
 * Every place the factory reads words an agent will act on. The list is closed
 * and it lives here, because which channels carry the factory's own voice is a
 * policy question, not a call site's (#80).
 *
 * A call site names a channel. It cannot describe one, so it has no way to say
 * "and exempt the factory login here", which is the sentence both of #52's
 * shipped bugs were written in.
 */
export const CHANNELS = [
  /** A top-level comment on a PR. Anyone can write one, and so can any bot. */
  "pr-comment",
  /** A submitted review's body. `agent-review.yml` posts its verdict here. */
  "review-summary",
  /** An inline review-thread comment. The reviewer's findings land here. */
  "review-thread",
  /** A comment on a ticket. Anyone can write one on a public target. */
  "ticket-comment",
  /** Whoever opened the ticket the dispatcher is about to run. */
  "ticket-author",
  /** Whoever wrote the parent spec a ticket hangs off. */
  "parent-spec",
  /** The retry marker comment an implement run reads its last failure from. */
  "retry-marker",
] as const;

/** One of the channels above, and nothing else. */
export type Channel = (typeof CHANNELS)[number];

/**
 * The factory's own voice. `agent-review.yml` posts its review summary and its
 * thread comments with GITHUB_TOKEN, and GitHub reports
 * `author_association: NONE` for that identity on every repo, so the
 * association alone would drop the reviewer's own findings before implement-pr,
 * whose whole job is to address them, ever read them. The login is spelled two
 * ways across the reads (`github-actions[bot]` on REST, `github-actions` on
 * gh's JSON and on GraphQL), so it is normalised before the comparison.
 * Comments posted with FACTORY_PAT come from the owner and need no exemption.
 */
const FACTORY_LOGINS: readonly string[] = ["github-actions"];

/**
 * The only channels the factory itself writes, and so the only ones where the
 * login above means anything.
 *
 * That login is NOT proof of trust. `github-actions` is what every workflow in
 * the target posts under, the factory's and the target's own alike, and a
 * coverage reporter or size-diff bot routinely quotes a fork PR's branch name,
 * commit message or failing test output. Honouring the login wherever it
 * appeared would launder a stranger's words straight through this control.
 *
 * So the exemption is decided here, against this list, rather than by whichever
 * call site is doing the reading. Both of #52's shipped bugs were a call site
 * getting this choice wrong: first every channel judged on the association
 * alone, which dropped the reviewer's own findings before implement-pr read
 * them; then every channel honouring the login, which trusted every bot in the
 * target.
 */
const FACTORY_WRITTEN_CHANNELS: readonly Channel[] = [
  "review-summary",
  "review-thread",
];

const normaliseLogin = (login: string | null | undefined): string =>
  String(login ?? "")
    .toLowerCase()
    .replace(/\[bot\]$/, "");

/**
 * Who wrote something, as the policy judges it. Both fields on every channel:
 * a read reports what it has, and the policy decides what that is worth here.
 * They are required rather than optional so that an accessor cannot quietly
 * report less on one channel than on another.
 */
export interface Author {
  readonly association: string | null | undefined;
  readonly login: string | null | undefined;
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
  /** Would the factory act on words this author wrote on this channel? */
  readonly trusts: (channel: Channel, author: Author) => boolean;
  /** Keep what a trusted author wrote on this channel, and count what was dropped. */
  readonly keep: <T>(
    channel: Channel,
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
  const trusts = (channel: Channel, author: Author): boolean =>
    (FACTORY_WRITTEN_CHANNELS.includes(channel) &&
      FACTORY_LOGINS.includes(normaliseLogin(author.login))) ||
    associations.includes(authorAssociation(author.association));
  return {
    associations,
    trusts,
    keep: <T>(
      channel: Channel,
      items: readonly T[],
      authorOf: (item: T) => Author,
    ): TrustedSelection<T> => {
      const kept = items.filter((item) => trusts(channel, authorOf(item)));
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
