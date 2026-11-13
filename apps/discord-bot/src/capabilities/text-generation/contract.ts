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
/** Text and supplied image/PDF input; no tools, retrieval or agent actions. */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /** One request, no retries. Failures contain no prompt, credentials or provider diagnostics.
     * Interruption cancels the request and awaits transport settlement before completing.
     */
    readonly generate: (
      prompt: string,
      system?: string,
      contents?: readonly AttachmentContent[],
    ) => Effect.Effect<string, TextGenerationUnavailable>;
  }
>()("hero-bot/TextGeneration") {}
