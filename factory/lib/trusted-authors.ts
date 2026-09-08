/**
 * Whose words the factory will act on.
 *
 * A ticket body and its comments are the implementer's instructions, so on a
 * public target, where anyone can open an issue or comment on one, the
 * factory reads only text written by an author it trusts. Trust is GitHub's
 * `author_association` on the issue or comment, and the default is the repo
 * owner alone. Targets widen it with `trusted_author_associations`.
 *
 * One module so the dispatcher and the run scripts cannot drift apart on the
 * policy. No imports, and callers may import it with or without the `.ts`
 * extension, so the strip-types jobs (dispatch) and the tsx jobs (implement,
 * review) both get it.
 *
 * On an org-owned target nobody is `OWNER`: the owner's own issues read
 * `MEMBER`. Set `OWNER,MEMBER` there (#26 moves these repos to an org).
 */

/** The default: only the repo owner's own words. */
export const DEFAULT_TRUSTED_AUTHORS = ["OWNER"] as const;

/** The env var the workflows pass the caller's input through. */
export const TRUSTED_AUTHORS_VAR = "TRUSTED_AUTHOR_ASSOCIATIONS";

/**
 * Parse the caller's comma-separated input. Empty or blank falls back to the
 * default, closed. A value GitHub never sends is kept as written and simply
 * matches nothing, which is also closed: a typo parks work rather than
 * releasing it.
 */
export const parseTrustedAuthors = (
  value: string | undefined,
): readonly string[] => {
  const parsed = (value ?? "")
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  return parsed.length > 0 ? parsed : DEFAULT_TRUSTED_AUTHORS;
};

/** The trusted list from the environment, for the scripts that take no input. */
export const trustedAuthorsFromEnv = (
  env: Record<string, string | undefined> = process.env,
): readonly string[] => parseTrustedAuthors(env[TRUSTED_AUTHORS_VAR]);

/**
 * Is this author trusted? An absent association is an outsider: GitHub always
 * sends one, so a payload without it is a shape we do not recognise.
 */
export const isTrustedAuthor = (
  association: string | null | undefined,
  trusted: readonly string[] = DEFAULT_TRUSTED_AUTHORS,
): boolean => trusted.includes(String(association ?? "NONE").toUpperCase());
