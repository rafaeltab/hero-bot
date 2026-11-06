# Hero Bot

This workspace runs a persistent Effect application offline. Discord connections and
moderation workflows belong to later tickets.

Install Node **24.22.2** (`.node-version` / `.nvmrc`) and pnpm **12.16.1**
(`npm install --global pnpm@12.16.1`), then run from the repository root:

```sh
pnpm install --frozen-lockfile
cp apps/discord-bot/.env.example apps/discord-bot/.env
pnpm dev
```

The process prints `hero-bot started (development)` and stays running. Ctrl+C or
SIGTERM interrupts the main Effect, releases its scoped timer, and prints
`hero-bot stopped`. The published Effect Node runner exits **130** for interruption,
including graceful SIGINT/SIGTERM shutdown. Invalid configuration exits nonzero
before startup. The timer owns the offline process lifetime until adapters are wired.

For an independent production configuration:

```sh
pnpm build
HERO_ENV=production pnpm start
```

`HERO_ENV` is required: `development` or `production`. Both run commands read an
optional `apps/discord-bot/.env`; existing environment values take precedence.
Keep development `.env` files out of production artifacts and supply production
configuration through the operator's process environment. This setting labels the
application lifetime; it does not provision or connect a bot identity.

Development must eventually use a separate Discord application, bot identity,
credentials and test server from production. The integration ticket owns this setup.
When its adapter exists, supply secrets such as `DISCORD_BOT_TOKEN` through the
environment or an operator-managed secret store. Never commit or log credentials,
or reuse production credentials in development. CI needs no Discord, database or
paid AI access. The offline dfx test's placeholder is not a credential.

```sh
pnpm lint        # Biome lint and formatting check
pnpm format      # formatting and safe lint fixes
pnpm typecheck
pnpm test        # builds first, then Vitest
pnpm test:crap   # real-runtime attribution and gate fixtures
pnpm coverage    # fresh 90/90 coverage plus per-function CRAP <=30
pnpm crap        # revalidate existing fresh CRAP evidence
pnpm check       # all baseline checks above
```

GitHub Actions runs each baseline check as a failing-on-error step. An administrator
must require `Lint, types, tests and fresh coverage` in branch protection/rulesets;
workflow configuration cannot enable that repository setting. Hosted execution has
not been observed by this local implementation.

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

See [validation and coordination notes](docs/workspace-validation.md) for versions,
evidence and sibling work, and [evaluation conventions](evaluations/README.md) for
future AI artifacts.
