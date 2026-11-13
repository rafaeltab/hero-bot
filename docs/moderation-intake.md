# Notification-only text intake (#30)

The `--moderation` executable consumes guild `MESSAGE_CREATE` and `MESSAGE_UPDATE`
events through dfx. The connection-only `--discord-development` smoke path is unchanged.
Creation and hydrated edit input cover ordinary/private course text channels,
announcement channels, forum posts/replies (thread channels), public/private threads
and voice-channel text. There is no audio or DM monitoring. #32 adds bounded Discord
conversation and recorded moderation history; #31 owns durable edit progression,
ordering and report-root reuse. Combine #31 before validating a complete edit lifecycle.
Attachment contents/copies, translations, budgets, recovery and confidential intake
remain separate capabilities. Final developer live QA is #40.

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

Optional bounds in the ignored application environment are `HERO_CONTEXT_REPLIES`
(default/max 10), `HERO_CONTEXT_NEARBY` (default/max 20), and
`HERO_CONTEXT_HISTORY` (default/max 10). Each is an integer from zero to its maximum;
invalid settings block startup before connecting. Zero disables that evidence class
and omissions remain explicit. Restart to apply changes. Triggering text is never
shortened by these bounds.

New configurations begin with the canonical initial policy in
`apps/discord-bot/src/capabilities/moderation/policy.ts`. Existing saved prompts are
never silently overwritten. View/edit with `/moderation config show` and
`/moderation config prompt`; an attributed saved version controls each assessment.
The prompt owns policy classifications; code validates the compact judgment.

Start `pnpm --filter @hero-bot/discord-bot moderation`. This is a paid AI path for
non-exempt source versions. Owner, designated Moderator roles, audit/reporting routes and
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

Context acquisition runs after exemptions and duplicate claims. It fetches at most
10 same-channel reply ancestors and the 20 messages preceding the source, not the
member's entire message history. Later conversation is explicitly outside the slice.
Deleted/inaccessible messages, transport failures, cycles, foreign server/channel
references and configured truncation are labelled; a genuinely empty content string
remains empty. Context preserves authors, source/channel references, timestamps,
embeds and supplied roles (null means unavailable). Context authors are not independent
violation targets. No context is saved when an ordinary source receives `none`.

Partial edits are hydrated through Discord REST without an ordinary-content cache.
The fetched source's actual edited timestamp identifies that snapshot; an already
superseded intermediate event cannot be reconstructed. Complete durable progression
and one-root edit behavior belong to #31, rather than this acquisition adapter.

History reads retained moderation findings for this server/member only, resolves
latest source versions and current corrections before selecting ten entries, and
excludes the source being judged. It supplies pending/confirmed findings and
corrected/overturned outcomes with supporting evidence and known origin. The
`IntakeStore.correctHistory` boundary records a newer complete outcome snapshot,
without modifying the original evidence; it rejects stale timestamps and unmatched
server/member/source identities. This is a boundary for the later authorized review
workflow, not a chat command or audit-thread parser. A correction snapshot must carry
its explanation and supporting evidence. Corrected/overturned entries are explicitly
non-adverse in judgment instructions. A prior deletion alone is not proof of intent.
Discord action-history ingestion and actual current restriction remain unavailable;
empty recorded history is not proof of a clean history or unrestricted membership.
History failures appear as unavailable in both evidence and the report root.

The private Automatic report root separates recommendation from disabled execution,
observed restriction (currently unavailable), source roles and unavailable history.
The thread contains the exact supplied JSON record, split into ordered Discord
messages as needed. Concatenating those messages reconstructs the JSON. Root history shows origin, subject/source, outcome, correction and relative time.
Root text may be abbreviated to Discord's limit; the thread and database retain full supplied
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
pnpm --filter @hero-bot/discord-bot exec vitest run test/context.test.ts test/intake.test.ts test/intake-discord.test.ts test/intake-persistence.test.ts test/ai.test.ts
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

For #32-specific deterministic faults and bounds, run:

```sh
pnpm --filter @hero-bot/discord-bot exec vitest run test/context.test.ts -t 'inaccessible'
pnpm --filter @hero-bot/discord-bot exec vitest run test/context.test.ts -t 'default bounds'
pnpm --filter @hero-bot/discord-bot exec vitest run test/context.test.ts -t 'foreign'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-persistence.test.ts -t 'corrections'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-discord.test.ts -t 'supported surface'
```

These fixtures inject REST 403/history failure without changing real permissions,
provide ten ancestors/twenty nearby/eleven history candidates, reject cross-server
material, and reopen PostgreSQL after an overturned correction. They require no
Discord credentials or paid calls. The surface cases run real dfx REST decoding for
creations and partial-edit hydration, including course/forum/private-thread/voice
text. They are protocol evidence, not a live permission certification.

For #40's live test, submit an allowed text and an unrelated Bilibili example from
an ordinary test member, then a link from the owner/designated moderator and within
an audit thread. Inspect private root/thread visibility as an ordinary account,
exact source/provenance/omissions, and unchanged source/member roles. Also post “Do you have unauthorized copies of the paid course?” from one ordinary
account, then reply “Yes, DM me for the whole set” from another. Check that only the
reply author is the subject and that ancestor authors/content are exact in the
private thread. Repeat in a private course channel, forum post/reply, public and
private thread, and voice-channel text. Run with bounds lowered to one and inspect
omissions. Remove Read Message History on a disposable test channel, submit a reply,
and verify unavailable context rather than clean/empty history; restore the explicit
permission afterwards. With #31 integrated, edit and verify source version/root reuse.
Record actual observations; offline CI and controlled evaluations are not live model evidence.

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
explicit operator work. Attachment/edit/translation evaluation extensions
belong with those later capabilities; this runner is their starting point.
