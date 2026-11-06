# Vercel AI SDK verification

`TextGeneration.generate(prompt)` returns `Effect<string, TextGenerationUnavailable>`.
`openAITextLive()` owns provider construction behind an adapter. It reads nonblank
`HERO_AI_API_KEY` and `HERO_AI_MODEL`; development/production values are independent.
Missing configuration fails before HTTP. Errors retain only sanitized configuration/
generate operation, not raw SDK diagnostics, prompts or credentials.

The representative provider path is OpenAI chat through `generateText` with no tools
and `maxRetries: 0`. This is infrastructure verification, not the moderation model,
judgment schema, policy prompt, workflow retry policy or evaluation runner.
No application startup invokes it automatically. A live call requires explicit
entry-point composition and environment configuration.

Each call owns a scoped abort controller. Completion, failure and interruption
abort it and await SDK promise settlement. Custom transports must honor abort and
settle: a transport ignoring cancellation can prevent cleanup completing. Cancellation
does not undo remote computation or charges already incurred.

Pinned `ai@7.0.163` and `@ai-sdk/openai@4.0.109` are verified by strict frozen install,
compilation and actual SDK/provider serialization/parsing over a controlled HTTP
transport. Tests cover success, rejected transport, HTTP 503, malformed responses,
nonblank configuration, single-attempt behavior, response consumption and delayed
cancellation cleanup. They do not mock away the SDK path or require paid AI access.

Run `pnpm --filter @hero-bot/discord-bot exec vitest run test/ai.test.ts` for the
focused checks, or `pnpm check` with disposable PostgreSQL for the full suite.
No live AI request has been made. See [SDK documentation](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
and [current verification](scaffold-validation.md).
