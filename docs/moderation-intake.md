# Notification-only text intake (#30)

The `--moderation` executable now consumes guild `MESSAGE_CREATE` events through dfx.
The connection-only `--discord-development` smoke path is unchanged. This is the
creation-only slice: edits, reply/nearby context acquisition, moderation history,
AI attachment contents, English translations, budgets, recovery and confidential
intake are unavailable. Their absence is recorded in each supplied evidence packet;
actionable attachment copying is available; metadata and an available quoted message are not claims of AI-inspected attachments or
complete conversation history. Final live QA is tracked in #40.

## Configure and run

Use the pinned Node/pnpm toolchain and separate development identity from
[configuration setup](moderation-configuration.md). Run `make infra-start`, then
`pnpm build`. Set `HERO_AI_API_KEY` and `HERO_AI_MODEL=gpt-6-luna` in the ignored
application `.env`, together with `DATABASE_URL` and the development Discord values.
This runtime rejects a different model rather than mislabelling provenance.

Enable **Message Content Intent** in the development application's Bot settings.
The runtime requests Guilds, Guild Messages and Message Content gateway intents.
Give the bot View Channel and Read Message History on monitored guild text surfaces
(including private course channels, forum threads, and voice text). Do not grant
Administrator, Manage Messages, Ban Members or Manage Roles for this workflow.

As actual server owner, use `/moderation config` to map the existing permission
roles and select private audit and reporting-entry channels. Audit text channels
must deny ordinary roles View Channel, and grant mapped roles View Channel/Read
Message History. The bot needs Send Messages, Read Message History, Attach Files,
Create Public Threads, Create Private Threads and Send Messages in Threads. A
Report's evidence thread is created from its root and inherits the private audit
channel; it is not an invitation to ordinary members. No overwrites are changed.
Both configured routes and their child threads are exempt. Confidential intake on
these routes is still unavailable.

New configurations begin with the canonical initial policy in
`apps/discord-bot/src/capabilities/moderation/policy.ts`. Existing saved prompts are
never silently overwritten. View/edit with `/moderation config show` and
`/moderation config prompt`; an attributed saved version controls each assessment.
The prompt owns policy classifications; code validates the compact judgment.

Start `pnpm --filter @hero-bot/discord-bot moderation`. This is a paid AI path for
non-exempt creations. Owner, designated Moderator roles, audit/reporting routes and
their threads bypass AI and storage; mapped Owner/Admin roles alone and course
roles do not create exemptions. An unconfigured or unsafe server blocks its own
intake. Private `/channel-status` reports delivered capabilities and later omissions;
it is not proof of server-wide live coverage or AI service health.

## Observable behavior and privacy

A valid `none` leaves only a content-free event identity claim. Actionable judgments
retain complete supplied text, literal Markdown destinations, embeds/quotes with
original authorship, attachment metadata and explicit omissions, source/channel
identity/version, source roles, observed roles, configuration/prompt snapshot,
model/provider and assessment time. No linked destinations are fetched. No AI tools
or retrieval are enabled. PostgreSQL contains no attachment blobs.

The private Automatic report root separates recommendation from disabled execution,
observed restriction (currently unavailable), source roles and unavailable history.
The thread contains the exact supplied JSON record, split into ordered Discord
messages as needed. Concatenating those messages reconstructs the JSON. Root text
may be abbreviated to Discord's limit; the thread and database retain full supplied
evidence. Mentions and embed unfurling are suppressed. There are no action controls,
message deletion, member bans or role changes. Audit discussion is not stored,
judged or parsed as a command.

Content-free claims are inserted before calling AI. Concurrent duplicates and
restarts cannot call again or create additional roots. A failed/interrupted claim
is deliberately not replayed. On invalid AI output, unavailable AI, failed database
preservation, or failed private delivery, intake reports failure rather than `none`.
It attempts a content-free service notification on the verified private route, then
sanitized logging. Delivery is marked complete only after root, thread and all text
succeed; a null delivery is incomplete/unknown, even if Discord received a partial
root/thread. No automatic retries, catch-up or repair occur in this slice. The
later failure ticket owns aggregation/health and recovery. Do not present the
current per-failure service notification as aggregate missed-message accounting.

## Reproducible offline QA and fault procedures

No Discord credentials, paid AI or production permissions are needed:

```sh
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-process.test.ts
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts test/intake-discord.test.ts test/intake-persistence.test.ts test/ai.test.ts
pnpm check
```

The executable test installs controlled gateway/REST and provider HTTP transports
around the real dfx/AI SDK adapters and disposable PostgreSQL. It sends actionable,
harmless, owner-exempt and duplicate events, reads retained records through the
store, inspects the actual REST report bodies, and rejects any punitive request.
The process exits on SIGTERM. The existing lifetime test independently observes
both database pools disappearing after termination.

For specific repeatable faults, append `-t 'invalid AI output'`,
`-t 'unavailable'`, `-t 'private delivery'`, or
`-t 'failed service notification'` to the `test/intake.test.ts` command. These
controlled boundary failures assert failed outcomes, notifications, non-retention,
and absence of false member reports. The persistence test reacquires the adapter
and replays the same identity to prove restart deduplication. Do not replay live
source content to diagnose failures. Inspect the retained private record and
service readiness instead; incomplete delivery is not automatically repaired.

For #40's live test, submit an allowed text and an unrelated Bilibili example from
an ordinary test member, then a link from the owner/designated moderator and within
an audit thread. Inspect private root/thread visibility as an ordinary account,
exact source/provenance/omissions, and unchanged source/member roles. Record actual
observations; offline CI and controlled evaluations are not live model evidence.

## Policy evaluations

Cases are versioned in `evaluations/policy-cases.json`. The runner uses the same
canonical initial policy, compact contract, installed adapter and model lock.
Controlled mode verifies runner/report plumbing with known responses; it does not
measure model quality. Run from the repository root:

```sh
pnpm build
pnpm --filter @hero-bot/discord-bot exec node tooling/evaluate-policy.mjs --output /tmp/hero-policy-controlled.json
# Explicit opt-in to paid calls, loading the ignored app environment:
pnpm --filter @hero-bot/discord-bot exec node --env-file-if-exists=.env tooling/evaluate-policy.mjs --paid --output /tmp/hero-policy-paid.json
```

Reports include format/case version, case hash, complete prompt/hash, commit, run
mode/time, model/provider/options, exact supplied input, expected action/URLs/reason
rubric, actual compact judgment or sanitized failure. Compare recommendations and
URLs; manually review uncertainty and Bilibili-presumption wording against the
rubrics. No numerical AI release threshold is invented. Paid evaluations remain
explicit operator work. Attachment/history/edit/translation evaluation extensions
belong with those later capabilities; this runner is their starting point.

## Attachment preservation (#33)

Only actionable triggering-message attachments are acquired. The application downloads
HTTPS `cdn.discordapp.com/attachments/` URLs without following redirects. It never
fetches linked sites. A judgment-scoped cache enforces one **20 MiB total** budget
using actual streamed bytes and metadata preflight checks. All originals are attempted,
including originals beyond the future four-item AI selection limit. AI image/file
contents remain unavailable (#34); copying does not mean the model inspected them.
The internal `AttachmentSession` passed to `Reports.publish` is the shared path for
future AI acquisition: create it once per judgment, pass the same session to copying,
and never create a second download budget. Neither bytes nor blobs enter PostgreSQL.

The private thread receives original bytes as Discord uploads with the original
filename. PostgreSQL delivery snapshots retain the source attachment/message/version,
original metadata, copied channel/message/attachment identities, copied URL, size,
and availability-check time. Source authorship remains in the original evidence.
Root/thread identities and each upload's pending/uncertain/confirmed state are
checkpointed. Delivery becomes complete only after copies and the complete text
thread succeed. Uploads use deterministic Discord nonces and enforce nonce checking.
Failed or uncertain acknowledgments remain `upload-unknown`; missing downloads,
oversized files, malformed metadata and unavailable copies remain explicit omissions.
A partial result triggers the existing content-free moderator service notification,
then sanitized logging if notification fails. A process interruption or database
checkpoint failure leaves partial/unknown progress. Do not replay the event or retry
uploads to diagnose it. There is no automatic repair or evidence deletion.

Availability is a last-checked observation, not indefinite retention. Discord can
remove messages or expire URLs independently. A copied message's metadata can refresh
its URL without consulting the source. As an operator with database and bot access,
explicitly recheck one retained source (metadata GETs only, no downloads or uploads):

```sh
pnpm build
pnpm --filter @hero-bot/discord-bot exec node --env-file-if-exists=.env tooling/check-attachment-copies.mjs GUILD_ID MESSAGE_ID
```

This updates the durable delivery snapshot and prints only identities/status/times.
A 404 or absent attachment is `missing`; forbidden/network failures are `unavailable`,
not proof of deletion. References remain retained in either case. Old records without
copy state are unknown. A recheck does not rewrite an older thread's historical
snapshot or automatically repost evidence. Restrict database/operator access as you
do for the private audit channel.

Reproduce offline copying, source removal, deleted copies, forbidden metadata,
partial thread creation, unavailable download/upload, uncertain acknowledgments,
restart deduplication and budget faults with no production credentials:

```sh
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/attachment-evidence.test.ts test/attachment-workflow.test.ts
pnpm check
```

The workflow test uses real disposable PostgreSQL and installed dfx multipart upload
transport. Append `-t 'deleted source'`, `-t 'failed private upload'`,
`-t 'missing attachment acknowledgment'`, `-t 'failed thread'` or
`-t 'dishonest size'` to the workflow command for individual controlled faults.
The adapter test confirms exact uploaded bytes and rechecks copies after the source
becomes unavailable; it distinguishes deleted copies from forbidden access.
It also proves five originals are preserved and AI selection/copying cannot each
spend a separate 20 MiB budget. No punitive requests are permitted by the fixtures.

For #40 live QA, send an actionable text plus a small original attachment from an
ordinary development-server member. Confirm the private upload and source/version
identities, then manually remove the test source as the human tester and confirm
the copied original remains inspectable. Manually remove a test copy, run the explicit
availability command and confirm `missing`. Use the offline procedures above for
permission/download/upload faults rather than broad production permission changes.
The agent never deletes test sources/copies. Live provider/Discord observations
remain #40's developer checkpoint; controlled tests are not live QA evidence.
