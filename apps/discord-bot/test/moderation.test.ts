import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
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

it.effect(
  "actual owner bootstraps a durable attributed prompt without role mappings",
  () => {
    const versions: import("../src/capabilities/moderation/contract.ts").Configuration[] =
      [];
    return Effect.gen(function* () {
      const moderation = yield* Moderation;
      expect(
        yield* moderation.execute({
          guildId: "10",
          actorId: "11",
          command: { kind: "prompt", value: "Policy" },
        }),
      ).toContain("version 1");
      expect(
        yield* moderation.execute({
          guildId: "10",
          actorId: "11",
          command: { kind: "show" },
        }),
      ).toContain("Policy");
      expect(versions).toMatchObject([
        { guildId: "10", actorId: "11", version: 1, prompt: "Policy" },
      ]);
    }).pipe(
      Effect.provide(ModerationLive),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ConfigurationStore, {
            history: () => Effect.succeed(versions),
            save: (config) =>
              Effect.sync(() => {
                versions.push({ ...config, version: versions.length + 1 });
                return versions.length;
              }),
          }),
          Layer.succeed(GuildAccess, {
            inspect: () =>
              Effect.succeed({
                ownerId: "11",
                actorRoles: [],
                roles: [],
                channels: [],
                problems: [],
              }),
          }),
        ),
      ),
    );
  },
);

it.effect(
  "denies stale configuration writes rather than overwriting another attributed version",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        yield* Effect.gen(function* () {
          const store = yield* ConfigurationStore;
          const config = {
            guildId: "9001",
            actorId: "11",
            version: 0,
            changedAt: "2026-01-01",
            roles: { Owner: [], Admin: [], Moderator: [] },
            auditChannel: null,
            reportingChannel: null,
            prompt: "original",
          };
          expect(yield* store.save(config)).toBe(1);
          expect(
            (yield* store
              .save({ ...config, prompt: "stale" })
              .pipe(Effect.flip)).reason,
          ).toBe("database");
          expect(yield* store.history("9001")).toMatchObject([
            { version: 1, prompt: "original" },
          ]);
          expect(yield* store.history("9002")).toEqual([]);
        }).pipe(
          Effect.provide(databaseLayer(table)),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);

it.effect(
  "rejects a forged permission name at the public submission boundary",
  () =>
    Effect.gen(function* () {
      const moderation = yield* Moderation;
      expect(
        yield* moderation.execute({
          guildId: "10",
          actorId: "11",
          command: {
            kind: "role",
            group: "course" as never,
            roleId: "50",
            remove: false,
          },
        }),
      ).toContain("Invalid permission");
    }).pipe(
      Effect.provide(ModerationLive),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ConfigurationStore, {
            history: () => Effect.succeed([]),
            save: () => Effect.die("must not save"),
          }),
          Layer.succeed(GuildAccess, {
            inspect: () =>
              Effect.succeed({
                ownerId: "11",
                actorRoles: [],
                roles: ["50"],
                channels: [],
                problems: [],
              }),
          }),
        ),
      ),
    ),
);

import type {
  Command,
  Configuration,
} from "../src/capabilities/moderation/contract.ts";
import type { Access } from "../src/capabilities/moderation/ports.ts";

const scenario = (
  run: (
    service: typeof Moderation.Service,
    access: Access,
    records: Configuration[],
  ) => Effect.Effect<void, unknown>,
) => {
  const records: Configuration[] = [];
  const access: Access = {
    ownerId: "11",
    actorRoles: [],
    roles: ["50", "51", "52", "53"],
    channels: [
      { id: "20", private: true, usable: true },
      { id: "21", private: false, usable: true },
      { id: "22", private: true, usable: false },
    ],
    problems: [],
  };
  return Effect.gen(function* () {
    yield* run(yield* Moderation, access, records);
  }).pipe(
    Effect.provide(ModerationLive),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(GuildAccess, {
          inspect: () => Effect.sync(() => structuredClone(access)),
        }),
        Layer.succeed(ConfigurationStore, {
          history: (id) =>
            Effect.sync(() => records.filter((r) => r.guildId === id)),
          save: (c) =>
            Effect.sync(() => {
              const version =
                records.filter((r) => r.guildId === c.guildId).length + 1;
              records.push({ ...structuredClone(c), version });
              return version;
            }),
        }),
      ),
    ),
  );
};
it.effect(
  "two servers retain independent policy, private channels and attributed history; live role revocation denies edits",
  () =>
    scenario((m, a, records) =>
      Effect.gen(function* () {
        const send = (command: Command, actorId = "11", guildId = "10") =>
          m.execute({ guildId, actorId, command });
        expect(yield* send({ kind: "history" })).toBe(
          "No configuration history.",
        );
        expect(
          yield* send({
            kind: "role",
            group: "Owner",
            roleId: "50",
            remove: false,
          }),
        ).toContain("Saved version 1");
        expect(
          yield* send({
            kind: "role",
            group: "Admin",
            roleId: "51",
            remove: false,
          }),
        ).toContain("Saved version 2");
        expect(
          yield* send({
            kind: "role",
            group: "Moderator",
            roleId: "52",
            remove: false,
          }),
        ).toContain("Saved version 3");
        a.actorRoles = ["51"];
        expect(
          yield* send({ kind: "prompt", value: "Server A policy" }, "12"),
        ).toContain("Saved version 4");
        a.actorRoles = ["52"];
        expect(
          yield* send({ kind: "prompt", value: "Unauthorized" }, "12"),
        ).toContain("Denied");
        expect(
          yield* send({ kind: "status", channelId: "20" }, "12"),
        ).toContain("unavailable until later slices");
        a.actorRoles = ["53"];
        expect(
          yield* send({ kind: "prompt", value: "Course member" }, "12"),
        ).toContain("Denied");
        a.actorRoles = [];
        expect(
          yield* send({ kind: "prompt", value: "Revoked admin" }, "12"),
        ).toContain("Denied");
        expect(
          yield* send({ kind: "prompt", value: "Server B policy" }, "11", "30"),
        ).toContain("version 1");
        expect(
          yield* send({
            kind: "channel",
            purpose: "auditChannel",
            channelId: "20",
          }),
        ).toContain("Saved version");
        expect(
          yield* send({
            kind: "channel",
            purpose: "reportingChannel",
            channelId: "20",
          }),
        ).toContain("Saved version");
        expect(yield* send({ kind: "show" })).toContain("Server A policy");
        expect(yield* send({ kind: "show" }, "11", "30")).toContain(
          "Server B policy",
        );
        expect(yield* send({ kind: "history" })).toContain("version 4 by 12");
        expect(yield* send({ kind: "status", channelId: "20" })).toContain(
          "exempt route true",
        );
        expect(yield* send({ kind: "status", channelId: "999" })).toContain(
          "missing or cross-server",
        );
        expect(
          yield* send({
            kind: "role",
            group: "Admin",
            roleId: "51",
            remove: true,
          }),
        ).toContain("Saved version");
        a.actorRoles = ["51"];
        expect(yield* send({ kind: "show" }, "12")).toContain("Denied");
        expect(records.filter((r) => r.guildId === "30")).toHaveLength(1);
      }),
    ),
);
it.effect.each([
  [{ kind: "prompt", value: "" }, "1–4000"],
  [{ kind: "prompt", value: "x".repeat(4001) }, "1–4000"],
  [
    { kind: "role", group: "Admin", roleId: "999", remove: false },
    "existing server role",
  ],
  [
    { kind: "role", group: "Admin", roleId: "10", remove: false },
    "existing server role",
  ],
  [
    { kind: "channel", purpose: "auditChannel", channelId: "999" },
    "existing server reporting",
  ],
  [{ kind: "channel", purpose: "auditChannel", channelId: "21" }, "unsafe"],
  [
    { kind: "channel", purpose: "reportingChannel", channelId: "22" },
    "Grant bot",
  ],
  [{ kind: "actions", enabled: true }, "outside this slice"],
  [{ kind: "actions", enabled: false }, "disabled"],
] satisfies [Command, string][])(
  "invalid or premature configuration is explained without saving: %j",
  ([command, explanation]) =>
    scenario((m, _a, records) =>
      Effect.gen(function* () {
        expect(
          yield* m.execute({ guildId: "10", actorId: "11", command }),
        ).toContain(explanation);
        expect(records).toEqual([]);
      }),
    ),
);

it.effect(
  "owner can repair setup by removing a mapped role that Discord has deleted",
  () =>
    scenario((m, a) =>
      Effect.gen(function* () {
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
        ).toContain("Saved version");
        a.roles = a.roles.filter((id) => id !== "52");
        expect(
          yield* m.execute({
            guildId: "10",
            actorId: "11",
            command: { kind: "status", channelId: "20" },
          }),
        ).toContain("mapped role is missing");
        expect(
          yield* m.execute({
            guildId: "10",
            actorId: "11",
            command: {
              kind: "role",
              group: "Moderator",
              roleId: "52",
              remove: true,
            },
          }),
        ).toContain("Saved version 2");
      }),
    ),
);
