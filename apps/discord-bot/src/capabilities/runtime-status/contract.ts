import { Context, Data, type Effect } from "effect";

/** Environment configuration could not be read or was invalid. No secrets exposed. */
export class StatusUnavailable extends Data.TaggedError("StatusUnavailable")<
  Record<never, never>
> {}

/** Read-only runtime description. Does not start resources or connect to Discord. */
export class RuntimeStatus extends Context.Service<
  RuntimeStatus,
  {
    /** Reads current configuration; construction dependencies are captured by its Layer. */
    readonly describe: Effect.Effect<string, StatusUnavailable>;
  }
>()("hero-bot/RuntimeStatus") {}
