import { expect, it } from "@effect/vitest";
import { ConfigProvider, Deferred, Effect, Fiber, Layer } from "effect";
import { openAITextLive } from "../src/adapters/ai.ts";
import { budgetSettings } from "../src/adapters/budget-config.ts";
import { budgetPostgresLayer } from "../src/adapters/budget-postgres.ts";
import { AiBudget } from "../src/capabilities/ai-budget/contract.ts";
import { TextGeneration } from "../src/capabilities/text-generation/contract.ts";
import { budgetPolicy as policy } from "./support/budget-policy.ts";
import {
  configurationDatabase,
  databaseConfig,
} from "./support/configuration-database.ts";

it.effect(
  "durable concurrent reservations isolate guilds and share a ceiling across restart",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        const live = budgetPostgresLayer(
          policy,
          table,
          () => new Date("2026-11-14T23:59:59Z"),
        );
        yield* Effect.gen(function* () {
          const b = yield* AiBudget;
          const results = yield* Effect.all(
            ["a", "b", "c"].map((id) =>
              Effect.result(
                b.reserve({
                  id,
                  guildId: "10",
                  purpose: "judgment",
                  attempt: 1,
                }),
              ),
            ),
            { concurrency: "unbounded" },
          );
          expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
          expect((yield* b.status("10")).guild.heldMicroUsd).toBe(60);
          yield* b.reserve({
            id: "translation",
            guildId: "20",
            purpose: "translation",
            attempt: 1,
          });
          expect((yield* b.status("20")).reason).toBe("shared");
        }).pipe(Effect.provide(live), Effect.provide(databaseConfig));
        yield* Effect.gen(function* () {
          const b = yield* AiBudget;
          expect((yield* b.status("10")).guild.heldMicroUsd).toBe(60);
          expect(
            (yield* b
              .reserve({
                id: "restart",
                guildId: "10",
                purpose: "judgment",
                attempt: 1,
              })
              .pipe(Effect.flip)).operation,
          ).toBe("budget");
        }).pipe(Effect.provide(live), Effect.provide(databaseConfig));
      }),
    ),
);

it.effect(
  "settlement releases only known usage, uses original pricing and admission day across midnight",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        let date = new Date("2026-11-14T23:59:59Z");
        const live = budgetPostgresLayer(policy, table, () => date);
        yield* Effect.gen(function* () {
          const b = yield* AiBudget;
          yield* b.reserve({
            id: "old",
            guildId: "10",
            purpose: "judgment",
            attempt: 1,
          });
          date = new Date("2026-11-15T00:00:00Z");
          expect((yield* b.status("10")).guild.heldMicroUsd).toBe(0);
          yield* b.settle({
            id: "old",
            attempt: 1,
            outcome: "succeeded",
            inputTokens: 10,
            outputTokens: 5,
          });
          yield* b.reserve({
            id: "new",
            guildId: "10",
            purpose: "translation",
            attempt: 1,
          });
          yield* b.settle({ id: "new", attempt: 1, outcome: "interrupted" });
          expect((yield* b.status("10")).guild).toEqual({
            reportedMicroUsd: 0,
            heldMicroUsd: 60,
            unknownAttempts: 1,
          });
        }).pipe(Effect.provide(live), Effect.provide(databaseConfig));
        date = new Date("2026-11-14T23:59:59Z");
        yield* Effect.gen(function* () {
          const b = yield* AiBudget;
          expect((yield* b.status("10")).guild).toEqual({
            reportedMicroUsd: 20,
            heldMicroUsd: 0,
            unknownAttempts: 0,
          });
          yield* b.settle({
            id: "old",
            attempt: 1,
            outcome: "succeeded",
            inputTokens: 999,
            outputTokens: 999,
          });
          expect((yield* b.status("10")).guild.reportedMicroUsd).toBe(20);
          expect((yield* b.status("20")).guild.reportedMicroUsd).toBe(0);
          expect((yield* b.status("30")).reason).toBe("unconfigured");
        }).pipe(
          Effect.provide(
            budgetPostgresLayer(
              { ...policy, inputMicroUsdPerMillion: 5000000 },
              table,
              () => date,
            ),
          ),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);

it.effect(
  "invalid budget configuration fails with actionable sanitized guidance",
  () =>
    Effect.gen(function* () {
      const errors = [];
      for (const raw of [
        undefined,
        "bad",
        "null",
        JSON.stringify({ ...policy, guildMicroUsd: {} }),
        JSON.stringify({ ...policy, sharedMicroUsd: 0 }),
        JSON.stringify({ ...policy, maxOutputTokens: 1.2 }),
        JSON.stringify({ ...policy, model: "other" }),
        JSON.stringify({ ...policy, maxInputTokens: Number.MAX_SAFE_INTEGER }),
      ]) {
        const error = yield* budgetSettings.pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown(
                raw === undefined ? {} : { HERO_AI_BUDGET_JSON: raw },
              ),
            ),
          ),
          Effect.flip,
        );
        errors.push({ operation: error.operation, guidance: error.guidance });
      }
      expect(errors).toEqual(
        Array.from({ length: 8 }, () => ({
          operation: "configuration",
          guidance: expect.stringContaining("docs/moderation-intake.md"),
        })),
      );
      expect(
        yield* budgetSettings.pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                HERO_AI_BUDGET_JSON: JSON.stringify(policy),
              }),
            ),
          ),
        ),
      ).toEqual(policy);
    }),
);

it.live(
  "paid retries and translations settle known error usage and hold unknown usage durably",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        yield* Effect.gen(function* () {
          const b = yield* AiBudget;
          let calls = 0;
          const aiLayer = openAITextLive({
            beforeAttempt: b.reserve,
            afterAttempt: b.settle,
            maxOutputTokens: 10,
            fetch: async (_url, init) => {
              calls++;
              const body = JSON.parse(String(init?.body));
              expect(body.max_completion_tokens).toBe(10);
              if (calls === 1)
                return Response.json(
                  {
                    error: { message: "private", type: "rate_limit_exceeded" },
                    usage: { prompt_tokens: 5, completion_tokens: 0 },
                  },
                  { status: 429, headers: { "retry-after-ms": "0" } },
                );
              return Response.json({
                id: "qa",
                object: "chat.completion",
                created: 0,
                model: "gpt-6-luna",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: "ok" },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                },
              });
            },
          });
          yield* Effect.gen(function* () {
            const ai = yield* TextGeneration;
            expect(
              yield* ai.generate("private", undefined, {
                guildId: "10",
                purpose: "judgment",
              }),
            ).toBe("ok");
            expect((yield* b.status("10")).guild).toEqual({
              reportedMicroUsd: 25,
              heldMicroUsd: 0,
              unknownAttempts: 0,
            });
            expect(
              yield* ai.generate("private", undefined, {
                guildId: "10",
                purpose: "translation",
              }),
            ).toBe("ok");
            expect((yield* b.status("10")).guild.reportedMicroUsd).toBe(45);
            expect(
              (yield* ai
                .generate("private", undefined, {
                  guildId: "10",
                  purpose: "judgment",
                })
                .pipe(Effect.flip)).operation,
            ).toBe("budget");
            expect(calls).toBe(3);
          }).pipe(
            Effect.provide(aiLayer),
            Effect.provide(
              ConfigProvider.layer(
                ConfigProvider.fromUnknown({
                  HERO_AI_API_KEY: "qa",
                  HERO_AI_MODEL: "gpt-6-luna",
                }),
              ),
            ),
          );
        }).pipe(
          Effect.provide(budgetPostgresLayer(policy, table)),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);

it.effect(
  "interruption retains a durable hold and restart cannot grant another allowance",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        const started = yield* Deferred.make<void>();
        const budgetLayer = budgetPostgresLayer(policy, table);
        yield* Effect.gen(function* () {
          const b = yield* AiBudget;
          const aiLayer = openAITextLive({
            beforeAttempt: b.reserve,
            afterAttempt: b.settle,
            maxOutputTokens: 10,
            fetch: async (_url, init) => {
              yieldStarted();
              return new Promise<Response>((_resolve, reject) =>
                init?.signal?.addEventListener("abort", () =>
                  reject(new DOMException("aborted", "AbortError")),
                ),
              );
            },
          });
          const yieldStarted = () => Deferred.doneUnsafe(started, Effect.void);
          const fiber = yield* Effect.gen(function* () {
            const ai = yield* TextGeneration;
            yield* ai.generate("private", undefined, {
              guildId: "10",
              purpose: "judgment",
            });
          }).pipe(
            Effect.provide(aiLayer),
            Effect.provide(
              ConfigProvider.layer(
                ConfigProvider.fromUnknown({
                  HERO_AI_API_KEY: "qa",
                  HERO_AI_MODEL: "gpt-6-luna",
                }),
              ),
            ),
            Effect.forkChild,
          );
          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
        }).pipe(Effect.provide(budgetLayer), Effect.provide(databaseConfig));
        yield* Effect.gen(function* () {
          const b = yield* AiBudget;
          expect((yield* b.status("10")).guild).toEqual({
            reportedMicroUsd: 0,
            heldMicroUsd: 60,
            unknownAttempts: 1,
          });
          expect(
            (yield* b
              .reserve({
                id: "new",
                guildId: "10",
                purpose: "judgment",
                attempt: 1,
              })
              .pipe(Effect.flip)).operation,
          ).toBe("budget");
        }).pipe(Effect.provide(budgetLayer), Effect.provide(databaseConfig));
      }),
    ),
);

it.effect(
  "independent application instances share durable admission and retain original pricing after operator change",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        const first = yield* Layer.build(
          budgetPostgresLayer(policy, table),
        ).pipe(Effect.provide(databaseConfig));
        const second = yield* Layer.build(
          budgetPostgresLayer(policy, table),
        ).pipe(Effect.provide(databaseConfig));
        const a = yield* AiBudget.pipe(Effect.provide(first));
        const b = yield* AiBudget.pipe(Effect.provide(second));
        yield* a.reserve({
          id: "first",
          guildId: "10",
          purpose: "judgment",
          attempt: 1,
        });
        expect(
          (yield* b
            .reserve({
              id: "second",
              guildId: "10",
              purpose: "judgment",
              attempt: 1,
            })
            .pipe(Effect.flip)).operation,
        ).toBe("budget");
        yield* Effect.gen(function* () {
          const changed = yield* AiBudget;
          yield* changed.settle({
            id: "first",
            attempt: 1,
            outcome: "succeeded",
            inputTokens: 10,
            outputTokens: 5,
          });
          expect((yield* changed.status("10")).guild.reportedMicroUsd).toBe(20);
        }).pipe(
          Effect.provide(
            budgetPostgresLayer(
              { ...policy, inputMicroUsdPerMillion: 2000000 },
              table,
            ),
          ),
          Effect.provide(databaseConfig),
        );
        expect(
          (yield* a
            .settle({ id: "missing", attempt: 1, outcome: "failed" })
            .pipe(Effect.flip)).operation,
        ).toBe("accounting");
        expect(
          (yield* a.reserve({ attempt: 1 }).pipe(Effect.flip)).operation,
        ).toBe("budget");
      }),
    ),
);
