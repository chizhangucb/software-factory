import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNameStatus } from "./changed-files";
import { redGreenPlan, redGreenVerdict } from "./red-green";

test("the plan lists added and modified test files, never deleted ones", () => {
  const plan = redGreenPlan(
    parseNameStatus("A\ttest/truncate.test.js\nM\ttest/slugify.test.js\nD\ttest/old.test.js\nR100\ttest/a.test.js\ttest/b.test.js\nM\tsrc/x.js\n"),
  );
  assert.deepEqual(plan, {
    run: true,
    testFiles: ["test/truncate.test.js", "test/slugify.test.js", "test/b.test.js"],
    vacuous: false,
    reason: "3 changed test file(s)",
  });
});

test("docs-only diffs pass vacuously", () => {
  const plan = redGreenPlan(parseNameStatus("M\tREADME.md\nA\tdocs/guide.md\n"));
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "docs only, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("a config-only or workflow-only diff passes vacuously", () => {
  const plan = redGreenPlan(parseNameStatus("M\t.github/workflows/ci.yml\nM\tpackage.json\n"));
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "config only, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("a diff of docs and config together passes vacuously too", () => {
  const plan = redGreenPlan(parseNameStatus("M\tREADME.md\nM\t.github/workflows/ci.yml\n"));
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "no source change, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("config next to a real source change with no test still fails", () => {
  const plan = redGreenPlan(parseNameStatus("M\t.github/workflows/ci.yml\nM\tpackage.json\nM\tsrc/slugify.js\n"));
  assert.equal(plan.vacuous, false);
  const verdict = redGreenVerdict(plan);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /no test file added or changed/);
});

test("a deleted file with no test added or changed passes vacuously, saying nothing was proved", () => {
  const plan = redGreenPlan(parseNameStatus("D\tsrc/slugify.js\nD\ttest/slugify.test.js\n"));
  assert.deepEqual(plan, {
    run: false,
    testFiles: [],
    vacuous: true,
    reason: "files deleted, no test added or changed, nothing proved",
  });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [] });
});

test("a deleted source file next to a changed one passes vacuously too", () => {
  const plan = redGreenPlan(parseNameStatus("D\tsrc/old.js\nM\tsrc/index.js\n"));
  assert.equal(plan.vacuous, true);
  assert.match(plan.reason, /nothing proved/);
});

test("a test renamed out of the test tree counts as a deleted file", () => {
  const plan = redGreenPlan(parseNameStatus("R100\ttest/slugify.test.js\tsrc/slugify.old.js\nM\tsrc/slugify.js\n"));
  assert.equal(plan.run, false);
  assert.equal(plan.vacuous, true);
});

test("a deleted file never hides a changed test from the run", () => {
  const plan = redGreenPlan(parseNameStatus("D\tsrc/old.js\nA\ttest/new.test.js\n"));
  assert.equal(plan.run, true);
  assert.deepEqual(plan.testFiles, ["test/new.test.js"]);
});

test("a source change with no deleted file and no test change still fails", () => {
  const plan = redGreenPlan(parseNameStatus("M\tsrc/slugify.js\n"));
  assert.equal(plan.run, false);
  assert.equal(plan.vacuous, false);
  const verdict = redGreenVerdict(plan);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /no test file added or changed/);
});

test("with results: red on base then green on head passes", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\nM\tsrc/x.js\n"));
  assert.deepEqual(
    redGreenVerdict(plan, { base: { exitCode: 1, output: "not ok" }, head: { exitCode: 0, output: "ok" } }),
    { ok: true, reasons: [] },
  );
});

test("with results: a test that already passes on base fails as a stub", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\nM\tsrc/x.js\n"));
  const verdict = redGreenVerdict(plan, { base: { exitCode: 0, output: "ok" }, head: { exitCode: 0, output: "ok" } });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /pass on the base/);
});

test("with results: a test that fails on head fails", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\n"));
  const verdict = redGreenVerdict(plan, { base: { exitCode: 1, output: "" }, head: { exitCode: 1, output: "" } });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /fail on the head/);
});

test("a plan that should run but has no results is a failure, never a silent pass", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\n"));
  assert.equal(redGreenVerdict(plan).ok, false);
});
