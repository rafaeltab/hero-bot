WORKTREE_STATE := $(shell git rev-parse --path-format=absolute --git-common-dir)/hero-worktrees

.PHONY: install configure dev infra-start infra-stop stop worktree-clean stop-locked worktree-clean-locked state-directory

install:
	node scripts/worktree/toolchain.mjs
	pnpm install --frozen-lockfile
	node scripts/worktree/postinstall.mjs

state-directory:
	@mkdir -p "$(WORKTREE_STATE)"

configure: state-directory
	@flock "$(WORKTREE_STATE)/registry.lock" node --input-type=module -e 'import { configure } from "./scripts/worktree/configure.mjs"; await configure();'

infra-start: state-directory
	@flock "$(WORKTREE_STATE)/registry.lock" node --input-type=module -e 'import { startInfra } from "./scripts/worktree/infra.mjs"; import { identity } from "./scripts/worktree/state.mjs"; await startInfra(identity());'

infra-stop: state-directory
	@flock "$(WORKTREE_STATE)/registry.lock" node --input-type=module -e 'import { stopInfra } from "./scripts/worktree/infra.mjs"; import { identity } from "./scripts/worktree/state.mjs"; stopInfra(identity());'

dev: state-directory
	@id="$$(node --input-type=module -e 'import { identity } from "./scripts/worktree/state.mjs"; console.log(identity().id);')" && \
	flock --no-fork --nonblock --conflict-exit-code 73 "$(WORKTREE_STATE)/$$id.lifetime.lock" node scripts/worktree/development.mjs; \
	result=$$?; if [ $$result -eq 73 ]; then echo 'This worktree already has a managed development process or is stopping.' >&2; fi; exit $$result

stop worktree-clean: state-directory
	@flock "$(WORKTREE_STATE)/registry.lock" $(MAKE) --no-print-directory $@-locked

stop-locked: TEARDOWN = stopInfra
worktree-clean-locked: TEARDOWN = cleanWorktree
stop-locked worktree-clean-locked:
	@node --input-type=module -e 'import { stopDevelopment } from "./scripts/worktree/development.mjs"; import { identity } from "./scripts/worktree/state.mjs"; await stopDevelopment(identity());'
	@id="$$(node --input-type=module -e 'import { identity } from "./scripts/worktree/state.mjs"; console.log(identity().id);')" && \
	flock --nonblock "$(WORKTREE_STATE)/$$id.lifetime.lock" node --input-type=module -e 'import { $(TEARDOWN) } from "./scripts/worktree/infra.mjs"; import { identity } from "./scripts/worktree/state.mjs"; $(TEARDOWN)(identity());'
