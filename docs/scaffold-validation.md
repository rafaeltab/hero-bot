# Scaffold verification

The scaffold includes the workspace, enforced local/CI engineering commands,
capability/adapter import rules, PostgreSQL/Drizzle, dfx development lifecycle,
Vercel AI SDK integration, validated coverage/CRAP, test linting and advisory mutations.
It implements no moderation policy/workflow/schema or AI evaluation runner.

## Reproduce

With pinned Node 24.22.2 / pnpm 12.16.1 and
[disposable PostgreSQL](postgres-validation.md):

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm mutation:verify
TURBO_FORCE=true pnpm check
```

Mutation verification precedes coverage so its generated artifacts do not invalidate
fresh evidence. `pnpm check` enforces Biome, test lint/fixtures, import graphs,
TypeScript, actual application tests, CRAP/evidence fixtures and fresh baseline/source
coverage. Source eligibility is shared across these tools; no threshold is relaxed.

The independently reproduced pre-improvement baseline was 45 application tests,
98.18% statements, 100% branches, and 45 functions with maximum CRAP 5.2. The
improvement pass adds the exact Effect.sync regression, shared-source eligibility
and complete sharding/report checks. Its final execution evidence is recorded below.

Hosted **CI / Checks** passed on earlier PR revisions. New pushed revisions must pass
that same check; workflow success alone does not establish merge protection. The
existing main ruleset remains disabled: see the exact
[remaining administrator action](repository-protection.md).

No live Discord handshake, paid AI call, production deployment or real-server bot
installation is claimed. Controlled tests use the actual installed SDKs, not whole-SDK
mocks. PostgreSQL tests use a real disposable server and independently observe cleanup.
The developer retains real-server release judgment.

Earlier detailed coordination and intermediate logs remain available in PR commit
history; current commands, policies and verification records in these documents are
authoritative rather than the superseded per-branch handoff narratives.

## Review improvement pass

- Strict frozen installation, lint, architecture and TypeScript checks passed.
- The exact unawaited Effect.sync assertion went red before its fix; approved
  promise-aware wrappers and import alias/shadow cases remain valid.
- Real mutation verification passed all five tests, including sharding identity
  equivalence and rejection of incomplete aggregate reports.
- Whole-PR analysis against `1b5ea5d` completed all **150 mutants across 13 original
  ranges** in four full-suite shards: **123 killed, 22 survived, 5 timeout**.
  The longest local shard took **308.5 seconds**. All four completion receipts and
  the exact original-scope union were verified. A per-mutant Timeout is a completed
  classified result, distinct from an unfinished job-level timeout. Survivors and
  timeout classifications remain advisory feedback, not proof of application defects.
- Evidence/logs for this pass are stored locally under
  `/home/rafaeltab/.cache/hero-pr24-improvements`; CI publishes per-shard reports and
  the completeness summary as artifacts.
- The existing ruleset update was attempted and rejected with HTTP 404; it remains
  disabled. The exact remaining administrator step is documented separately.

Final uncached `pnpm check` passed: **45 application tests**, **20 lint fixture tests**,
**12 architecture graphs**, **15 CRAP/evidence/policy tests**, **98.18% statements /
100% branches**, and **45 production functions with maximum CRAP 5.2**. All five
real mutation-verification tests passed separately. Independent post-validation
observation found **zero database client sessions**; the owned container was stopped
and its temporary connection configuration removed. No live Discord/paid AI call
or main-branch merge was performed.
