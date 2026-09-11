/**
 * The three pages under `docs/agents/` that the plugin's `setup-matt-pocock-skills` skill writes
 * (#197). `factory/plugins/README.md` keeps them the plugin's bytes, so a re-run of the skill is a
 * no-op and a bump can re-copy them, which means prose a repo adds there is prose the next bump
 * silently deletes. Four PRs added rules to `issue-tracker.md` after that rule existed, and four
 * reviews passed them, because the rule lives on a page nobody opens while editing the page it
 * governs. So this test holds it, and the repo's own tracker prose has a page a bump never touches.
 * The files are the fixture, in the style of `onboard/judged-path-instruction.test.ts`.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";

/** A file in this repo, by its path from the root. */
const readRepo = (file: string): string => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

/** The one line of `file` starting with `prefix`, failing unless there is exactly one. */
const theOneLine = (file: string, prefix: string): string => {
  const lines = readRepo(file).split("\n").filter((line) => line.startsWith(prefix));
  assert.equal(lines.length, 1, `${file} has one line starting ${prefix}`);
  return lines[0]!;
};

/** Where the repo's own tracker prose lives, beside the vendored `issue-tracker.md`. */
const OWN_TRACKER_PAGE = "docs/agents/tracker-conventions.md";

const SETUP_SKILL = "factory/plugins/mattpocock-skills/skills/engineering/setup-matt-pocock-skills";

/*
 * The two edits `factory/plugins/README.md` permits, and nothing more. A byte comparison would
 * fail the first permitted edit and get deleted for it; so each is blanked out on both sides
 * before comparing, and every other byte still has to match.
 *
 * 1. The triage table's right-hand column in `triage-labels.md`: the one headed "Label in our
 *    tracker", which the plugin's page itself says to edit to match the repo's vocabulary. Its
 *    cells are blanked, and every row's cells trimmed, since a longer label re-pads the table.
 *    The "Meaning" column beside it is prose, and still compared.
 * 2. The PR-surface flag in `issue-tracker.md`: `yes` or `no`, and no other word.
 */
const TRACKER_LABEL_COLUMN = "Label in our tracker";

const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

const blankTrackerLabels = (text: string): string => {
  const lines = text.split("\n");
  const header = lines.findIndex((line) => line.startsWith("|") && cells(line).includes(TRACKER_LABEL_COLUMN));
  if (header === -1) return text;
  const column = cells(lines[header]!).indexOf(TRACKER_LABEL_COLUMN);
  let inTable = true;
  return lines
    .map((line, index) => {
      if (index < header) return line;
      inTable &&= line.startsWith("|");
      if (!inTable) return line;
      const row = cells(line).map((cell) => (/^:?-+:?$/.test(cell) ? "---" : cell));
      if (index > header + 1) row[column] = "<label>";
      return row.join(" | ");
    })
    .join("\n");
};

const blankPrFlag = (text: string): string =>
  text.replace(/^\*\*PRs as a request surface: (?:yes|no)\.\*\*/m, "**PRs as a request surface: <flag>.**");

/** Each page the skill writes, the plugin file it is a copy of, and its permitted edit blanked. */
const VENDORED = {
  domain: { page: "docs/agents/domain.md", plugin: `${SETUP_SKILL}/domain.md`, outsidePermittedEdits: (text: string) => text },
  tracker: { page: "docs/agents/issue-tracker.md", plugin: `${SETUP_SKILL}/issue-tracker-github.md`, outsidePermittedEdits: blankPrFlag },
  triage: { page: "docs/agents/triage-labels.md", plugin: `${SETUP_SKILL}/triage-labels.md`, outsidePermittedEdits: blankTrackerLabels },
};
type VendoredPage = (typeof VENDORED)[keyof typeof VENDORED];

/** Whether `text`, standing in for a vendored page, matches the plugin's copy outside the permitted edit. */
const matchesPlugin = ({ plugin, outsidePermittedEdits }: VendoredPage, text: string): boolean =>
  outsidePermittedEdits(text) === outsidePermittedEdits(readRepo(plugin));

test("each page the setup skill writes is the plugin's copy, outside the edits the README permits", () => {
  // Compared with assert.equal rather than matchesPlugin, so a failure prints the diff.
  for (const { page, plugin, outsidePermittedEdits } of Object.values(VENDORED)) {
    assert.equal(
      outsidePermittedEdits(readRepo(page)),
      outsidePermittedEdits(readRepo(plugin)),
      `${page} has drifted from ${plugin}; prose of the repo's own goes on ${OWN_TRACKER_PAGE}`,
    );
  }
});

test("a permitted edit passes: a relabelled tracker column, and a flipped PR flag", () => {
  const triage = readRepo(VENDORED.triage.plugin);
  // A longer label re-pads its row, and a formatter may redraw the separator.
  const relabelled = triage
    .replace("| `ready-for-agent`          | `ready-for-agent`    |", "| `ready-for-agent` | `status: afk-agent-can-take-it` |")
    .replace(/^\| -+ \| -+ \| -+ \|$/m, "| --- | --- | --- |");
  assert.notEqual(relabelled, triage, "the edit landed");
  assert.ok(matchesPlugin(VENDORED.triage, relabelled), "a relabelled tracker column is still the plugin's page");

  const tracker = readRepo(VENDORED.tracker.plugin);
  const flipped = tracker.replace("**PRs as a request surface: no.**", "**PRs as a request surface: yes.**");
  assert.notEqual(flipped, tracker, "the edit landed");
  assert.ok(matchesPlugin(VENDORED.tracker, flipped), "a flipped PR flag is still the plugin's page");
});

test("any other edit fails: one word of prose on any page, the other two columns, a flag that is not yes or no", () => {
  const edits = [
    { on: VENDORED.domain, from: "**proceed silently**", to: "**proceed quietly**", what: "a word of domain.md's prose" },
    { on: VENDORED.tracker, from: "for all operations", to: "for most operations", what: "a word of issue-tracker.md's prose" },
    { on: VENDORED.triage, from: "When a skill mentions a role", to: "When a skill names a role", what: "a word of triage-labels.md's prose" },
    { on: VENDORED.triage, from: "Will not be actioned", to: "Will not be done", what: "a cell of the Meaning column" },
    { on: VENDORED.triage, from: "| `wontfix`                  |", to: "| `won't-fix`                |", what: "a cell of the plugin's label column" },
    { on: VENDORED.tracker, from: "request surface: no.**", to: "request surface: maybe.**", what: "a PR flag that is neither yes nor no" },
    // The drift #197 exists for: a repo rule appended to a vendored bullet.
    { on: VENDORED.tracker, from: '--comment "..."`\n', to: '--comment "..."`. Close the moment a PR merges.\n', what: "a repo rule appended to the Close bullet" },
  ];
  for (const { on, from, to, what } of edits) {
    const plugin = readRepo(on.plugin);
    const edited = plugin.replace(from, to);
    assert.notEqual(edited, plugin, `${what}: the edit landed`);
    assert.ok(!matchesPlugin(on, edited), `${what} is drift on ${on.page}`);
  }
});

test("the repo's own tracker rules live on a page a bump never touches", () => {
  assert.match(theOneLine(OWN_TRACKER_PAGE, "- **Close**"), /Close the moment a PR merges/, "a ticket closes the moment its PR merges");
  assert.match(theOneLine(OWN_TRACKER_PAGE, "- **Removals**"), /says so plainly in its body/, "a ticket that removes something says so");
});

test("a session reading CLAUDE.md's ticket bullet reaches that page, and so does an editor of the vendored pages", () => {
  // CLAUDE.md is what every session and every implementer run reads, and a bump never touches it.
  const ticketBullet = theOneLine("CLAUDE.md", "- **Creating, reading, labelling or closing a ticket**");
  assert.ok(ticketBullet.includes("`docs/agents/issue-tracker.md`"), "it still names the tracker page");
  assert.ok(ticketBullet.includes(`\`${OWN_TRACKER_PAGE}\``), `and names ${OWN_TRACKER_PAGE} beside it`);
  // The README is where the verbatim rule lives, so it says where prose goes instead.
  assert.ok(readRepo("factory/plugins/README.md").includes(`\`${OWN_TRACKER_PAGE}\``), `factory/plugins/README.md names ${OWN_TRACKER_PAGE}`);
});

test("ADR 0003's closing-keyword bullet says where the rule lives now", () => {
  // Its #181 correction says "the page" requires the keyword, meaning issue-tracker.md, which no
  // longer holds it. ADRs are corrected in place and dated, so a note beside it names the new home.
  const bullet = theOneLine("docs/adr/0003-gate-in-ci-auto-merge-with-audit.md", "- **The convention against closing keywords narrows.**");
  assert.match(bullet, new RegExp(`Corrected 2026-09-11 \\(#197\\): [^\\n]*\`${OWN_TRACKER_PAGE}\``), `and a dated correction names ${OWN_TRACKER_PAGE}`);
});
