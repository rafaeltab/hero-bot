import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Moderation } from "../src/capabilities/moderation/contract.ts";
import { ModerationLive } from "../src/capabilities/moderation/implementation.ts";
import {
  type Access,
  ConfigurationStore,
  GuildAccess,
} from "../src/capabilities/moderation/ports.ts";

it.effect(
  "doctor refreshes essential access faults without writing configuration or certifying live delivery",
  () => {
    const access: Access = {
      ownerId: "owner",
      actorRoles: [],
      roles: [],
      channels: [{ id: "audit", private: true, usable: true }],
      problems: [],
    };
    return Effect.gen(function* () {
      const m = yield* Moderation;
      const request = {
        guildId: "A",
        actorId: "owner",
        command: { kind: "doctor" as const },
      };
      expect(yield* m.execute(request)).toContain(
        "Database: configuration read succeeded",
      );
      access.channels[0] = { id: "audit", private: false, usable: false };
      const failed = yield* m.execute(request);
      expect(failed).toContain("ERROR");
      expect(failed).toContain("deny ordinary members View Channel");
      expect(failed).toContain("docs/moderation-configuration.md");
      access.channels[0] = { id: "audit", private: true, usable: true };
      const restored = yield* m.execute(request);
      expect(restored).not.toContain("unsafe");
      expect(restored).toContain("controlled probe");
      expect(restored).toContain("purgatory/isolation checks: unavailable");
    }).pipe(
      Effect.provide(ModerationLive),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(GuildAccess, {
            inspect: () => Effect.sync(() => structuredClone(access)),
          }),
          Layer.succeed(ConfigurationStore, {
            history: (guildId) =>
              Effect.succeed([
                {
                  guildId,
                  actorId: "owner",
                  version: 1,
                  changedAt: "now",
                  roles: { Owner: [], Admin: [], Moderator: [] },
                  auditChannel: "audit",
                  reportingChannel: "audit",
                  prompt: "policy",
                },
              ]),
            save: () => Effect.die("diagnostic must never save"),
          }),
        ),
      ),
    );
  },
);

it.effect(
  "diagnostics explain every supported monitoring surface and intent failure without claiming isolation",
  () =>
    Effect.gen(function* () {
      const m = yield* Moderation;
      const text = yield* m.execute({
        guildId: "A",
        actorId: "owner",
        command: { kind: "doctor" },
      });
      expect(text).toContain("ERROR Message Content");
      expect(text).toContain("ERROR monitoring/context inaccessible");
      expect(text).toContain("Channel thread: configured exempt route true");
      expect(text).toContain("unsupported surface");
    }).pipe(
      Effect.provide(ModerationLive),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(GuildAccess, {
            inspect: () =>
              Effect.succeed({
                ownerId: "owner",
                actorRoles: [],
                roles: [],
                channels: [],
                problems: [],
                messageContent: false,
                monitoring: [
                  {
                    id: "course",
                    parentId: null,
                    thread: false,
                    readable: false,
                    supported: true,
                  },
                  {
                    id: "thread",
                    parentId: "audit",
                    thread: true,
                    readable: true,
                    supported: true,
                  },
                  {
                    id: "audio",
                    parentId: null,
                    thread: false,
                    readable: true,
                    supported: false,
                  },
                ],
              }),
          }),
          Layer.succeed(ConfigurationStore, {
            history: () =>
              Effect.succeed([
                {
                  guildId: "A",
                  actorId: "owner",
                  version: 1,
                  changedAt: "now",
                  roles: { Owner: [], Admin: [], Moderator: [] },
                  auditChannel: "audit",
                  reportingChannel: "audit",
                  prompt: "policy",
                },
              ]),
            save: () => Effect.die("must not save"),
          }),
        ),
      ),
    ),
);

it.effect(
  "moderator reads fresh server-scoped diagnosis but cannot write; owner retains repair authority",
  () => {
    let memberRoles = ["mod"];
    return Effect.gen(function* () {
      const m = yield* Moderation;
      const execute = (guildId: string, actorId = "moderator") =>
        m.execute({ guildId, actorId, command: { kind: "doctor" } });
      expect(yield* execute("A")).toContain("Reporting channel is unsafe");
      expect(yield* execute("B")).not.toContain("unsafe");
      expect(
        yield* m.execute({
          guildId: "A",
          actorId: "moderator",
          command: { kind: "prompt", value: "forbidden" },
        }),
      ).toContain("Denied");
      memberRoles = [];
      expect(yield* execute("A")).toContain("Denied");
      expect(yield* execute("B", "owner")).toContain(
        "Database: configuration read succeeded",
      );
    }).pipe(
      Effect.provide(ModerationLive),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(GuildAccess, {
            inspect: (guildId) =>
              Effect.succeed({
                ownerId: "owner",
                actorRoles: memberRoles,
                roles: ["mod"],
                problems: [],
                channels: [
                  {
                    id: `${guildId}-audit`,
                    private: guildId === "B",
                    usable: true,
                  },
                ],
                messageContent: true,
              }),
          }),
          Layer.succeed(ConfigurationStore, {
            history: (guildId) =>
              Effect.succeed([
                {
                  guildId,
                  actorId: "owner",
                  version: 1,
                  changedAt: "now",
                  roles: { Owner: [], Admin: [], Moderator: ["mod"] },
                  auditChannel: `${guildId}-audit`,
                  reportingChannel: `${guildId}-audit`,
                  prompt: "policy",
                },
              ]),
            save: () => Effect.die("must not save"),
          }),
        ),
      ),
    );
  },
);
