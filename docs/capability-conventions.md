# Capability and adapter conventions

Follow ADRs 0001–0005. Capability contracts stay inside the application until another
application needs them; no moderation capability or workspace package is implied.

| Location under application source | Responsibility                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `capabilities/<name>/contract.ts` | Public interface, results, errors and invariants; no private implementation or SDK imports |
| Other capability files            | Private implementation, pure helpers and construction ports                                |
| `adapters`                        | SDK/configuration details, explicit error translation and scoped external resources        |
| `application.ts`                  | Explicit composition root selecting implementations/adapters and assembling Layers         |
| `main.ts`                         | Executable entry point running the composed Effect                                         |

Consumers obtain a contract service and use its operations without supplying its
construction dependencies on every call. Implementations capture ports through
Layer construction; effectful operations return Effects with explicit errors.
Pure calculations stay ordinary TypeScript. Simple infrastructure verification
adapters may implement a contract directly when there is no additional domain logic.

The runtime-status example reads application configuration, returns a description,
and translates invalid configuration into a typed error without sensitive values.
The application acquires its lifetime only after valid configuration and finalizes
on interruption. PostgreSQL, Discord and AI verification contracts add no moderation
workflow or application schema.

`pnpm architecture` runs dependency-cruiser and positive/negative import fixtures.
It rejects contract-to-implementation imports, cross-capability private imports,
capability-to-adapter imports, and SDK imports outside adapters. Adapters may import
ports; exact composition roots may wire implementations. The Node runtime has an
explicit entry-point exception. Type-only and unresolved edges are checked.
New SDK names require corresponding rules/fixtures. Keep tests outside production
import enforcement so they can assemble Layers and exercise real adapters.

The fixtures verify allowed wiring and each prohibited edge through the CLI's
nonzero error reporter. JSON diagnostics alone do not establish blocking exit status.
Import checks cannot establish resource lifetime or runtime semantics; behavioral
tests and review do that. See [validation](scaffold-validation.md).
