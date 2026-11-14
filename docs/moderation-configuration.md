# Notification-only server configuration and diagnostics (#29–#39)

The opt-in moderation runtime assesses eligible creations/edits, retains actionable
evidence, delivers private reports, supplies supported attachment inputs, translates
selected audit excerpts and enforces durable AI budgets. See
[intake and final QA](moderation-intake.md) for exact limitations. Configuration and
diagnostics are private, non-destructive and make no paid calls. Changes never
replay old messages. Automatic ban, purgatory and deletion remain disabled;
confidential intake, full review and execution/isolation belong to later specs.

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
| HERO_AI_API_KEY                                          | Required provider configuration; diagnostics never invoke it   |
| HERO_AI_MODEL                                            | Use gpt-6-luna                                                 |

`HERO_AI_BUDGET_JSON` is also required; use the credential-free example in
`apps/discord-bot/.env.example` and verify prices/model bounds as explained in the
[intake budget guide](moderation-intake.md#daily-ai-budgets-37).

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
There is no automatic replay. Ordinary harmless messages retain only content-free
version claims; actionable evidence is retained. Intake and budget tables also
require SELECT, INSERT and UPDATE plus CREATE TABLE on first startup.

The separate `pnpm dev` / `--discord-development` connection-only smoke still uses
`DEV_DISCORD_GUILD_ID`, requires exactly one development guild, and has no setup
commands or message processing. Do not switch its single-guild guard to use the
moderation allowlist. Multiple test guilds require a separate suitable development
installation; the original single-server smoke remains an independent checkpoint.

## Discord setup and commands

Install with bot + applications.commands scopes. Enable Message Content Intent
in Developer Portal > application > Bot. The runtime requests Guilds, Guild Messages
and Message Content. Do not grant Administrator, Ban Members, Manage Roles or Manage Messages.
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
   `/doctor` inspects listed server surfaces and reporting configuration. Both
   refresh roles/permissions and show process observations and current budgets.
   They do not certify live provider connectivity, delivery or isolation.
5. `/moderation config history` returns attributed, versioned full snapshots.

Map permission roles before selecting report channels. The adapter reads the
current guild owner, submitting member roles, bot roles, guild role identities,
channels and permission overwrites through Discord REST on every submission.
Cross-guild/deleted roles and channels are rejected. Nothing edits permissions.

Both report channels must be server text channels. The bot needs View Channel,
Send Messages, Read Message History, Attach Files, Create Public Threads, Create Private Threads and Send
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

## Non-Administrator development setup and final #40 diagnostics

Use a separate bot/application, database and two controlled test guilds A and B.
Install with bot + applications.commands scopes using Developer Portal > OAuth2 >
URL Generator. Grant only View Channel and Read Message History on each intended
ordinary/private course/voice-text channel and forum parent. Invite the bot to
private threads. Grant the reporting permissions listed above only in the private
text audit/reporting-entry channels. Map actual existing Admin/Moderator roles
before selecting channels; deny @everyone and every ordinary/course/shared-bot
role View Channel. Ordinary Administrator roles can bypass channel denies: remove
that privilege or map trusted administrators explicitly before configuring reports.
Never grant the bot Administrator. Do not grant punitive permissions.

Run as actual server owner (replace channel/role arguments using Discord selectors):

```text
/moderation config role group:Admin role:<Admin>
/moderation config role group:Moderator role:<Moderator>
/moderation config channel purpose:Audit channel:<private-audit>
/moderation config channel purpose:Reporting entry channel:<private-entry>
/doctor
/channel-status channel:<ordinary-test>
/channel-status channel:<private-course>
/channel-status channel:<forum-post-thread>
/channel-status channel:<private-thread>
/channel-status channel:<voice-text>
/channel-status channel:<private-audit>
```

Expected: private ephemeral response (large results attach `configuration.txt`),
current configuration version, configuration database read succeeded, content-intent
flag enabled, eligible non-exempt surfaces, exempt audit/entry routes and their
threads, all punishment switches disabled, no action/isolation certification.
Member roles are current; restrictions/action history remain unavailable. Service
observations cover only this process; pre-start loss is unknown. Budget estimates,
held/unknown capacity and current admission reason are distinct from provider
connectivity. A successful read cannot establish thread creation/upload or provider
acceptance; none are probed. Ordinary content may be empty even with enabled flags.

As mapped Moderator, repeat `/doctor` and `/channel-status`, then attempt
`/moderation config prompt value:Denied test` and `/moderation config show`:
expect diagnosis access but configuration denial. Remove the Moderator role and
resubmit: expect denial. Restore it manually. Actual owner must still configure
with no mapped roles. Repeat in B with different mappings; never see A's policy,
identities, failures or guild budget. Shared application totals are intentionally
aggregate. No configuration versions should be created by diagnosis.

Intentional fault/restore matrix (development guild A only):

| Fault                                                                                                                    | Expected diagnostic and impact                                                                 | Restore                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Deny bot View Channel or Read Message History in a monitored course channel                                              | ERROR monitoring/context inaccessible                                                          | Remove test deny; restore both allows; rerun channel-status                                                                         |
| Deny bot Send Messages, Attach Files, Create Public Threads, Create Private Threads or Send Messages in Threads on audit | ERROR private evidence blocked with full permission list; reports/copies may fail              | Remove each test deny and restore required allows; rerun doctor after each                                                          |
| Allow an ordinary/course/shared-bot role View Channel on audit                                                           | ERROR unsafe; confidential evidence must not be delivered                                      | Remove allow, deny ordinary access; rerun doctor                                                                                    |
| Remove mapped role's View Channel/Read Message History                                                                   | ERROR private evidence blocked                                                                 | Restore both permissions; rerun doctor                                                                                              |
| Delete a mapped test role                                                                                                | ERROR mapped role missing                                                                      | Owner uses unmap with old ID, maps replacement, updates overwrites, reruns doctor                                                   |
| Delete a configured test channel                                                                                         | ERROR select existing reporting channel                                                        | Owner creates safe private channel and uses config channel, reruns doctor                                                           |
| Disable Message Content Intent                                                                                           | ERROR disabled/unverified; content monitoring cannot be certified (gateway may refuse startup) | Re-enable portal toggle and restart runtime                                                                                         |
| Exhaust a budget without paid calls                                                                                      | WARNING affected AI calls stopped; missed messages stay process-local                          | Use below-reservation limit procedure in intake guide; restore consistent policy across stopped instances, restart; new events only |
| Database offline/denied                                                                                                  | ERROR sanitized setup unavailable; no success certificate                                      | Restore worktree PostgreSQL/database grants and DATABASE_URL; rerun; no ledger deletion                                             |

Use controlled offline commands for unavailable AI, database and budgets instead
of disrupting production credentials:

```sh
export PATH="$HOME/.local/share/mise/installs/node/24.22.2/bin:$PATH"
make install
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/diagnostics.test.ts test/moderation-commands.test.ts test/moderation-discord.test.ts test/moderation-persistence.test.ts test/ai-budget.test.ts test/intake-process.test.ts
pnpm check
```

A controlled live probe requires the developer's explicit #40 run: from an ordinary
test member send a canonical actionable fixture from `evaluations/README.md` in a
controlled source channel, inspect the private report/root/thread and copied
attachment as Moderator, then verify an ordinary member cannot view either through
the UI or direct message/thread link. This deliberately invokes paid judgment (and
possibly translation) under configured budgets; diagnostics alone never do so.
Check source and member roles are unchanged. Exercise harmless/edit/attachment/
multilingual cases using the intake guide and record real observations, prompt/
configuration/model provenance, IDs privately and remaining limitations. Permission
checks cannot enumerate every archived/private thread or prove all future membership
states: check each intended private thread and use controlled probes. No automatic
catch-up, punitive execution or purgatory checks are delivered. Final live #40
observations remain outstanding; offline checks are not live evidence.
