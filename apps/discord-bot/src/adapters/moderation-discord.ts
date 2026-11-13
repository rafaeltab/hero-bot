import { DiscordREST } from "dfx";
import { Effect, Layer } from "effect";
import { ModerationUnavailable } from "../capabilities/moderation/contract.ts";
import { GuildAccess } from "../capabilities/moderation/ports.ts";

type Role = { id: string; permissions: string };
type Overwrite = { id: string; type: number; allow: string; deny: string };
const view = 1024n;
const administrator = 8n;
const required =
  view | 2048n | 32768n | 65536n | (1n << 35n) | (1n << 36n) | (1n << 38n);
const base = (
  guildId: string,
  roles: readonly Role[],
  ids: readonly string[],
) =>
  roles
    .filter((r) => r.id === guildId || ids.includes(r.id))
    .reduce((bits, r) => bits | BigInt(r.permissions), 0n);
const effective = (
  guildId: string,
  roles: readonly Role[],
  ids: readonly string[],
  overwrites: readonly Overwrite[],
  memberId: string,
) => {
  let bits = base(guildId, roles, ids);
  if (bits & administrator) return bits | required;
  const everyone = overwrites.find((o) => o.id === guildId && o.type === 0);
  if (everyone) bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  const applicable = overwrites.filter(
    (o) => o.type === 0 && ids.includes(o.id),
  );
  const deny = applicable.reduce((b, o) => b | BigInt(o.deny), 0n);
  const allow = applicable.reduce((b, o) => b | BigInt(o.allow), 0n);
  bits = (bits & ~deny) | allow;
  const member = overwrites.find((o) => o.type === 1 && o.id === memberId);
  return member ? (bits & ~BigInt(member.deny)) | BigInt(member.allow) : bits;
};
/** Conservative privacy proof: ordinary roles and explicit member grants must not
 * see reports. Never mutates overwrites; bot Administrator is rejected.
 */
export const guildAccessLayer = (botId: string) =>
  Layer.effect(
    GuildAccess,
    Effect.gen(function* () {
      const rest = yield* DiscordREST;
      return GuildAccess.of({
        inspect: (guildId, actorId, mappings, channelId) =>
          Effect.gen(function* () {
            const guild = yield* rest.getGuild(guildId);
            const actor = yield* rest.getGuildMember(guildId, actorId);
            const bot = yield* rest.getGuildMember(guildId, botId);
            const roles = yield* rest.listGuildRoles(guildId);
            const channels = [
              ...((yield* rest.listGuildChannels(guildId)) ?? []),
            ];
            if (channelId && !channels.some((c) => c.id === channelId))
              channels.push(yield* rest.getChannel(channelId));
            const botAdmin = Boolean(
              base(guildId, roles, bot.roles) & administrator,
            );
            const permitted = new Set([
              ...Object.values(mappings).flat(),
              ...roles.filter((r) => r.tags?.bot_id === botId).map((r) => r.id),
            ]);
            return {
              ownerId: guild.owner_id,
              actorRoles: [...actor.roles],
              roles: roles.map((r) => r.id),
              problems: botAdmin
                ? [
                    "Remove Administrator from the bot; grant explicit channel permissions.",
                  ]
                : [],
              channels: (channels ?? []).flatMap((c) => {
                if (!("guild_id" in c) || c.guild_id !== guildId) return [];
                const overwrites =
                  "permission_overwrites" in c
                    ? (c.permission_overwrites ?? [])
                    : [];
                const ordinary = roles.filter((r) => !permitted.has(r.id));
                const visible = ordinary.some((r) =>
                  Boolean(
                    effective(guildId, roles, [r.id], overwrites, "") & view,
                  ),
                );
                // An allow to an individual cannot be proven safe without their current roles.
                const memberGrant = overwrites.some(
                  (o) =>
                    o.type === 1 &&
                    o.id !== botId &&
                    o.id !== guild.owner_id &&
                    Boolean(BigInt(o.allow) & view),
                );
                return [
                  {
                    id: c.id,
                    private:
                      "permission_overwrites" in c && !visible && !memberGrant,
                    usable:
                      c.type === 0 &&
                      Object.values(mappings)
                        .flat()
                        .every((id) => {
                          return (
                            (effective(guildId, roles, [id], overwrites, "") &
                              (view | 65536n)) ===
                            (view | 65536n)
                          );
                        }) &&
                      !botAdmin &&
                      (effective(guildId, roles, bot.roles, overwrites, botId) &
                        required) ===
                        required,
                  },
                ];
              }),
            };
          }).pipe(
            Effect.mapError(
              () => new ModerationUnavailable({ reason: "discord" }),
            ),
          ),
      });
    }),
  );
