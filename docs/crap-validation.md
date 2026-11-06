# Coverage and per-function CRAP

`pnpm coverage` deletes prior reports, forces baseline unit/integration coverage,
validates 90% statements/90% branches, then collects exact source-only attribution,
seals its evidence and enforces CRAP <=30 for every runtime production function.
`pnpm crap` revalidates an existing fresh receipt; it does not generate evidence.
`pnpm test:crap` verifies the scorer, inventory, freshness and actual runtime fixtures.
These run in the blocking **CI / Checks** job; actual merge enforcement requires
[administrator configuration](repository-protection.md).

## Metric and attribution

The pinned TypeScript AST inventories explicit function bodies: declarations,
expressions, arrows, constructors, methods, accessors and Effect generators.
Nested functions are scored independently. Complexity starts at 1 and adds one
for conditionals, loops, non-default cases, catches, logical operators/assignments,
optional-chain operations and default parameters, excluding nested bodies/type syntax.

Own statement coverage counts executed Istanbul statements assigned by their start
to the innermost function body. An uncalled function gets zero coverage; an empty
body uses invocation coverage. Missing statement evidence in nonempty bodies fails.
No file coverage percentage is substituted for function coverage.

`CRAP = complexity² × (1 − own statement coverage)³ + complexity`.
Scores are compared unrounded with 30. Fully covered complexity 30 passes; 31 fails.
An unexecuted complexity-6 function scores 42 and fails.

AST body coordinates must match the provider's source function map one-to-one.
Missing, ambiguous, corrupt or unexpected functions fail closed. Compiled subprocess
coordinates can conflict with source coordinates, so the mandatory 90/90 baseline
includes subprocess execution while CRAP uses a second source-only report.
Process-only execution earns no source attribution; add in-process tests when needed.
This does not claim branch/path completeness or equivalence to every complexity tool.

## Eligibility and freshness

The shared [source policy](production-source-policy.md) covers all hand-written
production code, including unimported files. Type-only modules have no functions to
score. Ignore directives in scored source are rejected. Unsupported source patterns
or provider mappings fail explicitly rather than silently falling back.

Coverage receipts bind source/tooling/configuration inputs, report bytes and run
timestamps. Changes during collection, missing/malformed reports, stale receipts,
changed inputs and runs older than one hour fail. Receipts establish local integrity,
not cryptographic attestation against a malicious editor. Run mutation verification
before coverage: its generated reports/fixtures can legitimately invalidate a receipt.

Actual Vitest/V8 fixtures verify typed functions, nested arrows, executed/deferred
Effect generators and boundary scores. A constructed but unexecuted generator
retains zero own coverage even when its wrapper ran. Evidence tests corrupt maps,
counters, timestamps and source inputs and verify rejection. See
[current commands and results](scaffold-validation.md).
