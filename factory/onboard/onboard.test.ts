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

import { HOLD_LABEL, HOLD_LABELS } from "../lib/labels.ts";

const onboard = fileURLToPath(new URL("../../scripts/onboard.sh", import.meta.url));
const target = "chizhangucb/factory-fixture";
const factoryChecks = ["factory/verdict", "factory/red-green", "factory/test-integrity"];

/**
 * A stub `gh`: it answers the reads `onboard.sh` makes and keeps the ruleset payload it
 * is handed, and every call it is made at all, one tab-separated argv per line
 * (tab-separated rather than `$*`, because a description is several words and would
 * otherwise be indistinguishable from the arguments around it). Every call and not just
 * the label creates, because "onboarding deletes nothing" is a claim about the calls the
 * script does *not* make, which only a full record can settle. `GH_EXISTING_ID` is how
 * a test picks the create path (unset) or the update path (an id). `GH_CALLER_ERROR`, when set, makes the caller-presence check fail with
 * that text instead of answering -- real `gh` on a 404 prints "HTTP 404" among other
 * text, which is what tells `onboard.sh` a missing file from any other kind of failure.
 * A call it does not recognise fails, so a reshaped `gh` line breaks the test loudly
 * instead of degrading into an empty answer.
 */
const stubGh = `#!/usr/bin/env bash
args="$*"
printf '%s\\t' "$@" >> "$GH_CALLS"; printf '\\n' >> "$GH_CALLS"
case "$args" in
  "label create"*) ;;
  "repo edit"*) ;;
  "api --method POST"*) cat > "$GH_PAYLOAD"; echo 4242 ;;
  "api --method PUT"*)  cat > "$GH_PAYLOAD" ;;
  *"contents/.github/workflows/factory.yml"*)
    if [ -n "\${GH_CALLER_ERROR:-}" ]; then echo "$GH_CALLER_ERROR" >&2; exit 1
    elif [ "$GH_HAS_CALLER" = "true" ]; then exit 0
    else echo "gh: Not Found (HTTP 404)" >&2; exit 1
    fi ;;
  *"--jq .default_branch") echo main ;;
  *"/rulesets --jq"*) echo "\${GH_EXISTING_ID:-}" ;;
  *) echo "stub gh: unexpected call: $args" >&2; exit 1 ;;
esac
exit 0
`;

/** `existingRulesetId` picks the update path over the create path. `hasCaller` defaults to
 * true, since most tests exercise a target that carries one; false drops the factory's
 * three checks, the way a real caller-less target does. `callerError`, when set, makes
 * the caller-presence check itself fail (not a 404), overriding `hasCaller`. */
type OnboardOptions = { existingRulesetId?: string; hasCaller?: boolean; callerError?: string };

/** A temp directory holding the stub `gh`, and the environment that reaches it. */
const sandbox = (options: OnboardOptions = {}) => {
  const { existingRulesetId, hasCaller = true, callerError } = options;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-"));
  fs.writeFileSync(path.join(dir, "gh"), stubGh, { mode: 0o755 });
  const payloadFile = path.join(dir, "payload.json");
  const callsFile = path.join(dir, "calls.tsv");
  return {
    dir,
    payloadFile,
    callsFile,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_PAYLOAD: payloadFile,
      GH_CALLS: callsFile,
      // Pinned rather than omitted: an ambient GH_EXISTING_ID would otherwise put the
      // create-path tests silently on the update path.
      GH_EXISTING_ID: existingRulesetId ?? "",
      GH_HAS_CALLER: hasCaller ? "true" : "false",
      GH_CALLER_ERROR: callerError ?? "",
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

/** Every `gh` call the script made, as its argv. */
const ghCalls = (callsFile: string): string[][] =>
  fs.existsSync(callsFile)
    ? fs
        .readFileSync(callsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t").filter(Boolean))
    : [];

/** The labels the script asked GitHub to create, by name, with the description it gave each. */
const createdLabels = (calls: string[][]): Map<string, string> => {
  const labels = new Map<string, string>();
  for (const args of calls.filter(([verb, noun]) => verb === "label" && noun === "create")) {
    const description = args.indexOf("--description");
    // `gh label create <name>`, so the name is the third argument.
    labels.set(args[2]!, description === -1 ? "" : args[description + 1]!);
  }
  return labels;
};

type Run = {
  code: number;
  /** stdout and stderr interleaved, which is the one stream a terminal shows. */
  output: string;
  requiredChecks: string[];
  labels: Map<string, string>;
  /** Every `gh` call the run made, for the claims that are about what it did not do. */
  calls: string[][];
};

/** Onboard the target with these own checks. See `OnboardOptions` for `options`. */
const onboardWith = (ownChecks: string[], options: OnboardOptions = {}): Run => {
  const box = sandbox(options);
  try {
    const result = spawnSync("/bin/sh", ["-c", 'exec "$0" "$@" 2>&1', onboard, target, ...ownChecks], {
      encoding: "utf8",
      env: box.env,
    });
    if (result.error) assert.fail(`onboard.sh did not run: ${result.error.message}`);
    const calls = ghCalls(box.callsFile);
    return {
      code: result.status ?? -1,
      output: result.stdout,
      requiredChecks: requiredChecks(box.payloadFile),
      labels: createdLabels(calls),
      calls,
    };
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
};

test("onboarding creates every label that stops a dispatch, so a triager can reach for one", () => {
  const { labels } = onboardWith(["check"]);
  for (const label of HOLD_LABELS) {
    assert.ok(labels.has(label), `onboard.sh creates ${label}, or a target has no way to hold a ticket back`);
  }
});

test("the hold label's description states the veto, because that is where a triager reads it", () => {
  // The label picker is the one place the meaning reaches the person choosing
  // it, which is where both of #169's failures happened. Prose in the target's
  // docs would be a second copy this repo cannot see.
  const { labels } = onboardWith(["check"]);
  assert.match(labels.get(HOLD_LABEL)!, /never dispatched/i);
  // `Factory:` says who reads the label, not who writes it. A hold is a human's
  // to add and remove, and the prefix is what tells a triager choosing it that
  // this label is addressed to the dispatcher rather than to another human.
  assert.match(labels.get(HOLD_LABEL)!, /^Factory:/);
});

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
    assert.equal(result.status, 0, `onboard.sh failed: ${result.stderr}`);
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
  assert.deepEqual(run.requiredChecks, factoryChecks, "a repeat is one check, not a duplicate context for GitHub");
});

test("an empty argument names no check, and never reaches the ruleset as an empty context", () => {
  const run = onboardWith(["", "check", "check"]);
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.doesNotMatch(run.output, /WARNING/, "`check` is an own check, whatever else was passed alongside it");
});

test("re-running to update an existing ruleset warns the same way", () => {
  const run = onboardWith([], { existingRulesetId: "7" });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.output, /factory's checks alone/i, "the update path is a separate path and a maintainer meets it too");
  assert.match(run.output, /ruleset factory updated/);
});

test("re-running with an own check updates the existing ruleset and stays quiet", () => {
  const run = onboardWith(["check"], { existingRulesetId: "7" });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.doesNotMatch(run.output, /WARNING/);
});

test("with no caller, the ruleset requires only the own checks named, and nothing warns", () => {
  const run = onboardWith(["check"], { hasCaller: false });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, ["check"], "no caller means the factory's three are never posted");
  assert.doesNotMatch(run.output, /WARNING/);
});

test("with no caller and no own check, the script warns the ruleset requires nothing at all", () => {
  const run = onboardWith([], { hasCaller: false });
  assert.equal(run.code, 0, "a repo with no caller and no CI can still be onboarded; the warning is the point");
  assert.deepEqual(run.requiredChecks, [], "no factory checks (no caller) and no own check either");
  assert.match(run.output, /WARNING/);
  assert.match(run.output, /requires nothing at all/i);
});

test("a caller check that fails for a reason other than 404 aborts, rather than being read as no caller", () => {
  const run = onboardWith([], { callerError: "gh: API rate limit exceeded (HTTP 403)" });
  assert.notEqual(run.code, 0, "an ambiguous answer must not be treated as a confirmed no-caller repo");
  assert.match(run.output, /rate limit/i, "the real gh error reaches the maintainer, not a swallowed failure");
  assert.doesNotMatch(
    run.output,
    /ruleset factory (created|updated)/,
    "no ruleset should be written off a caller check that never actually answered",
  );
});

/**
 * The five canonical triage roles, read out of `docs/agents/triage-labels.md`'s table
 * rather than repeated here. That page is vendored: `factory/plugins/README.md` keeps it
 * byte-identical to the `setup-matt-pocock-skills` copy, so it is the one place the roles
 * and their meanings are written down, and parsing it is what makes the script's
 * descriptions provably the same words a skill reads.
 */
const triageRoles = (): Map<string, string> => {
  const page = fs.readFileSync(fileURLToPath(new URL("../../docs/agents/triage-labels.md", import.meta.url)), "utf8");
  const roles = new Map<string, string>();
  for (const line of page.split("\n")) {
    // | `role` | `label` | Meaning |, which skips the header and the `---` divider.
    const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|$/);
    if (row) roles.set(row[2]!, row[3]!);
  }
  assert.equal(roles.size, 5, `docs/agents/triage-labels.md should map five roles, parsed ${roles.size}`);
  return roles;
};

test("onboarding creates the five triage roles, so no target needs the hand step", () => {
  // `setup-matt-pocock-skills` writes the mapping and never runs `gh label create`
  // (mattpocock/skills#616), and `gh issue create --label <missing>` fails outright rather
  // than creating the label, so a missing role is a triage pass that cannot be recorded.
  const { labels } = onboardWith(["check"]);
  for (const role of triageRoles().keys()) {
    assert.ok(labels.has(role), `onboard.sh creates ${role}, or a triager cannot apply it`);
  }
});

test("each triage role's description is the meaning docs/agents/triage-labels.md gives it", () => {
  // The page is what a skill reads and the picker is what a triager reads. Two wordings
  // for one role is how the same issue gets triaged two ways, so the script copies the
  // page rather than paraphrasing it, and this fails the day either side drifts.
  const { labels } = onboardWith(["check"]);
  for (const [role, meaning] of triageRoles()) {
    assert.equal(labels.get(role), meaning, `${role}'s description should be its meaning on the page`);
  }
});

test("onboarding asserts the two triage categories rather than trusting GitHub to have made them", () => {
  // `bug` and `enhancement` exist on most targets only because GitHub creates them on a new
  // repo, with GitHub's own wording. A repo made from a template, or one whose defaults were
  // cleared, has neither, and the triage skill hands out exactly these two category roles.
  const { labels } = onboardWith(["check"]);
  assert.equal(labels.get("bug"), "Something is broken");
  assert.equal(labels.get("enhancement"), "New feature or improvement");
});

/** The map, then the four ticket types the wayfinder skill puts on a child ticket. */
const wayfinderLabels = ["wayfinder:map", "wayfinder:research", "wayfinder:prototype", "wayfinder:grilling", "wayfinder:task"];

test("onboarding creates the five wayfinder labels, the other set nothing was creating", () => {
  const { labels } = onboardWith(["check"]);
  for (const label of wayfinderLabels) {
    assert.ok(labels.has(label), `onboard.sh creates ${label}, or charting a map fails on the first ticket`);
  }
});

test("a wayfinder ticket type says whether it is worked with a human or driven alone", () => {
  // HITL against AFK is the distinction the skill turns on, and the picker is where the
  // person labelling the ticket meets it. `wayfinder:map` is the container, not a type,
  // so it carries no such answer.
  const { labels } = onboardWith(["check"]);
  for (const label of wayfinderLabels.filter((name) => name !== "wayfinder:map")) {
    assert.match(labels.get(label)!, /with a human|AFK/, `${label} should say who drives it`);
  }
});

test("every label onboarding writes carries a description, empty ones included", () => {
  const { labels } = onboardWith(["check"]);
  for (const [name, description] of labels) {
    assert.notEqual(description, "", `${name} reaches the picker with nothing saying what it is for`);
  }
});

/**
 * The labels the script offered a `gh label delete` command for. Read off the commands
 * themselves rather than off the prose around them, so the note is free to explain which
 * labels it is leaving alone without that reading as an offer to delete them.
 */
const offeredForDeletion = (output: string): string[] =>
  output.split("\n").flatMap((line) => {
    const offer = line.match(/gh label delete "([^"]+)" /);
    return offer ? [offer[1]!] : [];
  });

test("the unused GitHub defaults are named, with the command that removes them", () => {
  // GitHub puts nine labels on a new repo. Four of them are roles the factory or the triage
  // skill uses; the other five are noise in the picker, and the note is how a maintainer
  // finds out they can go. It prints rather than deletes: see "onboarding deletes nothing".
  const { output } = onboardWith(["check"]);
  assert.deepEqual(offeredForDeletion(output).sort(), [
    "documentation",
    "good first issue",
    "help wanted",
    "invalid",
    "question",
  ]);
  assert.match(output, /--yes/, "the command should be one a maintainer can paste and have run");
  assert.match(output, new RegExp(target), "the command should name the target, not a placeholder");
  // `gh label delete good first issue` is three arguments and an error. The names are
  // printed quoted, so every line is one a maintainer can paste as it stands.
  assert.match(output, /gh label delete "good first issue" /, "a multi-word label has to reach the shell quoted");
});

test("no label the tracker actually uses is ever offered for deletion", () => {
  // `wontfix` is one of the five triage roles and `duplicate` is a real triage answer;
  // `bug` and `enhancement` are the two categories. Offering any of them would be this
  // note telling someone to delete part of the vocabulary the script just asserted.
  const { output, labels } = onboardWith(["check"]);
  const offered = offeredForDeletion(output);
  for (const kept of ["bug", "enhancement", "wontfix", "duplicate"]) {
    assert.ok(!offered.includes(kept), `${kept} is in use, and must never be offered for deletion`);
  }
  for (const created of labels.keys()) {
    assert.ok(!offered.includes(created), `onboard.sh creates ${created} and must not then offer to delete it`);
  }
});

test("the note about unused defaults goes to stderr, next to the other advice", () => {
  const box = sandbox();
  try {
    const result = spawnSync(onboard, [target, "check"], { encoding: "utf8", env: box.env });
    assert.equal(result.status, 0, `onboard.sh failed: ${result.stderr}`);
    assert.deepEqual(offeredForDeletion(result.stdout), [], "stdout is the record of what the run did");
    assert.ok(offeredForDeletion(result.stderr).length > 0);
    assert.doesNotMatch(result.stderr, /WARNING/, "an unused default is a note, not a warning; nothing is at risk");
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test("onboarding deletes nothing, which is what makes re-running it safe", () => {
  // Deleting a label strips it from every issue carrying it, silently and with no undo, so
  // the script stays purely additive and the unused defaults are printed instead (#176).
  const { calls } = onboardWith(["check"]);
  for (const args of calls) {
    assert.ok(!args.includes("delete"), `onboard.sh should delete nothing, it ran: gh ${args.join(" ")}`);
    assert.ok(!args.includes("DELETE"), `onboard.sh should delete nothing, it ran: gh ${args.join(" ")}`);
  }
});

test("a label create is a rewrite, so a second run updates descriptions rather than failing", () => {
  const { calls } = onboardWith(["check"]);
  for (const args of calls.filter(([verb, noun]) => verb === "label" && noun === "create")) {
    assert.ok(args.includes("--force"), `gh label create ${args[2]} without --force fails on a re-run`);
  }
});
