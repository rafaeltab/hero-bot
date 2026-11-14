# Toolchain maintenance

Use pinned Node/pnpm from the workspace. Upgrade exact compatible versions and the
lockfile together; check published engines/peers and installed APIs, then verify real
execution. Do not relax strict peers or quality gates to make a version install.
Provide [disposable PostgreSQL](postgres-validation.md), never live Discord or paid
AI credentials. Use a task-specific `TMPDIR` with available inodes; Turbo passes it
through. Run mutation verification before fresh coverage, not concurrently with it.

## Upgrade checks

| Upgrade                                       | Representative checks that must still work                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Effect / @effect/vitest / platform-node / dfx | `pnpm check`: scoped lifetime/interruption and actual timer disposal; configuration/error contracts; installed dfx HELLO/IDENTIFY/READY, wrong identity/server and transport cleanup; real PostgreSQL and controlled AI cancellation |
| Vitest / coverage-v8                          | `pnpm test:crap` and `pnpm coverage`: actual typed/nested/deferred Effect generators, exact function attribution, subprocess baseline, fresh receipts; `pnpm mutation:verify` for runner compatibility                               |
| TypeScript                                    | `pnpm typecheck`, `pnpm test:crap`, `pnpm coverage`, `pnpm mutation:verify`: compiler emission determines type-only eligibility; AST/body coordinates and complexity must still match actual reports                                 |
| Stryker / Vitest mutation runner              | `pnpm mutation:verify`, then coverage-only native runner checks and targeted staged validation: changed-line scope, per-test/static selection, checkpoint invalidation, integration gating and incomplete-result rejection           |
| ESLint / Vitest plugin / typescript-eslint    | `pnpm lint:tests`: positive/negative fixtures, aliases/shadowing, Effect/live/each, polling, generator returns and unsafe Effect.sync promises; verify real CLI nonzero exits                                                        |
| Biome / dependency-cruiser / Turbo            | `pnpm lint`, `pnpm architecture`, full `pnpm check`: allowed/prohibited graphs and error exit status, explicit composition roots, environment forwarding, fresh uncached coverage                                                    |

A complete upgrade verification is:

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm mutation:verify
pnpm mutation:verify:real
TURBO_FORCE=true pnpm check
```

For mutation/coverage/instrumentation upgrades, inspect the explicit changed-production
plan and use the [staged commands](mutation-validation.md). `pnpm mutation:verify`
runs contract tests without executing mutants. `--dry-run` verifies native unit
baseline coverage without executing mutants. A targeted real-mutant fixture is still
needed to establish actual kill/selection compatibility after a runner upgrade;
do not substitute an empty scope or claim contract tests prove runtime behavior.
Do not run exhaustive mutation analysis merely to validate tooling. Keep Node/pnpm
pins, CI setup and supported dependency combinations consistent. Re-evaluate survivor
classifications when library semantics change.

## Guarantees and limits

- Test lint catches the verified registration/assertion forms, including promises
  returned through Effect.sync. It cannot prove assertions execute or are meaningful,
  and does not perform general interprocedural analysis. Add fixtures before adopting
  new test builders/assertion wrappers. [Supported forms](test-lint-validation.md).
- Coverage requires complete fresh production evidence and 90% statements/branches.
  CRAP <=30 uses each function's own source statement evidence; nested generators
  cannot borrow wrapper/file coverage. Receipts bind inputs/reports and freshness,
  not signed attestation or behavioral correctness. [Metric](crap-validation.md).
- The [shared production policy](production-source-policy.md) retains unimported
  runtime source and defines test/generated/type-only treatment. Do not hide runtime
  code under excluded directories; new extensions or mappings require fixtures.
- Mutation scope, test selection and checkpoint reuse are separate. Native unit and
  integration stages use fresh per-test coverage. Process-test mutation observations
  are deferred to #44; ordinary CI retains those tests. Full-suite mutation fallback
  is removed. Timeouts are classified results, while unfinished stage work is visibly
  incomplete. Mutation analysis remains advisory and is not a required merge check.

## Common failures

| Symptom                                  | Diagnose and recover                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing/ambiguous function attribution   | Inspect source AST and `coverage-crap/coverage-final.json`; rerun real generator fixtures with the selected compiler/provider. Do not substitute file averages, exclude the function or weaken the threshold. |
| Stale/invalid receipt                    | Finish source/config changes and mutation verification, then regenerate `pnpm coverage`. Do not edit reports/receipts or run artifact-producing fixtures concurrently with coverage.                          |
| Wrong mutation scope or unsafe selection | Inspect `pnpm mutation --base <ref> --plan`; verify exact base and changed ranges. Retain static coverage and integration candidates; process-test mutation restoration is tracked by #44.                    |
| Sandbox cannot load a module             | Ensure app configuration dependencies are available inside Stryker's copied app, as with the application-local source policy. Exercise a real runner; do not bypass the failing tests.                        |
| Missing/inconsistent stage results       | Inspect plan, progress, checkpoints and summary. Rerun compatible unfinished work; do not interpret missing inventory or missing integration candidates as complete.                                          |
| Dependency mismatch                      | Check published exact versions, peers/engines and installed APIs; update the compatible set and lockfile, then strict installation and representative fixtures.                                               |

`CI / Checks` is the required context on the active main ruleset. Keep the user's
existing rule choices intact; [verify protection](repository-protection.md) separately
from successful workflow steps. Mutation analysis remains optional.
