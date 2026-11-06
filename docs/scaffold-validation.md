# Scaffold verification

The scaffold includes the workspace, enforced engineering commands, capability/import
rules, PostgreSQL/Drizzle, dfx development lifecycle, Vercel AI SDK integration,
validated coverage/CRAP, test linting and advisory mutations. No moderation workflow,
application schema or AI evaluation runner is implemented.

## Reproduce current checks

With pinned Node 24.22.2 / pnpm 12.16.1 and
[disposable PostgreSQL](postgres-validation.md):

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm mutation:verify
TURBO_FORCE=true pnpm check
```

Mutation verification precedes coverage so generated artifacts do not invalidate
fresh evidence. See [toolchain maintenance](toolchain-maintenance.md) for upgrade
fixtures, guarantees, failure diagnosis and limits.

## Latest survivor-driven pass

- Strict frozen installation and the full uncached gate passed: **52 application
  tests**, **20 lint fixtures**, **12 architecture graphs**, **15 CRAP/evidence/policy
  tests**, **98.18% statements / 100% branches**, and **45 production functions with
  maximum CRAP 5.2**. All five real mutation-verification tests passed separately.
- New tests reject one wrong READY guild, prefix/suffix numeric IDs and whitespace
  API credentials before transport use. Controlled timer observation proves actual
  acquisition and disposal on interruption, not just stop logging.
- Six specific original hosted replacements were applied directly, the focused
  tests failed, the original source was restored and the tests passed. No production
  source changes/mutants are committed.
- A real Stryker compiled-entrypoint probe reproduced the survivor before forwarding
  the child's mutation activation and killed it afterward. Only the activation
  variable is forwarded; development credentials remain excluded.
- [Survivor triage](mutation-survivor-triage.md) accounts for all 21 original survivors
  and both classified timeouts, distinguishing fixed gaps, remaining behavioral gaps
  and bounded/nonobservable cases. It does not target a perfect score.
- Logs/probes are under `/home/rafaeltab/.cache/hero-pr24-survivor-tests`. Independent
  post-validation observation found **zero database client sessions**; the owned
  container was stopped and temporary connection configuration removed.

The hosted baseline `7ba448f` completed all 150 mutants across 13 original ranges:
127 killed, 21 survived, 2 per-mutant timeouts. It is the triage input, not a claim
about a later revision. New hosted results are recorded on the PR; mutation
artifacts and the Results summary distinguish completed outcomes from unfinished work.
Earlier detailed runs remain in commit/PR history rather than duplicate current guidance.

## Protection and external limits

The existing main ruleset is **active**, requiring **Checks only**; this was verified
through the API after the owner enabled it. Mutation jobs remain optional by the
user's choice. [Protection status](repository-protection.md) is independent of
successful workflow steps; no rule changes were made in this pass.

No live Discord handshake, paid AI call, production deployment or real-server bot
installation is claimed. SDK tests use installed transport paths, not whole-SDK mocks;
PostgreSQL tests use a real disposable server. The developer retains real-server
release judgment. No main-branch merge was performed.
