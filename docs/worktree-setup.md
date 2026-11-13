# Isolated worktree setup

Use an existing Git checkout created by Git or T3. On Linux, install the pinned
Node 24.22.2 and pnpm 12.16.1 plus Make, Git, and util-linux `flock`. Docker is needed
only for infrastructure operations. Setup does not install a toolchain manager.

```sh
make install        # version check, frozen dependencies, best-effort configuration
make infra-start    # start owned PostgreSQL and wait for readiness
pnpm check          # automatically uses this worktree's database
pnpm dev            # explicitly connect the shared DEVELOPMENT Discord identity
make stop           # gracefully stop this bot, then remove infrastructure
make worktree-clean # also delete this worktree's database storage and release slot
```

`make infra-stop` removes this worktree's container (and any owned network), keeping
its named database volume. Restart recreates the container with that data. `make
stop` first sends SIGTERM to the managed development process and waits for its
exit. Failed shutdown prevents infrastructure teardown. Cleanup preserves the
checkout and shared secrets. Failed infrastructure cleanup retains the slot;
repeat cleanup after fixing Docker. Stop and cleanup require a valid worktree
identity and never infer main's resources when identity is absent or invalid.

## Credentials and generated files

The shared source is `$XDG_CONFIG_HOME/hero-bot/secrets.env`, defaulting to
`~/.config/hero-bot/secrets.env`. When absent, setup imports only declared development
Discord and optional AI keys from main's `apps/discord-bot/.env`. An existing source
is preserved; missing declared keys are appended. Initialization and allocation
are serialized across this repository's worktrees. Secret files and generated
configuration have mode 0600. Configuration is parsed as dotenv, never executed
as shell code. Do not source these files as shell scripts.

Edit shared secrets for persistent credential changes, then rerun `make install`
in each checkout to refresh its ignored `apps/discord-bot/.env`. Direct generated
file edits are overwritten. Unknown shared keys are never copied. PostgreSQL URLs
and `HERO_ENV=development` are computed, overriding shared/inherited settings.
Optional AI credentials stay optional; missing Discord credentials generate
key-only diagnostics and remain blank until provisioned. Use a separate development
application and dedicated test server as described in [Discord setup](discord-development.md).

Installation starts neither PostgreSQL nor the bot. Dependency or version-check
failures fail installation. A postinstall configuration failure prints a diagnostic
but does **not** fail dependency installation. CI skips this local hook. Successful
installation therefore does not guarantee readiness for every command.

## Identity, ports, and process ownership

The Git common directory holds private `hero-worktrees/allocations.json` plus
advisory locks and process records. The ignored `.env.worktree.json` must match
its reservation. Allocation follows the absolute Git metadata directory, independent
of branch, commit, or detached HEAD, including main. Do not manually edit reservations
or move a checkout with active resources. Clean it first if you need to relocate it.

Slots reserve ten localhost ports starting at 55420; PostgreSQL uses the first.
Initial allocation checks the entire range and skips occupied ranges. Reinstall
keeps the reservation. Later port conflicts fail startup with a port diagnostic;
stop the conflicting service and retry, rather than changing allocation. Container
and volume names use the allocation UUID; ownership labels include that UUID and
Git common directory. The CLI verifies labels before changing existing resources.
No extra Docker network is created by this workflow.

`pnpm dev` at the root or app is the supported live entry point. A kernel `flock`
held for the process lifetime permits one development bot across linked worktrees,
with a clear rejection for competing launches. Signals are forwarded to the bot;
the tracked supervisor waits for its exit. PID start-time checks prevent stale
records signalling a reused PID. Offline `pnpm start` and tests do not acquire the
Discord lock. Bypassing the supported entry point bypasses this management.

Local Vitest commands and coverage load the verified allocation automatically,
overriding inherited test URLs and edited generated database URLs. Turbo includes
the generated `.env` in test cache inputs. CI uses its explicitly supplied database
URL and requires no local worktree state. No schema or production settings change.

## Manual verification

See [worktree verification results](worktree-validation.md) for commands, observations,
and limitations. No automated setup tests were added, as requested in issue #41.
