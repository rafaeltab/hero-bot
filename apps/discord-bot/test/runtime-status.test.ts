import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { EnvironmentFromConfig } from "../src/adapters/environment-config.ts";
import {
  RuntimeStatus,
  StatusUnavailable,
} from "../src/capabilities/runtime-status/contract.ts";
import { RuntimeStatusLive } from "../src/capabilities/runtime-status/implementation.ts";
import { EnvironmentSource } from "../src/capabilities/runtime-status/ports.ts";

it.effect("describes the configured runtime through its public contract", () =>
  Effect.gen(function* () {
    const status = yield* RuntimeStatus;
    expect(yield* status.describe).toBe("hero-bot started (development)");
  }).pipe(
    Effect.provide(RuntimeStatusLive),
    Effect.provide(
      Layer.succeed(EnvironmentSource, {
        read: Effect.succeed("development" as const),
      }),
    ),
  ),
);

it.effect.each([{}, { HERO_ENV: "staging" }])(
  "reports unavailable status for missing or invalid configuration",
  (settings) =>
    Effect.gen(function* () {
      const status = yield* RuntimeStatus;
      expect(yield* Effect.flip(status.describe)).toEqual(
        new StatusUnavailable(),
      );
    }).pipe(
      Effect.provide(RuntimeStatusLive),
      Effect.provide(EnvironmentFromConfig),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown(settings)),
      ),
    ),
);
