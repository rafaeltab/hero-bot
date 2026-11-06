import { expect, it } from "@effect/vitest";
import { ConfigProvider, Deferred, Effect, Fiber } from "effect";
import { openAITextLive } from "../src/adapters/ai.ts";
import {
  TextGeneration,
  TextGenerationUnavailable,
} from "../src/capabilities/text-generation/contract.ts";

const settings = {
  HERO_AI_API_KEY: "controlled-key",
  HERO_AI_MODEL: "controlled-model",
};
const configuration = ConfigProvider.layer(
  ConfigProvider.fromUnknown(settings),
);

it.effect(
  "generates text through the real SDK and provider HTTP protocol",
  () =>
    Effect.gen(function* () {
      const requests: unknown[] = [];
      const responses: Response[] = [];
      const released: string[] = [];
      const live = openAITextLive({
        fetch: async (url, init) => {
          requests.push({ url, body: JSON.parse(String(init?.body)) });
          init?.signal?.addEventListener(
            "abort",
            () => released.push("request released"),
            { once: true },
          );
          const response = Response.json({
            id: "controlled-response",
            object: "chat.completion",
            created: 0,
            model: "controlled-model",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "Hello from controlled transport",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
          });
          responses.push(response);
          return response;
        },
      });
      const text = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* ai.generate("Say hello");
      }).pipe(Effect.provide(live), Effect.provide(configuration));
      expect(text).toBe("Hello from controlled transport");
      expect(responses.map((response) => response.bodyUsed)).toEqual([true]);
      expect(released).toEqual(["request released"]);
      expect(requests).toEqual([
        {
          url: "https://api.openai.com/v1/chat/completions",
          body: {
            model: "controlled-model",
            messages: [{ role: "user", content: "Say hello" }],
          },
        },
      ]);
    }),
);

it.effect.each(["provider", "transport", "invalid-response"])(
  "translates failed SDK calls without leaking provider diagnostics",
  (failure) =>
    Effect.gen(function* () {
      let calls = 0;
      const released: string[] = [];
      const live = openAITextLive({
        fetch: async (_url, init) => {
          init?.signal?.addEventListener(
            "abort",
            () => released.push("request released"),
            { once: true },
          );
          calls++;
          if (failure === "transport")
            throw new Error("private transport details");
          if (failure === "invalid-response")
            return Response.json({ private: "invalid response" });
          return Response.json(
            {
              error: {
                message: "private provider details",
                type: "server_error",
              },
            },
            { status: 503 },
          );
        },
      });
      const error = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* Effect.flip(ai.generate("private prompt"));
      }).pipe(Effect.provide(live), Effect.provide(configuration));
      expect(error).toEqual(
        new TextGenerationUnavailable({ operation: "generate" }),
      );
      expect(calls).toBe(1);
      expect(released).toEqual(["request released"]);
      expect(JSON.stringify(error)).not.toContain("private");
    }),
);

it.effect.each([
  {},
  { HERO_AI_MODEL: "model" },
  { HERO_AI_API_KEY: "secret" },
  { HERO_AI_API_KEY: "", HERO_AI_MODEL: "model" },
  { HERO_AI_API_KEY: " \t ", HERO_AI_MODEL: "model" },
  { HERO_AI_API_KEY: "secret", HERO_AI_MODEL: "  " },
])(
  "rejects absent or blank provider configuration before any request",
  (config) =>
    Effect.gen(function* () {
      let calls = 0;
      const failure = yield* Effect.flip(
        Effect.gen(function* () {
          const ai = yield* TextGeneration;
          yield* ai.generate("invalid configuration must not reach transport");
        }).pipe(
          Effect.provide(
            openAITextLive({
              fetch: async () => {
                calls++;
                throw new Error("unexpected request");
              },
            }),
          ),
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown(config)),
          ),
        ),
      );
      expect(failure).toEqual(
        new TextGenerationUnavailable({ operation: "configuration" }),
      );
      expect(calls).toBe(0);
    }),
);

it.effect(
  "interruption aborts the SDK request and awaits transport cleanup",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const events: string[] = [];
      const live = openAITextLive({
        fetch: async (_url, init) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                events.push("aborted");
                setTimeout(() => {
                  events.push("released");
                  reject(new DOMException("Aborted", "AbortError"));
                }, 10);
              },
              { once: true },
            );
            Deferred.doneUnsafe(started, Effect.void);
          });
        },
      });
      const fiber = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* ai.generate("pending request");
      }).pipe(
        Effect.provide(live),
        Effect.provide(configuration),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      expect(events).toEqual(["aborted", "released"]);
    }),
);

it.effect(
  "default transport construction validates configuration without a live call",
  () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          yield* TextGeneration;
        }).pipe(
          Effect.provide(openAITextLive()),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
        ),
      );
      expect(error).toEqual(
        new TextGenerationUnavailable({ operation: "configuration" }),
      );
    }),
);
