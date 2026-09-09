/**
 * Vendored from sandcastle 0.12.0, `.sandcastle/agent-workflows/shared/run-with-extraction.ts`.
 * No forced differences (#87). It is his to the line, verified byte for byte
 * against tag `v0.12.0`, commit `e99f832`, on 2026-09-09, so #47's rule that
 * every difference from him is named in the file leaves nothing to name here.
 * `docs/provenance/sandcastle.md` section 6 records the same.
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
