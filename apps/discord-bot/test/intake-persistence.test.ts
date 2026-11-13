import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { intakePostgresLayer } from "../src/adapters/intake-postgres.ts";
import { IntakeStore } from "../src/capabilities/moderation/ports.ts";
import {
  configurationDatabase,
  databaseConfig,
} from "./support/configuration-database.ts";
import { configuration, evidence } from "./support/intake-fixture.ts";

it.effect(
  "real PostgreSQL claims survive restart without retaining harmless contents, and actionable evidence and delivery are server isolated",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        const record = {
          evidence,
          configuration,
          judgment: {
            action: "ban" as const,
            reason: "Platform presumption.",
            offendingUrls: ["https://bilibili.com/video/1"],
          },
          model: "gpt-6-luna",
          provider: "openai/chat",
          assessedAt: "today",
        };
        yield* Effect.gen(function* () {
          const s = yield* IntakeStore;
          expect(yield* s.claim(evidence)).toBe(true);
          expect(yield* s.read("10", "100")).toEqual([]);
          yield* s.save(record);
          yield* s.delivered(evidence, { rootId: "r", threadId: "t" });
        }).pipe(
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(databaseConfig),
        );
        yield* Effect.gen(function* () {
          const s = yield* IntakeStore;
          expect(yield* s.claim(evidence)).toBe(false);
          expect(yield* s.read("10", "100")).toEqual([
            { record, delivery: { rootId: "r", threadId: "t" } },
          ]);
          expect(yield* s.read("other", "100")).toEqual([]);
        }).pipe(
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);

it.effect(
  "real store rejects delivery before preservation and stale overwrites, keeping the original evidence",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        yield* Effect.gen(function* () {
          const s = yield* IntakeStore;
          expect(
            (yield* s
              .delivered(evidence, { rootId: "false", threadId: "false" })
              .pipe(Effect.flip)).reason,
          ).toBe("database");
          expect(yield* s.claim(evidence)).toBe(true);
          const record = {
            evidence,
            configuration,
            judgment: {
              action: "delete" as const,
              reason: "Public mention.",
              offendingUrls: [],
            },
            model: "gpt-6-luna",
            provider: "openai/chat",
            assessedAt: "today",
          };
          yield* s.save(record);
          expect(
            (yield* s
              .save({
                ...record,
                judgment: { ...record.judgment, reason: "overwrite" },
              })
              .pipe(Effect.flip)).reason,
          ).toBe("database");
          expect(yield* s.read("10", "100")).toEqual([
            { record, delivery: null },
          ]);
        }).pipe(
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);
