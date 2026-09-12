/**
 * The files of this repo a text fixture scans, for the tests that hold a page or a copied line to
 * what it agreed to say (`onboard/judged-path-instruction.test.ts`, `onboard/token-scope.test.ts`).
 *
 * Named roots rather than a walk from the top, because a checkout of this repo holds other
 * sessions' worktrees under `.claude/`, and skipping test files because the agreed literal a
 * fixture compares against lives in one.
 */
import * as fs from "node:fs";

/** The roots worth scanning: the pages a maintainer or an agent reads, what a target copies, the code. */
export const REPO_ROOTS = ["README.md", "CONTEXT.md", "AGENTS.md", "CLAUDE.md", "docs", "templates", "scripts", "factory", ".github"];

/** Every non-test file under `roots`, by its path from the repo root. A missing root contributes none. */
const walk = (entry: string): string[] => {
  const url = new URL(`../../${entry}`, import.meta.url);
  if (!fs.existsSync(url)) return [];
  if (!fs.statSync(url).isDirectory()) return entry.endsWith(".test.ts") ? [] : [entry];
  return fs.readdirSync(url).flatMap((name) => (name === "node_modules" ? [] : walk(`${entry}/${name}`)));
};

export const repoFiles = (roots: string[] = REPO_ROOTS): string[] => roots.flatMap(walk);
