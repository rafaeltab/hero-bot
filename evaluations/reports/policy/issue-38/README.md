# Controlled evidence for #38

Implementation revision: `b33828cdf22befd0ffb0375b6d59f8f8357e6679`.
Node 24.22.2 / pnpm 12.16.1. Synthetic suite v3, 37 judgment cases.
No paid provider calls or live Discord work was performed.

Generated from repository root:

```sh
node apps/discord-bot/tooling/evaluate-policy.mjs --output evaluations/reports/policy/issue-38/controlled.json
node apps/discord-bot/tooling/evaluate-policy.mjs --controlled-invalid --output evaluations/reports/policy/issue-38/invalid.json
node apps/discord-bot/tooling/evaluate-policy.mjs --controlled-translation-failure --output evaluations/reports/policy/issue-38/translation-failure.json
node apps/discord-bot/tooling/evaluate-policy.mjs --compare evaluations/reports/policy/issue-38/controlled.json evaluations/reports/policy/issue-38/translation-failure.json --output evaluations/reports/policy/issue-38/comparison.json
```

Use new paths to reproduce; existing reports cannot be overwritten. These synthetic
artifacts are explicitly retained despite the repository's general reports ignore.
Every integrity digest was independently checked after generation.

Observed controlled outcomes:

- All 37 oracle-echo judgment responses validate. Matching expectations is constructed
  by the controlled adapter; it is not observed model accuracy.
- All 37 invalid-output responses produce sanitized failures, with no actual judgment.
- The translation-failure comparison identifies only `spanish-original` as a changed
  result. Its original judgment/expectation stays unchanged; English changes from the
  canned original-linked translation to unavailable. Execution settings differ explicitly.
- The short Chinese original is not selected by the local language detector; the
  omission is retained. This is not proof that English translation is unnecessary.
- Attachment reports identify the exact five original fixture formats and byte hashes.
  Their readability and live provider acceptance remain unverified.

Validation: `pnpm build` and full `pnpm check` passed, with 281 application tests,
97.83% statement coverage, 94.02% branch coverage and CRAP <=30 for 289 production
functions. Five additional CLI tests cover provenance/immutability, integrity,
comparison/faults, prompt differences, separate translations and credential redaction.
An earlier check run hit existing 3s/5s process-start timeouts; the full rerun passed
without changing their limits or engineering thresholds.

Follow-up observations belong in developer QA #40: actual recommendation/reason/URLs,
English meaning, attachment readability, private reports, unchanged source/member roles.
Standalone paid evaluation accounting integration remains dependent on #37; no ledger
or spend enforcement is claimed here. No policy changes or numerical AI gate were made.
