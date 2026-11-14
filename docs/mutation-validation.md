# Advisory changed-code mutations

## Commands and completed feedback

```sh
pnpm mutation:verify
pnpm mutation --base <exact-commit-or-ref> --plan
pnpm mutation --base <exact-commit-or-ref>
# Four independent jobs can execute these in parallel:
pnpm mutation --base <exact-commit-or-ref> --shard 1/4
# Repeat for 2/4, 3/4 and 4/4, then:
node scripts/mutation/summary.mjs apps/discord-bot/reports/mutation 4
```

Full-suite mode requires disposable PostgreSQL through `HERO_TEST_DATABASE_URL`.
Use a task-specific `TMPDIR` on a filesystem with available inodes when necessary;
Turbo passes it through. Verification and coverage must run sequentially in a shared
checkout because generated artifacts can invalidate fresh coverage receipts.

Stryker sandboxes live under the repository's `.stryker-tmp/`, at the same
directory depth as `apps/discord-bot`. This preserves repository-relative paths
to immutable evaluation fixtures in both tests and evaluation commands. App
source is still copied and instrumented in the sandbox; the evidence fixtures
are not mutation targets. The real execution fixture exercises these paths in
both per-test and full-suite modes.

The earlier single-job whole-PR run selected 150 mutants and exceeded its configured
20-minute budget. CI now balances whole original changed ranges across four shards,
retaining the same total scope, per-mutant full build/test fallback and 20-minute
budget **per shard**. Fail-fast is disabled, so a failure does not cancel siblings.
Numbered checks distinguish shards; these are not duplicate push/PR executions.

Each shard writes its plan before execution, separate JSON/HTML reports, and a
completion receipt only after Stryker returns. Artifacts upload even on failure.
`Mutations / Results` requires matching input fingerprints, all four completed
receipts, unchanged report hashes, finished mutant statuses, and an exact disjoint
union of the original ranges. Missing/failed/timed-out work is explicitly incomplete,
not a zero or passing score. Completed shards remain useful even if a sibling fails.
Summary reports status counts; per-shard HTML/JSON contains individual mutants.
Do not configure any mutation check as required merge protection.

A single exceptionally large changed range can still exceed a shard's budget; it
is not split across arbitrary line boundaries because that could drop multiline
mutations. Increase shard count for other ranges or investigate that range explicitly.
No mutation is silently sampled/dropped to obtain a successful result.

## Scope, selection and cache are separate

The CLI requires an explicit base and compares that **exact commit tree** to the
current working tree (committed, staged, unstaged and nonignored untracked files).
CI uses the PR base SHA, or the preceding main commit for a push. No implicit merge
base or fallback to all code. Added/replaced production lines become Stryker ranges;
deletions contain no current node. A mutation must fit wholly in an original range.
Pure renames/new files are conservatively additions; whitespace changes count.

The shared [production-source policy](production-source-policy.md) governs scope,
including test/generated/type-only exclusions and rejection of unsupported inputs.
Plans show the exact selected ranges. Empty scope writes an explicit result and
removes stale reports. Failed execution cannot reuse an old completed result.

Default/CI full-suite mode rebuilds instrumented TypeScript and runs **every** app
test for every mutant, including static initialization and compiled subprocess tests.
This avoids unsound in-process coverage mapping for child Node processes.

`--selection per-test` is only for independently verified in-process suites. The
installed Vitest runner uses per-mutant coverage, discovers the complete suite,
and retains all tests for static mutants. It is unsafe for the current whole app;
real fixtures demonstrate subprocess-only mutants falsely appear NoCoverage there,
while the full-suite fallback kills them. Do not treat related-file filtering or
NoCoverage as successful integration verification.

Optional `--incremental` is accepted only in per-test mode. Cache fingerprints bind
base, exact shard/ranges, mode, Node/Stryker versions and repository input paths/bytes,
including tests/config/lockfile. Test changes invalidate even static results.
Identical-input reuse still performs a dry run; it proves neither line scope nor
coverage-based selection. External state, environment values and ignored files are
outside fingerprints; omit incremental reuse when they change or for release evidence.
CI runs fresh and uploads reports, not caches.

## Maintainability and evidence

- `planning.mjs`: explicit Git comparison and deterministic whole-range partitioning.
- `cache.mjs`: conservative project fingerprint and cache identity.
- `execution.mjs`: Stryker invocation, lifecycle and per-shard report/completion receipt.
- `run.mjs`: small CLI interface; `summary.mjs`: validated aggregate completion.

Pinned Stryker core/Vitest runner 10.1.1 is verified against installed Vitest 5.1.0,
Effect testing 4.1.2 and TypeScript 6.0.3. Actual execution fixtures independently
prove changed-line scope, per-test coverage, static full-test selection, subprocess
fallback, cache reuse/invalidation, an advisory score of 0.00 that exits successfully,
and equivalence of sharded/unsharded mutation identities. Summary tests reject missing,
duplicate, changed-input, pending and incomplete/dropped-range artifacts.

Mutation score is advisory (`break=0`); tooling/dry-run errors remain visible.
There is no per-mutant type checker. Runtime errors, timeouts, equivalent and surviving
mutants require interpretation; completed reports do not prove behavioral completeness.
See [current verification](scaffold-validation.md) and the
[primary Stryker range semantics](https://stryker-mutator.io/docs/stryker-js/configuration/#mutate-string).

The review improvement run completed the complete 150-mutant PR scope locally:
123 killed, 22 survived, 5 classified timeouts; no job exhausted its budget.
All original ranges were verified present exactly once. The longest shard took
308.5 seconds. See the validation record for context; hosted performance can differ.
