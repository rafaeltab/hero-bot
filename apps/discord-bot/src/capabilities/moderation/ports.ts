import { Context, type Effect } from "effect";
import type {
  Configuration,
  Delivery,
  Evidence,
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
export class Reports extends Context.Service<
  Reports,
  {
    publish: (
      record: RecordEntry,
      update?: ReportUpdate,
    ) => Effect.Effect<Delivery, ModerationUnavailable>;
    notify: (
      guildId: string,
      channelId: string | null,
    ) => Effect.Effect<void, ModerationUnavailable>;
  }
>()("hero-bot/Reports") {}
