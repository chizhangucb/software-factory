/**
 * A removal ticket says what it deletes in a `## Removes` section of its
 * body, one list item per subject. The gate lets such a ticket delete the
 * tests of the listed subjects and nothing else. No section means the
 * strict gate; the signal is the body, never a label.
 *
 * A subject covers a deleted test when the two share a name, and separator
 * style is not part of a name: `view-log` covers `test/viewlog.test.mjs`,
 * because prose hyphenates what a filename concatenates (chronicle#297).
 *
 * The trade-off, deliberately this way round. Accepted as a false positive:
 * two spellings of one name are one name, so a ticket removing `view-log`
 * also authorises deleting an unrelated `viewLog`'s test. Kept as a false
 * negative: separators are stripped only inside one word, so neither `the
 * view log module` nor `the view.log module` covers `test/viewlog.test.mjs`.
 * Hyphenating a code name in prose is correct English, and refusing it blocks
 * correct work on `factory/test-integrity`, a required check no retry can
 * clear; spelling the name as two English words is not naming the code, and
 * telling a dotted name from a filename plus its extension would need a list
 * of known extensions. A wrong acceptance still faces the red-green proof and
 * the reviewer's verdict, plus the audit while ADR 0003 runs one on every
 * merge; a wrong refusal faces nothing.
 */

const HEADING = /^#{1,6}\s*removes\b/i;
const ANY_HEADING = /^#{1,6}\s/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;

/** Items under the Removes heading, or null when the body has no such section. */
export const parseRemoves = (issueBody: string): string[] | null => {
  const lines = issueBody.split(/\r?\n/);
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start < 0) return null;
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADING.test(line)) break;
    const item = line.match(LIST_ITEM);
    if (item) items.push(item[1]);
  }
  return items;
};

const STOP_NAMES = new Set(["test", "tests", "spec", "specs", "the", "and", "its", "for", "src", "lib"]);
const worthMatching = (candidate: string): boolean => candidate.length >= 3 && !STOP_NAMES.has(candidate);

/** Ends a name: `.` and `/` too, a dot introducing an extension or a `.test` suffix and a slash a new path segment. */
const WORD_BREAK = /[^a-z0-9_-]+/;
/** Ends a piece inside a name: the separators one spelling of it may use. */
const PIECE_BREAK = /[^a-z0-9]+/;

/**
 * The names a string offers: each word's pieces, plus the whole word with its
 * separators stripped whenever it has more than one piece. The stripped form
 * is what lets prose that hyphenates match a filename that concatenates, so
 * `view-log` and `view_log` both offer the name `viewlog`; `viewLog` already
 * is that name once lowercased, and is never split into pieces.
 *
 * Pieces are offered too, which is what makes coverage one-sided: a subject
 * naming `view` covers `test/view-log.test.mjs`, whose pieces include `view`,
 * but not `test/viewlog.test.mjs`, whose only name is `viewlog`. Every form,
 * piece or stripped, passes the same filter, so `test` and `spec` never count
 * as a match however they were spelled.
 */
const names = (s: string): Set<string> => {
  const out = new Set<string>();
  for (const word of s.toLowerCase().split(WORD_BREAK)) {
    const pieces = word.split(PIECE_BREAK).filter((piece) => piece !== "");
    for (const piece of pieces) if (worthMatching(piece)) out.add(piece);
    const stripped = pieces.join("");
    if (pieces.length > 1 && worthMatching(stripped)) out.add(stripped);
  }
  return out;
};

const testPathNames = (testPath: string): Set<string> =>
  names(testPath.replace(/\.[^./]+$/, "").replace(/\.(test|spec)$/, ""));

/** True when the subject names something the test path also names. */
export const subjectCovers = (subject: string, testPath: string): boolean => {
  const pathNames = testPathNames(testPath);
  for (const name of names(subject.replace(/\.[a-z0-9]+\b/gi, ""))) {
    if (pathNames.has(name)) return true;
  }
  return false;
};

export const uncoveredDeletedTests = (deletedTests: readonly string[], subjects: readonly string[]): string[] =>
  deletedTests.filter((p) => !subjects.some((s) => subjectCovers(s, p)));
