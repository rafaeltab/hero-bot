import { Context, Data, type Effect } from "effect";

/** Sanitized failure: SDK causes and credentials are deliberately not retained. */
export class DiscordUnavailable extends Data.TaggedError("DiscordUnavailable")<{
  readonly reason: "configuration" | "connection" | "identity";
}> {
  override get message() {
    return `Development Discord unavailable (${this.reason})`;
  }
}

/** Development-only connection; no commands, message content or moderation. */
export class DiscordConnection extends Context.Service<
  DiscordConnection,
  {
    /** Acquires a scoped connection, verifies READY identity/server, then runs until
     * interrupted. Failure and interruption both wait for resource cleanup.
     * Connection failure includes failure to receive READY within the startup bound.
     */
    readonly run: Effect.Effect<never, DiscordUnavailable>;
  }
>()("hero-bot/DiscordConnection") {}
