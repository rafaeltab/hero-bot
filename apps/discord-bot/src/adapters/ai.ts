import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { Config, Effect, Layer } from "effect";
import {
  TextGeneration,
  TextGenerationUnavailable,
} from "../capabilities/text-generation/contract.ts";

/** Transport injection is adapter construction only; consumers see no SDK types. */
export const openAITextLive = (
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly modelId?: string;
  } = {},
) =>
  Layer.effect(
    TextGeneration,
    Effect.gen(function* () {
      const apiKey = yield* Config.String("HERO_AI_API_KEY").pipe(
        Effect.mapError(
          () => new TextGenerationUnavailable({ operation: "configuration" }),
        ),
      );
      const modelId = yield* Config.String("HERO_AI_MODEL").pipe(
        Effect.mapError(
          () => new TextGenerationUnavailable({ operation: "configuration" }),
        ),
      );
      if (
        !apiKey.trim() ||
        !modelId.trim() ||
        (options.modelId !== undefined && options.modelId !== modelId)
      )
        return yield* Effect.fail(
          new TextGenerationUnavailable({ operation: "configuration" }),
        );
      const model = createOpenAI({ apiKey, ...options }).chat(modelId);
      return TextGeneration.of({
        generate: (prompt, system) =>
          Effect.scoped(
            Effect.gen(function* () {
              const controller = new AbortController();
              const request = yield* Effect.acquireRelease(
                Effect.sync(() =>
                  generateText({
                    model,
                    prompt,
                    ...(system === undefined ? {} : { system }),
                    maxRetries: 0,
                    abortSignal: controller.signal,
                  }),
                ),
                (request) =>
                  Effect.promise(async () => {
                    controller.abort();
                    // Await SDK/transport settlement on every exit, including interruption.
                    await request.then(
                      () => undefined,
                      () => undefined,
                    );
                  }),
              );
              const result = yield* Effect.tryPromise({
                try: () => request,
                catch: () =>
                  new TextGenerationUnavailable({ operation: "generate" }),
              });
              return result.text;
            }),
          ),
      });
    }),
  );
