/**
 * `scripts/onboard.sh` seen the way a maintainer sees it: what it prints on the way
 * past, and the ruleset payload it hands GitHub. The script is bash and talks to `gh`,
 * so the one honest test runs it with a stub `gh` first on PATH.
 *
 * That makes this the third test in the repo to spawn a process, after
 * `factory/dispatch/gh-read.test.ts` (real jq) and
 * `factory/guards/require-worktree-isolation.test.ts` (the hook). Still no network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const onboard = fileURLToPath(new URL("../../scripts/onboard.sh", import.meta.url));
const target = "chizhangucb/factory-fixture";
const factoryChecks = ["factory/verdict", "factory/red-green", "factory/test-integrity"];

/**
 * A stub `gh`: it answers the reads `onboard.sh` makes and keeps the ruleset payload it
 * is handed. `GH_EXISTING_ID` is how a test picks the create path (unset) or the update
 * path (an id). A call it does not recognise fails, so a reshaped `gh` line breaks the
 * test loudly instead of degrading into an empty answer.
 */
const stubGh = `#!/usr/bin/env bash
args="$*"
case "$args" in
  "label create"*|"repo edit"*) ;;
  "api --method POST"*) cat > "$GH_PAYLOAD"; echo 4242 ;;
  "api --method PUT"*)  cat > "$GH_PAYLOAD" ;;
  *"--jq .default_branch") echo main ;;
  *"/rulesets --jq"*) echo "\${GH_EXISTING_ID:-}" ;;
  *) echo "stub gh: unexpected call: $args" >&2; exit 1 ;;
esac
exit 0
`;

/** A temp directory holding the stub `gh`, and the environment that reaches it. */
const sandbox = (existingRulesetId?: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-"));
  fs.writeFileSync(path.join(dir, "gh"), stubGh, { mode: 0o755 });
  const payloadFile = path.join(dir, "payload.json");
  return {
    dir,
    payloadFile,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_PAYLOAD: payloadFile,
      ...(existingRulesetId === undefined ? {} : { GH_EXISTING_ID: existingRulesetId }),
    },
  };
};

/** The contexts the script asked GitHub to require, read back off the payload it sent. */
const requiredChecks = (payloadFile: string): string[] => {
  if (!fs.existsSync(payloadFile)) return [];
  const rules = JSON.parse(fs.readFileSync(payloadFile, "utf8")).rules;
  const checks = rules.find((rule: { type: string }) => rule.type === "required_status_checks");
  return (checks?.parameters.required_status_checks ?? []).map((c: { context: string }) => c.context);
};

type Run = {
  code: number;
  /** stdout and stderr interleaved, which is the one stream a terminal shows. */
  output: string;
  requiredChecks: string[];
};

/** Onboard the target with these own checks. `existingRulesetId` picks the update path. */
const onboardWith = (ownChecks: string[], existingRulesetId?: string): Run => {
  const box = sandbox(existingRulesetId);
  try {
    const result = spawnSync("/bin/sh", ["-c", 'exec "$0" "$@" 2>&1', onboard, target, ...ownChecks], {
      encoding: "utf8",
      env: box.env,
    });
    if (result.error) assert.fail(`onboard.sh did not run: ${result.error.message}`);
    return { code: result.status ?? -1, output: result.stdout, requiredChecks: requiredChecks(box.payloadFile) };
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
};

const warningLines = (output: string): number[] =>
  output.split("\n").flatMap((line, i) => (/WARNING: no own check/.test(line) ? [i] : []));

test("with an own check, the ruleset requires it next to the factory's three and nothing warns", () => {
  const run = onboardWith(["check"]);
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.doesNotMatch(run.output, /WARNING/, "a target whose own CI is required has nothing to warn about");
});

test("with no own check the ruleset gates on the factory's checks alone, and the script says so", () => {
  const run = onboardWith([]);
  assert.equal(run.code, 0, "a target with no CI can still be onboarded; the warning is the point");
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.output, /WARNING/);
});

test("the warning names the consequence, not just the omission", () => {
  const { output } = onboardWith([]);
  assert.match(output, /factory's checks alone/i, "the consequence is what a maintainer needs to read");
  assert.match(output, /own CI/i);
});

test("the warning is unmissable: it comes before the ruleset write and again after it", () => {
  const { output } = onboardWith([]);
  const written = output.split("\n").findIndex((line) => /ruleset factory created/.test(line));
  const warnings = warningLines(output);
  assert.ok(written >= 0, "the script must still say what it did");
  assert.ok(
    warnings.some((line) => line < written) && warnings.some((line) => line > written),
    `a warning only above the ruleset line scrolls away: warnings at ${warnings}, ruleset at ${written}`,
  );
});

test("the warning goes to stderr, so a maintainer who pipes stdout into a log still sees it", () => {
  const box = sandbox();
  try {
    const result = spawnSync(onboard, [target], { encoding: "utf8", env: box.env });
    assert.match(result.stderr, /WARNING: no own check/);
    assert.doesNotMatch(result.stdout, /WARNING/);
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test("a factory check handed back as an own check is still the factory's, so it warns", () => {
  const run = onboardWith(["factory/verdict"]);
  assert.equal(run.code, 0);
  assert.match(run.output, /WARNING/, "the ruleset gates on the factory's checks alone, however the arguments read");
});

test("re-running to update an existing ruleset warns the same way", () => {
  const run = onboardWith([], "7");
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.output, /factory's checks alone/i, "the update path is a separate path and a maintainer meets it too");
  assert.match(run.output, /ruleset factory updated/);
});

test("re-running with an own check updates the existing ruleset and stays quiet", () => {
  const run = onboardWith(["check"], "7");
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.doesNotMatch(run.output, /WARNING/);
});
