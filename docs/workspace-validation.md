# Workspace reference

The runnable workspace uses exact pins:

| Tool                                    | Version           |
| --------------------------------------- | ----------------- |
| Node LTS / pnpm                         | 24.22.2 / 12.16.1 |
| Turborepo / TypeScript                  | 2.11.10 / 6.0.3   |
| Biome                                   | 2.6.5             |
| Effect / platform-node / @effect/vitest | 4.1.2             |
| Vitest / coverage-v8                    | 5.1.0             |
| dfx                                     | 1.1.1             |

`@effect/vitest` is pinned to 4.1.2. Package compatibility is demonstrated by frozen
installation, compiled tests and actual installed SDK execution, not just peer ranges.

Use the [README](../README.md) for authoritative startup and check commands and
[scaffold validation](scaffold-validation.md) for the final verification record.
Development uses a separate Discord application, bot identity, credentials and test
server. Production hosting and credentials are not provisioned by this scaffold.

The offline process baseline validates configuration before acquiring its scoped
timer. Tests verify persistence, SIGINT/SIGTERM finalization and interruption exit
130, as specified by Effect's Node runner. Development runs TypeScript directly and
requires manual restart: Node watch mode exhibited a native shutdown assertion
with the pinned runtime, so it is not enabled.

Turbo forwards named configuration variables only. `TMPDIR` is passed through so
local validation can use a filesystem with sufficient inodes. It is a temporary
path, not a cached behavioral input. Keep secrets in environment configuration,
never repository files or routine logs.

The subprocess-aware coverage report can retain overlapping source/compiled entry
point statement coordinates. This is why CRAP uses a separate exact source report;
no production file is excluded to disguise that limitation. See
[CRAP attribution](crap-validation.md) and [production eligibility](production-source-policy.md).
