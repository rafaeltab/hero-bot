import { Config, Effect, Layer } from "effect";
import { StatusUnavailable } from "../capabilities/runtime-status/contract.ts";
import { EnvironmentSource } from "../capabilities/runtime-status/ports.ts";

export const EnvironmentFromConfig = Layer.succeed(EnvironmentSource, {
  read: Config.Literals(["development", "production"], "HERO_ENV").pipe(
    Effect.mapError(() => new StatusUnavailable()),
  ),
});
