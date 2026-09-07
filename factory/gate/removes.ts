/**
 * A removal ticket says what it deletes in a `## Removes` section of its
 * body, one list item per subject. The gate lets such a ticket delete the
 * tests of the listed subjects and nothing else. No section means the
 * strict gate; the signal is the body, never a label.
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
const tokens = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t)),
  );

const testPathTokens = (testPath: string): Set<string> => {
  const withoutExt = testPath.replace(/\.[^./]+$/, "").replace(/\.(test|spec)$/, "");
  return tokens(withoutExt);
};

/** True when the subject names something the test path also names. */
export const subjectCovers = (subject: string, testPath: string): boolean => {
  const subjectTokens = tokens(subject.replace(/\.[a-z0-9]+\b/gi, ""));
  const pathTokens = testPathTokens(testPath);
  for (const t of subjectTokens) if (pathTokens.has(t)) return true;
  return false;
};

export const uncoveredDeletedTests = (deletedTests: readonly string[], subjects: readonly string[]): string[] =>
  deletedTests.filter((p) => !subjects.some((s) => subjectCovers(s, p)));
