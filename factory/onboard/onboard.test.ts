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
 * `GH_HISTORY` is the target's default-branch history for discovery: one line per commit,
 * newest first, holding that commit's check-run names tab-separated. Commit n is `cn`, so
 * a test never has to invent a sha. The commit listing honours the `per_page` the script
 * asks for, which is what lets a test prove the sample size off the calls themselves.
 * The stub reports the names raw, factory checks included: filtering them is the script's
 * job and a stub that did it would be testing itself.
 */
const stubGh = `#!/usr/bin/env bash
args="$*"
printf '%s\\t' "$@" >> "$GH_CALLS"; printf '\\n' >> "$GH_CALLS"
case "$args" in
  "label create"*) ;;
  "repo edit"*) ;;
  "api --method POST"*) cat > "$GH_PAYLOAD"; echo 4242 ;;
  "api --method PUT"*)  cat > "$GH_PAYLOAD" ;;
  *"/commits?sha="*)
    if [ -n "\${GH_COMMITS_ERROR:-}" ]; then echo "$GH_COMMITS_ERROR" >&2; exit 1; fi
    per_page=$(printf '%s' "$args" | sed -n 's/.*per_page=\\([0-9][0-9]*\\).*/\\1/p')
    commit=0
    while IFS= read -r _names; do
      commit=$((commit + 1))
      if [ "$commit" -gt "\${per_page:-0}" ]; then break; fi
      echo "c$commit"
    done < "$GH_HISTORY" ;;
  *"/check-runs"*)
    commit=\${args#*/commits/c}; commit=\${commit%%/check-runs*}
    sed -n "\${commit}p" "$GH_HISTORY" | tr '\\t' '\\n' | grep -v '^$' || true ;;
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
 * the caller-presence check itself fail (not a 404), overriding `hasCaller`. `history` is
 * the target's recent default-branch commits, newest first, each the check names that
 * posted on it; the default is a repo whose CI has posted nothing, which is the case every
 * pre-discovery test was written against. `commitsError`, when set, makes the commit listing
 * discovery reads fail with that text, the way a rate limit does. */
type OnboardOptions = {
  existingRulesetId?: string;
  hasCaller?: boolean;
  callerError?: string;
  history?: string[][];
  commitsError?: string;
};

/** A temp directory holding the stub `gh`, and the environment that reaches it. */
const sandbox = (options: OnboardOptions = {}) => {
  const { existingRulesetId, hasCaller = true, callerError, history = [], commitsError } = options;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onboard-"));
  fs.writeFileSync(path.join(dir, "gh"), stubGh, { mode: 0o755 });
  const payloadFile = path.join(dir, "payload.json");
  const callsFile = path.join(dir, "calls.tsv");
  const historyFile = path.join(dir, "history.tsv");
  fs.writeFileSync(historyFile, history.map((names) => names.join("\t")).join("\n") + (history.length ? "\n" : ""));
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
      GH_HISTORY: historyFile,
      GH_COMMITS_ERROR: commitsError ?? "",
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
 *
 * So a skills bump that rewords the Meaning column turns a vendor re-copy red here, and the
 * fix is to follow it in `onboard.sh`. That is the intended direction: the page is upstream
 * of the picker, and the alternative is a second wording nobody notices going stale.
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

/**
 * Discovery (#177). Onboarding a target should be `scripts/onboard.sh owner/repo`, so with
 * no names on the command line the script reads what the target's CI actually posted on
 * recent default-branch commits. The hazard is the opposite of a missing check: requiring
 * a path-filtered one produces a target whose PRs wait on a check that never posts.
 */

/** A default branch where the same names posted on each of `commits` recent commits. */
const postedOnEvery = (commits: number, names: string[]): string[][] => Array.from({ length: commits }, () => names);

test("with no arguments, a check that posted on every sampled commit is discovered and required", () => {
  const run = onboardWith([], { history: postedOnEvery(5, ["check"]) });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"], "the same ruleset a hand-written `onboard.sh repo check` writes");
  assert.doesNotMatch(run.output, /WARNING/, "a target whose own CI is required has nothing to warn about");
});

/**
 * The names the run reported as possibly path-filtered, read off the note's own lines
 * rather than the prose around them, so the note can explain itself without that reading
 * as a name.
 */
const reportedPathFiltered = (output: string): string[] =>
  output.split("\n").flatMap((line) => {
    const reported = line.match(/^##\s+(.+?) \(posted on \d+ of \d+\)$/);
    return reported ? [reported[1]!] : [];
  });

/** The sample size the script actually uses, and the header comment that should explain it. */
const script = fs.readFileSync(onboard, "utf8");
const sampleSize = Number(/^check_sample=(\d+)$/m.exec(script)![1]);
const headerComment = script.slice(0, script.indexOf("set -euo pipefail"));

/** The `check-runs` reads the run made, one per commit it sampled. */
const checkRunCalls = (calls: string[][]): string[][] =>
  calls.filter((args) => args.some((argument) => argument.includes("/check-runs")));

test("a check on some sampled commits but not all is reported as path-filtered, never required", () => {
  // The hazard the sample exists for: `docs` posts only on commits that touch docs, so a PR
  // that touches none of its paths would wait forever for a check that never arrives.
  const run = onboardWith([], {
    history: [["check", "docs"], ["check"], ["check", "docs"], ["check"], ["check"]],
  });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"], "only the intersection is required");
  assert.deepEqual(reportedPathFiltered(run.output), ["docs"], "and the one left out is named, not silently dropped");
  assert.match(run.output, /never posts|waiting forever/i, "the note has to say what requiring it would cost");
});

test("a check that posted on the newest commit alone is not required off that one commit", () => {
  const run = onboardWith([], { history: [["check", "release"], ["check"], ["check"], ["check"], ["check"]] });
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.deepEqual(reportedPathFiltered(run.output), ["release"]);
});

test("discovery samples more than one commit, and asks GitHub for exactly the header's sample size", () => {
  const run = onboardWith([], { history: postedOnEvery(sampleSize + 3, ["check"]) });
  assert.ok(sampleSize > 1, "a sample of one cannot tell an always-on check from a path-filtered one");
  assert.equal(checkRunCalls(run.calls).length, sampleSize, `discovery should read the check runs of ${sampleSize} commits`);
  const listing = run.calls.find((args) => args.some((argument) => argument.includes("/commits?sha=")));
  assert.ok(
    listing?.some((argument) => argument.includes(`per_page=${sampleSize}`)),
    `the commit listing should ask for ${sampleSize} commits, it ran: gh ${listing?.join(" ")}`,
  );
});

test("the header comment states the sample size and the reason, for whoever runs the script", () => {
  // The number alone is a magic constant; the reason is what stops the next person moving it
  // in the direction that makes a path-filtered check look always-on.
  assert.match(headerComment, new RegExp(`\\b${sampleSize}\\b`), "the header should name the sample size it uses");
  assert.match(headerComment, /reason|because/i, "and say why that number");
  assert.match(headerComment, /path-filter/i, "which is the hazard the sample size answers");
});

test("naming checks on the command line overrides discovery, which is then never asked for", () => {
  // Discovery gets it wrong sometimes, and the positional arguments are the way out. A run
  // that read the history anyway would be a run whose override is only half an override.
  const run = onboardWith(["only-this"], { history: postedOnEvery(5, ["check", "lint"]) });
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "only-this"]);
  assert.deepEqual(checkRunCalls(run.calls), [], "no history is read when the maintainer named the checks");
  assert.doesNotMatch(run.output, /WARNING/);
});

test("with no caller, discovery still runs and the factory's three stay out of the ruleset", () => {
  const run = onboardWith([], { history: postedOnEvery(5, ["check"]), hasCaller: false });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, ["check"], "no caller means the factory's three are never posted");
  assert.doesNotMatch(run.output, /WARNING/);
});

test("the factory's own checks in a target's history are never rediscovered as its own CI", () => {
  // A target that carried a caller and then lost it still has `factory/verdict` all over its
  // history. Requiring it off that history would be a ruleset waiting on a check nothing posts.
  const run = onboardWith([], { history: postedOnEvery(5, factoryChecks), hasCaller: false });
  assert.equal(run.code, 0);
  assert.deepEqual(run.requiredChecks, [], "whether the factory's three are required is read off the caller, not history");
  assert.match(run.output, /requires nothing at all/i);
});

test("a name posted twice on one commit is one commit's worth of evidence, not two", () => {
  // A re-run posts a second check run under the same name. Counting it twice would push the
  // name past the sample size and drop it out of the intersection.
  const run = onboardWith([], { history: [["check", "check"], ["check"], ["check"], ["check"], ["check"]] });
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.deepEqual(reportedPathFiltered(run.output), []);
});

test("a repo with fewer commits than the sample takes the intersection over the ones it has", () => {
  const run = onboardWith([], { history: [["check"], ["check"]] });
  assert.deepEqual(run.requiredChecks, [...factoryChecks, "check"]);
  assert.match(run.output, /2 recent commits/, "the run should say how many commits it actually read");
});

test("a target whose CI posted nothing on any sampled commit still onboards, and still warns", () => {
  const run = onboardWith([], { history: postedOnEvery(5, []) });
  assert.equal(run.code, 0, "a target with no CI can still be onboarded; the warning is the point");
  assert.deepEqual(run.requiredChecks, factoryChecks);
  assert.match(run.output, /WARNING/);
  assert.deepEqual(reportedPathFiltered(run.output), [], "nothing posted is nothing to report either");
});

test("a commit listing that fails aborts, rather than being read as a repo with no history", () => {
  // The same rule the caller check follows: a rate limit is not an answer to "what does this
  // target's CI post", and reading it as "nothing" would write a ruleset gating on the
  // factory's three alone, with a warning that misdescribes why.
  const run = onboardWith([], { commitsError: "gh: API rate limit exceeded (HTTP 403)" });
  assert.notEqual(run.code, 0, "an ambiguous answer must not be treated as a target whose CI posted nothing");
  assert.match(run.output, /rate limit/i, "the real gh error reaches the maintainer, not a swallowed failure");
  assert.doesNotMatch(
    run.output,
    /ruleset factory (created|updated)/,
    "no ruleset should be written off a discovery read that never actually answered",
  );
});
