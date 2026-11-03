# Separate capability contracts from Effect implementations

Capabilities are deep modules in a hexagonal architecture: each exposes a small public contract, with its implementation in separate files. A person or agent must be able to understand how to use a capability—including its invariants and failure modes—by reading its contract without reading its implementation. This separation adds structure but keeps implementation complexity out of callers' working context.

Initially, capability modules live inside `apps/discord-bot`. Extract a workspace package when another application needs the capability; a capability does not automatically require its own package, and package boundaries do not define domain boundaries.

Effectful operations return Effects with explicit errors; pure calculations remain ordinary TypeScript. Layers assemble dependencies, with Discord, AI SDK, and database details encapsulated in adapters. Dependencies needed to construct an implementation must not leak into every call to its public contract. Effect execution happens at application entry points.

Tests primarily exercise observable capability behavior through public contracts with controlled adapters. Real adapters also receive integration tests. AI evaluations complement these tests by assessing decision quality; their framework, datasets, scoring, and enforcement policy remain undecided.

This decision establishes an architectural discipline, not a list of capabilities or a moderation workflow. It does not prescribe an AI judgment format or orchestration architecture.
