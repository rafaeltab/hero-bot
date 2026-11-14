# Versioned notification-only policy evaluations (#38)

`policy-cases.json` is the reviewed suite, extending the original #30 runner and
cases. Suite version 3 and each case's version/hash identify these synthetic inputs
and rubrics. Earlier versions remain in Git; never change a reviewed version's
contents without advancing its version. `acceptance` points to #26; the canonical
examples come from [the #5 resolution](https://github.com/rafaeltab/hero-bot/issues/5#issuecomment-6633247954).
No real member content, real copied courses or credentials belong here.

The suite covers all eleven public canonical examples, original multilingual text,
Markdown and embed targets, textual evasion, lookalikes and unknown short links,
PNG/JPEG/GIF/WebP/PDF originals, embedded overrides, missing/unsupported/truncated/
unreadable/count-limited/size-limited evidence, attributed context, corrected history,
prior deletion and exact actionable-to-harmless versions. Attachment contents are
reusable [synthetic fixtures](fixtures/attachments/README.md); supplied bytes are
hashed, never copied into JSON reports. Unavailable cases supply omission metadata,
not pretend readable contents. Interpretation of omission metadata here complements
the real acquisition/SDK/persistence checks described in `docs/moderation-intake.md`.

Confidential reporting is deliberately in `deterministicCases`: the configured
reporting route and its threads are exempt, with no AI call or reporter accusation.
The later confidential-intake UI is unavailable until #27. The deterministic
workflow case uses a helpful reporter quoting a separate offending author; it asserts
no judgment, archive or report on that route. Context attribution, service failures,
restart/edit progression and disabled execution are proved by workflow tests rather
than asking a model to assert its own safety.

## Reproduce without provider or Discord credentials

From repository root, use the pinned toolchain for every command:

```sh
export PATH="$HOME/.local/share/mise/installs/node/24.22.2/bin:$PATH"
node --version # v24.22.2
pnpm --version # 12.16.1
pnpm install --frozen-lockfile
make infra-start
pnpm build
node apps/discord-bot/tooling/evaluate-policy.mjs --output /tmp/policy-controlled-1.json
node apps/discord-bot/tooling/evaluate-policy.mjs --output /tmp/policy-controlled-2.json
node apps/discord-bot/tooling/evaluate-policy.mjs --compare /tmp/policy-controlled-1.json /tmp/policy-controlled-2.json --output /tmp/policy-comparison.json
node --test scripts/test/policy-evaluation.test.mjs
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts -t 'exempt source'
pnpm --filter @hero-bot/discord-bot exec vitest run test/intake.test.ts test/ai.test.ts test/intake-persistence.test.ts test/intake-process.test.ts test/attachment-workflow.test.ts
pnpm check
make infra-stop
```

Use new output paths for each invocation. The runner reserves its destination
exclusively **before** spending, uses mode 0600, and refuses overwrite. Reports
carry a SHA-256 integrity value checked by comparison; this detects edits, not a
cryptographic signature against an adversary who can recompute it. Retain original
reports in Git under `reports/policy/<run-id>/`. Reports include repository revision,
tracked working-diff hash, suite/case hashes and versions, complete prompt/config,
model/provider (model revision explicitly unavailable), adapter/tool versions,
settings, input/attachment hashes, expected/actual actions/URLs/reason rubrics,
validated outputs, failures, separate translations and unavailable metadata.
A dirty-tree report describes an intermediate checkout, not just its commit.
Build first: the runner uses the same built judgment parser, policy, translation
selection and AI adapter as the application. No Discord connection is made.

The controlled adapter deliberately echoes the oracle, including a canned Spanish
translation. This measures report plumbing and validation, **not** model decision
quality, injection resistance, OCR/readability, or deterministic wording. Report
observations remain `unverified` for qualitative review. Translation uses the
original-first audit selector and separate invocation. The short Chinese case is
currently not selected (language undetermined); that omission stays visible.
The longer Spanish case exercises original-linked translation. Translation timestamps
are retained, but ignored when identifying semantic result changes between runs.

Runnable controlled faults (unique output paths):

```sh
node apps/discord-bot/tooling/evaluate-policy.mjs --case bare-bilibili --controlled-invalid --output /tmp/policy-invalid.json
node apps/discord-bot/tooling/evaluate-policy.mjs --case spanish-original --controlled-translation-failure --output /tmp/policy-translation-fault.json
```

Invalid output yields `failure: invalid-output`, no `actual` judgment, never `none`.
Translation failure leaves the valid ban recommendation and original evidence intact,
with unavailable English audit excerpts. Existing workflow/transport failure procedures
in `docs/moderation-intake.md` exercise real SDK retries, content-free health, no
replay and database/process cleanup. These evaluation faults require no permission
changes or production credential disruption.

## Comparable reports and policy/configuration variants

`--compare <before.json> <after.json> --output <new.json>` verifies integrity, records
both report hashes, and exposes changes in case set, commit/dirty tree, prompt,
model/provider, configuration, adapters and execution settings. Results join by case
ID and carry full before/after records, including reason wording, URLs, original
version, translations and failures. Added/removed cases are explicit null sides.
Prompt/model/case differences make a comparison contextual, not a quality regression
claim. No numerical AI gate is added. Reason/readability/meaning need human review;
a matching action alone is insufficient. Never claim identical outputs across runs.

For an operator-approved alternate prompt, supply `--configuration /tmp/synthetic-config.json`
containing `{"version":"qa-2","prompt":"complete synthetic policy text"}`. Never
export a real server configuration with private content into this suite. The evaluated
model stays locked to `gpt-6-luna`; future model/provider migrations will be visible
in comparison metadata. The runtime saved policy is not edited by an evaluation.

## Explicit paid run and spend context

CI and ordinary commands never spend. A paid invocation requires **both** `--paid`
and `--spend-context` with a non-secret approval/accounting reference. Use `--case`
first: each selected case makes one original judgment invocation, up to three
transport attempts, plus at most one selected retained-English audit invocation
(up to three attempts). Full-suite spend varies with responses and token usage;
images/PDF can cost more than text. No fixed cost or free-failure claim is made.
The report records sanitized per-attempt outcome and reported tokens; missing usage
is unknown. No raw provider errors, prompts or ordinary content are logged.

#37 owns pricing, reservation and durable shared/per-server accounting. This standalone
operator tool currently uses the existing transport observation hooks, not the running
bot's durable budget ledger. It **does not enforce an evaluation spend ceiling** or
pretend an approval reference is one. Before spending, the operator must choose a
provider-side cap and review current pricing/available funds; use an isolated provider
project/key. Integrate #37's public accounting path once available rather than adding
a second ledger here. Do not put keys, prices assumed to be current, or raw billing
exports into committed fixtures/reports.

From `apps/discord-bot`, with authorized provider configuration in ignored `.env`:

```sh
node --env-file-if-exists=.env tooling/evaluate-policy.mjs --paid --case bare-bilibili --spend-context QA40-approved-run-1 --output /tmp/policy-paid-1.json
```

Requires `HERO_AI_API_KEY` and `HERO_AI_MODEL=gpt-6-luna`. A missing/invalid
configuration produces a sanitized unavailable report, not proof of model behavior.
No paid run was performed for this delivery. Actual quality and readability remain
unverified; final live QA is [#40](https://github.com/rafaeltab/hero-bot/issues/40).

## Developer QA handoff and observations

Latest complete retained artifacts: [controlled suite](reports/policy/issue-38/controlled.json),
[invalid output](reports/policy/issue-38/invalid.json),
[translation failure](reports/policy/issue-38/translation-failure.json), and
[comparison](reports/policy/issue-38/comparison.json). The controlled suite deliberately
returns expected outcomes: zero action differences is not observed model success.
Observed adapter/quality limitations: signature checks are not decoding/OCR; live
format acceptance is unverified; short Chinese language selection is omitted;
controlled translation is canned; SDK model revision is unavailable; standalone
paid accounting integration awaits #37. These are explicit follow-up checks for #40,
not silent policy changes or invented observed quality defects. If live observations
show a concrete defect, record case/report hashes, original/actual and reason/meaning
deviation, then file a specific follow-up; do not change expectations to hide it.

Small representative selection for the separate development server, ordinary test
member, notification-only permissions:

| Case                                   | Send / inspect                                        | Expected recommendation and QA observation                                                           |
| -------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `private-contact`                      | Exact suite text                                      | none; no retained ordinary contents                                                                  |
| `bare-bilibili`, `legitimate-bilibili` | Exact suite text                                      | ban recommendation; platform presumption, no claimed verification or punishment                      |
| `refund`, `public-report`              | Exact suite text                                      | review-hold / delete recommendations; execution disabled                                             |
| `edit-actionable`, `edit-harmless`     | Same source, edit in order                            | ban then none; one root; prior exact actionable version retained                                     |
| `screenshot`, `file-injection`         | Neutral text plus distribution.png / distribution.pdf | ban expected; inspect originals/copies, actual readability, override ignored; no external inspection |
| `spanish-original`                     | Exact original Spanish                                | ban expected; judgment uses original; separately labelled English preserves meaning/attribution      |
| `confidential-report`                  | Helpful quote only in configured exempt route         | no AI/archive/reporter finding; no later UI claimed                                                  |

Use the controlled commands for failures/unsupported evidence rather than disrupting
live credentials. Inspect actual private root/thread, supplied/omitted evidence,
configuration/model/source versions and unchanged roles/source messages. Record
what actually happened, reason rubric deviations, translation meaning, omissions and
report links in #40; no deterministic wording expectation. Synthetic attachments can
be reused without exposing member content. The agent does not remove live sources,
change permissions, punish members or submit Discord messages as part of this runner.
