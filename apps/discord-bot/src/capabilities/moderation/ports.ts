import { Context, type Effect } from "effect";
import type {
  Configuration,
  Delivery,
  Evidence,
  HistoryEntry,
  ModerationUnavailable,
  RecordEntry,
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

export class IntakeStore extends Context.Service<
  IntakeStore,
  {
    /** Current finding snapshots, resolved before applying any bound. */
    memberHistory?: (
      guildId: string,
      authorId: string,
    ) => Effect.Effect<HistoryEntry[], ModerationUnavailable>;
    /** Replace a finding's current outcome without altering retained original evidence. */
    correctHistory?: (
      entry: HistoryEntry,
    ) => Effect.Effect<void, ModerationUnavailable>;
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
export class Reports extends Context.Service<
  Reports,
  {
    publish: (
      record: RecordEntry,
    ) => Effect.Effect<Delivery, ModerationUnavailable>;
    notify: (
      guildId: string,
      channelId: string | null,
    ) => Effect.Effect<void, ModerationUnavailable>;
  }
>()("hero-bot/Reports") {}

/** Application-controlled evidence acquisition; runs only after exemption and claim. */
export class EvidenceContext extends Context.Service<
  EvidenceContext,
  {
    acquire: (
      evidence: Evidence,
    ) => Effect.Effect<Evidence, ModerationUnavailable>;
  }
>()("hero-bot/EvidenceContext") {}
