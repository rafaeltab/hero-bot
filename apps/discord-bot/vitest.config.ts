import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { loadTestEnvironment } from "../../scripts/worktree/test-environment.mjs";

const { coverageExcludes } = createRequire(import.meta.url)(
  "./tooling/production-policy.cjs",
);

await loadTestEnvironment();

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      autoAttachSubprocess: true,
      include: ["src/**/*.ts", "dist/**/*.js"],
      excludeAfterRemap: true,
      exclude: coverageExcludes,
      reporter: ["text", "json", "json-summary", "lcov"],
      clean: true,
      thresholds: { statements: 90, branches: 90 },
    },
  },
});
