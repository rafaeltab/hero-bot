import { Config, Effect } from "effect";
import type { BudgetPolicy } from "../capabilities/ai-budget/contract.ts";
import { TextGenerationUnavailable } from "../capabilities/text-generation/contract.ts";

const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
export const validateBudgetPolicy = (value: BudgetPolicy): BudgetPolicy => {
  if (
    !value?.version?.trim() ||
    !value.pricing?.trim() ||
    value.model !== "gpt-6-luna" ||
    ![
      value.sharedMicroUsd,
      value.inputMicroUsdPerMillion,
      value.outputMicroUsdPerMillion,
      value.maxInputTokens,
      value.maxOutputTokens,
    ].every(positive) ||
    !value.guildMicroUsd ||
    Object.entries(value.guildMicroUsd).length === 0 ||
    !Object.entries(value.guildMicroUsd).every(
      ([key, limit]) => /^[1-9]\d*$/.test(key) && positive(limit),
    ) ||
    !Number.isSafeInteger(reservationCost(value))
  )
    throw new Error("budget configuration");
  return value;
};
export const tokenCost = (p: BudgetPolicy, input: number, output: number) =>
  Number(
    (BigInt(input) * BigInt(p.inputMicroUsdPerMillion) +
      BigInt(output) * BigInt(p.outputMicroUsdPerMillion) +
      999999n) /
      1000000n,
  );
export const reservationCost = (p: BudgetPolicy) =>
  tokenCost(p, p.maxInputTokens, p.maxOutputTokens);
export const budgetSettings = Config.String("HERO_AI_BUDGET_JSON").pipe(
  Effect.flatMap((raw) =>
    Effect.try({
      try: () => validateBudgetPolicy(JSON.parse(raw)),
      catch: () =>
        new TextGenerationUnavailable({
          operation: "configuration",
          guidance:
            "Set HERO_AI_BUDGET_JSON: see docs/moderation-intake.md daily AI budgets.",
        }),
    }),
  ),
  Effect.mapError(
    () =>
      new TextGenerationUnavailable({
        operation: "configuration",
        guidance:
          "Set valid HERO_AI_BUDGET_JSON: see docs/moderation-intake.md daily AI budgets.",
      }),
  ),
);
