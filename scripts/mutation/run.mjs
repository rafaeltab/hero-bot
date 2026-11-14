import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runStages } from "./coordinator.mjs";
import { planChanges } from "./planning.mjs";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    workspace: { type: "string", default: process.cwd() },
    plan: { type: "boolean", default: false },
    scope: { type: "string", default: "changed" },
    budget: { type: "string", default: "900" },
    fresh: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.base)
  throw Error("--base <commit/ref> is required; no implicit comparison base");
if (!["changed", "all"].includes(values.scope))
  throw Error("--scope must be changed or all");
const budget = Number(values.budget);
if (!Number.isSafeInteger(budget) || budget < 1 || budget > 7200)
  throw Error("--budget must be an integer from 1 to 7200 seconds");
const root = resolve(values.workspace);
const plan = planChanges(root, values.base, { scope: values.scope });
if (values.plan) console.log(JSON.stringify(plan));
else
  await runStages(root, plan, {
    budget,
    fresh: values.fresh,
    dryRun: values["dry-run"],
  });
