# PostgreSQL and Drizzle verification (#18)

This slice implements #18 within #10. It introduces no tables, migrations,
moderation records, or application transaction model. `PersistenceProbe` is an
infrastructure verification contract, not a proposed moderation capability.

## Interface, configuration and lifetime

`src/capabilities/persistence-probe/contract.ts` owns the SDK-free service and
`PersistenceUnavailable`. `src/adapters/postgres.ts` implements it directly; there
is no application logic needing an intermediate implementation or private port.
Consumers obtain `PersistenceProbe` and call `roundTrip(number)`. It parameterizes
an integer SELECT through Drizzle, returning the PostgreSQL signed 32-bit integer.
Out-of-range, fractional or nonfinite values can be rejected by PostgreSQL and
return a query error. No SQL, driver client, or construction dependency leaks to
callers. The returned row is validated at the adapter boundary.

Compose `Effect.provide(PostgresProbeLive)` around the consumer Effect. The Layer
reads `DATABASE_URL` through Effect Config, validates the PostgreSQL URL protocol,
acquires a pool, and verifies connectivity before publishing the service.
The service is valid only inside that Layer's scope. For development and production,
use independent databases and credentials; never commit real connection URLs.
The current persistent application does not require or acquire this verification
Layer: future persistence workflows will compose their scoped adapters in
`application.ts`. No database is contacted by ordinary bot startup yet.

All failures carry only `_tag: PersistenceUnavailable` and an `operation`:
`configuration`, `connect`, or `query`. They retain no raw error, credentials,
parameters or server diagnostics. The pool has two connections maximum, a 1s
connection timeout, and a 2s server statement timeout. Release awaits `pool.end()`
on success, failure, failed connection verification and interruption. Promise
operations already submitted to pg finish before draining; interruption is not a
PostgreSQL query-cancellation protocol. A finalizer rejection would be a defect
rather than a recoverable query error. pg evicts disconnected idle clients; its
idle-error event is absorbed without logging sensitive driver data. Subsequent
queries can acquire replacements. There is no application retry policy.

## Published versions and sources

Pinned and installed with strict peer checking under Node 24.22.2 / pnpm 12.16.1:

- `drizzle-orm` **0.45.4**, the published stable version, not the native Effect RC.
- `pg` **8.23.1** and `@types/pg` **8.23.1**.
- Existing Effect **4.1.2**, TypeScript **6.0.3**, Vitest **5.1.0** unchanged.
- Disposable PostgreSQL **17.6** (`postgres:17.6-alpine`).

Primary published metadata: [Drizzle 0.45.4](https://registry.npmjs.org/drizzle-orm/0.45.4),
[pg 8.23.1](https://registry.npmjs.org/pg/8.23.1), and
[pg types](https://registry.npmjs.org/@types%2fpg/8.23.1).
Drizzle accepts pg >=8 and pg supports Node >=16. The
[official Drizzle connection guide](https://orm.drizzle.team/docs/get-started/postgresql-new)
describes the node-postgres pool integration; its current RC install recommendation
was deliberately not adopted. Installed stable types and actual queries verified
`drizzle(pool)` and parameterized `db.execute(sql...)`. The
[official pg pool reference](https://node-postgres.com/apis/pool) documents draining,
idle error events and connection timeouts. Compatibility evidence includes strict
installation, frozen installation, compilation and actual PostgreSQL queries,
rather than peer ranges alone.

## Local and CI commands

Tests require `HERO_TEST_DATABASE_URL`; absence fails rather than skipping them.
Use a disposable database the test user owns, with access to its own sessions in
`pg_stat_activity` and permission to terminate them (the supplied local/CI role
owns those sessions). No application schema is created or changed.

```sh
docker run --detach --rm --name hero-18-postgres \
  -e POSTGRES_USER=hero_test -e POSTGRES_PASSWORD=hero_test \
  -e POSTGRES_DB=hero_test -p 127.0.0.1:55418:5432 postgres:17.6-alpine
docker exec hero-18-postgres pg_isready -U hero_test
# Wait until pg_isready reports accepting connections before running tests.
export HERO_TEST_DATABASE_URL=postgresql://hero_test:hero_test@127.0.0.1:55418/hero_test
pnpm install --frozen-lockfile
pnpm --filter @hero-bot/discord-bot exec vitest run test/postgres.test.ts
pnpm check
docker stop hero-18-postgres
```

The values above are disposable test credentials. CI supplies the same image as a
health-checked service and runs all existing blocking checks. Turbo includes the
test URL in test/coverage environments and cache keys. PostgreSQL/Docker provisioning
is external local setup; CI needs no production credentials or paid services.
No hosted CI execution or production deployment is claimed.

## TDD and observed evidence

The first public round-trip test failed on the absent adapter, then passed against
the disposable server. The rejected-integer slice failed with a raw Drizzle defect,
then passed after typed query translation and verified a subsequent successful
query. The next slice demonstrated that merely constructing a lazy pg pool falsely
reported connectivity; requiring acquisition caught a nonexistent database as a
typed `connect` failure. Missing, empty, malformed and wrong-protocol configuration
failed before adding sanitized `configuration` translation, then passed.

Independent observer connections verify one real adapter session inside its scope
and zero after normal or failed use; interruption also awaits session disappearance.
These tests check resource ownership through the external server rather than
mocking pool.end. They cover cleanup already introduced by the successful-operation
slice. A further idle-session termination test produced an unhandled pg error and
a nonzero Vitest exit before installing the idle-error handler; afterward the same
check passed and a new round trip succeeded.

Before integration-tip reconciliation, all 11 PostgreSQL tests passed. The original
full gate passed 19 tests (before the additional idle-error test), 12 architecture
graphs and 98.50% statements / 100% branches. Final reconciled results are recorded
below. The existing compiled/source entry-point coverage attribution limitation is
documented in workspace-validation.md; no exclusions or thresholds were weakened.

## Coordination

Initial checkout/base matched integration `78adf411a7126e0262a40129b976e3f3630306db`.
Shared files touched: application package manifest, pnpm lockfile, `turbo.json`
(test/coverage env only), and CI (PostgreSQL service/env only). Preserve sibling
quality gates when merging these additions. Tests use `it.effect`,
`it.effect.each`, ordinary assertions and awaited `expect.poll`; future tooling
must preserve those forms. The CRAP source-attribution run also executes these
integration tests and needs the test URL. #18 stays open until integration PR #24
merges. No merge into integration or separate PR is part of this slice.

Final reconciliation merged both local and remote integration tips at
`b230b701f1e086187f3aee5385074a4ad0dfd259` into this branch, preserving the sibling
#21 and #22 gates. The only conflict was the pnpm lockfile; it was regenerated
from the combined exact manifests, followed by a successful frozen install.
`HERO_TEST_DATABASE_URL=... pnpm check` then passed Biome, test-only ESLint and its
13 fixtures, all 12 architecture graphs, TypeScript/build, 20 application tests
(including all 11 PostgreSQL checks), 14 CRAP-gate tests, baseline fresh coverage
and the separate source-attribution integration run. Coverage: **98.57% statements,
100% branches**; PostgreSQL adapter: **100% statements and branches**. All **21**
scored production functions passed CRAP <=30 (maximum observed **2**). No gating
configuration was weakened. Disposable container cleanup followed validation.

## Integration merge verification

The integration checkout merged adapter tip
`23e84fbb65a66b3a1f220a2766bcd21334931a53` into integration base
`b230b701f1e086187f3aee5385074a4ad0dfd259` without conflicts. With the pinned tools
from `/tmp/hero-16-tools/node_modules/.bin`,
`pnpm install --frozen-lockfile --strict-peer-dependencies` passed. A fresh
`postgres:17.6-alpine` container on a dynamically allocated loopback port supplied
`HERO_TEST_DATABASE_URL` from a protected temporary file. `TURBO_FORCE=true pnpm check`
passed with zero cached Turbo tasks: 13 lint fixtures, 12 architecture graphs,
TypeScript/build, 20 application tests (11 PostgreSQL tests), 14 CRAP fixtures,
fresh baseline coverage and the separate source-attribution run. Statements were
**98.57%**, branches **100%**, and all **21** production functions passed CRAP <=30
(maximum **2**). The adapter retained **100% statement and branch coverage**.

After validation, an independent `pg_stat_activity` query found **zero** remaining
test-role sessions in the disposable database, excluding the observer itself.
The merger stopped only its own container, verified its removal, and deleted the
temporary credentials. Existing CI services and blocking lint, architecture,
coverage and CRAP gates were preserved. Local setup still requires disposable
PostgreSQL as described above; hosted CI and production access were not exercised.
