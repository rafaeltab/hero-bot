import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runMutation } from "./execution.mjs";
import { planChanges, shardPlan } from "./planning.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    workspace: { type: "string", default: process.cwd() },
    plan: { type: "boolean", default: false },
    selection: { type: "string", default: "full-suite" },
    incremental: { type: "boolean", default: false },
    shard: { type: "string" },
  },
});
if (!values.base)
  throw new Error(
    "--base <commit/ref> is required; no implicit comparison base",
  );
if (!["full-suite", "per-test"].includes(values.selection))
  throw new Error("Unknown test selection");
if (values.incremental && values.selection !== "per-test")
  throw new Error(
    "Cache reuse requires per-test test-file tracking; full-suite always runs fresh",
  );
const root = resolve(values.workspace);
const plan = shardPlan(planChanges(root, values.base, values), values.shard);
if (values.plan) console.log(JSON.stringify(plan));
else await runMutation(root, plan);
