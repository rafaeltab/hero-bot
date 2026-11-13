import { Context, type Effect } from "effect";
import type {
  Configuration,
  Delivery,
  Evidence,
  ModerationUnavailable,
  RecordEntry,
  ServiceHealth,
} from "./contract.ts";

export type Access = {
  ownerId: string;
  actorRoles: string[];
  roles: string[];
  channels: { id: string; private: boolean; usable: boolean }[];
  problems: string[];
};
export class GuildAccess extends Context.Service<
  GuildAccess,
  {
    inspect: (
      guildId: string,
      actorId: string,
      roles: Configuration["roles"],
      channelId?: string,
    ) => Effect.Effect<Access, ModerationUnavailable>;
  }
>()("hero-bot/GuildAccess") {}
export class ConfigurationStore extends Context.Service<
  ConfigurationStore,
  {
    history: (
      guildId: string,
    ) => Effect.Effect<Configuration[], ModerationUnavailable>;
    /** Atomically append an attributed version, rejecting stale expected versions. */
    save: (
      configuration: Configuration,
    ) => Effect.Effect<number, ModerationUnavailable>;
  }
>()("hero-bot/ConfigurationStore") {}

export type VersionProgress = { version: string; state: string };
export type ReportUpdate = {
  auditChannel?: string | null;
  delivery: Delivery | null;
  latest: RecordEntry;
  observedVersion: string;
};
export class IntakeStore extends Context.Service<
  IntakeStore,
  {
    /** Serialize preservation and report updates per source across processes; never holds AI calls. */
    serialize: <A, E, R>(
      e: Evidence,
      task: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ModerationUnavailable, R>;
    progress: (
      e: Evidence,
    ) => Effect.Effect<VersionProgress[], ModerationUnavailable>;
    assessed: (e: Evidence) => Effect.Effect<void, ModerationUnavailable>;
    delivering: (e: Evidence) => Effect.Effect<void, ModerationUnavailable>;
    claim: (
      e: Pick<Evidence, "guildId" | "messageId" | "version">,
    ) => Effect.Effect<boolean, ModerationUnavailable>;
    save: (record: RecordEntry) => Effect.Effect<void, ModerationUnavailable>;
    delivered: (
      e: Evidence,
      delivery: Delivery,
    ) => Effect.Effect<void, ModerationUnavailable>;
    read: (
      guildId: string,
      messageId: string,
    ) => Effect.Effect<
      { record: RecordEntry; delivery: Delivery | null }[],
      ModerationUnavailable
    >;
  }
>()("hero-bot/IntakeStore") {}
/** A judgment-scoped cached, bounded acquisition shared by AI selection and copying.
 * Bytes are transient and must never enter RecordEntry or PostgreSQL. */
export type AttachmentSession = {
  acquire: (url: string, size: number) => Promise<Uint8Array>;
};
export class Reports extends Context.Service<
  Reports,
  {
    /** Construct exactly one shared session before judgment; no network until acquire.
     * Absent on text-only adapters: attachment contents are explicitly unavailable. */
    attachments?: () => AttachmentSession;
    /** Recheck copied-message identities, never source URLs; persist the returned snapshot. */
    refresh: (
      delivery: Delivery,
    ) => Effect.Effect<Delivery, ModerationUnavailable>;
    publish: (
      record: RecordEntry,
      checkpoint?: (
        delivery: Delivery,
      ) => Effect.Effect<void, ModerationUnavailable>,
      acquisition?: AttachmentSession,
      update?: ReportUpdate,
    ) => Effect.Effect<Delivery, ModerationUnavailable>;
    notify: (
      guildId: string,
      channelId: string | null,
      health?: ServiceHealth,
    ) => Effect.Effect<void, ModerationUnavailable>;
  }
>()("hero-bot/Reports") {}
