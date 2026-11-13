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

export type Judgment = {
  action: "none" | "delete" | "review-hold" | "ban";
  reason: string;
  offendingUrls: string[];
};
/** Complete original gateway evidence; embeds and attributed quotes remain unmodified.
 * Linked destinations are never retrieved; original attachments may be privately copied. */
export type Evidence = {
  guildId: string;
  messageId: string;
  version: string;
  authorId: string;
  channelId: string;
  parentId: string | null;
  currentRoles?: string[];
  channelContext?: { type: number; name: string | null };
  replyReference?: unknown;
  text: string;
  embeds: unknown[];
  quotes: unknown[];
  attachments: unknown[];
  roles: string[];
  restriction: string;
  limitations: string[];
};
export type RecordEntry = {
  evidence: Evidence;
  configuration: Configuration;
  judgment: Judgment;
  model: string;
  provider: string;
  assessedAt: string;
  observedRoles?: string[];
  systemPrompt?: string;
};
export type AttachmentCopy = {
  sourceAttachmentId: string | null;
  sourceMessageId: string;
  sourceVersion: string;
  metadata: unknown;
  status:
    | "pending"
    | "available"
    | "unavailable"
    | "oversized"
    | "upload-unknown"
    | "missing";
  copy?: {
    channelId: string;
    messageId: string;
    attachmentId: string;
    filename: string;
    url: string;
    size: number;
  };
  checkedAt?: string;
};
export type Delivery = {
  rootId: string;
  threadId: string;
  /** Missing state on older records is unknown, never proof of completeness. */
  state?: "partial" | "complete";
  attachments?: AttachmentCopy[];
};
/** Creation-only notification workflow. Claims are content-free and durable: failed or
 * interrupted claims are not replayed. Never deletes, bans, or changes member roles.
 * Actionable attachments are copied privately; AI attachment contents and retry/recovery remain unavailable. */
export class Intake extends Context.Service<
  Intake,
  {
    receive: (
      evidence: Evidence,
    ) => Effect.Effect<"exempt" | "duplicate" | "none" | "reported" | "failed">;
  }
>()("hero-bot/Intake") {}
