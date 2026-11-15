# Mutation execution validation — 2026-11-14

The PR execution path completes a representative whole-module scope and reuses
compatible results. The full cold baseline remains expensive and was not completed
within this investigation's mutation-execution allowance. No full mutation score
or precise completed full-run duration is claimed.

## Environment and budgets

Source commit: `439aed8a77735024be4ddd7971c6f8f0eb06e626`, with the uncommitted mutation
runner changes in this workspace. Node 24.22.2, pnpm 12.16.1, Stryker 10.1.1,
Vitest 5.1.0. Local AMD Ryzen 9 9955HX, 32 available logical CPUs, approximately
29 GiB RAM; Stryker concurrency remained **one**. PostgreSQL 17.6 ran in an owned,
disposable container. No paid/live service calls were made.

Mutation execution stopped within the one-hour window. Approximately 55 minutes
of execution included an initial 15-minute run that exposed an accounting bug,
the corrected 35-minute run, three minutes of continuation, the PR replays, and
small verification fixtures. No individual invocation exceeded its own deadline.
Normal lint/tests/coverage and report preparation continued afterward.

These are local timings. The earlier hosted feature run used eight GitHub runners
and 2,807 changed-scope mutants. The new full scope contains 2,965 mutants. Different
hardware, scopes and deferred process observations prevent an equivalent-completion
speedup ratio against that old run.

## Measurements

| Scope                                          | Budget | Measured elapsed | Result                                               |
| ---------------------------------------------- | -----: | ---------------: | ---------------------------------------------------- |
| Corrected full production scope, fresh results | 2,100s |       2,100.079s | Incomplete; 968 pending                              |
| Same full scope, checkpoint continuation       |   180s |         180.039s | Incomplete; 777 pending                              |
| Single-file PR replay, fresh results           |   180s |          65.646s | Complete; 75 mutants                                 |
| Identical PR replay with checkpoints           |    45s |          13.850s | Complete; identical outcomes; zero mutant executions |

The PR replay copied the actual application and tests into an isolated disposable
fixture, then selected the entire existing 65-line
`src/capabilities/moderation/readiness.ts` module through a whitespace-only edit.
It measures a realistic production-code scope without modifying application behavior
in the working tree. It is not a published feature PR or a claim about every PR size.
Both stages still discovered their complete suites: 146 unit and 158 integration
tests. Fresh execution required 57 unit and 32 integration mutant executions;
the repeat reused 75 unit and 42 integration observations after fresh coverage.

The complete PR result, using the corrected aggregation rule, is **42 Killed,
28 Survived and 5 NoCoverage**. Cold and repeated results match exactly.

The full unit stage took about **28.5 minutes**, including 212 static mutants
that require broad test execution. It recorded 1,043 Killed, 607 Survived,
1,310 NoCoverage, 4 Timeout and 1 RuntimeError. Integration gated out 1,048 resolved
unit outcomes. At the 35-minute cap, integration had executed 450 mutants.

Continuation reused **2,960 unit outcomes**, rerunning only four timeouts and one
invalid mutant; its unit classifications matched the fresh unit classifications.
Integration reused all **949** previously finished outcomes (450 tested plus
499 uncovered) and executed 191 additional candidates. This verifies real
application-scale continuation, not just fixture cache-file loading.

After continuation, the corrected combined counts are **1,496 Killed,
557 Survived, 129 NoCoverage, 4 Timeout, 2 RuntimeError and 777 Pending**.
The unfinished 777 cases prevent a full-scope score or an assertion that all
production mutation behavior has been checked. A fresh complete full run takes
longer than 35 minutes here; the remaining tail varies enough that no precise
completion estimate is warranted.

## Correctness findings and fixes

1. **Invalid mutant accounting.** Replacing the development Discord layer factory
   with `() => undefined` makes test-file initialization fail before assertions.
   Native Stryker classifies this RuntimeError. The coordinator initially treated
   it as a tooling failure and prevented integration continuation. A minimized real
   fixture reproduced that failure, then passed after invalid-mutant outcomes were
   accepted as finished observations. RuntimeError/CompileError are reported
   separately, excluded from scoring and not cached. Worker exits and baseline
   failures remain analysis errors. This follows
   [Stryker's state definitions](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/).
2. **Combined coverage labels.** A unit survivor followed by integration NoCoverage
   was labelled NoCoverage overall. It now remains Survived: coverage demonstrated
   in one stage cannot be erased by another. A direct failing regression and a real
   weak-assertion fixture cover this case. This changes labels, not test selection,
   gating, execution timings or detected/undetected totals.

Native stage observations were preserved unchanged. Benchmark artifacts contain
both their original `summary.json` and a `corrected-summary.json` recalculated from
those observations using the final aggregation rule. The label correction was
applied after timing cold/cached runs to keep their cache input hashes stable.

The real fixture exercised cold kills, static initialization, unit-to-integration
kills, exclusion of unit-resolved mutants from integration, identical cached
outcomes, docs-only reuse, transitive dependency invalidation and import-time invalid
mutants. A one-second real interruption also produced an explicitly incomplete
summary. An extra diagnostic print in that temporary probe initially assumed both
stages existed; the optional-stage print was corrected and the probe removed from
the permanent fixture. The permanent four real scenarios had all completed their
assertions before that harness-only failure. Root application continuation above
independently validates interrupted-work reuse at scale.

The final non-mutation contract suite has ten tests, including process-group deadline
termination, native test discovery partitions, worker failures, empty scopes,
checkpoint invalidation and combined coverage labels. The full ordinary `pnpm check`
passed with all 313 application tests and the existing coverage/CRAP gates intact.

## Comparison with the old hosted run

Downloaded the eight JSON reports from
[run 43613764307](https://github.com/rafaeltab/hero-bot/actions/runs/43613764307).
Their source bytes match this application's source. Comparison uses original source
path, location, mutator and replacement rather than run-local mutant IDs.

All **2,807** previous identities are present in the new **2,965**-mutant inventory;
none were dropped by the execution change. Among completed observations, 24 prior
kills are now undetected; each previously failed only in the intentionally deferred
process-test files. No completed comparison revealed a detection loss backed by
retained test failures. The previous reports include timing-sensitive intake failures,
so those reports are supporting evidence rather than an infallible behavioral oracle.

There are still 773 old identities with pending outcomes in the new run (plus four
pending identities outside the old scope). This is not proof of full equivalence.
Process observations remain explicitly deferred to
[issue #44](https://github.com/rafaeltab/hero-bot/issues/44).

## PR expectations and remaining work

PR analysis has one worker job and a 900-second aggregate execution budget, plus
setup/verification overhead. The measured single-file example completed comfortably;
a feature that replaces most of the application can still exhaust that budget.
Incomplete work has no aggregate score. Nightly/manual full-scope jobs continue
compatible checkpoints. PR-scoped checkpoints are now also saved for later runs of
that same PR; default-branch runs do not consume them. Source, test, configuration,
version and relevant environment changes invalidate affected evidence conservatively.

The next cold-run performance target is the static-mutant tail and broad module
initialization/imports. Increasing shard counts is not the first remedy. Hosted
runner performance, actual Actions cache save/restore and the remaining full-scope
outcomes require subsequent CI evidence; they were not published or exercised here.

Raw local evidence is under `reports/mutation-validation/` (ignored by Git):
`fixed-cold/`, `continuation/`, `pr-cold/`, `pr-warm/`, `fixture/`, comparison JSON,
and archived hosted reports. Commands and policies are in
[mutation-validation.md](mutation-validation.md).
