# Test linting (#22)

This implements [#22](https://github.com/rafaeltab/hero-bot/issues/22) within
[#10](https://github.com/rafaeltab/hero-bot/issues/10). No production behavior changes.
The prepared branch contained integration tip
`8729ae8063be4038abef2a745639cb1539f68015` before implementation.

## Commands and CI

- `pnpm lint:tests`: lint application tests, then verify the rule fixtures.
- `node --test scripts/test-lint/check.test.mjs`: fixtures alone.
- `pnpm check`: existing Biome, type, test and fresh coverage checks, plus test linting.

The existing blocking GitHub Actions baseline job already executes `pnpm lint`;
that command now includes `lint:tests`. Both real-test violations and broken fixture
expectations fail that step. No separate advisory job or production ESLint scan is
introduced. A hosted Actions run was not triggered from this implementation branch.

ESLint applies only to `apps/*/test/**/*.ts` and
`scripts/test-lint/fixtures/**/*.ts`. Fixture inputs are isolated strings in
`scripts/test-lint/check.test.mjs`; CLI probes temporarily materialize them under
the latter path and remove them in `finally`. They are outside application Vitest
`test/**/*.test.ts` discovery, TypeScript's app test inputs, and `src`/`dist`
production coverage. They never execute intentionally invalid tests.

## Supported syntax and rules

Use named imports (aliases supported) from `vitest` or `@effect/vitest`.
The exercised registration matrix is `it`, `it.each`, `it.effect`,
`it.effect.each`, `it.live`, and `it.live.each`, using array tables and callback
bodies (Effect callbacks return `Effect.gen`). `test` is also recognized, and
`describe`/`suite` delimit title scopes. Use a static string or interpolation-free
template for registration titles. The approved assertion helper is `expect(value)`
imported from either package, including matcher calls, `.not`, `.resolves` and
`.rejects`. Await asynchronous assertions in ordinary async tests; inside an Effect
use `yield* Effect.promise(() => expect(promise).resolves.matcher(...))`.
Existing application tests remain the behavioral evidence for the application.
These lint fixtures verify lint diagnostics, not application behavior.

| Enabled rule                      | Enforcement                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/no-focused-tests`          | Reject `.only` on tests/suites, including chained Effect and each registrations, and enabled inline `only` options.                                                                                                                                                                                                                                                                         |
| `tests/no-skipped-tests`          | Reject `.skip`, `.todo`, `.skipIf`, `.runIf`, missing callbacks, and enabled inline `skip`/`todo` options. Conditional registration is rejected conservatively without evaluating its condition.                                                                                                                                                                                            |
| `tests/no-duplicate-titles`       | Reject repeated static test titles or suite titles in the same suite, including repeated each declarations. Separate suites may reuse test titles.                                                                                                                                                                                                                                          |
| `vitest/valid-expect`             | Reject missing arguments/matchers, uncalled matchers, invalid modifier chains and unawaited async assertions (`alwaysAwait: true`). Explicit return statements are rejected conservatively, including generator returns that would not await the assertion; implicit arrow returns remain supported for `Effect.promise`. TypeScript additionally checks matcher names/types in real tests. |
| `tests/no-conditional-assertions` | Reject imported `expect` calls under if/switch/catch/loops, conditional branches, short-circuit right operands, and `.catch` callbacks, including inside Effect generators and local helpers.                                                                                                                                                                                               |

The local ESLint rules resolve import bindings through ESLint scope information;
shadowed names and unrelated functions do not become test registrations. The
Vitest plugin is configured with `vitestImports: ["@effect/vitest"]` for assertions.
The installed plugin's fixed test-chain list omits Effect/live registrations, and
its duplicate-title rule skips each. Local rules explicitly cover those gaps;
there is no preset pretending to recognize them.

## Evidence and tooling

Pinned ESLint **10.14.0**, `@vitest/eslint-plugin` **1.6.28**, and
`typescript-eslint` **8.72.1**, alongside baseline TypeScript **6.0.3**.
Versions, engines and peer ranges were checked with `npm view`; strict-peer and
frozen-lockfile installation succeeded. Actual fixture execution validated the
installed combination using pinned Node **24.22.2** and pnpm **12.16.1**.
Primary references: [ESLint configuration](https://eslint.org/docs/latest/use/configure/configuration-files),
[Vitest plugin](https://github.com/vitest-dev/eslint-plugin-vitest),
[ESLint package](https://registry.npmjs.org/eslint/10.14.0),
[plugin package](https://registry.npmjs.org/@vitest%2feslint-plugin/1.6.28),
[TypeScript ESLint package](https://registry.npmjs.org/typescript-eslint/8.72.1).
Recognition behavior was checked against the installed plugin source, and Effect
forms against installed `@effect/vitest` 4.1.2 declarations.

TDD used the ESLint diagnostics boundary already authorized for this ticket.
Each new rule category first failed because the invalid fixture produced no
expected diagnostic; enabling the minimal rule made its slice pass. Async assertion
fixtures share the `valid-expect` cycle with malformed assertions. Additional red
cycles exposed inline option objects and Promise catch callbacks before adding
those checks. A further red cycle exposed generator-returned async assertions; `alwaysAwait` closes that gap. Positive fixtures accompany each category across the six-form
matrix. CLI probes verify exit 0 for valid input and exit 1 plus the expected rule
ID for every required invalid category. Alias/shadowing and suite-scope probes
check recognition independently of the application's tests.

## Limits

Static linting cannot prove that assertions execute, detect bad behavior, or are
meaningful. No assertion-presence gate is claimed. Review behavior and failure
cases separately. Duplicate each declarations are checked by their title template;
collisions produced by runtime table expansion or computed titles are not evaluated.

Namespace imports, re-exported/custom assertion wrappers, destructured test-context
assertions, dynamically selected registration members, standalone `effect`/`live`
imports, tagged-template each tables, custom test builders/layers, and options
stored in variables or spreads are outside the verified syntax. Keep tests on the
supported forms; add fixtures and recognition before adopting another form/helper.
Conditional checks are lexical, not interprocedural control-flow analysis: helpers
called only conditionally cannot be proven unconditional, and loops are rejected
even when their input is statically nonempty. Promise catch checks conservatively
recognize the method name without proving the receiver is a Promise.

This slice does not certify architecture, adapters, CRAP attribution, mutation
selection or the full scaffold; those remain sibling work on the integration branch.
