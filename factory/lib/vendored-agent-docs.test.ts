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
