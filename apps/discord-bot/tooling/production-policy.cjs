// Kept inside the application so isolated mutation sandboxes use the same policy.
const applicationRoot = "apps/discord-bot";
const sourceRoot = `${applicationRoot}/src`;
const excludedSourceDirectories = [
  "generated",
  "__generated__",
  "test",
  "__tests__",
];
const coverageExcludes = [
  "src/**/*.d.ts",
  ...excludedSourceDirectories.map((name) => `src/**/${name}/**`),
  "src/**/*.test.ts",
  "src/**/*.spec.ts",
];
module.exports = {
  applicationRoot,
  sourceRoot,
  excludedSourceDirectories,
  coverageExcludes,
};
