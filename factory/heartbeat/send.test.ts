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
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import { TARGET_REPOS } from "./targets.ts";

const repoRoot = new URL("../../", import.meta.url);
const ENTRYPOINT = "factory/heartbeat/send.ts";
/** The env var the host passes the token in, which is the one `gh` itself reads. */
const TOKEN_ENV = "GH_TOKEN";
/** The pages a maintainer onboards a target from, named as `dispatch/triggers.test.ts` names its own sites. */
const DOC_PAGES = ["README.md", "docs/pipeline.md"];

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
  assert.match(stdout, literal(`${TARGET_REPOS.length} target(s), ${TARGET_REPOS.length} woken, 0 skipped, 0 failed`));
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
