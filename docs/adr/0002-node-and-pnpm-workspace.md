# Use Node.js LTS and pnpm in a TypeScript Turborepo

Use TypeScript, pnpm, and Turborepo, with the first application at `apps/discord-bot`. Run the application on Node.js LTS and pin tool versions for development and GitHub Actions. The application is a persistent process intended for modest message volume and eventual operation by someone other than the initial developer; no hosting provider is selected.

Node is preferred over Bun for the agreed Vitest and coverage toolchain and a consistent operational baseline. Runtime speed has not been benchmarked and is not the deciding factor. Bun's runtime, package manager, and test runner were considered as separate choices; none is required for this foundation.

Development uses a separate Discord test server, application, bot identity, and credentials from production. This separation permits independent development permissions and credential management.
