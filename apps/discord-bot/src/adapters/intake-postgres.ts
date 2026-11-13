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
      const locks = yield* Effect.acquireRelease(
        Effect.sync(() => new Pool({ connectionString: url, max: 2 })),
        (p) => Effect.promise(() => p.end()),
      );
      const db = drizzle(pool);
      const t = sql.identifier(table);
      yield* query(() =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${table},0))`,
          );
          await tx.execute(
            sql`create table if not exists ${t} (guild_id text not null,message_id text not null,version text not null,record jsonb,delivery jsonb,primary key(guild_id,message_id,version))`,
          );
          await tx.execute(
            sql`alter table ${t} add column if not exists state text not null default 'legacy'`,
          );
          await tx.execute(
            sql`alter table ${t} add column if not exists history_correction jsonb`,
          );
          // Legacy partial deliveries are uncertain; never blindly create another root.
          await tx.execute(
            sql`update ${t} set state=case when delivery is not null and coalesce(delivery->>'state','complete')='complete' then 'delivered' else 'delivering' end where record is not null and state='legacy'`,
          );
        }),
      );
      const state = (
        e: { guildId: string; messageId: string; version: string },
        value: string,
      ) =>
        query(async () => {
          await db.execute(
            sql`update ${t} set state=${value} where guild_id=${e.guildId} and message_id=${e.messageId} and version=${e.version}`,
          );
        });
      return IntakeStore.of({
        correctHistory: (entry) =>
          query(async () => {
            const result = await db.execute(
              sql`update ${t} set history_correction=${JSON.stringify(entry)}::jsonb where guild_id=${entry.guildId} and message_id=${entry.messageId} and record->'evidence'->>'authorId'=${entry.authorId} and not exists (select 1 from ${t} prior where prior.guild_id=${entry.guildId} and prior.message_id=${entry.messageId} and (prior.history_correction->>'at')::timestamptz >= ${entry.at}::timestamptz) returning message_id`,
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
              sql`select record,history_correction from ${t} where guild_id=${guildId} and record->'evidence'->>'authorId'=${authorId} and record->'judgment'->>'action' <> 'none' order by version::timestamptz desc`,
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
                  status: "pending",
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
                  Date.parse(corrections.get(id)?.at ?? "1970-01-01") <
                    Date.parse(correction.at))
              )
                corrections.set(id, correction);
            }
            for (const [id, correction] of corrections)
              entries.set(id, correction);
            return [...entries.values()];
          }),

        serialize: (e, task) =>
          Effect.scoped(
            Effect.gen(function* () {
              const client = yield* Effect.acquireRelease(
                query(() => locks.connect()),
                (c) => Effect.sync(() => c.release(true)),
              );
              yield* query(() =>
                client.query(
                  "select pg_advisory_lock(hashtextextended($1, 0))",
                  [JSON.stringify([table, e.guildId, e.messageId])],
                ),
              );
              return yield* task;
            }),
          ),
        progress: (e) =>
          query(async () => {
            const result = await db.execute<{ version: string; state: string }>(
              sql`select version,state from ${t} where guild_id=${e.guildId} and message_id=${e.messageId} order by version::timestamptz`,
            );
            return result.rows;
          }),
        assessed: (e) => state(e, "assessed"),
        delivering: (e) => state(e, "delivering"),
        claim: (e) =>
          query(async () => {
            const r = await db.execute(
              sql`insert into ${t} (guild_id,message_id,version,state) values (${e.guildId},${e.messageId},${e.version},'claimed') on conflict do nothing returning message_id`,
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
              sql`update ${t} set state=${delivery.state === "partial" ? "delivering" : "delivered"},delivery=${JSON.stringify(delivery)}::jsonb where guild_id=${e.guildId} and message_id=${e.messageId} and version=${e.version} and record is not null and (delivery is null or (delivery->>'rootId'=${delivery.rootId} and (delivery->>'threadId'='' or delivery->>'threadId'=${delivery.threadId}))) returning message_id`,
            );
            if (result.rows.length !== 1) throw Error();
          }),
        read: (guildId, messageId) =>
          query(async () => {
            const r = await db.execute<{
              record: RecordEntry;
              delivery: Delivery | null;
            }>(
              sql`select record,delivery from ${t} where guild_id=${guildId} and message_id=${messageId} and record is not null order by version::timestamptz`,
            );
            return r.rows;
          }),
      });
    }),
  );
