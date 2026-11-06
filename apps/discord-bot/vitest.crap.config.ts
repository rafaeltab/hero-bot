import { defineConfig } from "vitest/config";
import baseline from "./vitest.config.ts";

// The baseline report still enforces 90/90 and collects subprocess execution.
// This second report keeps source function coordinates free of compiled overlays.
export default defineConfig({
  test: {
    ...baseline.test,
    coverage: {
      ...baseline.test?.coverage,
      autoAttachSubprocess: false,
      include: ["src/**/*.ts"],
      reportsDirectory: "coverage-crap",
      thresholds: {},
      reporter: ["json"],
    },
  },
});
