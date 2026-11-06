# PostgreSQL and Drizzle verification

`PersistenceProbe.roundTrip(number)` executes a parameterized integer SELECT through
Drizzle and returns a validated PostgreSQL integer. It verifies infrastructure:
no tables, migrations, moderation schema or domain transaction model are added.
The SDK-free contract exposes `PersistenceUnavailable` with sanitized configuration,
connect or query operation; raw driver errors/credentials are not retained.

`PostgresProbeLive` reads `DATABASE_URL`, validates it, acquires a scoped pool and
verifies connectivity before publishing the service. Pool size is two; connection
and statement timeouts are 1s/2s. Release awaits `pool.end()` after success, failure
or interruption. Already submitted queries finish before draining; interruption is
not a PostgreSQL query-cancellation protocol. Idle disconnected clients are evicted
without leaking sensitive error diagnostics. Ordinary bot startup does not acquire
this optional verification Layer.

## Running the tests

Tests require a disposable owned PostgreSQL database through
`HERO_TEST_DATABASE_URL`; missing setup fails rather than skipping tests.
Use independent development/production databases. Public fixture credentials below
are exclusively for this local disposable container:

```sh
docker run --detach --rm --name hero-local-postgres \
  -e POSTGRES_USER=hero_test -e POSTGRES_PASSWORD=hero_test \
  -e POSTGRES_DB=hero_test -p 127.0.0.1:55418:5432 postgres:17.6-alpine
docker exec hero-local-postgres pg_isready -U hero_test
# Continue once ready:
export HERO_TEST_DATABASE_URL=postgresql://hero_test:hero_test@127.0.0.1:55418/hero_test
pnpm check
docker stop hero-local-postgres
```

CI provisions its own health-checked PostgreSQL service, requiring no production
credentials. Installed pins: Drizzle 0.45.4, pg/@types/pg 8.23.1, PostgreSQL 17.6.
Frozen installation, compilation and actual database queries verify compatibility.
See [Drizzle integration](https://orm.drizzle.team/docs/get-started/postgresql-new)
and [pg pool behavior](https://node-postgres.com/apis/pool).

The 11 real database tests verify success, rejected input, sanitized configuration/
connection/query failures, idle recovery and cleanup after success/failure/interruption.
Observer connections independently inspect session disappearance, keeping explicit
assertions outside the shared session-query helper.

When checking teardown, scope `pg_stat_activity` to the test database and
`backend_type = 'client backend'`, excluding the observer itself. A role-only count
can include PostgreSQL's preexisting logical replication launcher; its presence is
not an adapter connection leak. Remove only containers owned by your run.
See [current verification](scaffold-validation.md).
