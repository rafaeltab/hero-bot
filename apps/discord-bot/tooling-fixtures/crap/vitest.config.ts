import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tooling-fixtures/crap/representative.test.ts"],
    coverage: {
      provider: "v8",
      include: ["tooling-fixtures/crap/representative.ts"],
      reportsDirectory: "coverage-crap-fixtures",
      reporter: ["json"],
    },
  },
});
