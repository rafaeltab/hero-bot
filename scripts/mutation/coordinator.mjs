import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectFingerprint } from "./cache.mjs";
import { aggregate, atomic, resolved } from "./checkpoint.mjs";

const worker = fileURLToPath(new URL("./execution.mjs", import.meta.url));
export async function executeStage(options, remainingMS, workerPath = worker) {
  const optionPath = resolve(options.directory, "options.json");
  atomic(optionPath, options);
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      cwd: options.root,
      detached: true,
      stdio: "inherit",
      env: { ...process.env, HERO_MUTATION_OPTIONS: optionPath },
    });
    let timedOut = false;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, remainingMS);
    const abort = () => {
      kill();
      process.exitCode = 130;
    };
    process.once("SIGTERM", abort);
    process.once("SIGINT", abort);
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener("SIGTERM", abort);
      process.removeListener("SIGINT", abort);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      accept({ code, signal, timedOut });
    });
  });
}

export async function runStages(
  root,
  plan,
  { budget, fresh = false, dryRun = false },
  execute = executeStage,
) {
  const started = Date.now();
  const directory = resolve(root, "apps/discord-bot/reports/mutation");
  mkdirSync(directory, { recursive: true });
  atomic(resolve(directory, "plan.json"), {
    ...plan,
    fingerprint: projectFingerprint(root),
  });
  const summaryPath = resolve(directory, "summary.json");
  rmSync(summaryPath, { force: true });
  for (const name of ["mutation.json", "index.html", "completed.json"])
    rmSync(resolve(directory, name), { force: true });
  for (const stage of ["unit", "integration"]) {
    const target = resolve(directory, stage);
    mkdirSync(target, { recursive: true });
    for (const name of [
      "progress.json",
      "mutation.json",
      "index.html",
      "options.json",
    ])
      rmSync(resolve(target, name), { force: true });
  }
  const stages = {};
  let error;
  for (const stage of ["unit", "integration"]) {
    const target = resolve(directory, stage);
    mkdirSync(target, { recursive: true });
    // A cancelled worker must never leave yesterday's report as today's evidence.
    for (const name of ["progress.json", "mutation.json", "index.html"])
      rmSync(resolve(target, name), { force: true });
    if (!plan.mutate.length) continue;
    const gate =
      stage === "integration"
        ? stages.unit?.mutants
            .filter((m) => ["Survived", "NoCoverage"].includes(m.status))
            .map((m) => m.key)
        : undefined;
    if (stage === "integration") {
      if (
        !stages.unit?.planned ||
        stages.unit.mutants.some((m) => !resolved(m.status))
      )
        break;
      if (gate.length === 0) {
        stages.integration = { planned: true, mutants: [] };
        break;
      }
    }
    const remainingMS = budget * 1000 - (Date.now() - started);
    if (remainingMS <= 0 || process.exitCode === 130) break;
    const result = await execute(
      {
        root,
        stage,
        mutate: plan.mutate,
        gate,
        reuse: !fresh,
        dryRun,
        directory: target,
        progress: resolve(target, "progress.json"),
        checkpoint: resolve(directory, `checkpoint-${stage}.json`),
      },
      remainingMS,
    );
    const progress = resolve(target, "progress.json");
    stages[stage] = existsSync(progress)
      ? JSON.parse(readFileSync(progress, "utf8"))
      : { planned: false, mutants: [] };
    if (stages[stage].error || (!result.timedOut && result.code !== 0)) {
      error =
        stages[stage].error ??
        `${stage} runner failed (${result.code ?? result.signal})`;
      break;
    }
    if (!result.timedOut && !dryRun && !stages[stage].planned) {
      error = `${stage} runner returned without a mutation inventory`;
      break;
    }
    if (result.timedOut || dryRun) break;
  }
  rmSync(resolve(root, ".stryker-tmp"), { recursive: true, force: true });
  const summary = {
    ...aggregate(stages.unit?.mutants ?? [], stages.integration?.mutants ?? []),
    inventoryComplete: !plan.mutate.length || Boolean(stages.unit?.planned),
    scope: plan.scope,
    base: plan.base,
    budgetSeconds: budget,
    elapsedSeconds: (Date.now() - started) / 1000,
    deferredTests: [
      "process.test.ts",
      "intake-process.test.ts",
      "evaluation.test.ts",
    ],
    stages: Object.fromEntries(
      Object.entries(stages).map(([name, result]) => [
        name,
        {
          planned: Boolean(result.planned),
          tests: result.tests,
          reused: result.reused ?? 0,
          executed: result.executed ?? 0,
          startupSeconds: result.startupSeconds,
          mutants: result.mutants.length,
        },
      ]),
    ),
    ...(error && { error }),
  };
  if (dryRun || (plan.mutate.length && (!stages.unit?.planned || error)))
    summary.complete = false;
  summary.outcome = error
    ? "error"
    : dryRun
      ? "dry-run"
      : summary.complete
        ? "complete"
        : "incomplete";
  atomic(summaryPath, summary);
  const text = `## Advisory mutations: ${summary.outcome}\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\nIncomplete work has no aggregate score. Deferred process coverage: issue #44.\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  if (error) process.exitCode = 1;
  return summary;
}
