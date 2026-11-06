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
