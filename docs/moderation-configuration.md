> Message creation intake is now delivered by #30. See [text intake and QA](moderation-intake.md) for current behavior, additional thread permissions, and remaining unavailable capabilities. Setup-only statements below describe the #29 checkpoint.

# Notification-only server configuration (#29)

This executable delivers setup only. It receives guild slash commands, not ordinary
message events. Judgment, monitoring, attachment preservation, report delivery,
confidential intake, AI budgets and punishment remain unavailable. No messages are
replayed after changing configuration. Ban, purgatory and deletion are always
disabled. No punitive controls are registered.

## Start and stop

Select the pinned Node/pnpm versions, then run from the repository root:

```sh
make install
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot moderation
```

Use SIGINT/SIGTERM to stop. The scoped gateway and PostgreSQL pool close before
exit. `make infra-stop` stops only this checkout's database without deleting data.
Do not use worktree-clean if you need to retain configuration.

The app's ignored `.env` must contain:

| Setting                                                  | Meaning                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| HERO_ENV                                                 | development or production                                      |
| DEV_DISCORD_BOT_TOKEN / PROD_DISCORD_BOT_TOKEN           | Bot for the chosen environment                                 |
| DEV_DISCORD_APPLICATION_ID / PROD_DISCORD_APPLICATION_ID | Expected application                                           |
| DEV_MODERATION_GUILD_IDS / PROD_MODERATION_GUILD_IDS     | Explicit comma-separated allowed guild IDs; multiple supported |
| DATABASE_URL                                             | Environment-specific PostgreSQL database                       |
| HERO_AI_API_KEY                                          | Required provider configuration; never called in this slice    |
| HERO_AI_MODEL                                            | Use gpt-6-luna; judgment is not delivered here                 |

Only the chosen environment's Discord variables are used. Explicitly reusing the
other environment's application ID or token is rejected. Operators must provision
separate applications, credentials, guilds and databases; when the other identity
is absent locally, configuration cannot prove that separation. Unexpected guilds
in READY reject startup; commands from guilds outside the allowlist are ignored.
A failed command registration blocks that server's new commands and is logged
without IDs, request payloads or raw SDK errors; other servers continue.

The shared Discord/AI configuration and database are validated before connecting
the gateway. This verifies configuration and database connectivity, not paid AI
availability. No provider call is needed. Startup creates the
`moderation_configuration` table if absent: the database role needs CREATE TABLE,
SELECT and INSERT. Each change appends a complete attributed JSON configuration,
version and timestamp under its guild ID. A per-guild transaction lock and expected
version check reject stale concurrent writes; retry an explicitly failed command.
There is no automatic replay or retention of ordinary message contents.

The separate `pnpm dev` / `--discord-development` connection-only smoke still uses
`DEV_DISCORD_GUILD_ID`, requires exactly one development guild, and has no setup
commands or message processing. Do not switch its single-guild guard to use the
moderation allowlist. Multiple test guilds require a separate suitable development
installation; the original single-server smoke remains an independent checkpoint.

## Discord setup and commands

Install with bot + applications.commands scopes. The gateway needs Guilds only in
this slice. Do not grant Administrator, Ban Members, Manage Roles or Manage Messages.
An actual server owner can start without any mapped roles; current Owner/Admin
mappings can configure, Moderator mappings can inspect channel status but cannot
edit or view configuration/history. Discord administrator alone does not confer
application authority. The actual owner always retains authority.

All responses are ephemeral, with mentions disabled. Replies are deferred before
database/REST work. Large policy/history responses become private text attachments
rather than silently truncated output. Do not paste private policy into public logs.

1. `/moderation config role group:Owner|Admin|Moderator role:<existing role>`
   adds a permission mapping. Set `remove:true` to remove it. For a deleted role,
   use `/moderation config unmap group:<group> role-id:<ID from show/history>`. These are permission
   roles, independently of course/group membership; course roles confer no authority.
2. `/moderation config prompt value:<policy>` saves a nonblank 1–4000 character
   prompt. It does not invoke AI. `/moderation config show` views current settings.
3. `/moderation config channel purpose:Audit channel:<text channel>` selects the
   private audit channel. Repeat with purpose Reporting entry. This reserves a
   private reporting entry channel; confidential intake is unavailable.
4. `/channel-status [channel]` defaults to the invoking channel.
   `/doctor` currently provides the same setup diagnostics. Both distinguish
   configured exempt routes from monitoring/evidence/AI features not yet delivered.
5. `/moderation config history` returns attributed, versioned full snapshots.

Map permission roles before selecting report channels. The adapter reads the
current guild owner, submitting member roles, bot roles, guild role identities,
channels and permission overwrites through Discord REST on every submission.
Cross-guild/deleted roles and channels are rejected. Nothing edits permissions.

Both report channels must be server text channels. The bot needs View Channel,
Send Messages, Read Message History, Attach Files, Create Private Threads and Send
Messages in Threads. Each mapped permission role must be able to view/read evidence.
The bot must not have Administrator. Ordinary roles (including course roles)
must not have effective View Channel. Only this bot's Discord-managed role is
implicitly trusted; shared bot roles are ordinary roles. Explicit member View
Channel grants other than the owner/bot conservatively block setup because current
recipient membership cannot be proved by that grant. Replace them with mapped-role
overwrites. This is deliberately conservative; the bot never changes overwrites.

Missing setup/access is reported per server, without stopping healthy guilds.
Removed mappings or member roles take effect on the next submission; no cached
interaction permissions are trusted. Missing report-channel or prompt setup blocks
future monitoring readiness, not owner access to repair configuration. Current
status is a configuration/access check, not proof of successful future thread
creation/upload/provider calls.

## Reproducible offline QA and faults

No live Discord credentials or paid AI are used by engineering tests. Use this
checkout's disposable database:

```sh
make install
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/moderation.test.ts test/moderation-persistence.test.ts test/moderation-discord.test.ts test/moderation-commands.test.ts test/moderation-runtime.test.ts test/process.test.ts
pnpm check
```

The persistence suite executes configure → inspect → new pool/workflow → inspect
for guilds 10 and 12, with different prompts and attributed histories. It denies
Moderator and ordinary-member edits; its owned temporary tables are dropped.
The workflow suite revokes Admin roles between submissions, removes mappings,
tries foreign IDs and unsafe channels, and verifies disabled enabling attempts.

Controlled fault procedures are already executable in these suites:

- persistence: stale concurrent-version rejection, malformed URLs and unreachable
  database; no raw connection diagnostics returned;
- Discord REST: ordinary shared-role exposure, inaccessible moderator evidence,
  and command decoding at the real dfx HTTP transport;
- runtime: 403 registration failure in guild 10 while guild 12 handles commands,
  unexpected application/guild identity, invalid environment settings, and a stalled
  command in one server while another server continues;
- commands: database failure gives a private recovery reply; malformed requests
  do not save; long history uses a private attachment;
- process: missing Discord/AI/database configuration exits sanitized before dialing;
  a controlled two-guild gateway plus real PostgreSQL is interrupted and the
  observer confirms no owned sessions remain. Existing smoke checks also run.

These tests inject faults at external boundaries; they do not require production
permissions or replay ordinary messages. The full check preserves 90% statements,
90% branches and maximum CRAP 30, plus existing lint/type/architecture gates.

## Optional live developer checkpoint

Use only controlled development guilds and a separate development installation.
Run the commands above as the actual owner in server A and B, using distinct
prompts/private channels. Delegate an Admin and a Moderator; verify Admin can edit,
Moderator/member cannot. Remove the Admin's role and resubmit to verify denial.
Record version numbers and sanitized status observations, stop/restart, then inspect
both prompts, channels and histories again. Expose a test report channel to an
ordinary role and verify setup/status blocks it; restore permissions manually.
Never enable punishments or submit ordinary message contents for archival.

Offline adapter/process results are automated evidence, not a claim that these
commands have been exercised against live Discord. Live two-guild observations
remain an operator checkpoint when that installation is available.

## Automated observations (2026-11-13)

The implementation run exercised the offline two-server configure/inspect/restart
demonstration against disposable PostgreSQL, current-authority denials and role
revocation, real dfx HTTP/WebSocket command transport, and process interruption.
Full blocking checks passed with the original thresholds. The original development
connection smoke tests still enforce the exactly-one-guild identity guard.
No live Discord installation or paid AI call was used for these observations.
