import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNameStatus } from "./changed-files";
import { redGreenPlan, redGreenVerdict, type FileRun } from "./red-green";
import type { Runnability } from "./unrunnable";

/** One file's outcome on each side; the output is the driver's business, not the verdict's. */
const fileRun = (path: string, base: number, head: number, runnability: Runnability = "ran"): FileRun => ({
  path,
  base: { exitCode: base, output: "" },
  head: { exitCode: head, output: "" },
  runnability,
});

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
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [], unrunnable: [], detail: plan.reason });
});

test("a config-only or workflow-only diff passes vacuously", () => {
  const plan = redGreenPlan(parseNameStatus("M\t.github/workflows/ci.yml\nM\tpackage.json\n"));
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "config only, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [], unrunnable: [], detail: plan.reason });
});

test("a diff of docs and config together passes vacuously too", () => {
  const plan = redGreenPlan(parseNameStatus("M\tREADME.md\nM\t.github/workflows/ci.yml\n"));
  assert.deepEqual(plan, { run: false, testFiles: [], vacuous: true, reason: "no source change, nothing to prove" });
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [], unrunnable: [], detail: plan.reason });
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
  assert.deepEqual(redGreenVerdict(plan), { ok: true, reasons: [], unrunnable: [], detail: plan.reason });
});

test("a deleted source file next to a changed one passes vacuously too", () => {
  const plan = redGreenPlan(parseNameStatus("D\tsrc/old.js\nM\tsrc/index.js\n"));
  assert.equal(plan.vacuous, true);
  assert.match(plan.reason, /nothing proved/);
});

test("a deleted doc or config file next to a source change with no test still fails", () => {
  for (const diff of ["M\tsrc/x.js\nD\tdocs/old.md\n", "M\tsrc/x.js\nD\t.eslintrc\n", "M\tsrc/x.js\nD\tpackage-lock.json\n"]) {
    const plan = redGreenPlan(parseNameStatus(diff));
    assert.equal(plan.vacuous, false, diff);
    assert.equal(redGreenVerdict(plan).ok, false, diff);
  }
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

test("with runs: a file red on the base and green on the head passes", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\nM\tsrc/x.js\n"));
  assert.deepEqual(redGreenVerdict(plan, [fileRun("test/x.test.js", 1, 0)]), {
    ok: true,
    reasons: [],
    unrunnable: [],
    detail: "1 changed test file(s); test/x.test.js base 1 head 0",
  });
});

test("with runs: a test that already passes on the base fails as a stub", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\nM\tsrc/x.js\n"));
  const verdict = redGreenVerdict(plan, [fileRun("test/x.test.js", 0, 0)]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /pass on the base/);
});

test("with runs: one changed test file red on the base is enough, the rest may pass there", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/new.test.js\nM\ttest/tidied.test.js\nM\tsrc/x.js\n"));
  const runs = [fileRun("test/new.test.js", 1, 0), fileRun("test/tidied.test.js", 0, 0)];
  assert.deepEqual(redGreenVerdict(plan, runs), {
    ok: true,
    reasons: [],
    unrunnable: [],
    detail: "2 changed test file(s); test/new.test.js base 1 head 0, test/tidied.test.js base 0 head 0",
  });
});

test("with runs: a file that fails on the head fails the check, and no file that passed is named", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/broken.test.js\nM\ttest/healthy.test.js\n"));
  const runs = [fileRun("test/broken.test.js", 1, 1), fileRun("test/healthy.test.js", 1, 0)];
  const verdict = redGreenVerdict(plan, runs);
  assert.equal(verdict.ok, false);
  // The whole list, because the bug this replaces was a failure naming a file that passed.
  assert.deepEqual(verdict.reasons, ["changed test fails on the head (exit 1): test/broken.test.js"]);
});

test("with runs: a plan that should run but has no runs is a failure, never a silent pass", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/x.test.js\n"));
  assert.equal(redGreenVerdict(plan).ok, false);
});

test("a file the merge gate could not run is passed over rather than failed, and named", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/browser.spec.js\nM\ttest/unit.test.js\n"));
  const runs = [fileRun("test/browser.spec.js", 1, 1, "unrunnable"), fileRun("test/unit.test.js", 1, 0)];
  const verdict = redGreenVerdict(plan, runs);
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.unrunnable, ["test/browser.spec.js"]);
});

test("a file the merge gate could not run proves nothing on the base either, so it does not meet the base-red requirement", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/browser.spec.js\nM\ttest/unit.test.js\n"));
  // The unrunnable file died on the base too, which is not a test going red there.
  const runs = [fileRun("test/browser.spec.js", 1, 1, "unrunnable"), fileRun("test/unit.test.js", 0, 0)];
  const verdict = redGreenVerdict(plan, runs);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /pass on the base/);
  assert.doesNotMatch(verdict.reasons[0], /browser/);
});

test("a change whose every touched test file is unrunnable passes, saying plainly that nothing was proved", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/one.spec.js\nM\ttest/two.spec.js\nM\tsrc/x.js\n"));
  const runs = [fileRun("test/one.spec.js", 1, 1, "unrunnable"), fileRun("test/two.spec.js", 1, 1, "unrunnable")];
  const verdict = redGreenVerdict(plan, runs);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.reasons, []);
  assert.deepEqual(verdict.unrunnable, ["test/one.spec.js", "test/two.spec.js"]);
  assert.match(verdict.detail, /nothing was proved/);
  assert.match(verdict.detail, /test\/one\.spec\.js, test\/two\.spec\.js/);
});

test("the detail names what was passed over alongside what ran", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/browser.spec.js\nM\ttest/unit.test.js\n"));
  const runs = [fileRun("test/browser.spec.js", 1, 1, "unrunnable"), fileRun("test/unit.test.js", 1, 0)];
  const detail = redGreenVerdict(plan, runs).detail;
  assert.match(detail, /test\/unit\.test\.js base 1 head 0/);
  assert.match(detail, /could not run: test\/browser\.spec\.js/);
  assert.doesNotMatch(detail, /nothing was proved/);
});

test("one real failure beside a file that could not be run fails, naming only the real one", () => {
  const plan = redGreenPlan(parseNameStatus("A\ttest/browser.spec.js\nM\ttest/unit.test.js\n"));
  const runs = [fileRun("test/browser.spec.js", 1, 1, "unrunnable"), fileRun("test/unit.test.js", 1, 1)];
  const verdict = redGreenVerdict(plan, runs);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ["changed test fails on the head (exit 1): test/unit.test.js"]);
});

test("with a caller's own test command nothing is passed over: a dying file fails and names only itself", () => {
  // The merge gate cannot read that command's output, so every file counts as having run.
  const plan = redGreenPlan(parseNameStatus("A\ttest/browser.spec.js\nM\ttest/unit.test.js\n"));
  const runs = [fileRun("test/browser.spec.js", 1, 1, "unknown"), fileRun("test/unit.test.js", 1, 0, "unknown")];
  const verdict = redGreenVerdict(plan, runs);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.reasons, ["changed test fails on the head (exit 1): test/browser.spec.js"]);
  assert.deepEqual(verdict.unrunnable, []);
});
