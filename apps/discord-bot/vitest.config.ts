import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      autoAttachSubprocess: true,
      include: ["src/**/*.ts", "dist/**/*.js"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text", "json", "json-summary", "lcov"],
      clean: true,
      thresholds: { statements: 90, branches: 90 },
    },
  },
});
