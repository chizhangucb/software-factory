/**
 * The runnable's wiring (#222). A host runs `send.ts` on bare
 * `node --experimental-strip-types` with no `npm ci`, so every module it
 * reaches has to be imported with an explicit `.ts` specifier and may not pull
 * a package in. Nothing in the type system knows either: the prior art and the
 * same failure mode is `lib/strip-types-cone.test.ts`, whose table covers the
 * five workflow entrypoints this one is not one of.
 *
 * Two checks, because neither catches the other's failure: one pass actually
 * runs the command a host runs, which a bad specifier kills outright, and one
 * walks the imports for a package that resolves here and would not on a host
 * that installs nothing. The three import patterns are the cone test's, whole:
 * keeping one of them was how the first draft of this file passed green on the
 * imports it did not read.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PAUSE_VARIABLE } from "./pause.ts";
import { TARGET_REPOS } from "./targets.ts";
import { WAIVER_VARIABLE } from "./waiver.ts";

const repoRoot = new URL("../../", import.meta.url);
const ENTRYPOINT = "factory/heartbeat/send.ts";
/** The env var the host passes the token in, which is the one `gh` itself reads. */
const TOKEN_ENV = "GH_TOKEN";
/** The pages a maintainer onboards a target from, named as `dispatch/triggers.test.ts` names its own sites. */
const DOC_PAGES = ["README.md", "docs/pipeline.md"];
/**
 * The jobs a pause deliberately keeps, read off the caller rather than listed:
 * a job that keeps running while paused is one whose condition does not gate
 * on the pause variable, `paused` itself aside, which runs only while it is
 * set. Derived because the names are the point of the assertion below -- a
 * third job joining the set has to reach both pages, and a list spelled here
 * would go on passing while the pages went stale.
 *
 * Which jobs those are and why is `dispatch/triggers.test.ts`'s subject, tied
 * there to the caller's real conditions. Here they are only the names both
 * pages have to carry.
 */
const keepsRunningWhilePaused = (): string[] => {
  const template = fs.readFileSync(new URL("templates/factory.yml", repoRoot), "utf8");
  // Every job minus the gated ones, rather than only the jobs that carry an
  // `if:`: a job with no condition at all is the plainest thing a pause does
  // not stop, and deriving from the conditions alone would leave one out of
  // both pages with this green.
  const block = template.slice(template.indexOf("\njobs:"));
  assert.ok(block.startsWith("\njobs:"), "the caller template has a jobs block");
  const ids = [...block.matchAll(/\n {2}([a-z][a-z0-9_-]*):\n/g)].map(([, id]) => id!);
  assert.ok(ids.length > 0, "the caller template has jobs in it");
  const gated = new Set(
    [...block.matchAll(/\n {2}([a-z][a-z0-9_-]*):\n {4}if:((?:.*)(?:\n {6,}.*)*)/g)]
      .filter(([, , expression]) => expression!.includes(PAUSE_VARIABLE))
      .map(([, id]) => id!),
  );
  return ids.filter((id) => id !== "paused" && !gated.has(id));
};

/** A literal as a regex: a target or a path is matched whole, never as a pattern. */
const literal = (text: string): RegExp => new RegExp(text.replaceAll(/[.*+?^${}()|[\]\\/]/g, "\\$&"));

/** `import "x"`, on its own with no bindings. */
const SIDE_EFFECT_IMPORT = /^\s*import\s+["']([^"']+)["']/gm;
/** The `from "x"` of any import or re-export, including the `} from "x"` that closes a multi-line one. */
const FROM_IMPORT = /^\s*(?:import|export|\})[^'"\n]*\bfrom\s*["']([^"']+)["']/gm;
/** `import("x")`, anywhere on a line. */
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']/g;

/**
 * Every module specifier of every file the entrypoint reaches, transitively.
 * An inline `type` specifier is not skipped: type stripping blanks the keyword
 * and leaves the import, so the module is still loaded at runtime.
 */
const walkFrom = (entrypoint: string): { file: string; specifier: string }[] => {
  const reached = new Set<string>();
  const imports: { file: string; specifier: string }[] = [];
  const queue = [entrypoint];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (reached.has(file)) continue;
    reached.add(file);
    const onDisk = new URL(file, repoRoot);
    assert.ok(fs.existsSync(onDisk), `${entrypoint} reaches ${file}, which does not exist`);
    const source = fs.readFileSync(onDisk, "utf8");
    for (const pattern of [SIDE_EFFECT_IMPORT, FROM_IMPORT, DYNAMIC_IMPORT]) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]!;
        imports.push({ file, specifier });
        if (specifier.startsWith(".")) queue.push(path.posix.join(path.posix.dirname(file), specifier));
      }
    }
  }
  return imports;
};

test("the command a host runs completes a pass on bare node, with nothing installed", () => {
  // The real command, so a specifier strip-types cannot resolve fails here
  // rather than on the host. DRY_RUN sends no dispatch and an empty PATH means
  // no `gh` to send one with, so a live target is never woken by a test run.
  const stdout = execFileSync(process.execPath, ["--experimental-strip-types", ENTRYPOINT], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { DRY_RUN: "1", PATH: "" },
  });
  for (const target of TARGET_REPOS) assert.match(stdout, literal(`factory-sweep dispatched to ${target} (dry run)`));
  // Every outcome in the summary, so a pass that skipped a target says so
  // rather than reading as a quiet repo.
  assert.match(stdout, literal(`${TARGET_REPOS.length} target(s), ${TARGET_REPOS.length} woken, 0 skipped, 0 paused, 0 failed`));
});

/**
 * A pass against a stub `gh`, the way `factory/waiver/waive-factory-checks.test.ts`
 * runs the script: the stub answers each target's two variable reads from the
 * env and every open-work read with nothing, so no target is woken and no
 * network is touched. A call it does not recognise fails, so a reshaped `gh`
 * line breaks this loudly rather than answering empty.
 *
 * Both variables answer the same way: a value set in the env is the variable's
 * value, an empty one is the 404 GitHub sends for a variable that is not there,
 * and `fail` is a read that genuinely went wrong, which is the case the pause
 * and the waiver deliberately answer differently.
 *
 * `variablesReadable` is the third answer, and the one that tells the first two
 * apart: the list endpoint, which a token that may read variables answers 200
 * even when the target has none. Default true, since that is every target whose
 * token is scoped as README says.
 */
const passAgainstStub = ({
  waived = "",
  paused = "",
  variablesReadable = true,
}: {
  waived?: string;
  paused?: string;
  variablesReadable?: boolean;
}): { stdout: string; stderr: string; status: number } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heartbeat-"));
  fs.writeFileSync(
    path.join(dir, "gh"),
    `#!/usr/bin/env bash
args="$*"
answer() {
  if [ "$1" = "fail" ]; then echo "gh: API rate limit exceeded (HTTP 403)" >&2; exit 1; fi
  if [ -n "$1" ]; then printf '%s\\n' "$1"; else echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
}
case "$args" in
  *"actions/variables/${WAIVER_VARIABLE}"*) answer "\${GH_WAIVED:-}" ;;
  *"actions/variables/${PAUSE_VARIABLE}"*) answer "\${GH_PAUSED:-}" ;;
  *"actions/variables"*) answer "\${GH_VARS_LIST:-}" ;;
  *"issues?state=open"*) ;;
  *) echo "stub gh: unexpected call: $args" >&2; exit 1 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, ["--experimental-strip-types", ENTRYPOINT], {
    cwd: fileURLToPath(repoRoot),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      DRY_RUN: "",
      GH_WAIVED: waived,
      GH_PAUSED: paused,
      // The count GitHub answers a list read with, which is "0" for a target
      // that has no variables at all: an answer, and not the absence of one.
      GH_VARS_LIST: variablesReadable ? "0" : "",
    },
  });
  // A pass that never ran, or one a signal killed, has no status to read: say
  // so here rather than asserting against a null stdout further down.
  assert.ok(!result.error, `the pass ran: ${result.error?.message}`);
  assert.equal(result.signal, null, "the pass was not killed");
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
};

test("a pass names an open waiver, with its reason and the target", () => {
  const { stdout } = passAgainstStub({ waived: "PAT expired, see #244" });
  for (const target of TARGET_REPOS) assert.match(stdout, literal(`${target} WAIVED: PAT expired, see #244`));
  assert.match(stdout, literal(WAIVER_VARIABLE));
});

test("a target with no waiver produces no such line", () => {
  // The variable unset is a 404, which is not a failure and not a nag either.
  const { stdout } = passAgainstStub({});
  assert.doesNotMatch(stdout, /WAIVED/);
  assert.match(stdout, literal(`${TARGET_REPOS.length} target(s), 0 woken, ${TARGET_REPOS.length} skipped, 0 paused, 0 failed`));
});

test("a paused target is skipped for the pause, and the pass says so rather than calling it idle", () => {
  // Acceptance criteria 1 and 2 through the real script: the stub fails any
  // call it does not recognise and knows no dispatch, so a pass that wakes a
  // paused target here exits non-zero rather than passing quietly.
  const { stdout, status } = passAgainstStub({ paused: "runaway sweep, see #123" });
  assert.equal(status, 0, stdout);
  for (const target of TARGET_REPOS) assert.match(stdout, literal(`${target} skipped: paused (runaway sweep, see #123)`));
  assert.doesNotMatch(stdout, /dispatched to/);
  assert.doesNotMatch(stdout, /skipped: nothing waiting/);
  // Counted apart in the summary too, so a pass that skipped every target for
  // a pause does not read as a quiet estate.
  assert.match(stdout, literal(`${TARGET_REPOS.length} target(s), 0 woken, 0 skipped, ${TARGET_REPOS.length} paused, 0 failed`));
  assert.match(stdout, literal(PAUSE_VARIABLE));
});

test("a token that cannot read a target's variables fails it, rather than reading every pause as unset", () => {
  // Acceptance criterion 6 again, against the way the failure actually
  // arrives. A fine-grained PAT holding the repo but not Actions variables
  // read answers this endpoint 404, the same 404 as a variable that is simply
  // not there, so on its own "404 means unset" hands back "not paused" for
  // every target that token covers -- including one a maintainer really did
  // pause, woken every interval with the pass reporting it woken. The list
  // endpoint is what tells them apart: a token that may read variables answers
  // it 200 even when the target has none.
  const { stdout, stderr, status } = passAgainstStub({ paused: "", variablesReadable: false });
  assert.equal(status, 1, stdout);
  for (const target of TARGET_REPOS) assert.match(stderr, literal(`factory-sweep FAILED for ${target}`));
  assert.doesNotMatch(stdout, /dispatched to/);
  assert.match(stdout, literal(`0 woken, 0 skipped, 0 paused, ${TARGET_REPOS.length} failed`));
});

test("a target that is really paused is never asked whether its variables are readable", () => {
  // The list read is the 404's second question and nothing more. A pause that
  // answered with a value has already settled it, so making the call anyway
  // would spend a request per target per pass to re-confirm what the answer
  // just proved.
  const { stdout, status } = passAgainstStub({ paused: "incident", variablesReadable: false });
  assert.equal(status, 0, stdout);
  for (const target of TARGET_REPOS) assert.match(stdout, literal(`${target} skipped: paused (incident)`));
});

test("a pause that cannot be read fails its target rather than being taken for running", () => {
  // Acceptance criterion 6. The failure is a non-zero exit, which is what the
  // host's alerting sees, and the line names the target and the variable.
  const { stdout, stderr, status } = passAgainstStub({ paused: "fail" });
  assert.equal(status, 1, stdout);
  for (const target of TARGET_REPOS) assert.match(stderr, literal(`factory-sweep FAILED for ${target}`));
  assert.doesNotMatch(stdout, /dispatched to/);
  assert.match(stdout, literal(`${TARGET_REPOS.length} target(s), 0 woken, 0 skipped, 0 paused, ${TARGET_REPOS.length} failed`));
});

test("the runnable reaches only builtins and .ts files, so it runs with no npm install", () => {
  const imports = walkFrom(ENTRYPOINT);
  // A walk that finds nothing would pass every assertion below vacuously.
  assert.ok(imports.length > 0, `the walk from ${ENTRYPOINT} found no imports at all`);
  for (const { file, specifier } of imports) {
    if (specifier.startsWith(".")) {
      assert.ok(specifier.endsWith(".ts"), `${file} imports ${specifier} with no .ts extension, which strip-types cannot resolve`);
      continue;
    }
    assert.ok(specifier.startsWith("node:"), `${file} imports the package ${specifier}, and the host installs nothing`);
  }
});

test("every import form the cone test reads is read here too", () => {
  // The first draft of this file kept one of the three and enforced a third of
  // the rule it names. Each pattern is checked against the form it is for.
  const source = ['import "./side.ts";', 'import { a } from "./from.ts";', 'await import("./dynamic.ts");'].join("\n");
  const found = [SIDE_EFFECT_IMPORT, FROM_IMPORT, DYNAMIC_IMPORT].map((pattern) => [...source.matchAll(pattern)].map((m) => m[1]));
  assert.deepEqual(found, [["./side.ts"], ["./from.ts"], ["./dynamic.ts"]]);
});

test("both pages a maintainer onboards from name the command and the token", () => {
  for (const page of DOC_PAGES) {
    const text = fs.readFileSync(new URL(page, repoRoot), "utf8");
    assert.match(text, literal(ENTRYPOINT), `${page} names the runnable`);
    assert.match(text, new RegExp(`\\b${TOKEN_ENV}\\b`), `${page} names the env var the token travels in`);
  }
});

test("both pages say what a pause stops, what it does not, and that the heartbeat is what stops waking the target", () => {
  // Acceptance criterion 7. A maintainer reaches for the pause in an incident
  // and reads one of these two pages, so each has to carry the whole shape on
  // its own: which jobs keep running, and that the wake is what the heartbeat
  // withholds. Before #256 both pages described a pause that stopped the work
  // and said nothing about the runs it went on paying for.
  const kept = keepsRunningWhilePaused();
  assert.ok(kept.length > 0, "the caller keeps at least one job running while paused");
  for (const page of DOC_PAGES) {
    const text = fs.readFileSync(new URL(page, repoRoot), "utf8");
    assert.match(text, literal(PAUSE_VARIABLE), `${page} names the pause variable`);
    for (const job of kept) {
      assert.match(text, literal(job), `${page} names ${job}, which a pause does not stop`);
    }
    // All three in one sentence, because each on its own is already all over
    // both pages: the word "heartbeat" appears in the path of the runnable,
    // and "paused" in every bullet about the gate. The claim being pinned is
    // the one that joins them, that a pause is what stops the target being
    // woken, and only a sentence carrying all three makes it.
    const sentences = text.split(/(?<=[.:])\s/);
    assert.ok(
      sentences.some((sentence) => [/heartbeat/i, /\bwak(e|es|ing|en)\b/i, /\bpaused?\b/i].every((part) => part.test(sentence))),
      `${page} says in one sentence that the heartbeat is what stops waking a paused target`,
    );
  }
});
