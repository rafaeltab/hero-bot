import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";
import tests from "./scripts/test-lint/plugin.mjs";

export default [
  {
    files: ["apps/*/test/**/*.ts", "scripts/test-lint/fixtures/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    settings: { vitest: { vitestImports: ["@effect/vitest"] } },
    plugins: { vitest, tests },
    rules: {
      "tests/no-async-assertion-in-sync": "error",
      "tests/no-conditional-assertions": "error",
      "vitest/require-awaited-expect-poll": "error",
      "tests/no-generator-poll-return": "error",
      "vitest/valid-expect": ["error", { alwaysAwait: true }],
      "tests/no-duplicate-titles": "error",
      "tests/no-skipped-tests": "error",
      "tests/no-focused-tests": "error",
    },
  },
];
