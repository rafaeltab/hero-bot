# Test linting

`pnpm lint:tests` lints application tests and executes isolated rule fixtures.
`pnpm lint`, `pnpm check`, and **CI / Checks** enforce it. Intentionally invalid
fixture strings never execute as application tests or enter production coverage.

Use named imports (aliases supported) from `vitest` or `@effect/vitest`, static
registration titles, and `it`/`test` registrations including `each`, `effect`,
`effect.each`, `live` and `live.each`. `describe`/`suite` delimit title scopes.
The approved assertion helpers are imported `expect(...)` and `expect.poll(...)`,
with ordinary matchers, negation, resolves and rejects.

| Rule category                | Enforced behavior                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Focus/skip                   | Reject only, skip, todo, conditional registration, missing callbacks and enabled inline options            |
| Duplicate titles             | Reject repeated static registrations in a suite, including each declarations                               |
| Invalid/unawaited assertions | Validate matcher chains and await asynchronous assertions, including polling                               |
| Conditional assertions       | Reject assertions under conditionals, loops, catch branches/callbacks and short-circuit branches           |
| Effect semantics             | Generator returns do not await polling promises; Effect.sync does not await asynchronous assertion results |

Use `yield* Effect.promise(() => expect(promise).resolves.toBe(value))` inside an
Effect generator. `Effect.tryPromise` also handles a returned promise.
`yield* Effect.sync(() => expect(promise).resolves.toBe(value))` is rejected:
`sync` returns the promise as a value instead of awaiting the assertion. The rule
resolves imported Effect/constructor aliases (`effect` and `effect/Effect`) and
ignores shadowed locals. Synchronous assertions inside `Effect.sync` remain valid.
Ordinary async tests must await asynchronous assertions.

Fixtures reproduce the review's exact unsafe wrapper, verify valid promise-aware
constructors, poll semantics, alias/shadow handling, every supported registration
form and real ESLint CLI failure. Pinned tooling is ESLint 10.14.0,
@vitest/eslint-plugin 1.6.28, typescript-eslint 8.72.1. Local rules fill gaps in the
upstream plugin's recognition of Effect registrations and semantics.

Static checks cannot prove assertions execute or catch incorrect behavior.
Computed registrations/titles, custom assertion wrappers, namespace Vitest imports,
tagged-template tables and dynamic/spread registration options are not verified.
Add fixtures/recognition before adopting new forms. Conditional checks are lexical,
not interprocedural control-flow analysis. See [current validation](scaffold-validation.md).
