import { Context, Data, type Effect } from "effect";

export class PersistenceUnavailable extends Data.TaggedError(
  "PersistenceUnavailable",
)<{
  readonly operation: "configuration" | "connect" | "query";
}> {}

/** Infrastructure verification only; no application persistence schema is implied. */
export class PersistenceProbe extends Context.Service<
  PersistenceProbe,
  {
    /** Parameterized PostgreSQL integer round trip; use only within the Layer's scope. */
    readonly roundTrip: (
      value: number,
    ) => Effect.Effect<number, PersistenceUnavailable>;
  }
>()("hero-bot/PersistenceProbe") {}
