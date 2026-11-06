# Workspace slice validation (#16)

This implements only [#16](https://github.com/rafaeltab/hero-bot/issues/16) of
[#10](https://github.com/rafaeltab/hero-bot/issues/10). The five existing ADRs are
preserved. The prepared checkout initially matched local and remote integration
tips at `1b5ea5dcd29ee674572ef6b6b5182ad133521218`.

## Published versions

| Tool                                            | Pin     |
| ----------------------------------------------- | ------- |
| Node LTS                                        | 24.22.2 |
| pnpm                                            | 12.16.1 |
| Turborepo                                       | 2.11.10 |
| TypeScript                                      | 6.0.3   |
| Biome                                           | 2.6.5   |
| Effect / @effect/platform-node / @effect/vitest | 4.1.2   |
| dfx                                             | 1.1.1   |
| Vitest / @vitest/coverage-v8                    | 5.1.0   |
| @types/node                                     | 24.19.2 |

Verified published metadata with `npm view`, installed the exact versions with strict
peer checking, and verified frozen-lockfile installation. Primary sources:
[dfx](https://registry.npmjs.org/dfx/1.1.1),
[Effect](https://registry.npmjs.org/effect/4.1.2),
[Effect Vitest](https://registry.npmjs.org/@effect%2fvitest/4.1.2),
[Vitest](https://registry.npmjs.org/vitest/5.1.0), and
[Node LTS release](https://nodejs.org/en/blog/release/v24.22.2).
Installed dfx requires Effect `^4.0.0`; @effect/vitest requires Effect `^4.1.2` and
Vitest `>=5.0.0 <6.0.0`. Vitest supports Node 24. TypeScript 6 avoids adopting another
compiler major without need. Runtime tests provide evidence beyond peer ranges.

## Local validation evidence

Commands ran with pinned Node/pnpm binaries. `pnpm check` passed Biome, TypeScript,
six Vitest tests and fresh coverage. The lifecycle test first failed on the absent
application module, then passed with its minimal scoped lifetime. The process test
first failed on the absent executable entry point. An initial exit-code expectation
of zero was corrected against published Effect Runtime documentation specifying 130
for interruption; finalization assertions remain enforced.

Application tests exercise ConfigProvider Layers, interruption and resource
finalization, and reject missing/invalid environment values before startup. Process
tests launch the compiled entry point, observe production configuration, wait to
confirm persistence, send SIGINT/SIGTERM, and verify finalization output, exit 130
and empty stderr. The offline dfx test constructs its published configuration Layer,
reads its service and configured intents, and checks redaction under the installed
Effect runtime. No gateway/REST connection, live deployment, AI or database is claimed.
Effect 4 uses capitalized config constructors; nested literal dfx config values
require `Config.succeed`.

Fresh coverage reports 93.75% statements and 100% branches, lines and functions.
There are zero instrumented production branches; that percentage is vacuous, not
failure-path completeness. Vitest `autoAttachSubprocess` collects compiled `.js`
inputs and remaps them to `.ts`. The provider conservatively retains an uncovered
source-only entry-point statement alongside its covered compiled statement
(`main.ts`: 50% statements). No ignore annotation or production-file exclusion hides
this. Downstream CRAP tooling must validate per-function attribution separately.

Temporary failure probes were restored before final checks:

- Missing summary, malformed JSON, empty report, inconsistent percentage and
  consistent zero coverage each made the validator exit 1.
- An unexecuted production function made fresh Vitest coverage fail both thresholds
  at 62.5% statements and 0% branches.

## Coordination and external setup

Architecture checks (#17), validated CRAP (#18), test-specific linting (#19), mutation
analysis (#20), and real integration verification (#21–#23) remain sibling work. This
baseline does not certify the whole scaffold. Extend the existing CI/scripts with
those gates.

Production code lives in `apps/discord-bot/src`; tests under `test` are typechecked.
Actual forms include `it.effect`, `it.effect.each`, `it.each` and ordinary `expect`.
Keep intentional lint-failure fixtures outside normal discovery. Fresh coverage
exports `coverage-final.json`, `coverage-summary.json` and `lcov.info`. The validator
inventories runtime `.ts` files excluding `.d.ts`; declaration-only modules or new
source extensions require explicit coverage/inventory updates. No capability
contracts exist yet; future contracts and implementations must be separate files.

Replace the placeholder lifetime resource with scoped adapters when wiring real
integrations. Compose with Layers, retain dfx, and introduce no moderation behavior
as scaffolding. Integrations own development Discord identity/server credentials,
AI provider credentials, and PostgreSQL provisioning. Hosting/operator deployment
remain unresolved. Branch protection is external setup. CI needs no service secrets.

The root `HERO_ENV=development pnpm dev` command was also exercised through startup
and Ctrl+C finalization. Turbo's strict environment filtering requires its explicit
`dev.env` allowlist; future adapters must add their environment variable names there
without adding secret values. Development runs TypeScript directly with Node's
type stripping and needs manual restart after edits. Optional Node `--watch` was
removed after repeated native `FSWatcher.close` assertions on Ctrl+C with this pinned
runtime; watch mode is not required for the persistent-process baseline.
