import { Context, Data, type Effect } from "effect";

export class TextGenerationUnavailable extends Data.TaggedError(
  "TextGenerationUnavailable",
)<{
  readonly operation: "configuration" | "generate";
}> {}

export type InvocationContext = {
  guildId: string;
  purpose: "judgment" | "translation";
};
export type InvocationAttempt = Partial<InvocationContext> & {
  attempt: number;
};

/** Plain text only: no moderation judgment, tools, retrieval or agent actions. */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /** At most three transport attempts for retryable provider failures; SDK retries disabled. Failures contain no prompt, credentials or provider diagnostics.
     * Interruption cancels the request and awaits transport settlement before completing.
     */
    readonly generate: (
      prompt: string,
      system?: string,
      context?: InvocationContext,
    ) => Effect.Effect<string, TextGenerationUnavailable>;
  }
>()("hero-bot/TextGeneration") {}
