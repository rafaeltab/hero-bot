import { existsSync } from "node:fs";
// CI keeps its explicitly provisioned service. Local inherited URLs and edited
// generated files cannot redirect tests away from the allocated database.
export async function loadTestEnvironment() {
  if (process.env.CI) return;
  if (!existsSync(new URL("../../.env.worktree.json", import.meta.url))) return;
  const { databaseUrl, identity } = await import("./state.mjs");
  process.env.HERO_TEST_DATABASE_URL = databaseUrl(identity());
}
