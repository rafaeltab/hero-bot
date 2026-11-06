# Advisory changed-code mutation analysis (#23)

Implements only [#23](https://github.com/rafaeltab/hero-bot/issues/23) within
[#10](https://github.com/rafaeltab/hero-bot/issues/10), preserving ADR 0003 and the
blocking baseline. No moderation behavior or production scoring exclusions change.
The prepared isolated branch contained local and remote integration commit
`4d24c6638d1611c83367f4d96d7f85c150a2a41c` before work began.

## Tools and commands

Use pinned Node 24.22.2 and pnpm 12.16.1 (available in this environment through
`/tmp/hero-16-tools/node_modules/.bin`). Added exact pins
`@stryker-mutator/core@10.1.1` and `@stryker-mutator/vitest-runner@10.1.1`.
Registry metadata verified with `pnpm view`: core requires Node >=22; the runner
requires core 10.1.1 and Vitest >=2. Installed with strict peers, then verified with
a frozen lockfile and real runs against installed Vitest 5.1.0, @effect/vitest
4.1.2 and TypeScript 6.0.3. Broad peer ranges alone are not the compatibility proof.

Primary references: [core metadata](https://registry.npmjs.org/@stryker-mutator%2fcore/10.1.1),
[runner metadata](https://registry.npmjs.org/@stryker-mutator%2fvitest-runner/10.1.1),
[range configuration](https://stryker-mutator.io/docs/stryker-js/configuration/#mutate-string),
[Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/), and
[incremental semantics](https://stryker-mutator.io/docs/stryker-js/incremental/).
Installed instrumenter and runner source were also inspected and their semantics
verified below. This uses the published Stryker runner and a small Git-range CLI;
no wallpaperdb tooling was copied or vendored. A custom mutation engine, database,
and distributed runner are unnecessary for this small application.

```sh
export PATH=/tmp/hero-16-tools/node_modules/.bin:$PATH # this environment only
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm mutation:verify
pnpm mutation --base <explicit-commit-or-ref> --plan
pnpm mutation --base <explicit-commit-or-ref>
# Only for independently reviewed in-process suites with sound coverage mapping:
pnpm mutation --base <explicit-commit-or-ref> --selection per-test
pnpm mutation --base <explicit-commit-or-ref> --selection per-test --incremental
```

No implicit default branch, merge base or HEAD fallback is used. Resolve the exact
base you intend to review. Planning requires no mutation/test execution. Scores
never fail the command (`thresholds.break=0`); configuration, dry-run and tooling
errors remain nonzero so they cannot masquerade as a successful analysis.

## Changed production code means added/replaced lines

The comparison is the **exact base commit tree to the current working tree**:
committed, staged and unstaged changes plus nonignored untracked production files.
It is not a three-dot merge-base diff. On a clean branch this is the exact base to
HEAD delta. Deletions contain no current code to mutate; renamed/new files are
conservatively treated as additions when absent at the base path. Pure renames may
therefore receive broader analysis. CI checks GitHub's PR merge checkout against
`pull_request.base.sha`; pushes compare to `event.before`. Checkout fetches full
history. An unavailable/all-zero initial-push base is an explicit advisory error,
not an implicit switch to all production code.

`scripts/mutation/run.mjs` translates Git zero-context added-line hunks to Stryker
line/column ranges under `apps/discord-bot/src/**/*.ts`. A node must fit entirely
inside one contiguous changed range; unchanged lines in the same file and enclosing
blocks spanning unchanged lines are not mutated. This intentionally omits boundary
mutations spanning old and new code, rather than expanding to the entire file.
Columns use the actual end-of-line length. Whitespace-only replacement lines still
count as changed lines; this is a line diff, not token or semantic differencing.
Adjacent changes form a single range. Existing tracked lines are read from the
working tree, not the index. An empty scope writes an explicit no-mutations JSON
result and removes stale HTML; a failed selected run removes stale reports first.

Tests/specs, declarations (`.d.ts`), and `generated`/`__generated__`, `test`/`__tests__`
subdirectories are excluded. Compiled `dist` and fixture/tooling directories are
outside `src`. Stryker skips TypeScript type nodes in ordinary `.ts` files; runtime
contract constructs remain eligible. Put generated artifacts in the named generated
directories; there is no heuristic to recognize arbitrary generated source names.
This initial inventory supports TypeScript production files only; adopting another
extension or application requires extending the selector and fixtures explicitly.
Use ordinary source paths without glob metacharacters or colons (Stryker's range
syntax uses globs). No instrumentable node is a valid result, not proof of quality.

## Test selection and safe fallback

**Default/CI: full-suite fallback.** The existing process integration tests spawn
compiled `dist/main.js`, which cannot safely map to an in-process Stryker coverage
counter. The command runner uses coverage analysis off and executes
`pnpm build && pnpm test` for every mutant, including static initialization. Rebuilding
inside each sandbox invocation propagates the active mutant into compiled code;
subprocesses inherit Stryker's active-mutant environment. No tests are excluded by
related-file discovery or missing coverage. This costs more time and reports the
suite as one synthetic test; it does not claim coverage-guided narrowing.

**Opt-in per-test:** Stryker's Vitest runner gathers mutation-specific coverage in a
fresh dry run and runs tests whose IDs cover each dynamic mutant. `related:false`
retains the whole discovery suite (including tests without direct imports).
`ignoreStatic:false` and environment reload retain all tests for static mutants.
The Vitest plugin always uses per-test coverage even if an `off` setting were
supplied; merely changing that setting is not a full-suite fallback. Use the command
runner for unsafe mappings. `NoCoverage` is reported rather than silently treated
as killed, but is still not safe evidence for external-process integration paths.

Passing `--selection per-test` is an explicit caller assertion that the selected
suite is safe to narrow. It is unsuitable for the current whole application. Keep
full-suite mode when adding database/network/process integration tests or when
mapping is uncertain. Future splitting into separately verified projects may allow
narrowing the safe project while always retaining integration tests; that is not
implemented here. Live external services are not required by this slice.

## Cache reuse is a third mechanism

Fresh is the default; CI stores reports, not caches. Optional `--incremental` is
accepted only with per-test mode, whose runner reports test identities and sources.
The cache key includes base SHA, exact mutation ranges, selection mode, Node and
Stryker versions, and every tracked/nonignored untracked repository input's name
and contents. Any input change invalidates the whole cache, conservatively covering
static mutants whose test dependencies Stryker cannot map. Symbolic links contribute
their link text; dependencies are represented by the committed lockfile. This is
intentionally broader invalidation than Stryker's own diff and can forgo useful
reuse. No out-of-scope mutants from another selection's report are imported.

Even an identical-input incremental run still performs the dry run. Coverage-based
selection is demonstrated with caching disabled first. Unchanged-input reuse does
not prove changed-code scoping or coverage selection. Ignored files, external
service state, environment values and symlink target contents are outside the cache
fingerprint: delete `apps/discord-bot/reports/mutation/cache-*.json` or omit
`--incremental` when those change. Never use reused results as release evidence.

## Executed evidence

`pnpm mutation:verify` executes isolated real Git repositories and installed Stryker,
Vitest and Effect runners. It preserves machine-readable reports and CLI logs in
`reports/mutation-fixtures/` and removes fixture repositories in `finally`. They
remain outside application discovery, TypeScript inputs and production coverage.

- Planning fixture: changed and unchanged statements in one production file,
  untracked new production, tests, generated source and declarations. Only the
  changed existing line and added production line are selected.
- Fresh runner fixture: exactly two mutants at changed lines 1 and 3; unchanged
  function and enclosing unchanged block are absent. Arithmetic mutant is killed
  with one `coveredBy` ID and `testsCompleted=1` out of three tests; the target uses
  `it.effect`. Static string mutant is killed with `static=true` and all three
  tests completed. This run has `incremental=false`.
- Separate cache runs: first creates cache; second logs **2 of 2 mutant results
  reused**, after another successful dry run. Changing test input selects a new
  cache file, including for static initialization results.
- Unsafe mapping fixture: subprocess-only mutations are `NoCoverage` under
  per-test mode. Full-suite mode kills those same mutants, retains initialization
  tests and leaves an intentionally untested static string mutant `Survived`.
  A separate scope containing only that untested string reports a 0.00 score and
  still exits zero, exercising advisory scoring below the display thresholds.
- Empty-scope fixture verifies stale HTML cannot look like a current successful
  report. TDD red cycles observed the missing CLI, stale HTML and unchanged cache
  key on test edits before minimal fixes. Execution fixtures also exposed a missing
  fixture CLI binary path; using the installed Vitest executable resolved it.

A temporary whitespace replacement of the real runtime description line selected
one template-string mutant. Default command mode built instrumented TypeScript and
ran the actual application suite; the mutant was killed. The production edit was
restored, and the report retained locally at
`reports/mutation-application-probe/report.json` (log `/tmp/hero23-app-mutation.log`).
This is execution evidence, not a new application behavior or committed test seam.

## Reports, CI and limits

Local application reports: `apps/discord-bot/reports/mutation/plan.json`,
`mutation.json`, and `index.html`. JSON records locations, statuses, test IDs,
coverage and test counts where supported. Preserve a report with its plan before
running again; the next invocation replaces current outputs. Raw generated reports
are ignored and CI uploads them as `advisory-mutation-results`.

`.github/workflows/mutation.yml` is a separate job with `continue-on-error:true`
and a bounded timeout. It verifies fixtures and analyzes changed code. Baseline CI
and `pnpm check` retain all existing blocking checks; mutation commands are not
added to them. Do not configure the advisory job as a required branch-protection
check. A hosted run and branch-protection configuration were not performed here.
An error/timeout in this job means analysis is incomplete, not a passing score.

Mutation operators are representative bug probes, not behavioral completeness.
Equivalent/surviving mutants need review; timeouts and compile/runtime errors need
inspection. There is no per-mutant type checker, and full-suite command reports
cannot attribute individual killing tests. Broad fallback can be expensive as the
app grows. This ticket does not certify CRAP attribution, live adapters, deployment,
moderation behavior, or completion of the parent scaffold.

## Integration coordination

Root package scripts and lockfile are shared with sibling tickets. Preserve their
new dependencies, scripts and blocking workflows when merging; regenerate the
lockfile with pinned pnpm if needed. This slice adds a separate advisory workflow,
three mutation scripts and this document; no application production changes.
Parent integration uses a fresh merger. Tracker closure remains with the final
merge of [PR #24](https://github.com/rafaeltab/hero-bot/pull/24); this branch opens
no PR, closes no issue and does not merge into the integration branch.

## Final integrated validation

Merged local integration `b230b701f1e086187f3aee5385074a4ad0dfd259` into this branch
at `4f60e6c`, then merged the freshly fetched remote ref (already contained at the
same SHA). The only manual conflict was `.gitignore`; all mutation and CRAP output
entries were retained. Package scripts merged with the sibling's `test:crap`, fresh
coverage receipts and CRAP checks intact; no sibling dependency was removed.

Frozen installation with strict peers passed. `pnpm mutation:verify` passed all
three CLI/execution tests, including separate fresh selection, 2/2 reuse, test-edit
invalidation, static fallback, two subprocess-only mutants, and a 0.00-score
successful advisory run. `pnpm mutation --base b230b70...` returned the expected
empty production scope on this tooling-only branch. Full SHA was supplied; the
ellipsis here is descriptive only. Logs are `/tmp/hero23-integrated-fixtures.log`
and `/tmp/hero23-integrated-empty.log`; fixture reports are in
`reports/mutation-fixtures/`.

`TURBO_FORCE=true pnpm check` passed on the combined branch with zero Turbo cache
hits: Biome, application-test ESLint, 13 lint fixture tests, 12 architecture graphs,
TypeScript, build, nine application tests, 14 CRAP/evidence tests, fresh baseline
coverage and independent source function attribution. Coverage is 30/31 statements
(96.77%) and 100% branches (zero instrumented branches, hence vacuous). All eight
production functions have CRAP <=2. Log: `/tmp/hero23-integrated-check.log`.

Run mutation verification and baseline coverage **sequentially in a shared local
checkout**. An initial concurrent run correctly failed the new coverage receipt
check because transient fixture inputs changed during collection. The subsequent
sequential baseline run passed without weakening that check. CI jobs have separate
checkouts. Running mutation analysis after coverage can also make its receipt
stale by changing reports; regenerate coverage before using the CRAP command.
No hosted Actions run, live external service or branch-protection change is claimed.

### Latest PostgreSQL integration reconciliation

The final ref check found newer local integration
`5678c18cb45622aeecc21c308d8d5aa6c1c364bb` (#18). Merged it at `f57473a`,
regenerated the conflicted lockfile from the combined manifests with pinned pnpm,
and verified strict frozen installation. The fetched remote ref was merged too;
the final fetch now resolves both local and remote to `5678c18`. Added the same
disposable PostgreSQL service and test URL as baseline CI to the separate advisory
job, so full-suite mutation analysis retains the newly required integration tests.
No test skip, SDK substitution, or baseline weakening was introduced.

With a dedicated `postgres:17.6-alpine` container on a dynamically assigned loopback
port, mutation fixtures passed again (all three tests). The real application
one-line probe again generated exactly one mutant and killed it using the complete
build/test fallback, including database integration. Restored the production file;
the report is `reports/mutation-application-probe/postgres-report.json`, log
`/tmp/hero23-postgres-mutation.log`. The subsequent clean changed-production scope
against `5678c18` was empty (`/tmp/hero23-postgres-empty.log`).

The final sequential `HERO_TEST_DATABASE_URL=... TURBO_FORCE=true pnpm check`
passed with zero Turbo cache hits: lint plus 13 fixtures, architecture plus 12
graphs, TypeScript/build, **20 application tests** (11 real PostgreSQL tests),
14 CRAP/evidence fixtures, fresh baseline coverage **98.57% statements / 100%
branches**, and **21 production functions with CRAP <=2**. Logs are
`/tmp/hero23-postgres-check.log` and `/tmp/hero23-postgres-fixtures.log`.
The final independent observer counted one other test-role session before teardown;
its identity was not captured, so no zero-session cleanup claim is made for that
probe. The scoped adapter cleanup tests passed. This slice's disposable container
was then stopped and removed, ending its sessions. This supersedes the earlier nine-test baseline totals.
The final scope contains tooling/docs only relative to the latest integration tip.

### Fresh integration merger verification

The fresh merger confirmed a clean `t3/scaffold-foundation-integration` checkout
at `5678c18cb45622aeecc21c308d8d5aa6c1c364bb` and fast-forwarded it to the child
tip `bfcc68f27dbd533308d4d7c94e218e486c032d9b`. No conflict resolution or gate
changes were needed. The combined dependency pins, baseline PostgreSQL service,
architecture rules, test lint rules, coverage thresholds and CRAP checks remain.

Using the pinned Node/pnpm tools and a separate `postgres:17.6-alpine` container,
strict frozen installation passed. Sequential validation passed all three mutation
fixtures, then killed exactly one real application string mutant using the complete
`pnpm build && pnpm test` fallback. That mutant's report shows all 20 application
tests ran, including the PostgreSQL tests; four expected runtime/process assertions
failed and the other 16 tests passed. The temporary whitespace change was restored.
The production scope against the exact integration base `5678c18...` was then empty.
Full SHAs were supplied to the commands; this abbreviation is descriptive only.

`HERO_TEST_DATABASE_URL=... TURBO_FORCE=true pnpm check` passed with zero Turbo cache
hits: 13 test-lint fixtures, 12 architecture graphs, TypeScript/build, 20 application
tests including all 11 PostgreSQL tests, 14 CRAP/evidence fixtures, fresh baseline
coverage and independent source attribution. Statements were **98.57%**, branches
**100%**, and all **21** production functions had CRAP <=2. No mutation command was
added to the blocking gate. The fixtures again demonstrated a successful 0.00-score
command; `thresholds.break=0` and the separate job's `continue-on-error:true` retain
advisory scoring. Hosted Actions and branch-protection settings were not exercised.

The earlier one-row teardown observation was investigated before removing this
merger's database. A role-only observer query reproduced one row **before any test
or mutation ran**: PID 66, backend start `2026-11-06 00:53:47.593751+00`,
`backend_type='logical replication launcher'`, with no database, client address,
state or query. The same PID remained after mutation and baseline validation.
It is a PostgreSQL background process, not a pooled test connection. The earlier
child's unidentified row cannot be classified retroactively, but the repeated count
alone does not demonstrate a leak.

Independent samples during mutation (84 snapshots) and the full check (146
snapshots) captured transient test connections. Immediately after each CLI exited,
and at subsequent checks over roughly five seconds, only the pre-existing launcher
remained: **zero client backends in the test database**, excluding each observer.
These observations include Stryker command/worker teardown; they do not infer
cleanup from a snapshot while a worker is still running. The adapter's scoped
success, failure and interruption cleanup tests also passed. No resource code fix
was indicated. The observer guidance in `postgres-validation.md` now distinguishes
database client backends from this background process.

Merger logs are `/tmp/hero23-merger-{fixtures,mutation,empty,check}.log`; detailed
session evidence is `/tmp/hero23-merger-{mutation,check}-sessions.json`. The probe
report and exact plan are preserved locally under `reports/mutation-merger/`.
Only this merger's disposable container was stopped and removed after the checks.
