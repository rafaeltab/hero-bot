import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { configurationPostgresLayer } from "../src/adapters/moderation-postgres.ts";
import { Moderation } from "../src/capabilities/moderation/contract.ts";
import { ModerationLive } from "../src/capabilities/moderation/implementation.ts";
import {
  ConfigurationStore,
  GuildAccess,
} from "../src/capabilities/moderation/ports.ts";
import {
  configurationDatabase,
  databaseConfig,
  databaseLayer,
} from "./support/configuration-database.ts";

const access = Layer.succeed(GuildAccess, {
  inspect: () =>
    Effect.succeed({
      ownerId: "11",
      actorRoles: ["52"],
      roles: ["51", "52"],
      channels: [{ id: "20", private: true, usable: true }],
      problems: [],
    }),
});
it.effect(
  "configure → inspect → restart → inspect keeps two servers isolated and retains attributed versions through real PostgreSQL",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        const workflow = () => ModerationLive.pipe(EffectLayer());
        function EffectLayer() {
          return Layer.provide(Layer.mergeAll(access, databaseLayer(table)));
        }
        yield* Effect.gen(function* () {
          const m = yield* Moderation;
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: { kind: "prompt", value: "Policy A" },
            }),
          ).toContain("version 1");
          expect(
            yield* m.execute({
              guildId: "12",
              actorId: "11",
              command: { kind: "prompt", value: "Policy B" },
            }),
          ).toContain("version 1");
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: {
                kind: "role",
                group: "Moderator",
                roleId: "52",
                remove: false,
              },
            }),
          ).toContain("version 2");
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: {
                kind: "channel",
                purpose: "auditChannel",
                channelId: "20",
              },
            }),
          ).toContain("version 3");
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: {
                kind: "channel",
                purpose: "reportingChannel",
                channelId: "20",
              },
            }),
          ).toContain("version 4");
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "15",
              command: { kind: "prompt", value: "denied" },
            }),
          ).toContain("Denied");
          expect(
            yield* m.execute({
              guildId: "12",
              actorId: "15",
              command: { kind: "prompt", value: "ordinary member" },
            }),
          ).toContain("Denied");
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: { kind: "show" },
            }),
          ).toContain("Policy A");
        }).pipe(Effect.provide(workflow()), Effect.provide(databaseConfig));
        // Fresh Layer construction acquires a new pool after the first one has closed.
        yield* Effect.gen(function* () {
          const m = yield* Moderation;
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: { kind: "show" },
            }),
          ).toContain("Policy A");
          expect(
            yield* m.execute({
              guildId: "12",
              actorId: "11",
              command: { kind: "show" },
            }),
          ).toContain("Policy B");
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: { kind: "status", channelId: "20" },
            }),
          ).toContain("exempt route true");
          expect(
            yield* m.execute({
              guildId: "12",
              actorId: "11",
              command: { kind: "status", channelId: "20" },
            }),
          ).toContain("Select an existing");
          expect(
            yield* m.execute({
              guildId: "10",
              actorId: "11",
              command: { kind: "history" },
            }),
          ).toContain("version 4 by 11");
        }).pipe(Effect.provide(workflow()), Effect.provide(databaseConfig));
      }),
    ),
);
it.effect.each(["secret-invalid", "https://secret.example/db", ""])(
  "rejects malformed shared DB settings without exposing secrets: %s",
  (url) =>
    ConfigurationStore.pipe(
      Effect.provide(configurationPostgresLayer()),
      Effect.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ DATABASE_URL: url })),
      ),
      Effect.flip,
      Effect.map((e) => {
        expect(e.reason).toBe("configuration");
        expect(JSON.stringify(e)).not.toContain("secret");
        return e;
      }),
    ),
);
it.effect(
  "database connection failure is sanitized and closes its pool",
  () => {
    const url = new URL(
      process.env.HERO_TEST_DATABASE_URL ?? "postgres://unused",
    );
    url.pathname = "/missing_moderation_database";
    return ConfigurationStore.pipe(
      Effect.provide(configurationPostgresLayer()),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ DATABASE_URL: url.href }),
        ),
      ),
      Effect.flip,
      Effect.map((e) => {
        expect(e.reason).toBe("database");
        expect(JSON.stringify(e)).not.toContain("missing_moderation_database");
        return e;
      }),
    );
  },
);
