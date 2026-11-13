import { Context, Data, type Effect } from "effect";

export class TextGenerationUnavailable extends Data.TaggedError(
  "TextGenerationUnavailable",
)<{
  readonly operation: "configuration" | "generate";
}> {}

/** Plain text only: no moderation judgment, tools, retrieval or agent actions. */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /** One request, no retries. Failures contain no prompt, credentials or provider diagnostics.
     * Interruption cancels the request and awaits transport settlement before completing.
     */
    readonly generate: (
      prompt: string,
      system?: string,
    ) => Effect.Effect<string, TextGenerationUnavailable>;
  }
>()("hero-bot/TextGeneration") {}
