const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Shared by the production CLI and executable import fixtures. */
exports.createArchitectureConfig = (sourceRoot, capabilities) => {
  const root = escapeRegex(sourceRoot);
  const composition = `^${root}/(?:application|main)\\.ts$`;
  const rule = (name, from, to) => ({ name, severity: "error", from, to });
  return {
    forbidden: [
      rule("no-unresolved", {}, { couldNotResolve: true }),
      rule(
        "contracts-stay-public",
        {
          path: `^${root}/capabilities/[^/]+/(?:contract|ports)\\.ts$`,
        },
        {
          path: `^${root}/`,
          pathNot: `^${root}/capabilities/[^/]+/contract\\.ts$`,
        },
      ),
      ...capabilities.map((capability) =>
        rule(
          `private-${capability}`,
          {
            path: `^${root}/`,
            pathNot: [
              composition,
              `^${root}/adapters/`,
              `^${root}/capabilities/${escapeRegex(capability)}/`,
            ],
          },
          {
            path: `^${root}/capabilities/${escapeRegex(capability)}/`,
            pathNot: `^${root}/capabilities/${escapeRegex(capability)}/contract\\.ts$`,
          },
        ),
      ),
      rule(
        "adapters-cannot-import-implementations",
        {
          path: `^${root}/adapters/`,
        },
        {
          path: `^${root}/capabilities/[^/]+/`,
          pathNot: `^${root}/capabilities/[^/]+/(?:contract|ports)\\.ts$`,
        },
      ),
      rule(
        "sdk-only-in-adapters",
        {
          path: `^${root}/`,
          pathNot: `^${root}/adapters/`,
        },
        {
          path: "(^|/)(dfx|discord-api-types|discord\\.js|@discordjs/[^/]+|ai|@ai-sdk/[^/]+|drizzle-orm|drizzle-kit|pg|postgres)(/|$)",
        },
      ),
      rule(
        "platform-only-in-adapters-or-entry",
        {
          path: `^${root}/`,
          pathNot: [`^${root}/adapters/`, `^${root}/main\\.ts$`],
        },
        { path: "(^|/)@effect/platform-node(/|$)" },
      ),
      rule(
        "adapters-only-at-composition",
        {
          path: `^${root}/`,
          pathNot: [composition, `^${root}/adapters/`],
        },
        { path: `^${root}/adapters/` },
      ),
    ],
    options: {
      doNotFollow: { path: "node_modules" },
      tsPreCompilationDeps: true,
      enhancedResolveOptions: {
        exportsFields: ["exports"],
        conditionNames: ["import", "node", "default"],
      },
    },
  };
};
