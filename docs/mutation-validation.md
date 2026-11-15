# Advisory production-code mutations

Mutation testing targets added/replaced production TypeScript lines, using the shared
[production-source policy](production-source-policy.md). It never mutates tests,
generated JS, evaluation tooling or other tooling. Stryker instruments the original
TS; Vitest transpiles it as it runs. There is no per-mutant app build or shell-runner
fallback.

## Commands

Use pinned Node/pnpm. Integration tests require
[disposable PostgreSQL](postgres-validation.md) through `HERO_TEST_DATABASE_URL`.

```sh
# Contract checks: no mutants executed.
pnpm mutation:verify
# Small real fixture: static kills, integration gating, reuse and invalid mutants.
pnpm mutation:verify:real
# Inspect changed production ranges against an explicit base.
pnpm mutation --base <commit-or-ref> --plan
# Coverage-guided stages, checkpoint reuse, 15-minute aggregate budget.
pnpm mutation --base <commit-or-ref>
# Full production scope, one-hour budget, suitable for baseline continuation.
pnpm mutation --base HEAD --scope all --budget 3600
# Discard checkpoint reuse for this invocation.
pnpm mutation --base <commit-or-ref> --fresh
# Instrument and collect unit-stage baseline coverage, executing no mutants.
pnpm mutation --base HEAD --scope all --dry-run
```

`--budget` accepts 1–7200 seconds and includes stage startup/discovery, not dependency
installation or contract checks. The coordinator terminates the worker process group
at the deadline, retaining completed outcomes. `--dry-run` stops after the unit dry
run and makes no completion claim. Run only one mutation coordinator per checkout;
it owns `.stryker-tmp/` and its reports/checkpoints.

Changed scope compares the exact base tree to the working tree, including staged,
unstaged and nonignored untracked source. Added/replaced lines become original
Stryker ranges; deletions have no current node. Pure renames/new files conservatively
count as additions. Full scope uses all eligible production files. Scope selection,
coverage-guided test selection and checkpoint reuse remain distinct mechanisms.

## Test stages and deferred coverage

`apps/discord-bot/vitest.mutation.config.ts` partitions the existing suite:

1. Unit: files without database-backed cases.
2. Integration: database-backed files, including mixed unit/database files, only
   after the unit inventory finishes. Mutants resolved by unit tests (including classified timeouts and invalid outcomes) are gated out;
   only unit survivors and NoCoverage candidates require integration observations.

Both stages use the native Stryker Vitest runner with `perTest` coverage, complete
stage discovery (`related: false`), static initialization retained, early failure
exit, and one worker. NoCoverage is an explicit result, not proof of verification.
Classified per-mutant timeouts are surfaced as terminal outcomes but are not cached.
Per-mutant RuntimeError/CompileError outcomes are recorded as invalid, excluded
from the mutation score, and retried on later runs. Tool/dry-run failures remain
incomplete and fail the command. Integration gating uses
source path, original zero-based location, mutator and replacement, not stage-local
numeric mutant IDs. Each stage retains native coverage-selected test plans.

The developer explicitly deferred `process.test.ts` and `intake-process.test.ts`
from mutation execution; restoration is tracked by
[issue #44](https://github.com/rafaeltab/hero-bot/issues/44). `evaluation.test.ts`
launches the evaluation CLI and is also outside mutation execution. All three remain
in ordinary tests and ordinary coverage: the base Vitest config is unchanged.
Results describe this reduced mutation-observation suite, including potentially
uncovered executable wiring. The former global subprocess fallback is removed.

## Checkpoints and completion

Reports live under `apps/discord-bot/reports/mutation/`. Each stage writes a native
JSON/HTML report when it finishes and an atomically updated `progress.json` after
planning, periodically during execution, and at completion. Snapshots are batched
to avoid rewriting cumulative evidence for every fast mutant. Interruption can
lose the most recent 250ms of outcomes; those mutants simply run again. Completed evidence accumulates independently
in `checkpoint-unit.json` and `checkpoint-integration.json`. Interruption before
planning leaves the inventory unknown; it must never be reported as complete.

Every invocation performs fresh baseline discovery and mutant coverage collection.
After that, compatible checkpoint results may replace execution. Fingerprints bind
runtime/platform, tooling/configuration/lockfile/test inputs, declared application
environment values and local `.env` bytes. Per-mutant evidence additionally follows
relative imports from the mutant and its current coverage-selected test files.
Changes to those dependencies invalidate reuse. Static/uncovered mutants and
unsupported dynamic import graphs conservatively bind all production source.
Test changes invalidate all results, including static results. Values are hashed,
not included in checkpoint JSON. Base SHA and selected ranges are provenance, not
cache validity: docs-only changes and unrelated source changes need not invalidate
an independent runtime mutant.

This is intentionally conservative. Imported file edits invalidate the dependent
result; changing a file invalidates its own results even if only an unrelated
function changed. External database/provider state is not captured. Use `--fresh`
or change `HERO_MUTATION_EPOCH` after external state changes or for release evidence.
Only Killed, Survived and NoCoverage outcomes are reusable; timeouts and errors rerun.
Checkpoints are trusted execution evidence, not a security attestation against an
editor who can alter code or artifacts.

`summary.json` explicitly records complete/incomplete/error/dry-run, pending counts,
selected scope, stage inventory/reuse and deferred tests. Complete requires a finished
unit inventory and an integration result for each unit survivor/uncovered candidate.
A mutant covered by either stage remains covered in the combined result; a unit
survivor plus integration NoCoverage is Survived. An incomplete run reports status
counts but no aggregate score. Tool/dry-run errors
exit nonzero; budget exhaustion is advisory and visibly incomplete. Mutation scores
remain advisory (`break=0`); no required merge checks change.

## CI budget and continuation

PR updates run one job with a 900-second analysis budget. Superseded PR runs are
cancelled. Empty scopes start no Stryker workers. Scheduled nightly and manual runs
use full production scope and a 3600-second budget, resuming compatible completed
work. There is no additional mutation run on every main push. The outer job ceiling
is 70 minutes to allow setup, the one-hour analysis and artifact upload.

Default-branch scheduled/manual runs publish cumulative baseline checkpoint caches.
PR runs restore their own prior checkpoints first and the baseline as a fallback;
successful/budget-exhausted PR runs save only into their PR-number namespace and
merge-ref scope. Default-branch runs never consume PR checkpoints. GitHub enforces
[cache isolation between PR merge refs and the base branch](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).
Cancelled runs may lose progress since their latest saved checkpoint. Artifacts
include progress when the scope is unfinished. A successful Actions job can therefore
have an incomplete advisory analysis: read its step summary/`summary.json`. Ordinary
blocking CI retains its full tests, coverage and other gates.

## Validation and limits

Contract tests cover explicit scopes, dependency/test invalidation, independent
source reuse, static invalidation, stage-independent identities, gating, interrupted
work, stale report removal and empty scopes. These tests do not execute mutants.
The opt-in real fixture (`mutation:verify:real`, also run once in CI) verifies
native kills, static initialization, unit-to-integration gating, cached equivalence,
docs-only reuse, dependency invalidation and invalid-mutant accounting.
The native runner's baseline can be verified with `--dry-run`; ordinary staged test
execution verifies the suite partition independently of mutation execution.

Real local validation completed a 75-mutant whole-module PR replay in 65.646s
fresh and 13.850s with checkpoints, with identical outcomes. The fresh full scope
(2,965 mutants) did not finish in 35 minutes; three minutes of continuation left
777 pending. No full-scope score or completed full-run duration is claimed.
[Measured results](mutation-performance-validation.md) record scope, hardware,
correctness fixes, historical comparisons and limitations. Hosted timings and
actual Actions cache transport remain unverified. Historical decision evidence
is preserved in [the investigation](mutation-efficiency-research.md) and
[wallpaperdb comparison](wallpaperdb-mutation-research.md).
