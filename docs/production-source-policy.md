# Production-source eligibility

`apps/discord-bot/tooling/production-policy.cjs` defines eligibility once, inside
the application so isolated mutation sandboxes retain it. Vitest loads its globs;
`scripts/production-policy.mjs` supplies inventory/runtime detection to coverage
and mutation planning using those same definitions.

- Production is hand-written runtime TypeScript under `apps/discord-bot/src`.
- Exclude `.d.ts`, `*.test.ts`, `*.spec.ts` and the explicitly designated
  `generated`, `__generated__`, `test`, and `__tests__` directories at any depth.
  Generated output belongs only in those generated directories. Moving runtime
  code there merely to evade checks violates this policy.
- Unimported runtime source remains included. New runtime extensions and source
  symlinks fail inventory/planning rather than silently escaping checks.
- Type-only `.ts` modules are identified with the pinned TypeScript emitter:
  after comments and empty module markers are removed, they emit no runtime code.
  Vitest/summary inventory retains their zero-sized entries for completeness;
  CRAP and mutation planning omit them because they have no runtime functions or
  mutations. Runtime Context keys and classes are not type-only.
- The baseline additionally collects compiled `dist` subprocess execution and
  remaps it to source before applying the same exclusions. The CRAP source-only
  report avoids conflicting compiled/source function coordinates.

The policy fixtures verify both real Vitest configurations use the shared glob
list, inventory includes an unimported source, and mutation CLI planning excludes
the same test/generated/type-only inputs. No existing production coverage threshold
is weakened: 90% statements, 90% branches, CRAP <=30 and fresh complete evidence remain
required. Future production extensions require deliberate policy and fixture updates.
