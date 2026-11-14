import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { atomic, readCheckpoint, reusable } from "./checkpoint.mjs";
import { evidence, identity } from "./evidence.mjs";

export class CheckpointReporter {
  constructor() {
    this.options = JSON.parse(
      readFileSync(process.env.HERO_MUTATION_OPTIONS, "utf8"),
    );
    this.checkpoint = readCheckpoint(this.options.checkpoint);
    this.hash = evidence(this.options.root, this.options.stage);
    this.results = new Map();
    this.reused = 0;
    this.executed = 0;
    this.runIds = new Set();
    this.started = performance.now();
  }
  onDryRunCompleted({ result }) {
    this.tests = result.tests.length;
    this.startupSeconds = (performance.now() - this.started) / 1000;
    this.save();
  }
  save() {
    atomic(this.options.checkpoint, this.checkpoint);
    atomic(this.options.progress, {
      planned: this.planned,
      tests: this.tests,
      reused: this.reused,
      executed: this.executed,
      startupSeconds: this.startupSeconds,
      error: this.error,
      mutants: [...this.results.values()],
    });
  }
  onMutationTestingPlanReady({ mutantPlans }) {
    try {
      this.planned = true;
      const gate = this.options.gate && new Set(this.options.gate);
      for (const plan of mutantPlans) {
        if (!["Run", "EarlyResult"].includes(plan.plan))
          throw Error("Unsupported Stryker plan");
        const m = plan.mutant;
        const portable = {
          file: relative(
            resolve(this.options.root, "apps/discord-bot"),
            m.fileName,
          ),
          location: m.location,
          mutatorName: m.mutatorName,
          replacement: m.replacement,
        };
        const key = identity(portable);
        const fingerprint = this.hash(
          { ...portable, static: m.static },
          plan.runOptions?.testFilter,
        );
        const entry = { ...portable, key, fingerprint, status: "Pending" };
        this.results.set(String(m.id), entry);
        let status;
        let reason;
        if (gate && !gate.has(key)) {
          status = "Ignored";
          reason = "Already resolved by unit stage";
        } else if (this.options.reuse) {
          const cached = this.checkpoint.entries[key];
          if (cached?.fingerprint === fingerprint && reusable(cached.status)) {
            status = cached.status;
            reason = "Validated checkpoint reuse";
            this.reused++;
          }
        }
        if (status) {
          plan.plan = "EarlyResult";
          plan.mutant = { ...m, status, statusReason: reason };
        }
        if (plan.plan === "Run" && plan.runOptions.testFilter?.length !== 0)
          this.runIds.add(String(m.id));
      }
      this.save();
    } catch (error) {
      // Stryker swallows reporter errors. Stop all execution and surface the
      // diagnostic to the parent instead of accidentally running ungated.
      mutantPlans.splice(0);
      this.error = error.message;
      this.save();
    }
  }
  onMutantTested(mutant) {
    const entry = this.results.get(String(mutant.id));
    if (!entry) return;
    entry.status = mutant.status;
    entry.statusReason = mutant.statusReason;
    if (this.runIds.has(String(mutant.id))) this.executed++;
    if (reusable(entry.status)) this.checkpoint.entries[entry.key] = entry;
    // Batch snapshots so N fast mutants do not cause N full-report writes.
    this.flush ??= setTimeout(() => {
      this.flush = undefined;
      this.save();
    }, 250);
  }
  wrapUp() {
    clearTimeout(this.flush);
    this.flush = undefined;
    this.save();
  }
}
export const strykerPlugins = [
  { kind: "Reporter", name: "checkpoint", injectableClass: CheckpointReporter },
];
