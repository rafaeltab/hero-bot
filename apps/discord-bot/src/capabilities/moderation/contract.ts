import { Context, Data, type Effect } from "effect";

export type PermissionGroup = "Owner" | "Admin" | "Moderator";
export type Permission = "configure" | "inspect-channel-status";
export type Configuration = {
  guildId: string;
  actorId: string;
  version: number;
  changedAt: string;
  roles: Record<PermissionGroup, string[]>;
  auditChannel: string | null;
  reportingChannel: string | null;
  prompt: string;
};
export type Command =
  | { kind: "show" | "history" }
  | { kind: "prompt"; value: string }
  | { kind: "role"; group: PermissionGroup; roleId: string; remove: boolean }
  | {
      kind: "channel";
      purpose: "auditChannel" | "reportingChannel";
      channelId: string;
    }
  | { kind: "status"; channelId: string }
  | { kind: "actions"; enabled: boolean };
export type Request = { guildId: string; actorId: string; command: Command };
/** Sanitized boundary failure; never includes raw transport/database diagnostics. */
export class ModerationUnavailable extends Data.TaggedError(
  "ModerationUnavailable",
)<{
  reason: "database" | "discord" | "configuration" | "identity";
}> {}
/** Private configuration workflow. Fetches current authority on every submission.
 * No message intake, judgment, replay or punishment is performed.
 * Errors are sanitized; validation/permission failures are private response text.
 */
export class Moderation extends Context.Service<
  Moderation,
  {
    execute: (request: Request) => Effect.Effect<string, ModerationUnavailable>;
  }
>()("hero-bot/Moderation") {}
