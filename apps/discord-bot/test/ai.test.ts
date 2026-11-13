import { expect, it } from "@effect/vitest";
import { ConfigProvider, Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
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

it.live.each(["provider", "transport", "invalid-response"])(
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
      expect(calls).toBe(failure === "provider" ? 3 : 1);
      expect(released).toHaveLength(calls);
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
      const outcomes: string[] = [];
      const live = openAITextLive({
        afterAttempt: (event) =>
          Effect.sync(() => {
            outcomes.push(event.outcome);
          }),
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
      expect(outcomes).toEqual(["interrupted"]);
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

it.effect(
  "moderation sends the compact judgment policy as a system message through installed AI SDK/provider protocol",
  () =>
    Effect.gen(function* () {
      const bodies: unknown[] = [];
      const raw = JSON.stringify({
        action: "ban",
        reason: "Platform presumption.",
        offendingUrls: ["https://bilibili.com/video/1"],
      });
      const result = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* ai.generate(
          "Original supplied evidence",
          "Editable server policy",
        );
      }).pipe(
        Effect.provide(
          openAITextLive({
            modelId: "gpt-6-luna",
            fetch: async (_url, init) => {
              bodies.push(JSON.parse(String(init?.body)));
              return Response.json({
                id: "r",
                object: "chat.completion",
                created: 0,
                model: "gpt-6-luna",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: raw },
                    finish_reason: "stop",
                  },
                ],
              });
            },
          }),
        ),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              ...settings,
              HERO_AI_MODEL: "gpt-6-luna",
            }),
          ),
        ),
      );
      expect(result).toBe(raw);
      expect(bodies).toEqual([
        {
          model: "gpt-6-luna",
          messages: [
            { role: "developer", content: "Editable server policy" },
            { role: "user", content: "Original supplied evidence" },
          ],
        },
      ]);
    }),
);
it.effect(
  "moderation rejects a different configured model rather than storing false model provenance",
  () =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        return yield* TextGeneration;
      }).pipe(
        Effect.provide(openAITextLive({ modelId: "gpt-6-luna" })),
        Effect.provide(configuration),
        Effect.flip,
      );
      expect(result.operation).toBe("configuration");
    }),
);

it.live(
  "429 respects provider delay and stops after three transport attempts",
  () =>
    Effect.gen(function* () {
      const times: number[] = [];
      const result = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* Effect.flip(
          ai.generate("private", "policy", {
            guildId: "10",
            purpose: "translation",
          }),
        );
      }).pipe(
        Effect.provide(
          openAITextLive({
            fetch: async () => {
              times.push(performance.now());
              return Response.json(
                { error: { message: "secret", type: "rate_limit_error" } },
                { status: 429, headers: { "retry-after": "0.03" } },
              );
            },
          }),
        ),
        Effect.provide(configuration),
      );
      expect(result.operation).toBe("generate");
      expect(times).toHaveLength(3);
      expect(Number(times[1]) - Number(times[0])).toBeGreaterThanOrEqual(25);
      expect(Number(times[2]) - Number(times[1])).toBeGreaterThanOrEqual(25);
    }),
);

it.live.each([
  { "retry-after-ms": "5" },
  { "retry-after-ms": "bad", "retry-after": "0.005" },
  { "retry-after": new Date(0).toUTCString() },
  { "retry-after": "bad" },
])("retry header formats use the same bounded accounting path: %j", (headers) =>
  Effect.gen(function* () {
    const events: unknown[] = [];
    let calls = 0;
    const result = yield* Effect.gen(function* () {
      const ai = yield* TextGeneration;
      return yield* Effect.flip(
        ai.generate("private", "private policy", {
          guildId: "10",
          purpose: "translation",
        }),
      );
    }).pipe(
      Effect.provide(
        openAITextLive({
          beforeAttempt: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          afterAttempt: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          fetch: async () => {
            calls++;
            return Response.json(
              { error: { message: "secret", type: "rate_limit_error" } },
              { status: 429, headers },
            );
          },
        }),
      ),
      Effect.provide(configuration),
    );
    expect(result.operation).toBe("generate");
    expect(calls).toBe(3);
    expect(events).toEqual([
      { guildId: "10", purpose: "translation", attempt: 1 },
      { guildId: "10", purpose: "translation", attempt: 1, outcome: "failed" },
      { guildId: "10", purpose: "translation", attempt: 2 },
      { guildId: "10", purpose: "translation", attempt: 2, outcome: "failed" },
      { guildId: "10", purpose: "translation", attempt: 3 },
      { guildId: "10", purpose: "translation", attempt: 3, outcome: "failed" },
    ]);
  }),
);

it.effect(
  "long 429 delay is not shortened and interruption cancels backoff without another paid call",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      const failed = yield* Deferred.make<void>();
      const fiber = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* ai.generate("ordinary content");
      }).pipe(
        Effect.provide(
          openAITextLive({
            afterAttempt: () =>
              Deferred.succeed(failed, undefined).pipe(Effect.asVoid),
            fetch: async () => {
              calls++;
              return Response.json(
                { error: { message: "private", type: "rate_limit_error" } },
                { status: 429, headers: { "retry-after-ms": "70000" } },
              );
            },
          }),
        ),
        Effect.provide(configuration),
        Effect.forkChild,
      );
      yield* Deferred.await(failed);
      yield* TestClock.adjust("69 seconds");
      expect(calls).toBe(1);
      yield* Fiber.interrupt(fiber);
      yield* TestClock.adjust("1 day");
      expect(calls).toBe(1);
    }),
);

it.live(
  "temporary provider failure recovers within one invocation and accounts for successful usage",
  () =>
    Effect.gen(function* () {
      const events: unknown[] = [];
      let calls = 0;
      const text = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* ai.generate("private", "policy", {
          guildId: "10",
          purpose: "judgment",
        });
      }).pipe(
        Effect.provide(
          openAITextLive({
            afterAttempt: (event) =>
              Effect.sync(() => {
                events.push(event);
              }),
            fetch: async () => {
              calls++;
              if (calls === 1)
                return Response.json(
                  { error: { message: "private", type: "server_error" } },
                  { status: 503, headers: { "retry-after": "0" } },
                );
              return Response.json({
                id: "r",
                object: "chat.completion",
                created: 0,
                model: "controlled-model",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "allowed" },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 4,
                  completion_tokens: 5,
                  total_tokens: 9,
                },
              });
            },
          }),
        ),
        Effect.provide(configuration),
      );
      expect(text).toBe("allowed");
      expect(calls).toBe(2);
      expect(events).toEqual([
        { guildId: "10", purpose: "judgment", attempt: 1, outcome: "failed" },
        {
          guildId: "10",
          purpose: "judgment",
          attempt: 2,
          outcome: "succeeded",
          inputTokens: 4,
          outputTokens: 5,
        },
      ]);
    }),
);

it.effect(
  "supplies original image and PDF bytes through the installed chat adapter",
  () =>
    Effect.gen(function* () {
      const bodies: unknown[] = [];
      const result = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* ai.generate("Evidence metadata", "Policy", undefined, [
          {
            filename: "screen.png",
            mediaType: "image/png",
            data: new Uint8Array([137, 80, 78, 71]),
          },
          {
            filename: "lesson.pdf",
            mediaType: "application/pdf",
            data: new TextEncoder().encode("%PDF-1.4"),
          },
        ]);
      }).pipe(
        Effect.provide(
          openAITextLive({
            fetch: async (_url, init) => {
              bodies.push(JSON.parse(String(init?.body)));
              return Response.json({
                id: "r",
                object: "chat.completion",
                created: 0,
                model: "controlled-model",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "Judgment" },
                    finish_reason: "stop",
                  },
                ],
              });
            },
          }),
        ),
        Effect.provide(configuration),
      );
      expect(result).toBe("Judgment");
      expect(bodies).toEqual([
        {
          model: "controlled-model",
          messages: [
            { role: "system", content: "Policy" },
            {
              role: "user",
              content: [
                { type: "text", text: "Evidence metadata" },
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64,iVBORw==" },
                },
                {
                  type: "file",
                  file: {
                    filename: "lesson.pdf",
                    file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
                  },
                },
              ],
            },
          ],
        },
      ]);
    }),
);

it.live(
  "attachment retry preserves original bytes and server accounting on each paid attempt",
  () =>
    Effect.gen(function* () {
      const bodies: unknown[] = [];
      const attempts: unknown[] = [];
      const result = yield* Effect.gen(function* () {
        const ai = yield* TextGeneration;
        return yield* ai.generate(
          "Evidence",
          "Policy",
          { guildId: "10", purpose: "judgment" },
          [
            {
              filename: "x.pdf",
              mediaType: "application/pdf",
              data: new TextEncoder().encode("%PDF-1.4"),
            },
          ],
        );
      }).pipe(
        Effect.provide(
          openAITextLive({
            beforeAttempt: (e) =>
              Effect.sync(() => {
                attempts.push(e);
              }),
            fetch: async (_url, init) => {
              bodies.push(JSON.parse(String(init?.body)));
              if (bodies.length === 1)
                return Response.json(
                  { error: { message: "private", type: "rate_limit_error" } },
                  { status: 429, headers: { "retry-after-ms": "0" } },
                );
              return Response.json({
                id: "r",
                object: "chat.completion",
                created: 0,
                model: "controlled-model",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "Judgment" },
                    finish_reason: "stop",
                  },
                ],
              });
            },
          }),
        ),
        Effect.provide(configuration),
      );
      expect(result).toBe("Judgment");
      const expectedBody = {
        model: "controlled-model",
        messages: [
          { role: "system", content: "Policy" },
          {
            role: "user",
            content: [
              { type: "text", text: "Evidence" },
              {
                type: "file",
                file: {
                  filename: "x.pdf",
                  file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
                },
              },
            ],
          },
        ],
      };
      expect(bodies).toEqual([expectedBody, expectedBody]);
      expect(attempts).toEqual([
        { guildId: "10", purpose: "judgment", attempt: 1 },
        { guildId: "10", purpose: "judgment", attempt: 2 },
      ]);
    }),
);
