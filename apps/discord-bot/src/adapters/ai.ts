import { randomUUID } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, generateText } from "ai";
import { Config, Effect, Layer } from "effect";
import {
  type AttachmentContent,
  type InvocationAttempt,
  type InvocationContext,
  TextGeneration,
  TextGenerationUnavailable,
} from "../capabilities/text-generation/contract.ts";

/** Transport injection is adapter construction only; consumers see no SDK types. */
export const openAITextLive = (
  options: {
    readonly maxOutputTokens?: number;
    readonly fetch?: typeof globalThis.fetch;
    readonly modelId?: string;
    /** Runs before each paid transport attempt; durable budget admission runs here. */
    readonly beforeAttempt?: (
      event: InvocationAttempt,
    ) => Effect.Effect<void, TextGenerationUnavailable>;
    /** Sanitized accounting observation, including retries and failed requests. */
    readonly afterAttempt?: (
      event: InvocationAttempt & {
        outcome: "succeeded" | "failed" | "interrupted";
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
      },
    ) => Effect.Effect<void, TextGenerationUnavailable>;
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
      const attempt = (
        prompt: string,
        system: string | undefined,
        context: InvocationContext | undefined,
        number: number,
        contents: readonly AttachmentContent[],
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const event = {
              ...context,
              attempt: number,
              id: randomUUID(),
            };
            yield* options.beforeAttempt?.(event) ?? Effect.void;
            const controller = new AbortController();
            const request = yield* Effect.acquireRelease(
              Effect.sync(() =>
                generateText({
                  model,
                  ...(contents.length === 0
                    ? { prompt }
                    : {
                        messages: [
                          {
                            role: "user" as const,
                            content: [
                              { type: "text" as const, text: prompt },
                              ...contents.map((c) => {
                                return {
                                  type: "file" as const,
                                  data: c.data,
                                  mediaType: c.mediaType,
                                  filename: c.filename,
                                };
                              }),
                            ],
                          },
                        ],
                      }),

                  ...(system === undefined ? {} : { system }),
                  maxRetries: 0,
                  ...(options.maxOutputTokens === undefined
                    ? {}
                    : { maxOutputTokens: options.maxOutputTokens }),
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
              catch: (error) => error,
            }).pipe(
              Effect.tapError(
                (error) =>
                  options.afterAttempt?.({
                    ...event,
                    outcome: "failed",
                    ...failureUsage(error),
                  }) ?? Effect.void,
              ),
              Effect.onInterrupt(() => {
                return (
                  options.afterAttempt?.({
                    ...event,
                    outcome: "interrupted",
                  }) ?? Effect.void
                ).pipe(Effect.catch(() => Effect.void));
              }),
            );
            yield* options.afterAttempt?.({
              ...event,
              outcome: "succeeded",
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            }) ?? Effect.void;
            return result.text;
          }),
        );
      return TextGeneration.of({
        generate: (prompt, system, context, contents = []) => {
          const run = (
            number: number,
          ): Effect.Effect<string, TextGenerationUnavailable> =>
            attempt(prompt, system, context, number, contents).pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  if (error instanceof TextGenerationUnavailable)
                    return yield* Effect.fail(error);
                  if (
                    number >= 3 ||
                    !APICallError.isInstance(error) ||
                    !error.isRetryable
                  )
                    return yield* Effect.fail(
                      new TextGenerationUnavailable({ operation: "generate" }),
                    );
                  yield* Effect.sleep(retryDelay(error, number));
                  return yield* run(number + 1);
                }),
              ),
            );
          return run(1);
        },
      });
    }),
  );

/** Never shorten a provider delay, including delays above the SDK's 60s limit. */
const retryDelay = (error: APICallError, attempt: number): number => {
  const headers = error.responseHeaders ?? {};
  const milliseconds = Number(headers["retry-after-ms"]);
  if (
    headers["retry-after-ms"] &&
    Number.isFinite(milliseconds) &&
    milliseconds >= 0
  )
    return milliseconds;
  const value = headers["retry-after"];
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** (attempt - 1);
};

/** Some providers report billed usage on error responses. Never persist the body. */
const failureUsage = (
  error: unknown,
): { inputTokens?: number; outputTokens?: number } => {
  if (!APICallError.isInstance(error) || !error.responseBody) return {};
  try {
    const body = JSON.parse(error.responseBody);
    return {
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
    };
  } catch {
    return {};
  }
};
