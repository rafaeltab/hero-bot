export const budgetPolicy = {
  version: "qa-1",
  pricing: "controlled-not-live",
  model: "gpt-6-luna",
  guildMicroUsd: { "10": 100, "20": 100 },
  sharedMicroUsd: 150,
  inputMicroUsdPerMillion: 1000000,
  outputMicroUsdPerMillion: 2000000,
  maxInputTokens: 40,
  maxOutputTokens: 10,
};
