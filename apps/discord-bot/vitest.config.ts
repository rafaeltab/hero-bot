import { createRequire } from "node:module";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

const { coverageExcludes } = createRequire(import.meta.url)(
  "./tooling/production-policy.cjs",
);

if (!process.env.CI)
  config({
    path: new URL(".env", import.meta.url),
    override: true,
    quiet: true,
  });

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
