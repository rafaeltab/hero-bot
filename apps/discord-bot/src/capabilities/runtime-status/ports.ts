import { Context, type Effect } from "effect";
import type { StatusUnavailable } from "./contract.ts";

export type Environment = "development" | "production";

/** Adapter-facing port, not part of the consumer contract. */
export class EnvironmentSource extends Context.Service<
  EnvironmentSource,
  {
    readonly read: Effect.Effect<Environment, StatusUnavailable>;
  }
>()("hero-bot/EnvironmentSource") {}
