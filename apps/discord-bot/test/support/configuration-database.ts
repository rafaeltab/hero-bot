import { randomUUID } from "node:crypto";
import { ConfigProvider, Effect } from "effect";
import { Client } from "pg";
import { configurationPostgresLayer } from "../../src/adapters/moderation-postgres.ts";

export const configurationDatabase = Effect.acquireRelease(
  Effect.sync(() => `test_moderation_${randomUUID().replaceAll("-", "")}`),
  (table) =>
    Effect.promise(async () => {
      const client = new Client({
        connectionString: process.env.HERO_TEST_DATABASE_URL,
      });
      await client.connect();
      try {
        await client.query(`drop table if exists "${table}"`);
      } finally {
        await client.end();
      }
    }),
);
export const databaseLayer = (table: string) =>
  configurationPostgresLayer(table);
export const databaseConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    DATABASE_URL: process.env.HERO_TEST_DATABASE_URL,
  }),
);
