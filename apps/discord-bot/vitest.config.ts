import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const { coverageExcludes } = createRequire(import.meta.url)(
  "./tooling/production-policy.cjs",
);

const environmentFile = new URL(".env", import.meta.url);
if (!process.env.CI && existsSync(environmentFile)) {
  const { HERO_TEST_DATABASE_URL } = parseEnv(
    readFileSync(environmentFile, "utf8"),
  );
  if (HERO_TEST_DATABASE_URL !== undefined)
    process.env.HERO_TEST_DATABASE_URL = HERO_TEST_DATABASE_URL;
}

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
