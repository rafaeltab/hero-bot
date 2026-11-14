import { Context, type Effect } from "effect";
import type {
  InvocationAttempt,
  TextGenerationUnavailable,
} from "../text-generation/contract.ts";

/** USD millionths; operator prices are estimates, never a provider invoice. UTC days. */
export type BudgetPolicy = {
  version: string;
  pricing: string;
  model: string;
  guildMicroUsd: Record<string, number>;
  sharedMicroUsd: number;
  inputMicroUsdPerMillion: number;
  outputMicroUsdPerMillion: number;
  /** Provider model's maximum billable input; includes images/files and overhead. */
  maxInputTokens: number;
  maxOutputTokens: number;
};
export type BudgetTotals = {
  reportedMicroUsd: number;
  heldMicroUsd: number;
  unknownAttempts: number;
};
export type BudgetStatus = {
  day: string;
  timezone: "UTC";
  reason: "guild" | "shared" | "unconfigured" | "available";
  guild: BudgetTotals;
  shared: BudgetTotals;
  policy: BudgetPolicy;
};
export type AttemptUsage = InvocationAttempt & {
  outcome: "succeeded" | "failed" | "interrupted";
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
};
/** Durable pre-call holds. Unknown/interrupted attempts never release capacity.
 * Settlement uses reservation-day prices even after midnight/config changes.
 * No content, source identities or credentials belong in this ledger. */
export class AiBudget extends Context.Service<
  AiBudget,
  {
    reserve: (
      attempt: InvocationAttempt,
    ) => Effect.Effect<void, TextGenerationUnavailable>;
    settle: (
      usage: AttemptUsage,
    ) => Effect.Effect<void, TextGenerationUnavailable>;
    status: (
      guild: string,
    ) => Effect.Effect<BudgetStatus, TextGenerationUnavailable>;
  }
>()("hero-bot/AiBudget") {}
