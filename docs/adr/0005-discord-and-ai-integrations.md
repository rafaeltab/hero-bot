# Use dfx for Discord and Vercel AI SDK for model integration

Use dfx behind the Discord adapter for its native Effect integration. Its current published Effect peer range supports the selected Effect major; replacing it for an assumed incompatibility would be unjustified. Dependency installation and representative adapter checks must verify the exact selected versions during implementation.

Replacing dfx with discord.js or another Discord SDK requires explicit user approval and separately planned work. If dfx proves inadequate, document the concrete limitation and propose that work; an agent must not independently substitute another SDK while implementing an unrelated task. The adapter should keep Discord SDK details out of capability contracts so an approved replacement remains practical.

Use Vercel AI SDK behind an Effect adapter for model integration and provider flexibility. The model provider, AI judgment format, evidence flow, retry policy, and moderation orchestration remain decisions for the relevant workflows. Selecting this SDK does not settle them.
