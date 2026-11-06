import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Config, Effect, Layer, Schema } from "effect";
import { Pool } from "pg";
import {
  PersistenceProbe,
  PersistenceUnavailable,
} from "../capabilities/persistence-probe/contract.ts";

export const PostgresProbeLive = Layer.effect(
  PersistenceProbe,
  Effect.gen(function* () {
    const connectionString = yield* Config.String("DATABASE_URL").pipe(
      Effect.mapError(
        () => new PersistenceUnavailable({ operation: "configuration" }),
      ),
    );
    yield* Effect.try({
      try: () => {
        const url = new URL(connectionString);
        if (!["postgres:", "postgresql:"].includes(url.protocol))
          throw new Error("Unsupported protocol");
      },
      catch: () => new PersistenceUnavailable({ operation: "configuration" }),
    });
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const pool = new Pool({
          connectionString,
          max: 2,
          connectionTimeoutMillis: 1000,
          statement_timeout: 2000,
        });
        // pg removes broken idle clients itself. No caller owns these idle errors;
        // absorb the event without logging driver errors that can contain secrets.
        pool.on("error", () => undefined);
        return pool;
      }),
      (pool) => Effect.promise(() => pool.end()),
    );
    yield* Effect.tryPromise({
      try: async () => {
        const client = await pool.connect();
        client.release();
      },
      catch: () => new PersistenceUnavailable({ operation: "connect" }),
    });
    const db = drizzle(pool);
    return PersistenceProbe.of({
      roundTrip: (value) =>
        Effect.tryPromise({
          try: async () => {
            const result = await db.execute<{ value: number }>(
              sql`select ${value}::integer as value`,
            );
            return Schema.decodeUnknownSync(
              Schema.Struct({ value: Schema.Number }),
            )(result.rows[0]).value;
          },
          catch: () => new PersistenceUnavailable({ operation: "query" }),
        }),
    });
  }),
);
