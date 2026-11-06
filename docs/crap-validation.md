# Per-function CRAP validation (#21)

This implements only #21 within #10. It preserves the five foundation ADRs and
all baseline checks. Initial checkout and local/remote integration tips matched
`8729ae8063be4038abef2a745639cb1539f68015` on `t3/scaffold-foundation-integration`.

## Tooling and commands

No new dependencies: Node 24.22.2, pnpm 12.16.1, TypeScript 6.0.3 and
Vitest / @vitest/coverage-v8 5.1.0 remain pinned. Frozen installation succeeded;
`npm view typescript@6.0.3` and `npm view @vitest/coverage-v8@5.1.0` verified
published metadata, including the exact matching Vitest peer. Actual fixture runs
verify the installed provider and Effect 4.1.2 behavior.

- `pnpm test:crap`: Node test runner exercises the scorer, evidence validation and
  source inventory. Its representative fixture runs real Vitest/V8 against real
  TypeScript and Effect, rather than inventing a coverage map.
- `pnpm coverage`: deletes both report directories, forces baseline build/coverage,
  validates 90% statements/branches, runs source attribution coverage, seals the
  evidence and enforces CRAP <=30 for every runtime production function.
- `pnpm crap`: revalidates existing evidence and scores it; fails without a fresh
  complete run. Use `pnpm coverage` to generate that evidence.
- `pnpm check`: lint, types, application tests, gate tests and the full coverage gate.

GitHub Actions adds the fixture tests and invokes the combined gate through the
existing blocking baseline job; its branch-protection name is unchanged. Requiring
that job in repository rulesets remains operator setup. No hosted CI run is claimed.

## Metric and attribution

The repository-owned scorer uses the pinned TypeScript compiler AST. Each runtime
function declaration, function expression, arrow, explicit constructor, method,
getter and setter with a body is inventoried, including anonymous functions and
Effect generator callbacks. Identity is absolute source path plus declaration line
and column; report names are informational. No file coverage percentage is used.

Cyclomatic complexity is a documented syntactic variant: start at 1, add one for
each `if`, ternary, loop (`for`, `for in`, `for of`, `while`, `do`), non-default
`case`, `catch`, `&&`, `||`, `??`, their logical assignment forms, optional-chain
operation and default parameter. Nested functions are scored separately and their
bodies/parameters do not increase their parent's complexity. Type syntax is ignored.
This is not a claim of equivalence to an unspecified third-party complexity tool.

Coverage is the fraction of that function's Istanbul statement counters greater
than zero, assigned by statement **start** to the innermost AST function body.
Statements can span a nested callback; their start identifies which function
executes the declaration/expression, while statements inside that callback belong
to the callback. An uncalled function has coverage 0 regardless of other counters.
A truly empty body uses binary invocation coverage; a nonempty function without
statement evidence fails. This is statement coverage, not branch/path completeness.

`CRAP = complexity² × (1 − coverage)³ + complexity`, with coverage in [0,1].
Scores are not rounded before comparing with 30. Fully covered complexity 30 passes;
fully covered complexity 31 fails; uncovered complexity 6 scores 42 and fails.

Vitest's [V8 provider](https://vitest.dev/guide/coverage.html) performs AST-based
remapping and exports Istanbul JSON. The scorer matches each AST body start
**exactly** against `fnMap.loc.start`, checks its ending line and extent, and
requires a one-to-one match with every reported function. V8 exports a null ending
column for some locations; that means the end of the reported source line, not
permission to borrow a neighboring function. Counts, key inventories and source
coordinates are validated. Missing, extra or ambiguous functions fail closed.
The [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
provides the syntax and source-coordinate inventory.

The baseline's `autoAttachSubprocess` combines TS execution and remapped compiled
execution. Observed compiled overlays have different generator/callback positions,
so that merged map is unsuitable for exact attribution. The second report uses the
same application unit/integration tests with subprocess attachment disabled and
only `src/**/*.ts` included. It has no independent global percentage threshold:
the mandatory first report still enforces 90/90. No source is hidden to make CRAP
pass. Process-only function execution receives **zero** source attribution; such
functions need in-process tests to earn coverage. A future tool change that cannot
match source functions must fail the gate, not fall back to file coverage.

## Inputs, exclusions and freshness

Production scope is `apps/discord-bot/src/**/*.ts`, excluding `.d.ts`, `*.test.ts`,
`*.spec.ts`, `__tests__/` and explicitly generated `generated/` directories. Tests
under `test/` and `tooling-fixtures/`, plus build output under `dist/`, are outside
that scope. Type-only `.ts` modules are detected using TypeScript's emit with
comments removed; a module emitting only `export {}` has no runtime code and is
not scored. The baseline still validates their zero-sized summary entries.
New production runtime extensions and symlinks fail explicitly until supported.
Ignore directives (`v8`, `istanbul`, `c8`, coverage ignore) in scored files fail.
Generated output must be kept in the documented generated directory, not mixed
into hand-written runtime files.

The runner removes old reports before starting and bypasses Turbo caches. It
hashes repository TS/JS, JSON, YAML, lockfiles and runtime version files before
and after the run (excluding dependencies, build products and report directories).
Changes during the run fail. A receipt binds those inputs, both report hashes and
run timestamps. Validation requires identical inputs/report bytes and a run no
older than one hour, and rejects future/invalid timestamps. Missing files,
malformed JSON, mismatched maps, invalid counters, stale evidence and an absent
production entry fail. Receipts are local integrity/freshness evidence, not signed
attestations against a malicious editor. `coverage-crap/scores.json` is a readable
per-function artifact; reports and receipts remain ignored build products.

## Verification evidence and limits

The implementation was developed in red/green slices at the public scorer and CLI
boundaries: missing scorer, missing threshold enforcement, accepted ignore directive,
missing statement evidence, missing evidence module and missing inventory API each
produced failures before their implementation. Initial hand-counted coverage
expectations omitted the provider's counters for `if` statements; inspecting the
real statement map corrected the worked examples to include those counters.

Representative fixture outcomes:

| Function                                 | Complexity | Own statement coverage |                    CRAP |
| ---------------------------------------- | ---------: | ---------------------: | ----------------------: |
| typed function                           |          2 |                    2/3 |      2.1481481481481484 |
| Effect construction wrapper              |          1 |                      1 |                       1 |
| executed Effect generator                |          2 |                    4/5 |                   2.032 |
| nested typed arrow                       |          2 |                    2/3 |      2.1481481481481484 |
| uncalled function / unexecuted generator |          6 |                      0 |             42 (reject) |
| fully exercised boundary functions       |    30 / 31 |                      1 | 30 (pass) / 31 (reject) |

The deferred-generator fixture constructs an Effect successfully but never runs
it: wrapper coverage is 1 while generator coverage stays 0 and its score stays 42.
Tests also delete the generator's map entry, corrupt counts/coordinates, remove
statement evidence, alter reports, age/corrupt/remove receipts and change source
inputs. Intentional CRAP failures remain outside application coverage/discovery.

Current application functions score 1, except the source-test-unexecuted empty timer
callback, which scores 2. Its subprocess execution still contributes to the baseline
report. Baseline coverage remains 93.75% statements and 100% branches; the latter
has zero instrumented branches and is not evidence of failure-path completeness.
A temporary interface-only source first exposed the baseline's inventory mismatch;
including its zero-sized summary entry resolved it without adding a scored function.
The probe was removed after verification. Temporary unexecuted generated/test
sources also initially polluted remapped compiled coverage (75% statements);
`excludeAfterRemap: true` fixed the exclusions, restoring 93.75% while those probes
were present. Both were then removed. The strict production inventory still rejects
missing hand-written source coverage.

Unsupported provider attribution is an explicit failure, not automatic accommodation:
new transpilation patterns, implicit/generated functions or different provider versions
may require new real-runtime fixtures and attribution support. The gate certifies its
stated syntax/statement metric, not behavioral completeness, mutation resistance,
the other scaffold tickets or a working moderation bot.

## Coordination

Changes to root scripts, the CI workflow and Vitest coverage exclusions must be
retained when merging sibling #17/#22/#23 work. No new package dependencies or lock
changes are needed. `coverage` remains the required command; avoid replacing it with
bare `turbo run coverage`, which lacks receipts and CRAP validation. The parent
merger owns integration into `t3/scaffold-foundation-integration` and PR #24.

## Final integration validation

Before handoff, merged both local and fetched remote integration refs. Integration
had advanced to `4d24c6638d1611c83367f4d96d7f85c150a2a41c` with #17 and #22.
Resolved the root script conflict by retaining architecture, test-specific ESLint,
their fixture runners, all original checks, and the new CRAP commands. Their
production changes require no scorer exceptions or additional exclusions.

Frozen installation with strict peers and `TURBO_FORCE=true pnpm check` passed on
that combined branch: Biome, 13 test-lint fixture tests, 12 architecture graphs,
TypeScript (including CRAP configs/fixtures), nine application tests, 14 CRAP/evidence
checks, fresh baseline coverage and source attribution. Turbo tasks executed with
zero cache hits. Final baseline is 30/31 statements (96.77%) and 100% branches
(zero instrumented branches). Eight runtime production functions score at most 2;
the same unexecuted empty timer callback scores 2, the other seven score 1.
Context-service/error classes without explicit function bodies have no functions
to score; their production files remain inventoried in baseline coverage.

The implementation commit is `58c52e63dbef3ae267c354ae8c69bd904a18ae95`;
`8afce365270cabf386295a820b5c95ec4f8c8f7d` merges the integrated sibling work.
No integration branch merge, PR creation, issue closure, or PR watch was performed.
The parent should merge the completed feature branch using its fresh merger.
