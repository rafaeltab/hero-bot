# Mutation survivor triage

Baseline: hosted artifacts for `7ba448f`, all 150 mutants complete: 127 Killed,
21 Survived, 2 Timeout. IDs below are scoped to the named file; they are not stable
across new instrumentation. The original scope and advisory policy remain intact.

## Behavioral regressions now covered

Tests use existing capability/application seams and installed SDK transport handling.
Each listed hosted replacement was applied to production source, the targeted test
failed, then the original source was restored and the test passed. No mutated
production source is committed.

| File / hosted ID                       | Behavior and independent observation                                                                                                                                                                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapters/discord-development.ts` 1, 2 | Removing either regex anchor now accepts prefix/suffix application or guild IDs; configuration tests require rejection before dialing.                                                                                                                                                          |
| `adapters/discord-development.ts` 42   | Replacing the guild-ID comparison with true accepts one wrong guild. The new READY case requires identity failure and closed transport, bounded independently to catch accidental continued running.                                                                                            |
| `adapters/ai.ts` 14                    | Removing apiKey.trim accepts whitespace-only credentials. The public generate path must fail configuration before invoking the controlled transport.                                                                                                                                            |
| `application.ts` 3                     | Removing clearInterval leaves an actual timer after interruption. The in-process timer environment observes active timers before interruption and none afterward, independently of log messages.                                                                                                |
| `application.ts` 1                     | Removing acquisition schedules no lifetime resource; the same test requires an active timer before interruption. Test cleanup restores real timers even when a mutant fails.                                                                                                                    |
| `main.ts` 58                           | The existing compiled development-entrypoint test discarded Stryker's activation environment, so this survivor was not active in the child. The test now forwards only the activation variable alongside its credential-free development setting; real runner evidence verifies the correction. |

## Every other survivor

“Nonobservable” below is deliberately limited to the current intended contract and
pinned composition. It does not assert arbitrary future/global equivalence.

| File / hosted ID                                 | Classification and reason                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adapters/discord-development.ts` 13             | **Remaining behavioral gap.** The helper explicitly supplies the timeout, so mutating the factory's default 15-second argument is not exercised under valid configured startup. Custom timeout tests do not prove the default. Not equivalent.                                                                                                                                                                                                         |
| `adapters/discord-development.ts` 32, 34         | **Currently nonobservable defensive branch.** Removing/checking the wrong None tag affects an empty normally completed READY stream. Installed dfx uses Stream.fromPubSub with scope-owned shutdown; the public run waits for READY or fails/interruption, not normal empty completion while its scope is live. No artificial gateway replacement was added to chase this branch. Recheck after SDK/lifetime changes; not a general equivalence claim. |
| `adapters/discord-development.ts` 40             | **Equivalent under the enforced single-guild invariant.** Length must equal one before evaluating some/every. For one decoded guild both predicates invoke the same ID comparison once; zero/multiple guilds are rejected earlier. This differs from ID-comparison removal (42), now caught.                                                                                                                                                           |
| `adapters/postgres.ts` 11                        | **Remaining behavioral gap.** Removing the accepted postgres: alias rejects a valid URL; current integration fixtures use postgresql:. Not equivalent. A future accepted-protocol scenario should exercise that alias rather than merely asserting the literal allowlist.                                                                                                                                                                              |
| `adapters/postgres.ts` 14                        | **Nonobservable for the sanitized contract.** The internal Unsupported protocol message is discarded and translated into the same configuration error without a retained cause or log. Asserting private diagnostic wording would not improve the public behavior.                                                                                                                                                                                     |
| `capabilities/runtime-status/contract.ts` 35     | **Remaining error-contract gap.** The StatusUnavailable discriminant changes. Existing tests construct the expected error from the same mutated class, so equality is not an independent oracle for consumers dispatching on the tag. Not equivalent; prioritize a real recovery/dispatch consumer rather than a score-only string assertion.                                                                                                          |
| `capabilities/text-generation/contract.ts` 40    | **Remaining error-contract gap**, for TextGenerationUnavailable, with the same shared-constructor oracle limitation.                                                                                                                                                                                                                                                                                                                                   |
| `capabilities/discord-connection/contract.ts` 7  | **Remaining error-contract gap**, for DiscordUnavailable, with the same shared-constructor oracle limitation.                                                                                                                                                                                                                                                                                                                                          |
| `capabilities/persistence-probe/contract.ts` 34  | **Nonobservable in this composition:** Context service key becomes empty, but provider and consumer share the same key and no other service uses it. Namespacing/collision behavior could matter in another composition; not globally equivalent.                                                                                                                                                                                                      |
| `capabilities/runtime-status/contract.ts` 36     | **Nonobservable in this composition**, same provider/consumer key reasoning for RuntimeStatus.                                                                                                                                                                                                                                                                                                                                                         |
| `capabilities/runtime-status/ports.ts` 39        | **Nonobservable in this composition**, same reasoning for EnvironmentSource.                                                                                                                                                                                                                                                                                                                                                                           |
| `capabilities/text-generation/contract.ts` 41    | **Nonobservable in this composition**, same reasoning for TextGeneration.                                                                                                                                                                                                                                                                                                                                                                              |
| `capabilities/discord-connection/contract.ts` 10 | **Nonobservable in this composition**, same reasoning for DiscordConnection.                                                                                                                                                                                                                                                                                                                                                                           |

Service-key reasoning was checked against Effect 4.1.2 Context.Service: it assigns
`self.key`, and lookup uses that key. One mutation changes both provisioning and
consumption while leaving the other keys distinct. Error-tag changes, by contrast,
are observable discriminant changes and are not labelled equivalent.

## Classified timeouts

- `adapters/discord-development.ts` 21 changes the READY subscription to an empty
  event name, preventing startup; the bounded mutant run classified it Timeout.
- `adapters/postgres.ts` 26 removes client.release(), retaining a checked-out client
  and preventing normal pool drain; the bounded mutant run classified it Timeout.

Both are completed mutant outcomes, not unfinished shards or a missing whole-PR
result. No equivalence or successful cleanup is claimed for those mutated paths.

This pass addresses the requested behaviors and a concrete mutation-visibility gap,
not an arbitrary perfect score. The remaining gaps are explicit development evidence;
no new release gate, live Discord call or paid AI call is introduced.
