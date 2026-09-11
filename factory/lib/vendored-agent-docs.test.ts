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
const VENDORED_PAGES = [
  { page: "docs/agents/domain.md", plugin: `${SETUP_SKILL}/domain.md`, outsidePermittedEdits: (text: string) => text },
  { page: "docs/agents/issue-tracker.md", plugin: `${SETUP_SKILL}/issue-tracker-github.md`, outsidePermittedEdits: blankPrFlag },
  { page: "docs/agents/triage-labels.md", plugin: `${SETUP_SKILL}/triage-labels.md`, outsidePermittedEdits: blankTrackerLabels },
];
const vendored = (page: string) => VENDORED_PAGES.find((entry) => entry.page === page)!;

/** Whether `text`, standing in for `page`, matches the plugin's copy outside the permitted edit. */
const matchesPlugin = (page: string, text: string): boolean => {
  const { plugin, outsidePermittedEdits } = vendored(page);
  return outsidePermittedEdits(text) === outsidePermittedEdits(readRepo(plugin));
};

test("each page the setup skill writes is the plugin's copy, outside the edits the README permits", () => {
  for (const { page, plugin, outsidePermittedEdits } of VENDORED_PAGES) {
    assert.equal(
      outsidePermittedEdits(readRepo(page)),
      outsidePermittedEdits(readRepo(plugin)),
      `${page} has drifted from ${plugin}; prose of the repo's own goes on ${OWN_TRACKER_PAGE}`,
    );
  }
});

test("a permitted edit passes: a relabelled tracker column, and a flipped PR flag", () => {
  const triage = readRepo(vendored("docs/agents/triage-labels.md").plugin);
  // A longer label re-pads its row, and a formatter may redraw the separator.
  const relabelled = triage
    .replace("| `ready-for-agent`          | `ready-for-agent`    |", "| `ready-for-agent` | `status: afk-agent-can-take-it` |")
    .replace(/^\| -+ \| -+ \| -+ \|$/m, "| --- | --- | --- |");
  assert.notEqual(relabelled, triage, "the edit landed");
  assert.ok(matchesPlugin("docs/agents/triage-labels.md", relabelled), "a relabelled tracker column is still the plugin's page");

  const tracker = readRepo(vendored("docs/agents/issue-tracker.md").plugin);
  const flipped = tracker.replace("**PRs as a request surface: no.**", "**PRs as a request surface: yes.**");
  assert.notEqual(flipped, tracker, "the edit landed");
  assert.ok(matchesPlugin("docs/agents/issue-tracker.md", flipped), "a flipped PR flag is still the plugin's page");
});

test("any other edit fails: one word of prose on any page, the other two columns, a flag that is not yes or no", () => {
  const edits = [
    { page: "docs/agents/domain.md", from: "**proceed silently**", to: "**proceed quietly**", what: "a word of domain.md's prose" },
    { page: "docs/agents/issue-tracker.md", from: "for all operations", to: "for most operations", what: "a word of issue-tracker.md's prose" },
    { page: "docs/agents/triage-labels.md", from: "When a skill mentions a role", to: "When a skill names a role", what: "a word of triage-labels.md's prose" },
    { page: "docs/agents/triage-labels.md", from: "Will not be actioned", to: "Will not be done", what: "a cell of the Meaning column" },
    { page: "docs/agents/triage-labels.md", from: "| `wontfix`                  |", to: "| `won't-fix`                |", what: "a cell of the plugin's label column" },
    { page: "docs/agents/issue-tracker.md", from: "request surface: no.**", to: "request surface: maybe.**", what: "a PR flag that is neither yes nor no" },
    // The drift #197 exists for: a repo rule appended to a vendored bullet.
    { page: "docs/agents/issue-tracker.md", from: '--comment "..."`\n', to: '--comment "..."`. Close the moment a PR merges.\n', what: "a repo rule appended to the Close bullet" },
  ];
  for (const { page, from, to, what } of edits) {
    const plugin = readRepo(vendored(page).plugin);
    const edited = plugin.replace(from, to);
    assert.notEqual(edited, plugin, `${what}: the edit landed`);
    assert.ok(!matchesPlugin(page, edited), `${what} is drift on ${page}`);
  }
});

/** Where the repo's own tracker prose lives, beside the vendored `issue-tracker.md`. */
const OWN_TRACKER_PAGE = "docs/agents/tracker-conventions.md";

test("the repo's own tracker rules live on a page a bump never touches", () => {
  const bullets = readRepo(OWN_TRACKER_PAGE).split("\n");
  const close = bullets.filter((line) => line.startsWith("- **Close**"));
  assert.equal(close.length, 1, "the Close convention is one bullet");
  assert.match(close[0]!, /Close the moment a PR merges/, "a ticket closes the moment its PR merges");
  const removals = bullets.filter((line) => line.startsWith("- **Removals**"));
  assert.equal(removals.length, 1, "the Removals convention is one bullet");
  assert.match(removals[0]!, /says so plainly in its body/, "a ticket that removes something says so");
});

test("a session reading CLAUDE.md's ticket bullet reaches that page, and so does an editor of the vendored pages", () => {
  // CLAUDE.md is what every session and every implementer run reads, and a bump never touches it.
  const ticketBullet = readRepo("CLAUDE.md")
    .split("\n")
    .filter((line) => line.startsWith("- **Creating, reading, labelling or closing a ticket**"));
  assert.equal(ticketBullet.length, 1, "CLAUDE.md still has its ticket bullet, once");
  assert.ok(ticketBullet[0]!.includes("`docs/agents/issue-tracker.md`"), "it still names the tracker page");
  assert.ok(ticketBullet[0]!.includes(`\`${OWN_TRACKER_PAGE}\``), `and names ${OWN_TRACKER_PAGE} beside it`);
  // The README is where the verbatim rule lives, so it says where prose goes instead.
  assert.ok(readRepo("factory/plugins/README.md").includes(`\`${OWN_TRACKER_PAGE}\``), `factory/plugins/README.md names ${OWN_TRACKER_PAGE}`);
});
