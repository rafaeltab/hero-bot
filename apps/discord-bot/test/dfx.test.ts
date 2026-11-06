import { expect, it } from "@effect/vitest";
import { DiscordConfig } from "dfx";
import { Config, ConfigProvider, Effect, Redacted } from "effect";

it.effect(
  "resolves the installed dfx configuration Layer using the installed Effect runtime",
  () =>
    Effect.gen(function* () {
      const config = yield* DiscordConfig.DiscordConfig;
      expect(config.gateway.intents).toBe(513);
      expect(Redacted.value(config.token)).toBe("offline-placeholder");
      expect(String(config.token)).not.toContain("offline-placeholder");
    }).pipe(
      Effect.provide(
        DiscordConfig.layerConfig({
          token: Config.Redacted("DISCORD_BOT_TOKEN"),
          gateway: { intents: Config.succeed(513) },
        }),
      ),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            DISCORD_BOT_TOKEN: "offline-placeholder",
          }),
        ),
      ),
    ),
);
