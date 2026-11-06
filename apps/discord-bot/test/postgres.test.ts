import { randomUUID } from "node:crypto";
import { expect, it } from "@effect/vitest";
import { ConfigProvider, Deferred, Effect, Fiber } from "effect";
import { Client } from "pg";
import { PostgresProbeLive } from "../src/adapters/postgres.ts";
import { PersistenceProbe } from "../src/capabilities/persistence-probe/contract.ts";

const databaseUrl = process.env.HERO_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "HERO_TEST_DATABASE_URL must point to a disposable PostgreSQL database; see docs/postgres-validation.md",
  );
}
it.effect("round trips an integer through PostgreSQL and Drizzle", () =>
  Effect.gen(function* () {
    const probe = yield* PersistenceProbe;
    expect(yield* probe.roundTrip(42)).toBe(42);
  }).pipe(
    Effect.provide(PostgresProbeLive),
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ DATABASE_URL: databaseUrl }),
      ),
    ),
  ),
);

it.effect("translates a rejected integer query and keeps the pool usable", () =>
  Effect.gen(function* () {
    const probe = yield* PersistenceProbe;
    const failure = yield* probe.roundTrip(Number.NaN).pipe(Effect.flip);
    expect(failure).toMatchObject({
      _tag: "PersistenceUnavailable",
      operation: "query",
    });
    expect(JSON.stringify(failure)).not.toContain("NaN");
    expect(yield* probe.roundTrip(-7)).toBe(-7);
  }).pipe(
    Effect.provide(PostgresProbeLive),
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ DATABASE_URL: databaseUrl }),
      ),
    ),
  ),
);

it.effect("reports connection failure while constructing the Layer", () => {
  const missingDatabase = new URL(databaseUrl);
  missingDatabase.pathname = "/hero_missing_database_18";
  return PersistenceProbe.pipe(
    Effect.provide(PostgresProbeLive),
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ DATABASE_URL: missingDatabase.href }),
      ),
    ),
    Effect.flip,
    Effect.map((failure) => {
      expect(failure).toMatchObject({
        _tag: "PersistenceUnavailable",
        operation: "connect",
      });
      expect(JSON.stringify(failure)).not.toContain("hero_missing_database_18");
      return failure;
    }),
  );
});

it.effect.each([
  {},
  { DATABASE_URL: "" },
  { DATABASE_URL: "secret-invalid-url" },
  { DATABASE_URL: "https://secret.example/db" },
])("rejects invalid configuration without exposing its value: %j", (settings) =>
  PersistenceProbe.pipe(
    Effect.provide(PostgresProbeLive),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(settings))),
    Effect.flip,
    Effect.map((failure) => {
      expect(failure).toMatchObject({
        _tag: "PersistenceUnavailable",
        operation: "configuration",
      });
      expect(JSON.stringify(failure)).not.toContain("secret");
      return failure;
    }),
  ),
);

const observeSessions = Effect.acquireRelease(
  Effect.promise(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return client;
  }),
  (client) => Effect.promise(() => client.end()),
);

async function sessionCounts(observer: Client, name: string) {
  const result = await observer.query<{ count: number }>(
    "select count(*)::int as count from pg_stat_activity where application_name = $1",
    [name],
  );
  return result.rows;
}

it.effect.each([false, true])(
  "releases PostgreSQL sessions after scope exit (query failure: %s)",
  (fail) =>
    Effect.scoped(
      Effect.gen(function* () {
        const observer = yield* observeSessions;
        const name = randomUUID();
        const url = new URL(databaseUrl);
        url.searchParams.set("application_name", name);
        const operation = Effect.gen(function* () {
          const probe = yield* PersistenceProbe;
          const sessions = yield* Effect.promise(() =>
            sessionCounts(observer, name),
          );
          expect(sessions).toEqual([{ count: 1 }]);
          yield* probe.roundTrip(fail ? Number.NaN : 42);
        }).pipe(
          Effect.provide(PostgresProbeLive),
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ DATABASE_URL: url.href }),
            ),
          ),
          Effect.exit,
        );
        const outcome = yield* operation;
        expect(outcome._tag).toBe(fail ? "Failure" : "Success");
        yield* Effect.promise(async () => {
          await expect
            .poll(() => sessionCounts(observer, name))
            .toEqual([{ count: 0 }]);
        });
      }),
    ),
);

it.effect("interruption awaits pool cleanup before the fiber exits", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const observer = yield* observeSessions;
      const started = yield* Deferred.make<void>();
      const name = randomUUID();
      const url = new URL(databaseUrl);
      url.searchParams.set("application_name", name);
      const fiber = yield* Effect.gen(function* () {
        const probe = yield* PersistenceProbe;
        expect(yield* probe.roundTrip(18)).toBe(18);
        yield* Deferred.succeed(started, undefined);
        yield* Effect.never;
      }).pipe(
        Effect.provide(PostgresProbeLive),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ DATABASE_URL: url.href }),
          ),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(fiber);
      yield* Effect.promise(async () => {
        await expect
          .poll(() => sessionCounts(observer, name))
          .toEqual([{ count: 0 }]);
      });
    }),
  ),
);

it.effect("survives PostgreSQL closing an idle pooled session", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const observer = yield* observeSessions;
      const name = randomUUID();
      const url = new URL(databaseUrl);
      url.searchParams.set("application_name", name);
      yield* Effect.gen(function* () {
        const probe = yield* PersistenceProbe;
        yield* Effect.promise(() =>
          observer.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where application_name = $1",
            [name],
          ),
        );
        // Wait for the server to acknowledge termination before requesting a replacement.
        yield* Effect.promise(async () => {
          await expect
            .poll(() => sessionCounts(observer, name))
            .toEqual([{ count: 0 }]);
        });
        expect(yield* probe.roundTrip(21)).toBe(21);
      }).pipe(
        Effect.provide(PostgresProbeLive),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ DATABASE_URL: url.href }),
          ),
        ),
      );
    }),
  ),
);
