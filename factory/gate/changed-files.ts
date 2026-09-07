/**
 * Classifies the files a PR touches. The heuristics are generic on purpose:
 * the gate serves any target repo, so it only looks at paths, never at a
 * repo's test runner config.
 */

export type FileKind = "test" | "doc" | "source";
export type ChangeStatus = "A" | "M" | "D" | "R" | "C" | "T";

export interface ChangedFile {
  readonly status: ChangeStatus;
  readonly path: string;
  readonly oldPath?: string;
  readonly kind: FileKind;
}

const TEST_DIRS = new Set(["test", "tests", "__tests__"]);
const CODE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx",
  "py", "go", "rb", "rs", "java", "kt", "swift", "cs", "php", "ex", "exs",
]);
const DOC_EXTENSIONS = new Set(["md", "mdx", "markdown", "txt", "rst", "adoc"]);
const DOC_BASENAMES = /^(license|licence|changelog|authors|contributors|notice|copying)(\..*)?$/i;

const extensionOf = (p: string): string => {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
};

export const isTestFile = (p: string): boolean => {
  if (!CODE_EXTENSIONS.has(extensionOf(p))) return false;
  const segments = p.split("/");
  const base = segments[segments.length - 1];
  if (segments.slice(0, -1).some((s) => TEST_DIRS.has(s))) return true;
  return /\.(test|spec)\.[^.]+$/.test(base) || /_test\.go$/.test(base) || /^test_.*\.py$|_test\.py$/.test(base);
};

export const isDocFile = (p: string): boolean => {
  const segments = p.split("/");
  const base = segments[segments.length - 1];
  if (segments.slice(0, -1).some((s) => s === "docs" || s === "doc")) return true;
  if (DOC_BASENAMES.test(base)) return true;
  return DOC_EXTENSIONS.has(extensionOf(p));
};

export const classifyFile = (p: string): FileKind =>
  isTestFile(p) ? "test" : isDocFile(p) ? "doc" : "source";

/** Parses `git diff --name-status -M` output. Renames carry both paths. */
export const parseNameStatus = (output: string): ChangedFile[] =>
  output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [raw, a, b] = line.split("\t");
      const status = raw[0] as ChangeStatus;
      const path = status === "R" || status === "C" ? b : a;
      const file: ChangedFile = { status, path, kind: classifyFile(path) };
      return status === "R" || status === "C" ? { ...file, oldPath: a } : file;
    });
