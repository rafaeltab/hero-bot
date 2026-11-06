const { readdirSync } = require("node:fs");
const {
  createArchitectureConfig,
} = require("./scripts/architecture-rules.cjs");
const root = "apps/discord-bot/src";
const capabilities = readdirSync(`${root}/capabilities`, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
module.exports = createArchitectureConfig(root, capabilities);
