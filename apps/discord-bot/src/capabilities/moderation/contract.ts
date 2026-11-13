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
/** Exact source and supplied context. Discord evidence is application acquired;
 * linked destinations are never retrieved. Missing evidence has explicit limitations. */
export type HistoryEntry = {
  guildId: string;
  authorId: string;
  messageId: string;
  at: string;
  origin: "automatic" | "manual" | "unknown";
  status: "pending" | "upheld" | "corrected" | "overturned";
  summary: string;
  correction?: string;
  supportingEvidence: unknown[];
};
export type ConversationMessage = {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  timestamp: string;
  text: string;
  roles: string[] | null;
  embeds: unknown[];
  replyReference: unknown;
};
export type AttachmentInput = {
  index: number;
  attachmentId: string | null;
  filename: string | null;
  status: "supplied" | "unavailable";
  reason?: string;
  mediaType?: string;
  bytes?: number;
};
export type Evidence = {
  /** Supplied means sent to provider, not proof of interpretation. */
  attachmentInputs?: AttachmentInput[];
  guildId: string;
  messageId: string;
  version: string;
  authorId: string;
  channelId: string;
  parentId: string | null;
  currentRoles?: string[];
  replyAncestors?: ConversationMessage[];
  nearbyMessages?: ConversationMessage[];
  moderationHistory?: HistoryEntry[];
  historyAvailability?: "available" | "unavailable";
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
  /** Actual root channel when it differs from this version's configuration snapshot. */
  channelId?: string;
  rootId: string;
  threadId: string;
  /** Missing state on older records is unknown, never proof of completeness. */
  state?: "partial" | "complete";
  attachments?: AttachmentCopy[];
};
export type FailureStage =
  | "judgment"
  | "database"
  | "evidence"
  | "report"
  | "translation"
  | "configuration";
export type ServiceHealth = {
  /** Process-local observation window; restart is unknown, never zero historical loss. */
  since: string;
  missedMessages: number;
  failures: Partial<Record<FailureStage, number>>;
  active: FailureStage[];
};
/** Versioned notification workflow. Claims are content-free and durable: failed or
 * interrupted claims are not replayed. Never deletes, bans, or changes member roles.
 * Exact creations/edits share one report; uncertain delivery blocks updates.
 * Actionable attachments are copied privately; Supported original image/PDF contents are supplied transiently. No missed-event replay. */
export class Intake extends Context.Service<
  Intake,
  {
    status: (guildId: string) => Effect.Effect<ServiceHealth>;
    /** Shared service failure path. No source/member/content parameters. Translation
     * callers use missed=false: failed audit translation cannot invalidate judgment. */
    reportFailure: (
      guildId: string,
      channelId: string | null,
      stage: FailureStage,
      missed?: boolean,
    ) => Effect.Effect<void>;
    recover: (guildId: string, stage: FailureStage) => Effect.Effect<void>;
    receive: (
      evidence: Evidence,
    ) => Effect.Effect<"exempt" | "duplicate" | "none" | "reported" | "failed">;
  }
>()("hero-bot/Intake") {}
