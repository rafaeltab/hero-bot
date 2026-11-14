import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Config, Effect, Layer } from "effect";
import { Pool } from "pg";
import {
  type Configuration,
  ModerationUnavailable,
} from "../capabilities/moderation/contract.ts";
import { ConfigurationStore } from "../capabilities/moderation/ports.ts";

/** Namespace is operator-owned, never supplied by a Discord request. */
export const configurationPostgresLayer = (
  table = "moderation_configuration",
) =>
  Layer.effect(
    ConfigurationStore,
    Effect.gen(function* () {
      const url = yield* Config.String("DATABASE_URL").pipe(
        Effect.mapError(
          () => new ModerationUnavailable({ reason: "configuration" }),
        ),
      );
      yield* Effect.try({
        try: () => {
          if (
            !["postgres:", "postgresql:"].includes(new URL(url).protocol) ||
            !/^[a-z_][a-z0-9_]*$/.test(table)
          )
            throw Error();
        },
        catch: () => new ModerationUnavailable({ reason: "configuration" }),
      });
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const pool = new Pool({
            connectionString: url,
            max: 2,
            connectionTimeoutMillis: 1000,
            statement_timeout: 5000,
          });
          pool.on("error", () => undefined);
          return pool;
        }),
        (pool) => Effect.promise(() => pool.end()),
      );
      const db = drizzle(pool);
      const tableSql = sql.identifier(table);
      const query = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: () => new ModerationUnavailable({ reason: "database" }),
        });
      yield* query(() =>
        db.execute(
          sql`create table if not exists ${tableSql} (guild_id text not null, version integer not null, configuration jsonb not null, primary key (guild_id, version))`,
        ),
      );
      return ConfigurationStore.of({
        history: (guildId) =>
          query(async () => {
            const result = await db.execute<{ configuration: Configuration }>(
              sql`select configuration from ${tableSql} where guild_id = ${guildId} order by version`,
            );
            return result.rows.map((row) => row.configuration);
          }),
        save: (config) =>
          query(() =>
            db.transaction(async (tx) => {
              // Cross-process serialization per guild; CAS prevents stale authorization/config overwrites.
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${config.guildId}, 29))`,
              );
              const latest = await tx.execute<{ version: number }>(
                sql`select version from ${tableSql} where guild_id = ${config.guildId} order by version desc limit 1`,
              );
              if ((latest.rows[0]?.version ?? 0) !== config.version)
                throw Error();
              const version = config.version + 1;
              await tx.execute(
                sql`insert into ${tableSql} values (${config.guildId}, ${version}, ${JSON.stringify({ ...config, version })}::jsonb)`,
              );
              return version;
            }),
          ),
      });
    }),
  );
