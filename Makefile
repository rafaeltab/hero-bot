WORKTREE_STATE := $(shell git rev-parse --path-format=absolute --git-common-dir)/hero-worktrees

.PHONY: install infra-start infra-stop stop worktree-clean

install:
	node scripts/worktree/toolchain.mjs
	pnpm install --frozen-lockfile
	node scripts/worktree/postinstall.mjs

infra-start:
	flock "$(WORKTREE_STATE)/registry.lock" node --input-type=module -e 'import { startInfra } from "./scripts/worktree/infra.mjs"; import { identity } from "./scripts/worktree/state.mjs"; await startInfra(identity());'

infra-stop:
	flock "$(WORKTREE_STATE)/registry.lock" node --input-type=module -e 'import { stopInfra } from "./scripts/worktree/infra.mjs"; import { identity } from "./scripts/worktree/state.mjs"; stopInfra(identity());'

stop:
	flock "$(WORKTREE_STATE)/registry.lock" node --input-type=module -e 'import { stopWorktree } from "./scripts/worktree/infra.mjs"; import { identity } from "./scripts/worktree/state.mjs"; await stopWorktree(identity());'

worktree-clean:
	flock "$(WORKTREE_STATE)/registry.lock" node --input-type=module -e 'import { stopWorktree } from "./scripts/worktree/infra.mjs"; import { identity } from "./scripts/worktree/state.mjs"; await stopWorktree(identity(), true);'
