# Notification-only versioned text intake (#30, #31, #32, #33, #36)

The `--moderation` executable consumes guild `MESSAGE_CREATE` and `MESSAGE_UPDATE`
events through dfx. The connection-only `--discord-development` smoke path is unchanged.
Creation and hydrated edit input cover ordinary/private course text channels,
announcement channels, forum posts/replies (thread channels), public/private threads
and voice-channel text. There is no audio or DM monitoring. #32 adds bounded Discord
conversation and recorded moderation history; #31 owns durable edit progression,
ordering and report-root reuse, now included from integration.
AI attachment contents, translations, budgets, recovery and confidential intake
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
A partial edit is assessed only if the fetched edited timestamp matches the event;
superseded intermediate events are explicitly unavailable rather than misattributed.
Complete edit events preserve their own exact contents. #31 supplies durable
progression and one-root edit behavior.

History reads retained moderation findings for this server/member only, resolves
latest actionable source versions and current corrections before selecting ten entries, and
excludes the source being judged. A harmless edit does not overturn the earlier finding;
only a recorded correction changes that finding's outcome. It supplies pending/confirmed findings and
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
observed restriction (currently unavailable), source roles and supplied recorded history.
The thread contains the exact supplied JSON record, split into ordered Discord
messages as needed. Concatenating those messages reconstructs the JSON. Root history shows origin, subject/source, outcome, correction and relative time.
Root text may be abbreviated to Discord's limit; the thread and database retain full supplied
evidence. Mentions and embed unfurling are suppressed. There are no action controls,
message deletion, member bans or role changes. Audit discussion is not stored,
judged or parsed as a command.

Content-free version claims are inserted before calling AI. Concurrent duplicates and
restarts cannot call again for the same server/message/version. A failed/interrupted
claim is deliberately not replayed. An ordinary `none` retains only its identity and
progress, without text or judgment. After a source becomes actionable, later assessed
versions (including `none`) are retained. Earlier discarded harmless versions are not
reconstructed. These versions are one source finding, not additional violations.

Each source shares one report root and evidence thread. Each completed version appends
its exact JSON record to the thread; concatenate that version's ordered chunks to
reconstruct it. The root shows the newest **assessed source version**, not the last AI
call to finish, and separately shows the newest observed version at update time.
Previously actionable evidence remains in the thread and database after a harmless
edit. An interrupted/unavailable newer assessment does not imply a harmless judgment.
A configuration route change does not move an existing report: the original private
channel is rechecked before updating it. If it is no longer safe/available, delivery
fails rather than sending evidence elsewhere.

Complete Discord update payloads are used directly. For partial updates the adapter
fetches the message only from Discord and requires the returned edit timestamp to match the event. If another edit has
already replaced that snapshot, or Discord returns a different source identity, it
records a content-free evidence failure and missed event in shared service health;
it never labels the newer contents as the older version. Metadata-only updates are
ignored. No ordinary-message cache or archive is introduced. Missed/deleted/unavailable
snapshots are not automatically replayed. Linked destinations are never fetched.

On invalid AI output, unavailable AI, failed database preservation, or failed private
delivery, intake reports failure rather than `none`. It attempts a content-free
service notification on the verified private route, then sanitized logging. Service failures are aggregated by server/category as described below; private status carries current missed counts. Provider retries are bounded, while event catch-up and delivery repair never run automatically.

### Durable progress and uncertainty

The store exposes content-free `progress(evidence)` per server/source with these states:

| State        | Meaning after interruption/restart                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `claimed`    | Invocation reserved; AI completion/persistence unknown. Never automatically invoke again.                                        |
| `assessed`   | Valid judgment completed. An ordinary harmless result has no retained record; a retained record has not begun external delivery. |
| `delivering` | External delivery reserved; root/thread/chunks or acknowledgment may be partial/unknown. Never blindly resend.                   |
| `delivered`  | Root, thread and all evidence chunks acknowledged and delivery identity persisted.                                               |
| `legacy`     | Pre-#31 content-free claim; no replay. Retained legacy records migrate to delivered or uncertain delivering.                     |

PostgreSQL uniqueness protects version claims. A session advisory lock serializes
preservation and delivery per source across processes; AI calls remain concurrent.
Schema upgrade uses a separate transaction/advisory lock. Locks release on interruption
or process loss. The external-delivery reservation is committed **before** Discord
requests; acknowledgment is stored only after every request completes. A crash before
reservation permits a later new version to create the source's first root. A crash
at/after reservation blocks automatic delivery for the source, even if no Discord
request actually arrived. Later versions are still assessed and preserved. A failed
acknowledgment write has the same conservative outcome. This deliberately sacrifices
automatic delivery availability where exactly-once external effects cannot be proven.
It does not promise exactly-once AI or Discord execution, retry uncertain findings,
or catch up messages missed during an outage.

For private operator inspection, load the ignored application environment and use
PostgreSQL tooling on that development database. This query emits no source contents:

```sql
SELECT guild_id, message_id, version, state,
       record IS NOT NULL AS evidence_retained,
       delivery IS NOT NULL AS delivery_acknowledged
FROM moderation_intake ORDER BY guild_id, message_id, version;
```

A null delivery is incomplete/unknown, even if a root exists in Discord. Do not clear
claims, reset `delivering`, delete rows, or rerun live source content as a repair.
Inspect the original private thread and preserved versions; automated reconciliation
and recovery are not supplied here. No punitive permissions or actions are needed.

## Reproducible offline QA and fault procedures

No Discord credentials, paid AI or production permissions are needed:

```sh
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-process.test.ts test/intake-versions.test.ts
pnpm --filter @hero-bot/discord-bot exec vitest run test/context.test.ts test/intake.test.ts test/intake-discord.test.ts test/intake-persistence.test.ts test/ai.test.ts
pnpm check
```

The executable test installs controlled gateway/REST and provider HTTP transports
around the real dfx/AI SDK adapters and disposable PostgreSQL. It sends actionable,
harmless, owner-exempt and duplicate events, reads retained records through the
store, inspects the actual REST report bodies, and rejects any punitive request.
It edits an actionable source to harmless on the same root, exits on SIGTERM,
then restarts and replays creations/edits without new AI or report writes. The existing lifetime test independently observes
both database pools disappearing after termination.

The `test/intake-versions.test.ts` suite uses disposable PostgreSQL with controlled
external boundaries. To reproduce individual scenarios, run:

```sh
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-versions.test.ts -t 'out-of-order'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-versions.test.ts -t 'concurrent versions'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-versions.test.ts -t 'acknowledgment loss'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-versions.test.ts -t 'interruption'
```

The interruption case stops an in-flight AI call after its durable claim and reopens
the adapter. Additional interruption cases stop after preservation before delivery
reservation, and inside reserved external delivery, then assert the safe versus
uncertain restart behavior. Acknowledgment loss simulates an accepted external root whose response
is lost, reopens the adapter, and asserts no replacement root, with later harmless
versions retained. Out-of-order completion delays the older provider response while
a newer version finishes through another store instance. Concurrent cases assert
one root and one invocation per version under independent database connections.

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
permission afterwards. Edit and verify source version/root reuse.
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

## Attachment preservation (#33)

Supported triggering-message attachments are acquired before judgment. Only actionable originals are privately copied. The application downloads
HTTPS `cdn.discordapp.com/attachments/` URLs without following redirects. It never
fetches linked sites. A judgment-scoped cache enforces one **20 MiB total** budget
using actual streamed bytes and metadata preflight checks. All originals are attempted,
including originals beyond the four-item AI selection limit. AI selection and private copying use the same session; copying does not mean the model inspected an attachment.
The internal `AttachmentSession` passed to `Reports.publish` is the shared path for
AI acquisition: create it once per judgment, pass the same session to copying,
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

## Service failures and accounting (#36)

Private `/doctor` and `/channel-status` append service observations from the same
intake instance that handles gateway events, after existing authorization succeeds.
Each server has independent counts for judgment (including invalid structured output),
database, evidence preservation, report delivery, configuration and translation.
`missed messages` counts events whose notification workflow failed or was interrupted,
including an actionable event whose record/copy/report could not finish. It does
not mean every such message lacked a valid judgment. Counts contain no member,
source text, credentials or raw diagnostics. A valid judgment remains valid when
preservation, reporting or a future translation fails.

Observations are **since process start**. Earlier loss is explicitly unknown after
restart: these counters are not a durable lifetime total. Content-free durable
claims and partial delivery snapshots survive restart; missed evidence is never
replayed. An interruption before a database claim can be made cannot provide
restart deduplication, but no catch-up query is run. Status reflects observed
failures, not an active provider probe or proof that an unavailable stage recovered.
A successful new judgment clears judgment health; only a fully persisted/delivered
new actionable record clears delivery/database health. Old partial records remain
partial even after the service recovers.

The first failure in each active category attempts one content-free notice on the
verified private route. Later failures increment status rather than sending one
notice per member/message. A failed service notice prints only a sanitized
`moderation service notification failed; guild=...; stage=...; missed=...` line and
stops; it does not recursively notify or retry. Unknown/unverified routes are never
used. Recovery permits a fresh notice for a subsequent outage episode.

The shared text-generation adapter accepts optional `{guildId, purpose}` metadata
(`judgment` or `translation`). Its construction hooks `beforeAttempt` and
`afterAttempt` expose each transport attempt and sanitized outcome/token usage;
failed/interrupted usage can be unknown, never assumed free. These are the extension
points for #37 budget reservation/accounting and #35 separate translations, not
claims that either feature is delivered. The public `Intake.reportFailure` and
`recover` operations accept only server, verified route and stage; translation
callers omit the missed-message flag so an audit limitation cannot invalidate the
judgment. No source evidence is accepted by this service reporting path.

Retryable provider errors (429 and temporary server failures) get at most three
transport attempts total. SDK retries are disabled. The adapter honors
`retry-after-ms`, numeric `Retry-After` seconds and HTTP dates, without shortening
long waits; absent/invalid delays use 250ms then 500ms. Invalid output/schema and
non-retryable failures are not retried. There is no application AI concurrency cap
or short timeout. Interruption aborts an in-flight request and waits for transport
settlement, or cancels backoff before another paid request. Attempts never retry
Discord evidence uploads or replay the moderation event.

### Controlled final-QA faults

Use the isolated worktree infrastructure, without production credentials:

```sh
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/ai.test.ts test/intake.test.ts test/moderation-commands.test.ts test/attachment-workflow.test.ts test/intake-persistence.test.ts test/moderation-runtime.test.ts test/intake-process.test.ts
pnpm check
```

For individual faults, append `-t '429'`, `-t 'retry header'`, or
`-t 'interruption'` to `test/ai.test.ts`; append `-t 'outage aggregates'`,
`-t 'new successful'`, `-t 'interrupted judgment'`, `-t 'unavailable'`,
`-t 'partial evidence'`, `-t 'delivery-state'`, `-t 'translation limitation'`, or
`-t 'failed service notification'` to `test/intake.test.ts`.
The 70-second controlled delay uses the Effect test clock: after 69 seconds only
one transport call exists, and cancellation prevents any subsequent call.
Three repeated 429s produce exactly three attempts. An invalid-output outage over
two distinct events yields `missedMessages: 2`, `active: [judgment]`, one service
notice, zero retained ordinary records/reports; replaying the claimed event is a
duplicate. A new valid event clears the active judgment fault without resetting
its missed count. A translation fault leaves missed count zero and preserves the
valid recommendation. Interruption retains the content-free claim and one missed
count. Save/checkpoint failure reports database; an unknown attachment upload
reports evidence, retaining the valid finding without claiming complete delivery.
Existing attachment tests additionally use real disposable PostgreSQL and the
installed dfx transport to verify partial root/thread/copy states and no punishments.
Failed-notice output contains only the sanitized service line above.

Fixtures clean their disposable database tables and transports on scope exit;
`make infra-stop` stops this worktree's PostgreSQL when done. No live roles,
permissions or messages need changing. Production logs must never be populated by
replaying ordinary content. The separate connection-only smoke remains unchanged.
Actual paid-provider and private Discord observations remain final live QA #40.

## Supplied image and file evidence (#34)

After exemptions and the durable version claim, intake creates one acquisition
session. It selects at most four supported original contents, checks actual length
against declared size and verifies matching signatures. The installed `ai@7.0.163`
and `@ai-sdk/openai@4.0.109` chat adapter sends PNG, JPEG, GIF and WebP as inline
`image_url` data, and PDF as inline `file_data`, together with original text and
metadata in one user message. The configured policy stays in the system/developer
message. No provider URL fetching, tools, redirects or linked-site browsing occurs.
The model remains locked to `gpt-6-luna`.

These are **offline protocol-verified formats**, not a claim of live model
acceptance or OCR quality. Other documents (DOCX, spreadsheets and text files),
audio and video are unsupported by this path. There is no implicit conversion or
fallback model. Signature checking is not full decoding: damaged/encrypted PDFs,
unreadable pages and animation frames may still be uninterpretable. The prompt
requires material gaps to be disclosed. Provider rejection fails the judgment as
a service problem, never as `none`.

Each source attachment has an indexed `attachmentInputs` entry with identity,
filename, `supplied`/`unavailable`, and either verified MIME/actual byte length or
an omission reason. Reasons distinguish malformed metadata, unsupported format,
four-content limit, unavailable acquisition/download, shared download budget,
length mismatch/truncation and unreadable/mismatched signatures. `supplied` means
the bytes were sent in a successful judgment request; it does not prove every
page or pixel was understood. File instructions cannot override policy. Exact
metadata/selection accompanies the judgment in PostgreSQL and its private evidence
thread. Bytes remain transient and never enter database records.

The same cached session is passed to private copying. Its single **20 MiB actual
streamed download budget** covers AI and preservation together, including failed
downloads and dishonest size declarations. Copying tries every original, including
unsupported formats and contents beyond the AI selection limit. A cache hit costs
no second download. AI omission and incomplete copying are distinct. An ordinary
`none` can incur transient AI downloads but retains no contents, judgment or private
attachment archive. Existing edit, duplicate and uncertain delivery semantics apply.

### Reproduce attachment QA

Fixtures and expected findings: `evaluations/fixtures/attachments/README.md`.
No credentials needed:

```sh
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/ai.test.ts test/intake.test.ts test/attachment-workflow.test.ts test/attachment-evidence.test.ts
pnpm check
```

The workflow suite exercises installed provider HTTP and dfx multipart adapters
with disposable PostgreSQL. It compares original bytes at both transports,
records supplied/omitted identities, proves four AI inputs versus five private
originals, spends 15 MiB on AI then rejects a 6 MiB preservation download, and
verifies harmless non-retention and sanitized provider rejection. Filter with
`-t 'provider attachment rejection'`, `-t 'separate download budgets'`, or
`-t 'original png'`. The intake suite covers malformed/unsupported inputs, missing
acquisition, download failure, truncation and wrong signatures. Existing process
and version suites cover restart, edits, deduplication and partial delivery.

Explicit paid demonstration (one invocation with the original PNG and PDF; no
Discord access; requires valid provider configuration in the ignored environment):

```sh
pnpm build
pnpm --filter @hero-bot/discord-bot exec node --env-file-if-exists=.env tooling/evaluate-attachments.mjs --paid --output /tmp/hero-attachment-paid.json
```

The report records fixture hashes/input, prompt snapshot/hash, adapter/model,
commit, expected recommendation/URLs and actual validated result or sanitized
failure. Compare the reason against the rubric: the PDF override must not become
policy and no external verification may be claimed. Provider failure is a
limitation, not proof of model support. This checkout had no configured AI key/model,
so no paid success is claimed.

For #40, use an ordinary test member to send the PNG/PDF with neutral accompanying
text, inspect the private finding and supplied-input entries, then inspect private
original copies. Repeat with five PDFs, a video and malformed PDF to inspect
omissions. Check an allowed screenshot/harmless response leaves no archive; edit
an actionable source to harmless and confirm older evidence remains. Verify the
PDF injection is ignored under the saved policy. Record actual readability,
recommendations and unchanged source/member roles. These live observations remain
the developer's final QA checkpoint.

## English audit translations (#35)

Judgment always receives original multilingual evidence first. Only evidence selected
for retention (an actionable source, or a later version of an already retained source)
is eligible for a separate English audit invocation. Ordinary `none` messages and
their context are discarded without a translation call or content archive. English
or URL-only evidence does not need a translation call. No linked destinations are
retrieved, and translations never feed back into the recommendation.

The immutable record and private evidence thread contain `auditTranslation`: target
language, availability, original source server/message/version, exact original
excerpts, JSON pointers into that version's preserved evidence, original language
markers, English text, model/provider, configuration version, complete translation
instructions, detector version and attempt time. Context/history pointers resolve
against the supplied record, preserving their own authorship/message references,
timestamps and corrections. These are audit aids, never independent findings about
context authors or a replacement for originals. Earlier versions remain unchanged.

Selection uses pinned local `tinyld` language detection over supplied text, embed/
quote text and retained conversation/history text. Literal URL targets and metadata
are excluded from detection. Detection is heuristic: short ASCII snippets (fewer
than twelve letters), ambiguous and mixed-language passages can be missed. The
record explicitly carries that limitation; `not-selected` means no excerpt was selected,
not a guarantee that every character is English. `selectionOmissions` identifies
short/undetermined excerpts by pointer with `und` language markers. Non-Latin passages within English
text are also candidates. No missing attachment contents are inferred or reconstructed
for translation. Inspect preserved originals when a language marker or translation
looks uncertain; final live multilingual quality validation remains #40.

Provider or structurally invalid translation output records `unavailable` against
the exact originals, publishes the valid recommendation and evidence normally, and
raises a separate content-free translation health notice with **zero missed messages**.
That notice makes no claim of judgment/preservation failure. A later successful
translation clears active translation health; an English event makes no recovery
claim. Failed translations are not replayed. If the process is interrupted during
translation, scope cleanup cancels the paid request; finalization attempts to retain
the valid judgment with an interrupted audit limitation. Report delivery has not
started in that case, and no automatic replay occurs. A separate database failure
still reports inability to preserve truthfully.

Judgment and translation use the same `TextGeneration` adapter. Both pass server
identity and purpose through the existing per-attempt accounting hooks for #37;
translation retries inherit the same maximum-three-attempt policy, provider delay,
SDK retry disabling and transport cleanup. There is no global concurrency cap or
short application timeout. Translation calls run outside source serialization locks.

### Controlled multilingual QA

No Discord credentials, paid calls or permission changes are required:

```sh
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'multilingual'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'translation failure'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'audit translates exact'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'non-English ordinary none'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'interrupted audit'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'installed provider carries'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake-discord.test.ts test/intake-persistence.test.ts test/ai.test.ts
pnpm check
```

Versioned originals/English meaning rubrics are in
`apps/discord-bot/test/support/audit-translation-fixture.ts` (Spanish, Chinese,
Russian, Portuguese and Arabic). Success observes original-first inputs, one
separate translation invocation, exact pointer/original association, English text,
unchanged recommendation, per-server purpose/token accounting, restart retention
and actual dfx evidence-thread bodies. Failure injects a controlled provider error,
malformed JSON, absent/mismatched pointers, wrong counts, invalid language/text,
and interruption. Expect retained originals and valid judgment, unavailable audit
markers, no punitive requests, no missed-judgment increase, no foreign-server health
changes and no raw provider diagnostics in logs. The ordinary-none case observes
zero translations/records, while subsequent retained harmless versions are translated.
The context case preserves quoted authors and an overturned history correction.
Tests dispose transports and database resources on scope exit; `make infra-stop`
stops this worktree's infrastructure when finished.

For #40, submit the fixture originals from an ordinary test member and compare
meaning (distribution offer/private contact, negation and uncertainty), not identical
English wording. Inspect original-first source/version references, language markers,
configuration/model provenance and unchanged roles/source messages in the private
thread. Repeat an English source with non-English quoted/context evidence and an
edit to a harmless non-English message. Use the controlled failures above for outage
observations rather than intentionally disrupting production credentials. Record
actual private Discord/paid-provider observations separately; CI is protocol evidence.

## Daily AI budgets (#37)

Moderation startup requires `HERO_AI_BUDGET_JSON` (see the credential-free example
in `apps/discord-bot/.env.example`). Missing/malformed configuration names this
variable and this guide. Every configured moderation guild needs a positive daily
`guildMicroUsd` limit; `sharedMicroUsd` limits the entire application in the same
PostgreSQL ledger. Currency units are **USD millionths**: 1,000,000 = USD 1.
Use safe positive integer amounts, token limits and prices. `version` identifies
the operator configuration; `pricing` identifies the provider price sheet/date
and any billing assumptions. `model` must be `gpt-6-luna`. The example prices are
illustrative, **not verified provider pricing**. Supply conservative uncached input
and output prices in USD millionths per million tokens. Cached input is charged
at the ordinary input estimate; output includes all provider-reported output tokens.
These are price-based usage estimates, not an invoice or an exact provider balance.
Taxes, credits and unrelated consumers of the API key are outside this ledger.

Set `maxInputTokens` to the provider model's **full maximum billable input**,
including system instructions, image/file tokens and provider overhead, not an
estimate based on typical messages. Set `maxOutputTokens` to an acceptable output
cap (sent to the SDK on every attempt). Verify the model limits and prices with
the provider before enabling paid moderation; a wrong bound/price cannot guarantee
a real currency ceiling. A worst-case attempt reserves
`ceil((maxInputTokens * inputPrice + maxOutputTokens * outputPrice)/1,000,000)`
USD millionths. A daily limit below that amount deliberately admits no calls.
There is no separate AI concurrency cap or application request timeout.

All processes sharing one application must use the **same database, ledger table
and budget policy**. Separate development/production databases and API keys.
Stop all application instances before changing policy, update their configuration
together, then restart. Retain the database/table: changing its name or deleting
rows grants a new allowance and is not a supported reset procedure. Raising a
limit resumes new eligible events using existing usage, never old messages.
Lowering it cannot undo already billed work. Old rows retain their original policy,
prices, purpose, attempt, admission timestamp, tokens (when known) and outcome;
configuration changes never reprice earlier usage. No content, message/member
identities, provider diagnostics or secrets enter the accounting ledger.

Both judgment and conditional English audit translation use the same per-transport
hooks. Each retry reserves separately, at most three attempts. Atomic PostgreSQL
admission checks both ceilings across processes before contacting the provider;
concurrent calls cannot all spend the same remaining capacity. An attempt with
complete nonnegative integer input/output usage settles at its admission prices,
rounded up once to USD millionths. Even failed calls are charged when the provider
supplies usage. Unknown, partial, malformed or interrupted usage retains the entire
reservation, never invents zero spend. A crash between reservation and transport,
or failed settlement, also retains capacity. There is no automatic refund, replay
or operator release of unknown holds. Database admission failure prevents the call;
settlement failure surfaces accounting failure while preserving the hold.

Days are **UTC calendar days**, fixed independently of the host timezone. An
in-flight attempt belongs to its admission day even if it settles after midnight.
A retry after midnight reserves the new day. Yesterday's unknown holds remain in
yesterday's ledger; they are not claimed to be today's spend. New days resume new
eligible events, not catch-up work. A restart on the same day retains every hold
and settled amount. The conservative bound can leave unused capacity; insufficient
capacity for the next full reservation counts as exhaustion before the numeric
limit is exactly reached.

Private `/doctor` and `/channel-status` include today's guild/shared reported
estimates, held capacity, unknown/pending attempt count, limits and policy provenance.
Only this guild's limit is exposed, alongside aggregate application totals.
`reason` is `available`, `guild`, `shared`, `unconfigured`, or
`accounting-unavailable`. Missing status storage is never presented as zero usage.
A denied judgment increments the existing content-free missed-message count and
`budget` service failure; it creates no finding or harmless-message archive.
These missed counts remain process-local as documented above; ledger totals are
durable. Translation denial retains the valid judgment and records an unavailable
English audit limitation; it does not increment missed judgments. Status budget
availability is current; active failure categories describe the last observed
workflow failure and clear on a successful new judgment.

### Controlled budget QA (no paid calls)

Use pinned Node24.22.2/pnpm12.16.1 and disposable worktree PostgreSQL:

```sh
export PATH="$HOME/.local/share/mise/installs/node/24.22.2/bin:$PATH"
make infra-start
pnpm build
pnpm --filter @hero-bot/discord-bot exec vitest run test/ai-budget.test.ts
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'budget exhaustion'
pnpm check
```

The controlled prices are input 1/output 2 USD millionths per token, maximum
40 input/10 output tokens: a 60-unit reservation, 100 per guild and 150 shared.
Concurrent admissions in one guild admit exactly one of three calls. A second
guild admits one; remaining shared capacity blocks another. Restart retains the
60-unit unknown hold. A reported 10-input/5-output attempt settles at 20 units,
including after midnight and policy change; duplicate settlement cannot overwrite
it. A failed first attempt with reported 5-input/0-output costs 5, followed by a
20-unit success and a separate 20-unit translation: total 45, three HTTP calls,
then the next 60-unit reservation is denied. Interrupted transport aborts and
retains 60 across restart. No transport needs an actual API key or network.

The public intake procedure yields one ordinary `none` with unknown usage, then
one denied new event: missed messages 1, active `budget`, reason `guild`, held 60,
one service notice, zero retained ordinary records/reports. A duplicate does not
increment counts. Controlled midnight permits a new event; the missed identity
remains a duplicate and is never replayed. Tables and SDK requests are disposed on
scope exit. `make infra-stop` stops this worktree's PostgreSQL when done.

For #40 only, after confirming provider prices/full model bounds, use a separate
development guild and a small positive daily limit **below one reservation**.
Submit one ordinary eligible event: zero paid transport calls, a private budget
service notice and missed count 1. Verify source/roles unchanged and no finding.
Restart with a larger low-cost limit and submit a _new_ event; expect its judgment
and optional translation to consume the configured estimates. Do not replay the
missed event. Inspect today's `ai_budget_attempts` rows as an authorized operator
for day/purpose/token/policy/outcome provenance; inspect status for estimates versus
unknown holds. This is optional paid developer QA, not claimed live evidence.
