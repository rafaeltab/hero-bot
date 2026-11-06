# Capability and adapter conventions (#17)

This slice implements [#17](https://github.com/rafaeltab/hero-bot/issues/17) within
[#10](https://github.com/rafaeltab/hero-bot/issues/10), following ADRs 0001–0005.
The runtime-status example reads existing application configuration; it defines no
moderation workflow, database schema, Discord operation, or AI output format.
Capabilities stay in `apps/discord-bot`, with no new workspace packages.

## Layout and public interface

Paths below are relative to `apps/discord-bot/src`:

| Path                                                                      | Purpose and permitted dependencies                                                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities/<name>/contract.ts`                                         | Consumer interface: Effect Context key, results, explicit errors, and usage guarantees. May import other capability contracts, never implementations, ports or adapters.    |
| `capabilities/<name>/implementation.ts` and other files in that directory | Private implementation. May use its own ports, pure helpers and other public contracts.                                                                                     |
| `capabilities/<name>/ports.ts`                                            | Adapter-facing construction interface. May use public contract types; consumers in other capabilities cannot import it.                                                     |
| `adapters/**`                                                             | Satisfy ports, translate SDK/configuration failures into declared errors, and own scoped external resources. May import contracts and ports, never private implementations. |
| `application.ts`                                                          | Explicit composition root: select implementations and adapters and assemble Layers.                                                                                         |
| `main.ts`                                                                 | Executable entry point: execute the composed Effect using NodeRuntime.                                                                                                      |

`RuntimeStatus.describe` returns `Effect<string, StatusUnavailable>` with no
construction requirements in its environment. It reads the current environment,
returns the startup description, and reports missing/invalid configuration with a
typed error containing no configuration values or credentials. Reading status does
not acquire process resources. Consumers need only its contract:

```ts
const status = yield* RuntimeStatus;
const description = yield* status.describe;
```

`RuntimeStatusLive` captures `EnvironmentSource` during Layer construction; calls do
not take SDK clients or configuration objects. `EnvironmentFromConfig` implements
that port using the existing `HERO_ENV` validation and translates Config errors.
String formatting is an ordinary private pure function. The application provides
these Layers, reads the description before acquiring its existing scoped timer,
and releases the timer on interruption. Keep resource ownership scoped when
replacing that placeholder with real integrations. Execute Effects only in entry
points and test runners, never inside capabilities or adapters.

## Blocking import checks

Run `pnpm architecture` from the repository root. It runs dependency-cruiser against
production `src` and then the executable fixtures. Both `pnpm check` and GitHub
Actions include this command without suppressing failures. Existing lint, type,
test and fresh coverage checks remain intact.

`.dependency-cruiser.cjs` discovers capability directories and uses
`scripts/architecture-rules.cjs` to build rules. Every file other than `contract.ts`
in a capability directory is private; this includes ports, helpers, barrels and
implementation files. Only that capability and the two exact composition-root
files may import its implementation. Adapters have a narrower exception for ports.
Adding a capability directory needs no new per-capability rule. Avoid aliases or
barrels that obscure these explicit paths; unresolved imports also fail. Type-only
imports are checked with `tsPreCompilationDeps`, including cross-capability leaks.

SDK imports and subpaths for dfx, Discord packages, `ai`, `@ai-sdk/*`, Drizzle, `pg`
and `postgres` are restricted to adapters. `@effect/platform-node` is restricted to
adapters plus the exact `main.ts` entry point. The composition roots may wire
implementations and adapters; they have no general SDK exemption. Add newly chosen
SDK package names and an executable fixture when integrating another SDK. These
rules inspect import edges, not arbitrary runtime calls, environment access or
semantic correctness; code review still enforces execution/resource conventions.
Tests may import implementations to assemble Layers and SDKs for adapter integration
tests; production import restrictions apply to `src`, not test runners.

## Enforcement evidence and TDD

The public status test first failed on the absent contract, then passed after the
minimal contract/port/implementation. The next slice first failed on the absent
configuration adapter, then passed after implementing explicit error translation.
The already integrated lifecycle tests exercise the composition root: invalid
configuration never starts resources, and interruption waits for cleanup. Compiled
entry-point tests retain SIGTERM/SIGINT cleanup and production configuration checks.
These seams verify observable status/failure and application lifetime; they do not
claim live external integration coverage.

`scripts/fixtures/architecture.mjs` defines one allowed graph and eleven prohibited
graphs. The runner writes isolated temporary TypeScript graphs, runs the same rules,
asserts exact violation names, checks blocking CLI status, and removes the graphs
in `finally`. These fixtures are outside application build/test discovery and
production coverage. Allowed wiring includes Layer composition, an adapter using
a capability port and dfx, cross-capability contract consumption, and the Node
entry-point exception. Negative fixtures demonstrate:

- Contract importing an implementation.
- Cross-capability imports of implementation types and private ports.
- SDK imports in an implementation, a contract via subpath, and the composition root.
- A helper pretending to be a composition root.
- Capability importing an adapter; adapter importing an implementation.
- Platform runtime outside the adapter/entry exception; unresolved imports.

The JSON reporter emits violations but exits zero in the installed tool. Production
uses `--output-type err`, and fixtures verify its nonzero status separately from
the JSON violation assertions. Reporter choice is part of the gate.

## Tooling and coordination

New tool: exact `dependency-cruiser@18.7.2`, supporting Node `^22 || ^24 || >=26`,
verified against [published registry metadata](https://registry.npmjs.org/dependency-cruiser/18.7.2),
its installed configuration schema/types and actual CLI execution. See the
[primary rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
for rule semantics. Installation used Node 24.22.2, pnpm 12.16.1 and strict peer
checking; the existing Effect 4.1.2 stack remains unchanged. Frozen-lockfile install
and `pnpm check` passed: nine runtime tests, twelve import graphs, 96.77% statement
coverage and 100% branch coverage. Contract/port files have zero instrumentable
statements in the V8 report; they remain inventoried, with no exclusions added.
The existing compiled/source entry-point statement attribution limitation remains.

For #18/#19/#20: put database/Discord/AI SDK imports and resource acquisition in
`src/adapters`, expose application-owned ports/contracts as needed, wire Layers in
`application.ts`, and add required environment names to Turbo's allowlist. No
workflow-specific capability is prescribed here. For #21: production now includes
Context keys, tagged errors and an Effect generator implementation; preserve sound
per-function attribution. For #22/#23: the new test uses `it.effect` and
`it.effect.each`; intentional import fixtures are in `scripts/fixtures`, never
production code. Preserve the architecture command when combining package scripts
and workflow edits. This slice does not certify sibling CRAP, lint or mutation gates.
