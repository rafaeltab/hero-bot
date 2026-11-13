.PHONY: install infra-start infra-stop stop worktree-clean
install:
	node scripts/worktree/toolchain.mjs
	pnpm install --frozen-lockfile
	node scripts/worktree/postinstall.mjs

infra-start infra-stop stop worktree-clean:
	node scripts/worktree/cli.mjs $@
