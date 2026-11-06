# Hero Bot

This workspace includes an opt-in dfx development connection and a separate offline
process baseline. It implements no moderation workflows.

Install Node **24.22.2** and pnpm **12.16.1**, then run:

```sh
pnpm install --frozen-lockfile
cp apps/discord-bot/.env.example apps/discord-bot/.env
# Fill the ignored .env with a separate development application's bot token,
# application ID and dedicated test-server ID (see setup link below).
pnpm dev
```

Development connects through dfx, checks the READY application and sole server,
prints `development Discord ready`, and stays running. Ctrl+C or SIGTERM closes the
scoped connection and prints `development Discord stopped`; Effect's Node runner
exits **130** for interruption. Missing configuration fails before connecting;
startup without READY fails after 15 seconds. Node runs TypeScript directly;
restart manually after edits.

See [Discord development setup and verification](docs/discord-development.md) for
separate identity/server setup, controlled evidence, live smoke steps and limitations.
Secrets belong only in environment configuration or the ignored `.env`. CI requires
no live Discord credentials. Do not use a production bot token or invite this bot to
the real server.

The existing offline process baseline remains available independently:

```sh
pnpm build
HERO_ENV=development pnpm start
```

It prints `hero-bot started (development)` and releases its timer on shutdown.
`HERO_ENV=production pnpm start` labels that same offline baseline; this does not
connect or deploy a production bot. Both app scripts read an optional ignored `.env`,
with existing environment values taking precedence. Keep development `.env` files
out of production artifacts. Hosting and production configuration remain undecided.

Tests and coverage require the [disposable PostgreSQL setup](docs/postgres-validation.md).

```sh
pnpm lint        # Biome and test-specific assertion/registration checks
pnpm format      # formatting and safe lint fixes
pnpm typecheck
pnpm test        # builds first, then Vitest; requires HERO_TEST_DATABASE_URL
pnpm test:crap   # real-runtime attribution and gate fixtures
pnpm coverage    # fresh 90/90 coverage plus per-function CRAP <=30
pnpm crap        # revalidate existing fresh CRAP evidence
pnpm check       # all baseline checks above
```

GitHub Actions runs baseline checks as failing-on-error steps. The existing main
ruleset is **active** and requires **Checks** from workflow **CI** (GitHub Actions).
Mutation jobs remain optional by the user's choice. See
[verified protection status](docs/repository-protection.md).

Workflows run once per pull-request update and on pushes to `main`, avoiding duplicate
branch-push and pull-request checks. The four numbered mutation shards and `Mutations / Results` remain advisory; they
partition one analysis rather than duplicate it.

Coverage enforces **90% statements and 90% branches**, includes unimported production
source and subprocess execution, and remaps compiled code through TypeScript source
maps. Tests, declarations and generated output are excluded from final scoring.
Fresh runs delete previous reports and bypass Turbo caches. The validator rejects
missing, malformed, empty, inconsistent or incomplete production reports.

CRAP uses exact source-function attribution and per-function statement coverage.
The source-only attribution run is separate from the mandatory subprocess-aware
90/90 baseline; missing, invalid or stale evidence fails. See
[CRAP semantics and verification](docs/crap-validation.md) for the metric, exclusions,
worked scores and source-mapping limitations.

See [workspace versions](docs/workspace-validation.md), [current validation](docs/scaffold-validation.md),
[mutation commands/results](docs/mutation-validation.md), and [shared source policy](docs/production-source-policy.md).
[Evaluation conventions](evaluations/README.md) describe future AI artifacts.

For upgrades and troubleshooting, use the short [toolchain maintenance guide](docs/toolchain-maintenance.md).
The [survivor triage](docs/mutation-survivor-triage.md) distinguishes new regression
tests, remaining behavioral gaps and currently nonobservable mutations.
