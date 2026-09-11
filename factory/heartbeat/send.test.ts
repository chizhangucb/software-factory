/**
 * The runnable's wiring (#222). A host runs `send.ts` on bare
 * `node --experimental-strip-types` with no `npm ci`, so every module it
 * reaches has to be imported with an explicit `.ts` specifier and may not pull
 * a package in. Nothing in the type system knows either: prior art and the same
 * failure mode is `lib/strip-types-cone.test.ts`, which pins the five workflow
 * entrypoints this one is not one of.
 *
 * The documented command is pinned here too, because a host runs whatever the
 * docs say and a renamed entrypoint would leave both pages pointing at nothing.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const repoRoot = new URL("../../", import.meta.url);
const ENTRYPOINT = "factory/heartbeat/send.ts";
/** The env var the host passes the token in, which is the one `gh` itself reads. */
const TOKEN_ENV = "GH_TOKEN";

/** The `from "x"` of any import or re-export, including the `} from "x"` that closes a multi-line one. */
const FROM_IMPORT = /^\s*(?:import|export|\})[^'"\n]*\bfrom\s*["']([^"']+)["']/gm;

/** Every module specifier of every file the entrypoint reaches, transitively. */
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
    for (const match of fs.readFileSync(onDisk, "utf8").matchAll(FROM_IMPORT)) {
      const specifier = match[1]!;
      imports.push({ file, specifier });
      if (specifier.startsWith(".")) queue.push(path.posix.join(path.posix.dirname(file), specifier));
    }
  }
  return imports;
};

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

test("both pages a maintainer onboards from name the command and the token", () => {
  for (const page of ["README.md", "docs/pipeline.md"]) {
    const text = fs.readFileSync(new URL(page, repoRoot), "utf8");
    assert.match(text, new RegExp(ENTRYPOINT.replaceAll("/", "\\/")), `${page} names the runnable`);
    assert.match(text, new RegExp(`\\b${TOKEN_ENV}\\b`), `${page} names the env var the token travels in`);
  }
});
