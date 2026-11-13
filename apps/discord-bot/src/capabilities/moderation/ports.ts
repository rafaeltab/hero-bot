import { Context, type Effect } from "effect";
import type { Configuration, ModerationUnavailable } from "./contract.ts";

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
