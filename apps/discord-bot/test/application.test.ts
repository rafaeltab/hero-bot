import { expect, it } from "@effect/vitest";
import { ConfigProvider, Console, Deferred, Effect, Fiber } from "effect";
import { application, applicationForDevelopment } from "../src/application.js";
import { DiscordUnavailable } from "../src/capabilities/discord-connection/contract.ts";

it.effect(
  "starts with development configuration and finalizes its lifetime on interruption",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const messages: unknown[] = [];
      const output: Console.Console = {
        ...console,
        log: (message) => {
          messages.push(message);
          Deferred.doneUnsafe(started, Effect.void);
        },
      };
      const fiber = yield* application.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ HERO_ENV: "development" }),
          ),
        ),
        Effect.provideService(Console.Console, output),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      expect(messages).toEqual([
        "hero-bot started (development)",
        "hero-bot stopped",
      ]);
    }),
);

it.effect.each([{}, { HERO_ENV: "staging" }])(
  "rejects missing or invalid environment configuration without starting",
  (settings) =>
    Effect.gen(function* () {
      const messages: unknown[] = [];
      const result = yield* application.pipe(
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown(settings)),
        ),
        Effect.provideService(Console.Console, {
          ...console,
          log: (message) => {
            messages.push(message);
          },
        }),
        Effect.exit,
      );
      expect(result._tag).toBe("Failure");
      expect(messages).toEqual([]);
    }),
);

it.effect(
  "development entrypoint rejects missing Discord configuration without opening a connection",
  () =>
    Effect.gen(function* () {
      const result = yield* applicationForDevelopment(true).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ HERO_ENV: "development" }),
          ),
        ),
        Effect.flip,
      );
      expect(result).toEqual(
        new DiscordUnavailable({ reason: "configuration" }),
      );
    }),
);

it.effect(
  "keeps the baseline lifetime available separately from the Discord development path",
  () =>
    Effect.sync(() => {
      expect(applicationForDevelopment(false)).toBe(application);
    }),
);
