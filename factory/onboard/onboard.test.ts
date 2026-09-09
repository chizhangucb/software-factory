/**
 * `scripts/onboard.sh` seen the way a maintainer sees it: what it prints, and the
 * ruleset payload it hands GitHub. The script is bash and talks to `gh`, so the one
 * honest test runs it with a stub `gh` first on PATH.
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

/**
 * A stub `gh`: it answers the reads `onboard.sh` makes and keeps the ruleset payload
 * it is handed. `GH_EXISTING_ID` is how a test picks the create path (unset) or the
 * update path (an id), which are the two paths the ticket asks about.
 */
const stubGh = `#!/usr/bin/env bash
args="$*"
case "$args" in
  "api --method POST"*) cat > "$GH_PAYLOAD"; echo 4242 ;;
  "api --method PUT"*)  cat > "$GH_PAYLOAD" ;;
  *"--jq .default_branch") echo main ;;
  *"/rulesets --jq"*) echo "\${GH_EXISTING_ID:-}" ;;
esac
exit 0
`;

type Run = {
  code: number;
  stdout: string;
  stderr: string;
  /** The contexts in the ruleset the script asked GitHub for. */
  requiredChecks: string[];
};

/** Run onboarding against a stub gh. `existingRulesetId` picks the update path. */
const onboardWith = (args: string[], existingRulesetId?: string): Run => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-"));
  try {
    const gh = path.join(dir, "gh");
    fs.writeFileSync(gh, stubGh, { mode: 0o755 });
    const payloadFile = path.join(dir, "payload.json");
    const result = spawnSync(onboard, args, {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GH_PAYLOAD: payloadFile,
        ...(existingRulesetId === undefined ? {} : { GH_EXISTING_ID: existingRulesetId }),
      },
    });
    if (result.error) assert.fail(`onboard.sh did not run: ${result.error.message}`);
    const rules = fs.existsSync(payloadFile) ? JSON.parse(fs.readFileSync(payloadFile, "utf8")).rules : [];
    const checks = rules.find((rule: { type: string }) => rule.type === "required_status_checks");
    return {
      code: result.status ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
      requiredChecks: (checks?.parameters.required_status_checks ?? []).map((c: { context: string }) => c.context),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const factoryChecks = ["factory/verdict", "factory/red-green", "factory/test-integrity"];

test("with an own check, the ruleset requires it next to the factory's three and nothing warns", () => {
  const run = onboardWith(["chizhangucb/factory-fixture", "check"]);
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.doesNotMatch(run.stderr, /warning/i, "a target whose own CI is required has nothing to warn about");
});

test("with no own check the ruleset gates on the factory's checks alone, and the script says so", () => {
  const run = onboardWith(["chizhangucb/factory-fixture"]);
  assert.equal(run.code, 0, "a target with no CI can still be onboarded; the warning is the point");
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.stderr, /warning/i);
});

test("the warning names the consequence, not just the omission", () => {
  const { stderr } = onboardWith(["chizhangucb/factory-fixture"]);
  assert.match(stderr, /factory's checks alone/i, "the consequence is what a stranger needs to read");
  assert.match(stderr, /own CI/i);
});

test("the warning is unmissable: it is the last thing printed as well as the first", () => {
  const { stderr } = onboardWith(["chizhangucb/factory-fixture"]);
  const banners = stderr.split("\n").filter((line) => /warning/i.test(line));
  assert.equal(banners.length, 2, "once before the ruleset is written and once after, so it cannot scroll away");
});

test("re-running to update an existing ruleset warns the same way", () => {
  const run = onboardWith(["chizhangucb/factory-fixture"], "7");
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.stderr, /factory's checks alone/i, "the update path is a separate path and a stranger meets it too");
  assert.match(run.stdout, /ruleset factory updated/);
});

test("re-running with an own check updates the existing ruleset and stays quiet", () => {
  const run = onboardWith(["chizhangucb/factory-fixture", "check"], "7");
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.doesNotMatch(run.stderr, /warning/i);
});
