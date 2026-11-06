// Each graph is checked by the same rule factory as production, with real TS imports.
const contract = "export type Status = string;";
const implementation = 'export const live = "ready";';
const base = {
  "capabilities/status/contract.ts": contract,
  "capabilities/status/ports.ts": "export type Source = string;",
  "capabilities/status/implementation.ts": implementation,
};
export const fixtures = [
  {
    name: "permitted-layer-wiring",
    files: {
      ...base,
      "capabilities/status/contract.ts":
        'import { Context } from "effect"; export class Status extends Context.Service<Status, { readonly value: string }>()("Status") {}',
      "capabilities/status/ports.ts":
        'import { Context } from "effect"; export class Source extends Context.Service<Source, { readonly value: string }>()("Source") {}',
      "capabilities/status/implementation.ts":
        'import { Effect, Layer } from "effect"; import { Status } from "./contract.ts"; import { Source } from "./ports.ts"; export const live = Layer.effect(Status, Effect.gen(function* () { const source = yield* Source; return { value: source.value }; }));',
      "application.ts":
        'import { Layer } from "effect"; import { live } from "./capabilities/status/implementation.ts"; import { source } from "./adapters/source.ts"; export const wired = live.pipe(Layer.provide(source));',
      "adapters/source.ts":
        'import { Layer } from "effect"; import { Source } from "../capabilities/status/ports.ts"; export { DiscordConfig } from "dfx"; export const source = Layer.succeed(Source, { value: "ready" });',
      "capabilities/consumer/implementation.ts":
        'import type { Status } from "../status/contract.ts"; export type Result = Status;',
      "main.ts":
        'import { NodeRuntime } from "@effect/platform-node"; export { NodeRuntime };',
    },
    rules: [],
  },
  {
    name: "contract-imports-implementation",
    files: {
      ...base,
      "capabilities/status/contract.ts":
        'export { live } from "./implementation.ts";',
    },
    rules: ["contracts-stay-public"],
  },
  {
    name: "cross-capability-type-import",
    files: {
      ...base,
      "capabilities/consumer/implementation.ts":
        'import type { live } from "../status/implementation.ts"; export type Result = typeof live;',
    },
    rules: ["private-status"],
  },
  {
    name: "cross-capability-port-import",
    files: {
      ...base,
      "capabilities/consumer/implementation.ts":
        'export type { Source } from "../status/ports.ts";',
    },
    rules: ["private-status"],
  },
  {
    name: "sdk-in-capability",
    files: {
      ...base,
      "capabilities/status/implementation.ts":
        'export { DiscordConfig } from "dfx";',
    },
    rules: ["sdk-only-in-adapters"],
  },
  {
    name: "sdk-subpath-in-contract",
    files: {
      ...base,
      "capabilities/status/contract.ts": 'export * from "dfx/DiscordConfig";',
    },
    rules: ["sdk-only-in-adapters"],
  },
  {
    name: "composition-does-not-exempt-sdk",
    files: {
      ...base,
      "application.ts": 'export { DiscordConfig } from "dfx";',
    },
    rules: ["sdk-only-in-adapters"],
  },
  {
    name: "non-root-private-import",
    files: {
      ...base,
      "helper.ts":
        'export { live } from "./capabilities/status/implementation.ts";',
    },
    rules: ["private-status"],
  },
  {
    name: "capability-imports-adapter",
    files: {
      ...base,
      "adapters/source.ts": "export const source = 1;",
      "capabilities/status/implementation.ts":
        'export { source } from "../../adapters/source.ts";',
    },
    rules: ["adapters-only-at-composition"],
  },
  {
    name: "adapter-imports-private-implementation",
    files: {
      ...base,
      "adapters/source.ts":
        'export { live } from "../capabilities/status/implementation.ts";',
    },
    rules: ["adapters-cannot-import-implementations"],
  },
  {
    name: "platform-in-capability",
    files: {
      ...base,
      "capabilities/status/implementation.ts":
        'export { NodeRuntime } from "@effect/platform-node";',
    },
    rules: ["platform-only-in-adapters-or-entry"],
  },
  {
    name: "unresolved-import",
    files: { ...base, "application.ts": 'export * from "./missing.ts";' },
    rules: ["no-unresolved"],
  },
];
