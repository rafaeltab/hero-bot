# Issue #41 manual verification

Verified on 2026-11-13 on Linux with Node 24.22.2, pnpm 12.16.1 and Docker 29.1.3.
No automated setup tests were added. Disposable detached Git worktrees under
`/tmp/hero41-manual-*` were used, with a disposable XDG configuration home.

| Public operation / observation                                       | Result                                                                                                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make install` in this checkout                                      | Passed frozen installation; initialized shared secrets from main without logging values; no service started by install.                                                          |
| Concurrent `make install` in two detached worktrees                  | Both exited 0; distinct UUIDs, slots, database ports and resource names; simultaneous shared-source initialization completed. A listener held on port 55430 was avoided.         |
| Secret/generated-file metadata                                       | Shared source and generated app environments were mode 0600; generated files ignored by Git.                                                                                     |
| Reinstall after editing generated environment                        | Preserved allocation and shared source; replaced direct generated edits. Found pnpm skips unchanged postinstall, so Make explicitly repeats the best-effort hook.                |
| Shared source change                                                 | Updated optional model setting appeared after reinstall; undeclared sentinel was not copied. Restored disposable source afterward.                                               |
| Unusable shared-source directory                                     | `make install` exited 0 with setup-failure diagnostics.                                                                                                                          |
| Changed dependency manifest without lock update                      | `make install` failed frozen installation.                                                                                                                                       |
| `make infra-start` in two worktrees, repeated start                  | Both PostgreSQL services became ready; repeated start reused owned resources.                                                                                                    |
| SQL through real disposable PostgreSQL                               | Table and identifiable value created in A; absent in B.                                                                                                                          |
| `make infra-stop`, then `make infra-start`                           | A container disappeared; volume remained; B still answered SQL; A's identifiable data survived recreation.                                                                       |
| Listener on an allocated stopped database port                       | Start failed with port diagnostics; allocation stayed unchanged; restart succeeded after releasing listener.                                                                     |
| Controlled `pnpm dev` in disposable worktrees                        | Temporary entrypoint performed no Discord operations; second launch rejected; B typecheck worked while A held the lock.                                                          |
| `make stop` during controlled execution                              | SIGTERM handler completed before infrastructure teardown; process exited; B subsequently acquired the shared lock.                                                               |
| Missing/corrupt identity, `make stop`                                | Refused both cases. Restored disposable identity afterward.                                                                                                                      |
| Volume deliberately held by a disposable helper container            | Cleanup failed and retained allocation; removing helper allowed successful cleanup and slot release.                                                                             |
| Successful `make worktree-clean`                                     | Removed selected database volume; preserved peer volume, shared source and checkout. Both disposable allocations cleaned afterward.                                              |
| Blank development credentials, `pnpm dev`                            | Failed configuration before connecting.                                                                                                                                          |
| CI environment loader with explicit sentinel URL                     | Preserved CI-provided URL despite local allocation.                                                                                                                              |
| `pnpm typecheck`; focused `test/process.test.ts`                     | Passed (3 focused process tests).                                                                                                                                                |
| `HERO_TEST_DATABASE_URL=<deliberately invalid local URL> pnpm check` | Passed lint, architecture, typecheck, all 52 app tests, tooling fixtures, coverage and CRAP for 45 production functions; confirms local allocation overrides inherited test URL. |

Initial verification failures were resolved before the successful runs: focused
process tests first needed `pnpm build`; an interrupted Docker operation left the
current checkout's container without a published host port. `make infra-stop` and
`make infra-start` recreated it. Startup now also checks host TCP reachability
alongside PostgreSQL readiness. Docker container creation gets a longer timeout
than routine operations to allow a first image pull.

No live Discord smoke check was performed. Controlled process verification used
a temporary entrypoint only in disposable checkouts, and establishes management
and shutdown behavior rather than real Discord authentication or presence. The
existing Discord transport tests passed as part of the full suite. Main's active
checkout was read for credential import, not reinstalled during verification.

## Standards

The independent standards review found no documented-standard violations. It
reported two baseline judgement calls:

- **Possible Duplicated Code:** port-allocation arithmetic appeared in validation,
  allocation and diagnostics. Resolved by centralizing the base port and range
  size and using the shared port function in diagnostics.
- **Possible Duplicated Code:** both CLI lock supervision and development-process
  supervision forward signals and await child exit. Retained for now: these are
  small lifecycle boundaries, and the development supervisor additionally owns
  its private process record. This is an optional refactoring suggestion.

## Spec

The independent requirements review found no actionable spec findings or scope
creep. It checked concurrent allocation, resource ownership, graceful shutdown,
secret handling, local database isolation, CI configuration and verification scope
against issue #41.

Review totals: Standards had 0 violations and 2 optional suggestions (1 resolved);
Spec had 0 findings. Neither axis reported a blocking issue.
