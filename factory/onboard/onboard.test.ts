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
 *
 * `GH_RULESET` is the ruleset already on the target, one required context per line, the
 * factory's own included: filtering those is the script's job and a stub that did it would
 * be testing itself. `GH_RULESET_ERROR` makes that read fail instead. The stub answers no
 * commits, check-runs or commit-status call at all, so a script that went back to guessing
 * own checks off the target's history fails here rather than passing quietly.
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
  *"/rulesets --jq"*)
    if [ -n "\${GH_RULESETS_ERROR:-}" ]; then echo "$GH_RULESETS_ERROR" >&2; exit 1; fi
    echo "\${GH_EXISTING_ID:-}" ;;
  *"/rulesets/"*)
    if [ -n "\${GH_RULESET_ERROR:-}" ]; then echo "$GH_RULESET_ERROR" >&2; exit 1; fi
    printf '%s' "\${GH_RULESET:-}" | grep -v '^$' || true ;;
  *) echo "stub gh: unexpected call: $args" >&2; exit 1 ;;
esac
exit 0
`;

/** `existingRulesetId` picks the update path over the create path. `hasCaller` defaults to
 * true, since most tests exercise a target that carries one; false drops the factory's
 * three checks, the way a real caller-less target does. `callerError`, when set, makes
 * the caller-presence check itself fail (not a 404), overriding `hasCaller`. */
type OnboardOptions = {
  existingRulesetId?: string;
  hasCaller?: boolean;
  callerError?: string;
  /** The contexts the target's existing `factory` ruleset requires, factory ones included. */
  ruleset?: string[];
  /** When set, the read of that ruleset fails with this text, the way a rate limit does. */
  rulesetError?: string;
  /** When set, the listing that finds the ruleset fails first, before there is an id to read. */
  rulesetsError?: string;
};

/** A temp directory holding the stub `gh`, and the environment that reaches it. */
const sandbox = (options: OnboardOptions = {}) => {
  const { existingRulesetId, hasCaller = true, callerError, ruleset, rulesetError, rulesetsError } = options;
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
      // create-path tests silently on the update path. Naming the ruleset's contexts is
      // itself saying the target has one, so that case picks an id without repeating it.
      GH_EXISTING_ID: existingRulesetId ?? (ruleset || rulesetError ? "7" : ""),
      GH_RULESET: (ruleset ?? []).join("\n"),
      GH_RULESET_ERROR: rulesetError ?? "",
      GH_RULESETS_ERROR: rulesetsError ?? "",
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

/**
 * Every `gh` call the script made, as its argv. The stub writes a tab *after* every
 * argument, so each line ends in one and splitting leaves a trailing empty field: drop
 * exactly that one, rather than every empty field. An argument that is genuinely empty
 * has to survive, or a call made with one silently shifts every argument after it and
 * `createdLabels` reads the wrong thing as a name or a description.
 */
const ghCalls = (callsFile: string): string[][] =>
  fs.existsSync(callsFile)
    ? fs
        .readFileSync(callsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t").slice(0, -1))
    : [];

/** The `gh label create` calls among them, as argv. */
const labelCreateCalls = (calls: string[][]): string[][] =>
  calls.filter(([verb, noun]) => verb === "label" && noun === "create");

/** The labels the script asked GitHub to create, by name, with the description it gave each. */
const createdLabels = (calls: string[][]): Map<string, string> => {
  const labels = new Map<string, string>();
  for (const args of labelCreateCalls(calls)) {
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
  /** The ruleset payload as it was sent, or "" when the run wrote none. */
  payload: string;
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
      payload: fs.existsSync(box.payloadFile) ? fs.readFileSync(box.payloadFile, "utf8") : "",
      labels: createdLabels(calls),
      calls,
    };
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
};

/**
 * Own checks come from the command line or from the ruleset already on the target (#228).
 * Nothing is read off the target's commits: the guess that used to live here required the
 * factory's own job names on one target and nothing at all on two others.
 */

test("a re-run naming nothing keeps exactly the own checks the factory ruleset already requires", () => {
  // The re-run is what a maintainer does to pick up a new label or an onboard.sh change, and
  // it must not need the check list remembered. Before #228 it rewrote the ruleset off a guess.
  const run = onboardWith([], { ruleset: [...factoryChecks, "check", "e2e"] });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check", "e2e"]);
  assert.doesNotMatch(run.output, /WARNING/, "the target's own CI is still required, so nothing is at risk");
});

/** Every write onboarding makes: the repo edit, the labels, and the ruleset itself. */
const writes = (calls: string[][]): string[][] =>
  calls.filter(
    ([verb, noun]) =>
      (verb === "repo" && noun === "edit") ||
      (verb === "label" && noun === "create") ||
      (verb === "api" && noun === "--method"),
  );

test("onboarding reads no commit, check run or commit status: it guesses no own check at all", () => {
  // The guess #228 removed was never right on a live target: it required the factory's own job
  // names on one repo and nothing at all on the two whose CI runs on pull requests alone.
  const run = onboardWith([], { ruleset: [...factoryChecks, "check"] });
  for (const args of run.calls) {
    const endpoint = args.join(" ");
    assert.doesNotMatch(endpoint, /\/commits/, `onboard.sh should read no commit, it ran: gh ${endpoint}`);
    assert.doesNotMatch(endpoint, /check-runs/, `onboard.sh should read no check run, it ran: gh ${endpoint}`);
    assert.doesNotMatch(endpoint, /\/status/, `onboard.sh should read no commit status, it ran: gh ${endpoint}`);
  }
});

test("a re-run that names only some of the ruleset's own checks is refused, and the rest named", () => {
  // The foot-gun itself: re-running to pick up a label, with a half-remembered check list, used
  // to leave the target's build unrequired and a PR that breaks it merging clean.
  const run = onboardWith(["check"], { ruleset: [...factoryChecks, "check", "e2e"] });
  assert.notEqual(run.code, 0);
  assert.match(run.output, /\be2e\b/, "the check that would have been lost is named, not just counted");
  assert.deepEqual(writes(run.calls), [], "a refusal writes nothing at all");
  assert.equal(run.payload, "", "and no ruleset reached GitHub");
});

test("the same run with --allow-drop goes through, and the check named as going is gone", () => {
  const run = onboardWith(["check", "--allow-drop"], { ruleset: [...factoryChecks, "check", "e2e"] });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
});

test("--no-own-checks on a target whose ruleset requires some is a drop like any other", () => {
  // The flag says "this repo genuinely has none yet", which is a claim about a first run. On a
  // target that already requires its own CI it is the same silent shrink under another name.
  const run = onboardWith(["--no-own-checks"], { ruleset: [...factoryChecks, "check"] });
  assert.notEqual(run.code, 0);
  assert.match(run.output, /\bcheck\b/);
  assert.deepEqual(writes(run.calls), []);
});

test("a first run with no own check named and no flag refuses, and writes nothing on the way", () => {
  // No ruleset to keep a list from and no list given: the two ways forward are stated rather
  // than one of them being taken silently, which is what the old empty guess did.
  const run = onboardWith([]);
  assert.notEqual(run.code, 0);
  assert.deepEqual(writes(run.calls), [], "no label create, no repo edit, no ruleset write");
  assert.match(run.output, /--no-own-checks/, "the flag that says the target genuinely has none");
  assert.match(run.output, new RegExp(`scripts/onboard\\.sh ${target} <check>`), "and naming them by hand");
});

test("a first run with --no-own-checks proceeds, gating on the factory's three, and warns", () => {
  const run = onboardWith(["--no-own-checks"]);
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.output, /WARNING: no own check/, "the empty-repo path stays open, but it is stated");
  assert.match(run.output, /ruleset factory created/);
});

test("naming own checks alongside --no-own-checks is refused rather than one of them winning", () => {
  const run = onboardWith(["check", "--no-own-checks"]);
  assert.notEqual(run.code, 0);
  assert.deepEqual(writes(run.calls), []);
});

test("a factory ruleset that exists and cannot be read is a refusal, never an empty answer", () => {
  // Reading the failure as "this target requires nothing" is the shrink with a different cause:
  // the write would go out having measured the drop against a list that never arrived.
  const run = onboardWith(["check"], { rulesetError: "gh: API rate limit exceeded (HTTP 403)" });
  assert.notEqual(run.code, 0);
  assert.match(run.output, /rate limit/i, "the real gh error reaches the maintainer");
  assert.deepEqual(writes(run.calls), []);
});

test("a ruleset listing that fails is a refusal too, not a target read as having none", () => {
  // The listing is what tells a first run from a re-run. Read a failure as "no ruleset yet" and
  // the drop guard has no baseline to measure against, and the run creates over what is there.
  const run = onboardWith(["check"], { rulesetsError: "gh: API rate limit exceeded (HTTP 403)" });
  assert.notEqual(run.code, 0);
  assert.match(run.output, /rate limit/i, "the real gh error reaches the maintainer");
  assert.deepEqual(writes(run.calls), []);
});

test("two consecutive re-runs naming nothing hand GitHub the same payload", () => {
  // Idempotence is what makes a re-run safe to reach for. The second run sees what the first
  // wrote, so the ruleset it keeps its own checks from is the one it just produced.
  const first = onboardWith([], { ruleset: [...factoryChecks, "check", "e2e"] });
  const second = onboardWith([], { ruleset: first.requiredChecks });
  assert.equal(second.code, 0);
  assert.equal(second.payload, first.payload);
});

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
  const run = onboardWith(["--no-own-checks"]);
  assert.equal(run.code, 0, "a target with no CI can still be onboarded; the warning is the point");
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.output, /WARNING/);
});

test("the warning names the consequence, not just the omission", () => {
  const { output } = onboardWith(["--no-own-checks"]);
  assert.match(output, /factory's checks alone/i, "the consequence is what a maintainer needs to read");
  assert.match(output, /own CI/i);
});

test("the warning is unmissable: it comes before the ruleset write and again after it", () => {
  const { output } = onboardWith(["--no-own-checks"]);
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
    const result = spawnSync(onboard, [target, "--no-own-checks"], { encoding: "utf8", env: box.env });
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
  const run = onboardWith(["--no-own-checks"], { hasCaller: false });
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
 * rather than repeated here, so the script's descriptions are provably the words a skill
 * reads. A row with no role, `hold`'s, is not one of them.
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

test("no label onboarding writes reaches the picker without a description", () => {
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

test("every description fits GitHub's 100 character limit, or the label create fails", () => {
  // GitHub rejects a longer one outright, and `set -e` would take the whole onboarding
  // down with it, halfway through the vocabulary.
  const { labels } = onboardWith(["check"]);
  for (const [name, description] of labels) {
    assert.ok(description.length <= 100, `${name}'s description is ${description.length} characters`);
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
  for (const args of labelCreateCalls(calls)) {
    assert.ok(args.includes("--force"), `gh label create ${args[2]} without --force fails on a re-run`);
  }
});

test("onboarding a target that has been onboarded before writes the same vocabulary, and no delete", () => {
  // "Re-run onboarding to pick up the new labels" is the advice this ticket gives a target
  // that is already live, and an already-onboarded target is the one with a `factory`
  // ruleset, so the re-run goes down the update path. The stub keeps no state, so what this
  // can prove is that the two paths write the same labels and that neither deletes: a
  // script that skipped or trimmed the vocabulary once a ruleset existed would fail here.
  const first = onboardWith(["check"]);
  const rerun = onboardWith(["check"], { existingRulesetId: "7" });
  assert.match(rerun.output, /ruleset factory updated/, "an onboarded target takes the update path");
  assert.deepEqual([...rerun.labels], [...first.labels], "a re-run should assert the same labels and wording");
  for (const args of rerun.calls) {
    assert.ok(!args.includes("delete") && !args.includes("DELETE"), `a re-run ran: gh ${args.join(" ")}`);
  }
});

test("every label comes from one unbroken block of label lines, so the vocabulary reads at a glance", () => {
  const lines = fs.readFileSync(onboard, "utf8").split("\n");
  const block = lines.flatMap((line, index) => (line.startsWith('label "') ? [index] : []));
  assert.equal(block.at(-1)! - block[0]! + 1, block.length, "no other line sits inside the block");
  assert.equal(block.length, onboardWith(["check"]).labels.size, "and the block is every label the run creates");
});

/**
 * The instruction onboarding prints (#181), as the template holds it. Read off the template
 * rather than pinned here, because what these tests prove is that the script prints the
 * template rather than a copy of its own; the bytes themselves are pinned to the ticket's in
 * `judged-path-instruction.test.ts`, and a change to them goes red there.
 */
const JUDGED_PATH_TEMPLATE = "templates/agents-md-judged-path.md";
const JUDGED_PATH_INSTRUCTION = fs.readFileSync(new URL(`../../${JUDGED_PATH_TEMPLATE}`, import.meta.url), "utf8").trimEnd();

/** The line index of every exact copy of the instruction in a run's output. */
const instructionLines = (output: string): number[] =>
  output.split("\n").flatMap((line, i) => (line === JUDGED_PATH_INSTRUCTION ? [i] : []));

test("a run ends by printing the instruction, a whole line that pastes as it stands", () => {
  // Line equality, not a substring: a maintainer copies this line into the target's AGENTS.md,
  // so a prefix in front of it would be a prefix in the target's file.
  const { output } = onboardWith(["check"]);
  assert.equal(instructionLines(output).length, 1, "the instruction, exactly once and exactly as agreed");
});

test("the instruction sits beside the required checks, and the warning still has the last word", () => {
  const { output } = onboardWith(["--no-own-checks"]);
  const lines = output.split("\n");
  const required = lines.findIndex((line) => line.startsWith("required on main:"));
  const [instruction] = instructionLines(output);
  assert.ok(required >= 0 && instruction !== undefined);
  assert.ok(instruction > required, "after the ruleset is written, since it is what a PR needs to meet it");
  assert.ok(Math.max(...warningLines(output)) > instruction, "the warning is the more urgent of the two");
});

test("the instruction is printed in the script's banner idiom, as a note rather than a warning", () => {
  // A target missing the line fails closed: a producer nobody told gets a PR that
  // sits blocked, which is where it was before. Nothing is at risk, so it is a NOTE, and the
  // WARNING stays reserved for a ruleset that lets a broken build merge.
  const { output } = onboardWith(["check"]);
  const lines = output.split("\n");
  const [instruction] = instructionLines(output);
  const open = lines.slice(0, instruction).lastIndexOf("#".repeat(60));
  const close = lines.indexOf("#".repeat(60), instruction!);
  assert.ok(open >= 0 && close > instruction!, "fenced by the same banner the other notes use");
  assert.match(lines[open + 1]!, /^## NOTE: /);
  assert.ok(
    lines.slice(open + 1, close).every((line, i) => open + 1 + i === instruction || line.startsWith("## ")),
    "every other line of the banner is the script's own `## ` prose",
  );
  assert.match(lines.slice(open, close).join("\n"), new RegExp(JUDGED_PATH_TEMPLATE), "and it names the file to copy");
});

test("the instruction goes to stderr with the rest of the advice", () => {
  const box = sandbox();
  try {
    const result = spawnSync(onboard, [target, "check"], { encoding: "utf8", env: box.env });
    assert.equal(result.status, 0, `onboard.sh failed: ${result.stderr}`);
    assert.equal(instructionLines(result.stderr).length, 1);
    assert.equal(instructionLines(result.stdout).length, 0, "stdout is the record of what the run did");
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});

test("a target with no caller is not told the factory judges its PRs, since nothing there would", () => {
  // No caller means no reviewer to answer `agent:review` and no factory check in the ruleset,
  // so the line's last sentence would be false there. The factory's own repo is one such.
  const { output, code } = onboardWith(["check"], { hasCaller: false });
  assert.equal(code, 0);
  assert.doesNotMatch(output, /Opening a pull request yourself/);
});

test("a template the script cannot read never takes the warning down with it", () => {
  // The ruleset is written by the time the note prints, and the warning still has to print
  // after it, so under set -e an unreadable template must cost the note alone. Run from a copy
  // of the script with no templates/ beside it, which is that failure without touching the tree.
  const box = sandbox();
  const lone = path.join(box.dir, "scripts", "onboard.sh");
  fs.mkdirSync(path.dirname(lone));
  fs.copyFileSync(onboard, lone);
  try {
    const result = spawnSync("/bin/sh", ["-c", 'exec "$0" "$@" 2>&1', lone, target, "--no-own-checks"], { encoding: "utf8", env: box.env });
    assert.equal(result.status, 0, `onboard.sh failed: ${result.stdout}`);
    const lines = result.stdout.split("\n");
    const unreadable = lines.findIndex((line) => /could not read/.test(line));
    assert.ok(unreadable >= 0, "the note says it could not read the template");
    assert.ok(Math.max(...warningLines(result.stdout)) > unreadable, "and the warning still prints after it");
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});
