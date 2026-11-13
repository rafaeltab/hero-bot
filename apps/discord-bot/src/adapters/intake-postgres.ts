import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Config, Effect, Layer } from "effect";
import { Pool } from "pg";
import type {
  Delivery,
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
      return IntakeStore.of({
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
              sql`update ${t} set delivery=${JSON.stringify(delivery)}::jsonb where guild_id=${e.guildId} and message_id=${e.messageId} and version=${e.version} and record is not null and delivery is null returning message_id`,
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
