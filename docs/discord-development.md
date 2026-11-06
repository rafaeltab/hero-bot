# Discord development connection (#19)

Implements only #19 within #10. dfx **1.1.1**, Effect and
@effect/platform-node **4.1.2**, Node **24.22.2**, pnpm **12.16.1**,
TypeScript **6.0.3**, Vitest/@vitest/coverage-v8 **5.1.0** and
@effect/vitest **4.1.2** retain their existing exact pins. No SDK replacement,
moderation, command registration, message content intent, or production deployment
is included.

## Installed SDK verification

`pnpm install --frozen-lockfile --strict-peer-dependencies` succeeds. The installed
`dfx/package.json`, exported declarations and runtime code were inspected, rather
than assuming its Effect `^4.0.0` peer range establishes compatibility.
`dfx/gateway` exports `DiscordLive` (gateway, REST, rate limiter, memory shard/state
stores and JSON codec). It requires Effect HTTP and WebSocket services plus dfx
configuration; the adapter supplies that configuration with the redacted token and
default **Guilds-only intent (1)**. The live composition supplies Node Undici HTTP
and Node WebSocket Layers. Installed `Config` uses capitalized constructors and
Schema validation; the package README's older lowercase config example is not the
implementation API.

Primary sources: [published dfx 1.1.1](https://registry.npmjs.org/dfx/1.1.1),
[dfx source](https://github.com/tim-smart/dfx), and
[Discord gateway lifecycle](https://discord.com/developers/docs/events/gateway).
The controlled checks run the installed package's exported runtime, not repository
main examples. Relevant installed files are `src/gateway.ts`,
`src/DiscordGateway/Shard.ts`, `src/DiscordGateway/DiscordWS.ts`,
`src/DiscordGateway/Sharder.ts` and `src/DiscordConfig.ts` in dfx.

## Public boundary and lifecycle

`DiscordConnection.run` requires only its capability service; HTTP, WebSocket and
configuration construction requirements are captured by `discordDevelopmentLayer`.
`developmentProgram` in the composition root consumes that contract.
`developmentApplication` supplies the real adapter and Node transports. `pnpm dev`
selects it through `main.ts --discord-development`; the baseline `pnpm start` does
not connect to Discord. Turbo forwards only the named environment variables.

Configuration requires `HERO_ENV=development`, a nonempty
`DEV_DISCORD_BOT_TOKEN`, and numeric `DEV_DISCORD_APPLICATION_ID` /
`DEV_DISCORD_GUILD_ID`. Errors retain no raw configuration/SDK causes or credentials.
The explicit `DiscordUnavailable.reason` is `configuration`, `identity` or
`connection`. Startup builds the real dfx Layer in a scope and waits for READY via
`fromDispatch("READY")`. The entire initialization, including gateway REST discovery,
is bounded by 15 seconds. READY must name the configured application and exactly
one guild matching the configured test server. Mismatches close the connection.
This verifies the initial READY snapshot; it is not continuous membership policing.

A successful connection remains scoped until interruption. Cleanup completes before
`development Discord stopped` is printed. SDK resources, readers and child fibers
are finalized by Layer/Effect scope ownership. Invalid configuration opens no
transport. NodeRuntime logs sanitized startup errors to stdout and exits 1;
SIGINT/SIGTERM interruption exits 130. These exit semantics are intentional.

## Controlled evidence (no live credentials)

Run with the pinned tools on PATH:

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm check
pnpm --filter @hero-bot/discord-bot exec vitest run test/discord-connection.test.ts
```

The transport simulator sits below dfx: an Effect HTTP client returns gateway bot
metadata and a WebSocket-compatible EventTarget emits HELLO and READY JSON. The
actual installed SDK performs REST discovery, serializes IDENTIFY with the configured
token and intent 1, decodes messages, manages the shard and publishes READY. Tests
observe the public development program, lifecycle messages and socket closure.
They do not replace dfx services or mock this repository's adapter internals.

Checks cover successful startup/interruption, missing and invalid configuration,
production-mode rejection, wrong application, missing/extra server, missing READY,
and stalled REST discovery. Both startup failures after acquisition and interruption
close the socket. Compiled entrypoint tests verify the development flag's safe
configuration failure and the baseline SIGINT/SIGTERM cleanup behavior. The source
attribution coverage run exercises the composed development program in process.

TDD began with a failing real-SDK lifecycle test for the absent adapter, followed by
its implementation. A second red slice demonstrated that an additional guild was
accepted; the identity guard then rejected it. The entrypoint/configuration slice
first failed on the absent development application. Follow-up failure-path checks
exercise the same public boundary. No tests or production sources are excluded to
accommodate dfx, and sibling lint, architecture and CRAP gates remain mandatory.

## Repeatable live smoke (external setup; not run)

1. Create a **new development Discord application and bot**, distinct from production,
   in the [Discord Developer Portal](https://discord.com/developers/applications).
   Create a dedicated private test server. Do not reuse the production application,
   bot token or server; this task does not authorize adding any bot to the real server.
2. Install that development bot in the test server with the `bot` OAuth2 scope and
   no administrator/moderation permissions. No privileged gateway intents or
   application commands are required by this connection-only scaffold. Ensure it
   belongs only to the dedicated test server.
3. Copy `apps/discord-bot/.env.example` to its ignored `.env`, fill the three
   `DEV_DISCORD_*` values from that application and server, and keep
   `HERO_ENV=development`. Do not paste credentials into commands, logs or commits.
4. Run `pnpm dev` from root. Within 15 seconds expect `development Discord ready`;
   confirm the separate bot appears online in the test server. A failure prints a
   sanitized reason and exits nonzero. Do not send messages or invoke moderation.
5. Press Ctrl+C. Expect `development Discord stopped`, clean process termination,
   and eventual offline presence. Run again and send SIGTERM to the app's Node PID
   to exercise that path. The app exits 130 for either interruption; Turbo may
   report its own wrapper termination status.
6. Repeat with an intentionally incorrect application/server ID (keep token private):
   expect an `identity` failure and cleanup. Restore the correct development values.

**Live smoke was not run:** this checkout has no supplied separate application/token
or test-server setup. No secrets were requested to manufacture optional live evidence.
Controlled tests establish installed type/runtime integration and lifecycle behavior;
they do not establish live authentication, Discord availability, permissions, network
TLS/WebSocket interoperability or online presence.

## SDK limitations and coordination

Installed dfx catches failed gateway discovery and falls back to Discord's default
URL; its WebSocket/shard loops reconnect internally and do not expose those failures
as typed gateway stream errors. The adapter therefore reports failure to reach READY
as `connection` after its startup bound, without claiming a precise auth/network
classification. Once READY succeeds, reconnection follows dfx behavior; this scaffold
does not add a post-start health timeout. Keep normal application logging at the default Info threshold; SDK trace output
contains inbound gateway event bodies and is not an operator logging policy. The
controlled successful handshake also checks captured Trace logs for token leakage.
Application lifecycle messages contain no token/event bodies.

Parent merger owns integration and PR #24. Shared edits are `application.ts`,
`main.ts`, app `package.json`, `.env.example`, `turbo.json`, README and application /
process tests. Preserve sibling service composition, scripts and gates when merging.
No new dependency or lockfile changes are needed. The offline baseline remains for
sibling tests; connect integrations through the explicit development composition.

## Validation and handoff

The full pinned `pnpm check` passed with 23 application/process tests, 13 test-lint
fixture tests, 12 architecture graphs and 14 CRAP/evidence checks. Fresh baseline
coverage and exact source attribution both passed without exclusions or weakened
thresholds; 19 production functions scored at most 6. The composition generator
and sanitized error getter are exercised in process, rather than borrowing their
subprocess coverage. The original empty baseline timer callback remains unexecuted
in the source-only report and honestly scores 2.

Final reconciliation merged local and fetched remote integration tip
`5678c18cb45622aeecc21c308d8d5aa6c1c364bb` (including #18) into this feature branch.
Frozen strict-peer installation and `TURBO_FORCE=true pnpm check` passed on the
combined code with zero cached Turbo tasks, using an owned disposable
`postgres:17.6-alpine` container for the newly integrated PostgreSQL tests.
All **34** tests passed in both coverage runs; coverage was **97.60% statements**
and **100% instrumented branches**. All **32** production functions passed CRAP
(maximum **5.2**). The adapter's lifetime generator has **80% own statement
coverage**; the gate reports that directly rather than borrowing file coverage.
Coverage percentages do not establish all logical paths were exercised.

The root TypeScript `HERO_ENV=development pnpm dev` command was separately exercised
without Discord credentials: it selected `--discord-development`, reported the
sanitized configuration error and exited nonzero before connecting. A live Discord
handshake remains unrun. No integration merge, PR creation, issue closure or PR
watch was performed by this slice. The parent should use a fresh merger and retain
the sibling PostgreSQL service/test environment and all existing gates.
