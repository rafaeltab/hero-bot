# Mutation CI cost investigation

Investigated 2026-11-14. Research only; CI configuration is unchanged.

## Why this happened

The [foundation resolution](https://github.com/rafaeltab/hero-bot/issues/4#issuecomment-6614556278) approved advisory mutation testing on changed production code, using coverage to select relevant tests where sound. [Issue 23](https://github.com/rafaeltab/hero-bot/issues/23) explicitly allowed a broader fallback for integration/static tests whose coverage cannot safely narrow execution. Neither specifies eight shards or a four-hour budget.

The original implementation [56dac38](https://github.com/rafaeltab/hero-bot/commit/56dac3897964f979ac85aa36fee60d48ce33f3c4) used a command runner because compiled subprocess observations do not appear in Stryker's in-process per-test coverage. The real fixture in `scripts/mutation/execution.test.mjs` demonstrates child-only mutants reported as NoCoverage by per-test mode but killed by the full-suite fallback. This is a valid correctness concern.

The implementation applied that fallback globally: `scripts/mutation/execution.mjs:47-69` chooses the command runner, disables coverage analysis, rebuilds the application and runs every app test for every mutant, serially. CI does not pass `--selection per-test` or `--incremental`. Full-suite cache reuse is explicitly rejected by `scripts/mutation/run.mjs`. The existing cache key also hashes all repository inputs, so simply enabling caching would not provide reuse across normal changed commits.

The response to timeouts was increased parallelism and budget:

- [208173a](https://github.com/rafaeltab/hero-bot/commit/208173a9d981aa75762bc42d579766e8b42a9e66), Nov 6: one 20-minute job became four 20-minute jobs after a 150-mutant scope exceeded the limit.
- [54b0b55](https://github.com/rafaeltab/hero-bot/commit/54b0b55297202ac1c60a1c4fcc499734bc68581f), Nov 14: four became eight, and each timeout rose from 20 to 240 minutes after the 2,807-mutant notification feature timed out. Documentation explicitly prioritized retaining every mutant and whole changed range.

Assessment: a sound fallback for some tests became the default execution strategy for everything; then CI capacity was expanded to finish it. The history establishes the technical rationale, but not a separate user decision approving this recurring compute budget. The [merge comment](https://github.com/rafaeltab/hero-bot/pull/43#issuecomment-6882641246) explicitly calls for fixing the cost next.

## Measured hosted cost

[Completed PR run 43613764307](https://github.com/rafaeltab/hero-bot/actions/runs/43613764307), head `54b0b55`:

| Shard | Job minutes |
| ----- | ----------: |
| 1     |      113.13 |
| 2     |      168.88 |
| 3     |      149.70 |
| 4     |      106.83 |
| 5     |       90.13 |
| 6     |       55.98 |
| 7     |      158.63 |
| 8     |      105.40 |

Total shard elapsed time: **948.7 runner-minutes / 15.81 runner-hours**. This is elapsed runner usage, not an invoice or CPU-hour estimate. The Results job adds about ten seconds. Parallel wall time is about 2h49m. Setup and verification take roughly one minute per shard.

Its `mutation-summary` artifact reports a complete analysis of 41 ranges and 2,807 mutants: 1,960 killed, 29 timeouts, 818 survived. [Shard 2](https://github.com/rafaeltab/hero-bot/actions/runs/43613764307/job/132504245586) selected 440 mutants; its initial command took 23.6 seconds, and analysis took 167m47s. The command runner reports the entire shell invocation as one synthetic test.

The workflow runs on each PR update and pushes to main, with no concurrency cancellation or planning job before creating eight workers. Thus a merged feature can incur another analysis on main; [run 43629685061](https://github.com/rafaeltab/hero-bot/actions/runs/43629685061) was in progress during inspection. These are distinct events, not duplicate push and PR triggers on the feature branch. Eight workers also start for empty production scopes. The ruleset API confirms only `Checks` is required, not mutation checks.

## Recommended order of work

1. **Bound automatic expenditure.** Add per-PR concurrency cancellation, a planning step that avoids empty workers, and run tool verification once. Propose an explicit PR mutation budget with costly exhaustive fallback on manual/nightly runs. Preserve mandatory integration tests on every PR. Label deferred or interrupted mutation scope honestly as incomplete; do not silently sample or claim a complete aggregate. Moving exhaustive work changes the current cadence and should be an explicit policy choice. These controls limit frequency and waste; they do not speed an individual mutant.
2. **Compile the instrumented app once.** Replace per-mutant `pnpm build && pnpm test` with Stryker `buildCommand: "pnpm build"` and command `pnpm test`. In pinned [Stryker v10.1.1 sandbox initialization](https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/packages/core/src/sandbox/sandbox.ts#L74), the build runs after sandbox population; the [command runner](https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/packages/core/src/test-runner/command-test-runner.ts#L80) activates mutants through an environment variable rather than rewriting each mutant's source. This should retain compiled subprocess behavior without recompiling for each activation. Verify a compiled child-only mutant is killed and compiled static initialization still works. Benchmark before claiming a speedup.
3. **Enable coverage-guided execution where sound.** Separate in-process capability/adapter tests from process/CLI observations. Use the native Vitest runner with per-test selection for scopes whose mutation observability is demonstrated in-process; retain static-mutant execution and a conservative subprocess fallback for remaining scope. A source file is not automatically safe just because it has unit coverage: required process-only observations must remain represented. Avoid a blanket switch to `--selection per-test`, which existing fixtures prove unsound for the whole app.
4. **Restore early exit and useful reuse.** The current `disableBail: true` requests all failures from supporting native runners; use early exit when only killed/survived status is needed. For the shell runner, explicitly configure Vitest to bail rather than assuming Stryker's flag controls the command. Rework incremental identity and invalidation deliberately before persisting caches: current whole-repo fingerprints intentionally prevent cross-change reuse. Keep environment/external-state limitations explicit.
5. **Tune parallelism last.** Whole-range sharding balances source-line counts, not mutant counts or test costs (`planning.mjs:89-119`). Measured shard spread is about 3x. Once cost per mutant is reduced, select worker count from actual scope and measured cost. If refining partitions, verify the exact mutant identity union so splitting multiline ranges cannot silently lose mutations. Increasing concurrency alone reduces wall time at best, not the underlying total work; database isolation is necessary for concurrent integration workers.

No implementation benchmark was run in this investigation. Expected savings from build-once and per-test execution remain unmeasured. See the [companion wallpaperdb research](wallpaperdb-mutation-research.md) for reusable patterns and limitations.

## What to take from wallpaperdb

The comparison verifies native Vitest per-test selection, unit-first integration gating, bounded stages, persisted checkpoints and explicit fixture reset. These address work per mutant and continuation rather than simply adding machines. Its PR workflow has a 900-second aggregate execution budget and nightly all-scope work. However, the inspected green run completed in 2m52s with an explicitly incomplete scope, so its duration cannot serve as a complete-analysis speedup benchmark. Cache reuse was zero in the visited stages of the two inspected runs.

The recommended target is build-once plus coverage-guided in-process execution, with compatible unit-killed mutants avoiding redundant mutation integration work and subprocess-required observations retained in a separate fallback. Add bounded PR execution and honest incomplete reporting as an explicit cadence policy, then validated checkpoint continuation. Copy the mechanisms rather than the vendored coordinator or its version-specific Stryker patch.
