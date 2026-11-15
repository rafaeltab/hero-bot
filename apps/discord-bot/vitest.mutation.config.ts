import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

// Mixed unit/database files remain in integration until their tests are split.
const integration = [
  "acquisition-notices",
  "ai-budget",
  "attachment-workflow",
  "intake",
  "intake-persistence",
  "intake-versions",
  "moderation",
  "moderation-persistence",
  "postgres",
].map((name) => `test/${name}.test.ts`);
const deferred = [
  "test/process.test.ts", // Restore with child coverage in issue #44.
  "test/intake-process.test.ts", // Restore with child coverage in issue #44.
  "test/evaluation.test.ts", // Evaluation CLI is outside mutation execution.
];
const stage = process.env.HERO_MUTATION_STAGE;
if (stage !== "unit" && stage !== "integration")
  throw Error("HERO_MUTATION_STAGE must be unit or integration");

// Override arrays explicitly: mergeConfig concatenates includes and would run
// the entire baseline suite again during the integration stage.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: stage === "integration" ? integration : ["test/**/*.test.ts"],
    exclude: stage === "unit" ? [...deferred, ...integration] : deferred,
    coverage: { ...base.test?.coverage, enabled: false },
  },
});
