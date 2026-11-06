# Vercel AI SDK Effect adapter (#20)

This implements only #20 within #10. `TextGeneration` is a plain-text integration
contract, not a moderation judgment, prompt policy, schema or agent workflow.
No tools, retrieval, actions, evaluations or orchestration are introduced.

## Usage and configuration

Consumers import `src/capabilities/text-generation/contract.ts`, obtain
`TextGeneration`, and call `generate(prompt)` to receive `Effect<string,
TextGenerationUnavailable>`. Provider construction and types stay in
`src/adapters/ai.ts`. With no application logic to wrap, that adapter implements
the contract directly, as the existing persistence verification adapter does.

Compose at an application entry point (or in tests):

```ts
const text = Effect.gen(function* () {
  const ai = yield* TextGeneration;
  return yield* ai.generate("Say hello");
}).pipe(Effect.provide(openAITextLive()));
```

Import `openAITextLive` only at composition roots. The Layer reads
`HERO_AI_API_KEY` and `HERO_AI_MODEL` through Effect Config; both must be nonblank.
Supply an independently configured provider key/model for development and production.
Do not log configuration, prompts or provider diagnostics. Turbo's development
environment allowlist includes both names, with no secret values. The `.env.example`
contains commented names only. Missing/blank values produce the sanitized
`configuration` error before any HTTP request. Other failures have operation
`generate`; neither error stores the underlying SDK error or its sensitive data.

The explicit OpenAI chat endpoint is a representative provider path, not a decision
about the eventual moderation provider/model. The adapter uses `generateText` with
no tools and `maxRetries: 0`; it does not establish a workflow retry policy.
Every call owns its own abort controller in an Effect scope. Normal completion,
failure and interruption abort the controller and await the SDK promise's settlement.
A custom transport must honor abort and settle its promise; a transport that ignores
cancellation can prevent cleanup completing. There is no persistent SDK client pool
or adapter timer to release. Callers may apply Effect timeouts, which follow the
same interruption cleanup. Cancellation does not claim to undo remote computation
or charges already incurred.

Ordinary bot startup does not compose or invoke this optional capability. No live AI
call was performed. A live call would require explicit entry-point wiring and real
environment configuration; passing controlled tests is not evidence of live access.

## Published compatibility and primary references

Pinned `ai@7.0.163` and `@ai-sdk/openai@4.0.109` were verified with `pnpm view`,
installed with strict peers and checked with frozen installation. Both require
Node >=22 and accept Zod `^3.25.76 || ^4.1.8`; the lockfile resolves Zod 4.6.7.
Their shared provider protocol is `@ai-sdk/provider@4.0.36` and provider-utils is
5.0.75. Existing Node 24.22.2, pnpm 12.16.1, Effect/@effect/vitest 4.1.2,
TypeScript 6.0.3 and Vitest 5.1.0 remain unchanged. pnpm generated exact release-age
exceptions for these new published SDK packages; no workspace policy was disabled.
Actual request/response, compilation and lifecycle checks establish compatibility
beyond declared engines/peers.

Primary references: [published SDK metadata](https://registry.npmjs.org/ai/7.0.163),
[published provider metadata](https://registry.npmjs.org/@ai-sdk%2fopenai/4.0.109),
[provider configuration](https://ai-sdk.dev/providers/ai-sdk-providers/openai),
[generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).
Installed provider sources/types were checked alongside these references.

## Controlled verification and TDD

Run `pnpm --filter @hero-bot/discord-bot exec vitest run test/ai.test.ts` for this
slice without any credentials or network. Tests compose the public contract with
real `generateText`, `createOpenAI().chat(...)`, SDK request serialization and SDK
response/error parsing. Only the HTTP fetch boundary is controlled. Tests check the
actual endpoint, model, user message and returned text. Failure cases include HTTP
503, rejected transport and malformed successful responses, all with one request
(no retries) and sanitized typed errors. Five missing/blank configuration cases and
default transport construction validate configuration before calls. The delayed
abort test verifies that fiber interruption waits for transport release.

The successful call first failed on the absent adapter. Failure translation first
failed with raw SDK defects, then passed with typed translation. Configuration
first failed with raw Config errors/accepted blanks, then passed with sanitized
validation. Cancellation first returned without aborting transport; scoped request
ownership made it wait for release. A test-transport readiness race was corrected
by registering its abort listener before signaling that the request had started.
No entire-SDK mocks, provider stubs or paid access are used.

Full `pnpm check` additionally requires disposable PostgreSQL per
[postgres validation](postgres-validation.md). Existing architecture, supported test
lint forms, 90/90 fresh coverage and per-function CRAP <=30 remain mandatory.

## Coordination

Prepared branch `t3/vercel-ai-effect-adapter` contained integration tip
`5678c18cb45622aeecc21c308d8d5aa6c1c364bb`. Shared edits are app dependencies,
`pnpm-lock.yaml`, exact SDK release-age entries in `pnpm-workspace.yaml`, Turbo's
development env names and `.env.example`. Preserve sibling dfx, mutation and workflow
changes when reconciling; no CI secret or paid AI service is needed. The parent owns
integration through PR #24 with a fresh merger; #20 stays open for PR closure.

## Validation results

Pinned frozen/strict-peer installation and `TURBO_FORCE=true pnpm check` passed:
Biome, real-test lint plus 13 lint fixtures, 12 architecture graphs, TypeScript/build,
31 application tests (11 AI and 11 PostgreSQL), 14 CRAP fixture tests, fresh baseline
coverage and separate source-attribution integration coverage. The AI adapter has
100% statements/branches/functions; all 34 production functions pass CRAP <=30
(maximum 3). Existing source/compiled entry-point attribution remains documented in
workspace-validation.md; no exclusions, thresholds or gates were weakened.

The successful-response test also checks that the SDK consumed the response body;
success and failure tests observe request release before the consumer exits.
Controlled fake credentials are the only AI configuration used. Local PostgreSQL
was provisioned in an exclusively owned disposable container on a dynamic loopback
port, with credentials held outside the repository and omitted from command output.

Final reconciliation brought local integration `bfcc68f27dbd533308d4d7c94e218e486c032d9b`
into this branch, preserving #23's advisory mutation workflow, scripts and exact
Stryker dependencies. The fetched remote integration tip was already contained.
The lockfile conflict was resolved from the combined manifests with pinned pnpm,
then strict frozen installation succeeded; no conflict markers were retained.
Fresh baseline coverage is **109/110 statements (99.09%) and 10/10 branches (100%)**.
The integrated `pnpm mutation:verify` also passed all three selection/execution
fixtures; no mutation score for the new AI adapter is claimed. Final check logs are
`/tmp/hero-20-validation/check.log` and `/tmp/hero-20-validation/mutation.log`.

The final reconciled full check passed again with zero Turbo cache hits. Both
integration refs remained contained at the final fetch. A teardown observer counted
one other test-role PostgreSQL session (its identity was not captured); no
zero-session database cleanup claim is made. All existing scoped PostgreSQL cleanup
tests passed. Stopping and removing this slice's own disposable container ended
its sessions, and its temporary credential file was deleted. No other container
was touched. The working tree is clean after the documentation commit.

## Fresh integration merger verification

The fresh merger confirmed a clean `t3/scaffold-foundation-integration` checkout
at `326bacc154af768aaf4565f08e862acdf4f16f8a` and merged AI child tip
`e7be4805d7d6bf0023069846f6e78ee2c281b1c2`. Conflicts in `.env.example` and
`turbo.json` were resolved by retaining all three `DEV_DISCORD_*` names alongside
the optional AI names. The Discord development entrypoint, all earlier scripts and
direct dependency pins, both PostgreSQL CI services, and the newer PostgreSQL,
mutation and Discord documentation remain unchanged. The combined lockfile merged
without a conflict and passed pinned strict frozen installation; no regeneration
or dependency substitutions were needed.

Using `/tmp/hero-16-tools/node_modules/.bin`, `pnpm mutation:verify` passed all
three real selection/execution fixtures after installing the combined dependencies.
This again verifies changed-line scoping, per-test selection, static/subprocess
fallback and separate incremental reuse semantics. It does not establish a mutation
score for the new AI adapter. Mutation verification ran before coverage to preserve
the fresh coverage receipt.

With a separately owned `postgres:17.6-alpine` container on a dynamically allocated
loopback port, `HERO_TEST_DATABASE_URL=... TURBO_FORCE=true pnpm check` passed with
zero Turbo cache hits: Biome, 13 test-lint fixtures, 12 architecture graphs,
TypeScript/build, **45 application tests** (including 11 AI and 11 PostgreSQL tests),
14 CRAP/evidence fixtures, fresh baseline coverage and independent source function
attribution. Coverage is **162/165 statements (98.18%)** and **28/28 branches
(100%)**. All **45** source-attributed production functions pass CRAP <=30; the
maximum is **5.2**. The AI adapter has **100% statement/branch/function coverage**
and a maximum function CRAP score of **3**. The existing Discord lifetime generator
still reports its own **80%** statement coverage. No exclusions, thresholds or
blocking/advisory settings changed.

Controlled tests exercised real SDK/provider request serialization and response
parsing, consumed response bodies, sanitized provider/transport/response errors,
configuration rejection before requests, and interruption that awaits delayed
transport release. The combined dfx initialization, IDENTIFY/READY, identity and
startup-failure checks and interrupted socket cleanup also passed. No live Discord
or paid/live AI request was made; optional AI configuration still does not wire AI
into ordinary startup. Hosted Actions, live provider access and deployment remain
unverified.

An independent observer captured **17** mutation-fixture and **25** full-check
database snapshots. For each complete CLI, six post-exit samples spanning roughly
five seconds found **zero client backends in the test database**, excluding the
observer. The same pre-existing logical replication launcher (PID **71**, no
database, backend start `2026-11-06 01:01:50.563807+00`) remained before and after;
it was not counted as a database client. Sampling did not catch short-lived test
connections; the 11 PostgreSQL tests independently check scoped cleanup. Only this
merger's container was stopped, its automatic removal verified, and its temporary
credential files deleted. Logs and session evidence are under
`/tmp/hero20-merger-validation/{install,mutation,check}.log` and
`/tmp/hero20-merger-validation/{mutation,check}-sessions.json`. No push, PR creation
or issue closure is part of this merger.
