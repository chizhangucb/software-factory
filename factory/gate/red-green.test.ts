import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNameStatus } from "./changed-files";
import { redGreenPlan, redGreenVerdict } from "./red-green";

test("the plan lists added and modified test files, never deleted ones", () => {
  const plan = redGreenPlan(
    parseNameStatus("A\ttest/truncate.test.js\nM\ttest/slugify.test.js\nD\ttest/old.test.js\nR100\ttest/a.test.js\ttest/b.test.js\nM\tsrc/x.js\n"),
    null,
  );
  assert.deepEqual(plan, {
    run: true,
    testFiles: ["test/truncate.test.js", "test/slugify.test.js", "test/b.test.js"],
    vacuous: false,
    reason: "3 changed test file(s)",
  });
});

test("docs-only diffs pass vacuously", () => {
  const plan = redGreenPlan(parseNameStatus("M\tREADME.md\nA\tdocs/guide.md\n"), null);
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "docs only, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("a config-only or workflow-only diff passes vacuously", () => {
  const plan = redGreenPlan(parseNameStatus("M\t.github/workflows/ci.yml\nM\tpackage.json\n"), null);
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "config only, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("a diff of docs and config together passes vacuously too", () => {
  const plan = redGreenPlan(parseNameStatus("M\tREADME.md\nM\t.github/workflows/ci.yml\n"), null);
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "no source change, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("config next to a real source change with no test still fails", () => {
  const plan = redGreenPlan(parseNameStatus("M\t.github/workflows/ci.yml\nM\tpackage.json\nM\tsrc/slugify.js\n"), null);
  assert.equal(plan.vacuous, false);
  const verdict = redGreenVerdict(plan);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /no test file added or changed/);
});

test("a Removes ticket that changes no tests passes vacuously", () => {
  const plan = redGreenPlan(parseNameStatus("D\tsrc/slugify.js\nD\ttest/slugify.test.js\n"), ["slugify"]);
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "removal ticket, no tests changed" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("a source change with no test change fails when the ticket has no Removes section", () => {
  const plan = redGreenPlan(parseNameStatus("M\tsrc/slugify.js\n"), null);
  assert.equal(plan.run, false);
  assert.equal(plan.vacuous, false);
  const verdict = redGreenVerdict(plan);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /no test file added or changed/);
});

test("with results: red on base then green on head passes", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\nM\tsrc/x.js\n"), null);
  assert.deepEqual(
    redGreenVerdict(plan, { base: { exitCode: 1, output: "not ok" }, head: { exitCode: 0, output: "ok" } }),
    { ok: true, reasons: [] },
  );
});

test("with results: a test that already passes on base fails as a stub", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\nM\tsrc/x.js\n"), null);
  const verdict = redGreenVerdict(plan, { base: { exitCode: 0, output: "ok" }, head: { exitCode: 0, output: "ok" } });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /pass on the base/);
});

test("with results: a test that fails on head fails", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\n"), null);
  const verdict = redGreenVerdict(plan, { base: { exitCode: 1, output: "" }, head: { exitCode: 1, output: "" } });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /fail on the head/);
});

test("a plan that should run but has no results is a failure, never a silent pass", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\n"), null);
  assert.equal(redGreenVerdict(plan).ok, false);
});
