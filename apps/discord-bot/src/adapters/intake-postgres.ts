import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Config, Effect, Layer } from "effect";
import { Pool } from "pg";
import type {
  Delivery,
  HistoryEntry,
  RecordEntry,
} from "../capabilities/moderation/contract.ts";
import { ModerationUnavailable } from "../capabilities/moderation/contract.ts";
import { IntakeStore } from "../capabilities/moderation/ports.ts";
/** Content-free durable claims deliberately do not replay after failures/restarts. */
export const intakePostgresLayer = (table = "moderation_intake") =>
  Layer.effect(
    IntakeStore,
    Effect.gen(function* () {
      const url = yield* Config.String("DATABASE_URL").pipe(
        Effect.mapError(
          () => new ModerationUnavailable({ reason: "configuration" }),
        ),
      );
      const query = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: () => new ModerationUnavailable({ reason: "database" }),
        });
      yield* Effect.try({
        try: () => {
          if (
            !/^[a-z_][a-z0-9_]*$/.test(table) ||
            !["postgres:", "postgresql:"].includes(new URL(url).protocol)
          )
            throw Error();
        },
        catch: () => new ModerationUnavailable({ reason: "configuration" }),
      });
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const p = new Pool({
            connectionString: url,
            max: 2,
            connectionTimeoutMillis: 1000,
            statement_timeout: 5000,
          });
          p.on("error", () => undefined);
          return p;
        }),
        (p) => Effect.promise(() => p.end()),
      );
      const db = drizzle(pool);
      const t = sql.identifier(table);
      yield* query(() =>
        db.execute(
          sql`create table if not exists ${t} (guild_id text not null,message_id text not null,version text not null,record jsonb,delivery jsonb,primary key(guild_id,message_id,version))`,
        ),
      );
      yield* query(() =>
        db.execute(
          sql`alter table ${t} add column if not exists history_correction jsonb`,
        ),
      );
      return IntakeStore.of({
        correctHistory: (entry) =>
          query(async () => {
            const result = await db.execute(
              sql`update ${t} set history_correction=${JSON.stringify(entry)}::jsonb where guild_id=${entry.guildId} and message_id=${entry.messageId} and record->'evidence'->>'authorId'=${entry.authorId} and not exists (select 1 from ${t} prior where prior.guild_id=${entry.guildId} and prior.message_id=${entry.messageId} and prior.history_correction->>'at' >= ${entry.at}) returning message_id`,
            );
            if (result.rows.length === 0) throw Error();
          }),
        memberHistory: (guildId, authorId) =>
          query(async () => {
            // Resolve the latest retained source version and its latest correction BEFORE
            // any bound. A corrected finding can never fall outside a raw-event window.
            const result = await db.execute<{
              record: RecordEntry;
              history_correction: HistoryEntry | null;
            }>(
              sql`select record,history_correction from ${t} where guild_id=${guildId} and record->'evidence'->>'authorId'=${authorId} order by version desc`,
            );
            const entries = new Map<string, HistoryEntry>();
            const corrections = new Map<string, HistoryEntry>();
            for (const row of result.rows) {
              const r = row.record;
              const id = r.evidence.messageId;
              if (!entries.has(id))
                entries.set(id, {
                  guildId,
                  authorId,
                  messageId: id,
                  at: r.assessedAt,
                  origin: "automatic",
                  status:
                    r.judgment.action === "none" ? "corrected" : "pending",
                  summary: `${r.judgment.action}: ${r.judgment.reason}`,
                  supportingEvidence: [
                    {
                      guildId,
                      messageId: id,
                      channelId: r.evidence.channelId,
                      authorId,
                      version: r.evidence.version,
                      text: r.evidence.text,
                      roles: r.evidence.roles,
                      parentId: r.evidence.parentId,
                      embeds: r.evidence.embeds,
                      quotes: r.evidence.quotes,
                      attachments: r.evidence.attachments,
                    },
                  ],
                });
              const correction = row.history_correction;
              if (
                correction &&
                (!corrections.has(id) ||
                  (corrections.get(id)?.at ?? "") < correction.at)
              )
                corrections.set(id, correction);
            }
            for (const [id, correction] of corrections)
              entries.set(id, correction);
            return [...entries.values()];
          }),
        claim: (e) =>
          query(async () => {
            const r = await db.execute(
              sql`insert into ${t} (guild_id,message_id,version) values (${e.guildId},${e.messageId},${e.version}) on conflict do nothing returning message_id`,
            );
            return r.rows.length === 1;
          }),
        save: (record) =>
          query(async () => {
            const e = record.evidence;
            const r = await db.execute(
              sql`update ${t} set record=${JSON.stringify(record)}::jsonb where guild_id=${e.guildId} and message_id=${e.messageId} and version=${e.version} and record is null returning message_id`,
            );
            if (r.rows.length !== 1) throw Error();
          }),
        delivered: (e, delivery) =>
          query(async () => {
            const result = await db.execute(
              sql`update ${t} set delivery=${JSON.stringify(delivery)}::jsonb where guild_id=${e.guildId} and message_id=${e.messageId} and version=${e.version} and record is not null and (delivery is null or (delivery->>'rootId'=${delivery.rootId} and (delivery->>'threadId'='' or delivery->>'threadId'=${delivery.threadId}))) returning message_id`,
            );
            if (result.rows.length !== 1) throw Error();
          }),
        read: (guildId, messageId) =>
          query(async () => {
            const r = await db.execute<{
              record: RecordEntry;
              delivery: Delivery | null;
            }>(
              sql`select record,delivery from ${t} where guild_id=${guildId} and message_id=${messageId} and record is not null order by version`,
            );
            return r.rows;
          }),
      });
    }),
  );
