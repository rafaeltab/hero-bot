# Discord development bot

`pnpm dev` runs the separate development connection through installed dfx 1.1.1,
Effect/platform-node 4.1.2, Node 24.22.2 and pnpm 12.16.1. `pnpm start` retains the
offline process baseline. No moderation, commands or production deployment are added.

## Separate identity and live smoke

1. Create a new development application/bot in the
   [Discord Developer Portal](https://discord.com/developers/applications) and a
   dedicated private test server. Never reuse the production bot/token/server.
2. Install it only in that test server with the bot scope, without Administrator
   or moderation permissions. This connection-only scaffold uses Guilds intent (1),
   not privileged message-content intent or application commands.
3. Run `make install`. Set `DEV_DISCORD_BOT_TOKEN`,
   `DEV_DISCORD_APPLICATION_ID`, and `DEV_DISCORD_GUILD_ID` in the shared
   `~/.config/hero-bot/secrets.env` (or under `$XDG_CONFIG_HOME`), then rerun
   `make install` to refresh generated configuration. Keep secrets out of logs
   and commits. See [worktree setup](worktree-setup.md).
4. Run `pnpm dev`; expect `development Discord ready` within 15 seconds and online
   presence in the test server. Invalid/missing configuration fails before connecting.
5. Ctrl+C or SIGTERM closes scoped resources and prints `development Discord stopped`.
   Effect's Node runner exits 130 for interruption. Restart manually after edits.
6. An incorrect application/server ID must produce sanitized identity failure and
   cleanup. Restore correct development values afterward.

Live smoke has **not** run: separate credentials/server setup were unavailable.
The developer decides when to add a bot to the real server; this scaffold does not.

## Contract and controlled verification

`DiscordConnection.run` exposes no SDK construction requirements. Its Layer captures
configuration, dfx gateway/REST services and Node HTTP/WebSocket transports.
Startup waits for READY with the configured application and exactly one expected
test guild. The 15-second bound includes discovery. The initial snapshot guard is
not continuous membership policing. The connection stays scoped until interruption;
cleanup precedes the stopped message. Errors expose only configuration, identity or
connection reason, without raw causes or credentials.

Controlled tests exercise installed dfx below the adapter: real REST discovery,
HELLO/IDENTIFY/READY serialization/parsing, configuration/identity rejection, stalled
discovery/READY, socket closure, scoped cleanup and executable entrypoint failure.
They do not replace dfx services. Run the full suite with `pnpm check` and disposable
PostgreSQL, or focus `test/discord-connection.test.ts` through the app's Vitest CLI.

The SDK internally reconnects and falls back to a default gateway URL on discovery
failure; the adapter cannot promise precise authentication/network classification.
Post-start health timeouts are not added. Keep normal logs at Info: SDK trace output
can contain event bodies and is not an operator evidence-retention policy.
Controlled checks do not establish live auth, network/TLS interoperability or presence.
See [published dfx](https://registry.npmjs.org/dfx/1.1.1),
[Discord lifecycle](https://discord.com/developers/docs/events/gateway), and
[current verification](scaffold-validation.md).
