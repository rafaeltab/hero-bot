import { Context, Data, type Effect } from "effect";

export class TextGenerationUnavailable extends Data.TaggedError(
  "TextGenerationUnavailable",
)<{
  readonly operation: "configuration" | "generate";
}> {}

/** Transient original attachment content. Never persist these bytes. */
export type AttachmentContent = {
  readonly filename: string;
  readonly mediaType: string;
  readonly data: Uint8Array;
};
export type InvocationContext = {
  guildId: string;
  purpose: "judgment" | "translation";
};
export type InvocationAttempt = Partial<InvocationContext> & {
  attempt: number;
};

/** Text and original image/PDF input; no tools, retrieval or agent actions. */
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
      contents?: readonly AttachmentContent[],
    ) => Effect.Effect<string, TextGenerationUnavailable>;
  }
>()("hero-bot/TextGeneration") {}
