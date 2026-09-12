/**
 * `scripts/waive-factory-checks.sh` seen the way a maintainer sees it (#244):
 * what it prints, what it writes, and in what order. The script is bash and
 * talks to `gh`, so the one honest test runs it with a stub `gh` first on PATH,
 * the same harness `factory/onboard/onboard.test.ts` uses.
 *
 * Every `gh` call is recorded, not just the writes: "a second `on` is not
 * destructive" and "a refusal writes nothing" are claims about calls the script
 * does *not* make, which only a full record can settle. The order of the two
 * writes is part of the interface, so it is asserted as an order and not as a
 * pair of calls.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { WAIVER_VARIABLE } from "../heartbeat/waiver.ts";

const script = fileURLToPath(new URL("../../scripts/waive-factory-checks.sh", import.meta.url));
const repoRoot = new URL("../../", import.meta.url);
const target = "chizhangucb/factory-fixture";
const FACTORY_CHECKS = ["factory/verdict", "factory/red-green", "factory/test-integrity"];
const RULESET_ID = "7";

/**
 * A stub `gh` answering the reads the script makes and recording every call,
 * one tab-separated argv per line. `GH_WAIVED` is the variable's current value,
 * empty meaning unset, which real `gh` answers with a 404. `GH_RULESET_JSON` is
 * the ruleset on the target, whole, because filtering its contexts is the
 * script's job and a stub that did it would be testing itself.
 * `GH_PUT_FAILS` makes the ruleset write fail the way a rate limit does, which
 * is the half-failure the write order exists for.
 */
const stubGh = `#!/usr/bin/env bash
args="$*"
printf '%s\\t' "$@" >> "$GH_CALLS"; printf '\\n' >> "$GH_CALLS"
case "$args" in
  *"actions/variables/${WAIVER_VARIABLE}"*)
    if [ -n "\${GH_WAIVED:-}" ]; then printf '%s\\n' "$GH_WAIVED"; else echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi ;;
  "variable set"*) ;;
  "variable delete"*) ;;
  "api --method PUT"*)
    cat > "$GH_PAYLOAD"
    if [ -n "\${GH_PUT_FAILS:-}" ]; then echo "$GH_PUT_FAILS" >&2; exit 1; fi ;;
  *"/rulesets?"*) printf '%s\\n' "\${GH_EXISTING_ID:-}" ;;
  *"/rulesets/"*) printf '%s' "$GH_RULESET_JSON" ;;
  *) echo "stub gh: unexpected call: $args" >&2; exit 1 ;;
esac
exit 0
`;

/** A target's `factory` ruleset, as GitHub returns it: the contexts sit inside everything else. */
const ruleset = (contexts: string[]) =>
  JSON.stringify({
    id: Number(RULESET_ID),
    name: "factory",
    target: "branch",
    enforcement: "active",
    created_at: "2026-01-01T00:00:00Z",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "pull_request", parameters: { required_approving_review_count: 0, allowed_merge_methods: ["squash"] } },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: contexts.map((context) => ({ context })),
        },
      },
    ],
  });

type Options = {
  /** The contexts the target's `factory` ruleset requires today, the factory's own included. */
  contexts?: string[];
  /** The reason already on the target, empty meaning no waiver is open. */
  waived?: string;
  /** No `factory` ruleset on the target at all. */
  noRuleset?: boolean;
  /** When set, the ruleset write fails with this text. */
  putFails?: string;
};

const run = (args: string[], options: Options = {}) => {
  const { contexts = [...FACTORY_CHECKS, "check"], waived = "", noRuleset = false, putFails } = options;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "waive-"));
  fs.writeFileSync(path.join(dir, "gh"), stubGh, { mode: 0o755 });
  const payloadFile = path.join(dir, "payload.json");
  const callsFile = path.join(dir, "calls.tsv");
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_PAYLOAD: payloadFile,
      GH_CALLS: callsFile,
      GH_EXISTING_ID: noRuleset ? "" : RULESET_ID,
      GH_RULESET_JSON: ruleset(contexts),
      GH_WAIVED: waived,
      GH_PUT_FAILS: putFails ?? "",
    },
  });
  const calls: string[][] = fs.existsSync(callsFile)
    ? fs
        .readFileSync(callsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t").slice(0, -1))
    : [];
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls,
    /** The contexts the script asked GitHub to require, off the payload it sent. */
    required: (): string[] => {
      if (!fs.existsSync(payloadFile)) return [];
      const rules = JSON.parse(fs.readFileSync(payloadFile, "utf8")).rules;
      const checks = rules.find((rule: { type: string }) => rule.type === "required_status_checks");
      return (checks?.parameters.required_status_checks ?? []).map((c: { context: string }) => c.context);
    },
    payload: () => JSON.parse(fs.readFileSync(payloadFile, "utf8")),
  };
};

/** The index of the first call whose argv joined matches, or -1. */
const indexOf = (calls: string[][], match: (args: string[]) => boolean): number => calls.findIndex(match);
const isVariableSet = (args: string[]) => args[0] === "variable" && args[1] === "set";
const isVariableDelete = (args: string[]) => args[0] === "variable" && args[1] === "delete";
const isRulesetWrite = (args: string[]) => args[0] === "api" && args.includes("PUT");

test("on with no reason is refused, and nothing is written", () => {
  const { status, stderr, calls } = run([target, "on"]);
  assert.notEqual(status, 0);
  assert.match(stderr, /reason/i, "the refusal says a reason is what is missing");
  assert.equal(indexOf(calls, isVariableSet), -1, "no variable was set");
  assert.equal(indexOf(calls, isRulesetWrite), -1, "no ruleset was written");
});

test("on sets the reason and then takes exactly the three factory contexts off, keeping own checks", () => {
  const { status, calls, required } = run([target, "on", "PAT expired, see #244"], {
    contexts: [...FACTORY_CHECKS, "check", "e2e", "gitleaks"],
  });
  assert.equal(status, 0);
  assert.deepEqual(required(), ["check", "e2e", "gitleaks"], "the target's own checks are untouched");
  const set = calls[indexOf(calls, isVariableSet)]!;
  assert.ok(set.includes(WAIVER_VARIABLE) && set.includes("PAT expired, see #244"), "the reason is the variable's value");
});

test("the variable is written before the ruleset, so a half-failure is visible and not in effect", () => {
  const { calls } = run([target, "on", "Actions is down"]);
  const variable = indexOf(calls, isVariableSet);
  const rule = indexOf(calls, isRulesetWrite);
  assert.ok(variable !== -1 && rule !== -1, "both writes happened");
  assert.ok(variable < rule, "the nag exists before anything is waived, never the other way round");
});

test("a ruleset write that fails leaves the waiver set and says the target is still gated", () => {
  const { status, stderr, calls } = run([target, "on", "Actions is down"], { putFails: "gh: API rate limit exceeded (HTTP 403)" });
  assert.notEqual(status, 0);
  assert.notEqual(indexOf(calls, isVariableSet), -1, "the reason stays on the target");
  assert.equal(indexOf(calls, isVariableDelete), -1, "nothing rolls the variable back");
  assert.match(stderr, /still required|still gated/i, "it says the checks are still required");
});

test("a second on over an open waiver writes nothing and says what is already waived", () => {
  const { status, stdout, calls } = run([target, "on", "a different reason"], { waived: "PAT expired, see #244" });
  assert.equal(status, 0);
  assert.match(stdout, /PAT expired, see #244/, "it says what the target is waived for");
  assert.equal(indexOf(calls, isVariableSet), -1, "the open waiver's reason is not overwritten");
  assert.equal(indexOf(calls, isRulesetWrite), -1, "the ruleset is not rewritten");
});

test("off restores the three factory contexts and only then clears the variable", () => {
  const { status, calls, required } = run([target, "off"], { contexts: ["check", "e2e"], waived: "PAT expired, see #244" });
  assert.equal(status, 0);
  assert.deepEqual(required(), ["check", "e2e", ...FACTORY_CHECKS], "the own checks keep their place and the factory's go back");
  const rule = indexOf(calls, isRulesetWrite);
  const cleared = indexOf(calls, isVariableDelete);
  assert.ok(rule !== -1 && cleared !== -1, "both writes happened");
  assert.ok(rule < cleared, "a half-failed off leaves the target gated with the nag still up");
});

test("off on a target already carrying the three checks requires no duplicate", () => {
  const { required } = run([target, "off"], { contexts: [...FACTORY_CHECKS, "check"], waived: "stale" });
  assert.deepEqual(required(), [...FACTORY_CHECKS, "check"]);
});

test("the ruleset is written back whole: everything but the contexts survives", () => {
  const { payload } = run([target, "on", "Actions is down"]);
  const sent = payload();
  assert.equal(sent.name, "factory");
  assert.deepEqual(sent.conditions.ref_name.include, ["refs/heads/main"]);
  assert.deepEqual(sent.bypass_actors, [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }]);
  assert.deepEqual(
    sent.rules.map((rule: { type: string }) => rule.type),
    ["deletion", "non_fast_forward", "pull_request", "required_status_checks"],
  );
});

test("a target with no factory ruleset is refused before anything is written", () => {
  const { status, stderr, calls } = run([target, "on", "Actions is down"], { noRuleset: true });
  assert.notEqual(status, 0);
  assert.match(stderr, /ruleset/i);
  assert.equal(indexOf(calls, isVariableSet), -1, "no variable was set");
});

test("a mode that is neither on nor off is refused", () => {
  const { status, stderr, calls } = run([target, "maybe"]);
  assert.notEqual(status, 0);
  assert.match(stderr, /on|off/);
  assert.equal(calls.length, 0, "nothing was read or written");
});

test("nothing in the factory sets or clears the waiver: only the script writes it", () => {
  // The whole point of the variable is that a human is the only actor who can
  // take the merge gate off, so a write anywhere the factory runs is the bug
  // this test exists to catch.
  // `--untracked` so a file added in this branch and not yet committed counts too.
  const listed = spawnSync("git", ["grep", "--untracked", "-lF", WAIVER_VARIABLE], { cwd: fileURLToPath(repoRoot), encoding: "utf8" });
  const files = listed.stdout.split("\n").filter(Boolean);
  assert.ok(files.includes("scripts/waive-factory-checks.sh"), "the script names the variable");
  const writers = files.filter((file) => file.startsWith("factory/") && !file.endsWith(".test.ts"));
  for (const file of writers) {
    const source = fs.readFileSync(new URL(file, repoRoot), "utf8");
    // The `gh` call as it is written in code, quotes and all, so prose about a
    // variable being set does not read as one being set.
    assert.doesNotMatch(source, /"variable",\s*"(set|delete)"/, `${file} writes the waiver variable, and only a human may`);
    assert.doesNotMatch(source, /--method\s+(PUT|POST|PATCH|DELETE)/, `${file} writes where it should only read the waiver`);
  }
});
