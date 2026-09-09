/**
 * Vendored from sandcastle 0.12.0, `.sandcastle/agent-workflows/shared/run-with-extraction.ts`.
 * No forced differences (#47, #87): below this header the file is identical to
 * upstream, so the list #47 keeps true is empty here.
 * `docs/provenance/sandcastle.md` section 6 carries the row and its counts,
 * unmoved, since that table's method excludes comments.
 */
import {
  run,
  type OutputObjectDefinition,
  type RunOptions,
  type RunResult,
} from "@ai-hero/sandcastle";

export interface RunWithExtractionOptions<T> extends Omit<
  RunOptions,
  "output"
> {
  readonly output: OutputObjectDefinition<T>;
  readonly extractionPrompt: string;
  /**
   * Extra attempts after the first if extraction or validation fails. Forwarded
   * to `Output`'s built-in `maxRetries`, which resumes the extraction session
   * and feeds back the error so the agent can re-emit a corrected tag.
   * Default: `2` (three attempts total).
   */
  readonly maxRetries?: number;
}

export async function runWithExtraction<T>(
  options: RunWithExtractionOptions<T>,
): Promise<RunResult & { output: T }> {
  const {
    output,
    extractionPrompt,
    maxRetries = 2,
    ...produceOptions
  } = options;
  const produce = await run(produceOptions);
  const sessionId = produce.iterations.at(-1)?.sessionId;

  if (!sessionId) {
    throw new Error(
      "Cannot extract structured output because the produce run had no session id.",
    );
  }

  const { promptArgs: _promptArgs, ...extractionOptions } = produceOptions;
  const extraction = await run({
    ...extractionOptions,
    name: produceOptions.name ? `${produceOptions.name} (extract)` : undefined,
    promptFile: undefined,
    prompt: extractionPrompt,
    resumeSession: sessionId,
    output: { ...output, maxRetries },
  });

  return { ...produce, output: extraction.output };
}
