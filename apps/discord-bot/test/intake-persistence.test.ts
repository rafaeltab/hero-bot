import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Client } from "pg";
import { intakePostgresLayer } from "../src/adapters/intake-postgres.ts";
import { IntakeStore } from "../src/capabilities/moderation/ports.ts";
import { auditRecord } from "./support/audit-translation-fixture.ts";
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
          auditTranslation: auditRecord,
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

it.effect(
  "recorded corrections survive restart and replace adverse history without altering original evidence",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        yield* Effect.gen(function* () {
          const s = yield* IntakeStore;
          yield* s.claim(evidence);
          yield* s.save({
            evidence,
            configuration,
            judgment: {
              action: "delete",
              reason: "Original finding.",
              offendingUrls: [],
            },
            model: "gpt-6-luna",
            provider: "openai/chat",
            assessedAt: "2026-11-13T00:00:00Z",
          });
          yield* s.correctHistory!({
            guildId: "10",
            authorId: "12",
            messageId: "100",
            at: "2026-11-14T00:00:00Z",
            origin: "manual",
            status: "overturned",
            summary: "Authorized copy",
            correction: "Original deletion recommendation was mistaken",
            supportingEvidence: ["License supplied by author"],
          });
        }).pipe(
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(databaseConfig),
        );
        yield* Effect.gen(function* () {
          const s = yield* IntakeStore;
          expect(yield* s.memberHistory!("10", "12")).toMatchObject([
            {
              status: "overturned",
              summary: "Authorized copy",
              supportingEvidence: ["License supplied by author"],
            },
          ]);
          expect(
            (yield* s.correctHistory!({
              guildId: "10",
              authorId: "12",
              messageId: "100",
              at: "2026-11-14T01:00:00+01:00",
              origin: "manual",
              status: "upheld",
              summary: "Stale same instant",
              supportingEvidence: [],
            }).pipe(Effect.flip)).reason,
          ).toBe("database");
          expect(
            (yield* s.correctHistory!({
              guildId: "other",
              authorId: "12",
              messageId: "100",
              at: "2026-11-15T00:00:00Z",
              origin: "manual",
              status: "upheld",
              summary: "Foreign",
              supportingEvidence: [],
            }).pipe(Effect.flip)).reason,
          ).toBe("database");
          expect(yield* s.memberHistory!("other", "12")).toEqual([]);
          expect(yield* s.memberHistory!("10", "other")).toEqual([]);
          expect((yield* s.read("10", "100"))[0]?.record.judgment.reason).toBe(
            "Original finding.",
          );
        }).pipe(
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);

it.effect(
  "a harmless edit does not overturn an earlier actionable finding in member history",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        yield* Effect.gen(function* () {
          const store = yield* IntakeStore;
          yield* store.claim(evidence);
          yield* store.save({
            evidence,
            configuration,
            judgment: {
              action: "ban",
              reason: "Original actionable source.",
              offendingUrls: [],
            },
            model: "gpt-6-luna",
            provider: "openai/chat",
            assessedAt: "2026-11-13T00:00:00Z",
          });
          const edited = {
            ...evidence,
            version: "2026-11-13T00:01:00Z",
            text: "Hello",
          };
          yield* store.claim(edited);
          yield* store.save({
            evidence: edited,
            configuration,
            judgment: {
              action: "none",
              reason: "Harmless edit.",
              offendingUrls: [],
            },
            model: "gpt-6-luna",
            provider: "openai/chat",
            assessedAt: "2026-11-13T00:01:00Z",
          });
          expect(yield* store.memberHistory!("10", "12")).toMatchObject([
            {
              status: "pending",
              summary: expect.stringContaining("Original actionable source."),
            },
          ]);
        }).pipe(
          Effect.provide(intakePostgresLayer(table)),
          Effect.provide(databaseConfig),
        );
      }),
    ),
);

it.effect(
  "legacy content-free claims remain uncertain and invalid stored lifecycle states fail closed",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const table = yield* configurationDatabase;
        const reopen = <A, E>(task: Effect.Effect<A, E, IntakeStore>) =>
          task.pipe(
            Effect.provide(intakePostgresLayer(table)),
            Effect.provide(databaseConfig),
          );
        yield* reopen(
          Effect.gen(function* () {
            yield* (yield* IntakeStore).claim(evidence);
          }),
        );
        const client = yield* Effect.acquireRelease(
          Effect.promise(async () => {
            const client = new Client({
              connectionString: process.env.HERO_TEST_DATABASE_URL,
            });
            await client.connect();
            return client;
          }),
          (client) => Effect.promise(() => client.end()),
        );
        yield* Effect.promise(() =>
          client.query(`update "${table}" set state='legacy'`),
        );
        yield* reopen(
          Effect.gen(function* () {
            const store = yield* IntakeStore;
            expect(yield* store.progress(evidence)).toEqual([
              { version: evidence.version, state: "legacy" },
            ]);
            expect(yield* store.claim(evidence)).toBe(false);
            expect(yield* store.read("10", "100")).toEqual([]);
          }),
        );
        yield* Effect.promise(() =>
          client.query(`update "${table}" set state='invalid'`),
        );
        yield* reopen(
          Effect.gen(function* () {
            expect(
              (yield* (yield* IntakeStore).progress(evidence).pipe(Effect.flip))
                .reason,
            ).toBe("database");
          }),
        );
      }),
    ),
);
