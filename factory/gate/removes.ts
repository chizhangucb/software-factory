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
 * The trade-off, and it is deliberate. Stripping separators can only make
 * matching looser, and a looser gate is the opposite failure: a ticket that
 * authorises deleting a test it never named. So the looseness stops at whole
 * names, never substrings. Two spellings of one name become one name, which
 * is both the reach and the false positive: a ticket removing `view-log`
 * would also authorise deleting the test of an unrelated `viewLog`.
 * Separators are stripped only inside a word, which is the false negative:
 * the subject `the view log module` still does not cover
 * `test/viewlog.test.mjs`, and `view` alone never covers `viewlog`.
 *
 * That is the right way round. Hyphenating a code name in prose is correct
 * English, so refusing it blocked correct work on `factory/test-integrity`,
 * a required check no retry can clear. A subject that spells the name as two
 * English words is not naming the code at all, so asking it to is a contract
 * a ticket author can read: name the subject the way the code spells it, in
 * any separator style. And a wrong acceptance still faces the red-green
 * proof, the reviewer's verdict and the audit (ADR 0003), where a wrong
 * refusal faces nothing.
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

const STOP_TOKENS = new Set(["test", "tests", "spec", "specs", "the", "and", "its", "for", "src", "lib"]);
const worthMatching = (name: string): boolean => name.length >= 3 && !STOP_TOKENS.has(name);

/**
 * One name's worth of text. `-` and `_` live inside a name; everything else,
 * `.` and `/` included, ends one, because a dot introduces an extension or a
 * `.test` suffix and a slash a new path segment.
 */
const WORDS = /[^a-z0-9_-]+/;
const PIECES = /[^a-z0-9]+/;

/**
 * The names a string offers: each word's pieces, plus the whole word with its
 * separators stripped whenever it has more than one piece. The stripped form
 * is what lets prose that hyphenates match a filename that concatenates, so
 * `view-log`, `view_log` and `viewLog` all offer the name `viewlog`.
 *
 * Separators are stripped only inside a word, never across whitespace, and
 * every stripped form passes the same filter its pieces do, so `test` and
 * `spec` still never count as a match.
 */
const names = (s: string): Set<string> => {
  const out = new Set<string>();
  for (const word of s.toLowerCase().split(WORDS)) {
    const pieces = word.split(PIECES).filter((piece) => piece !== "");
    for (const piece of pieces) if (worthMatching(piece)) out.add(piece);
    if (pieces.length > 1 && worthMatching(pieces.join(""))) out.add(pieces.join(""));
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
