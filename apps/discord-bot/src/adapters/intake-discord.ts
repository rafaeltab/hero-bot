import { DiscordREST } from "dfx";
import { Effect, Layer } from "effect";
import { ModerationUnavailable } from "../capabilities/moderation/contract.ts";
import { Reports } from "../capabilities/moderation/ports.ts";

const safe = { allowed_mentions: { parse: [] }, flags: 4 } as const;
/** Threads inherit the proven-private audit text channel. No extra users invited. */
export const reportsDiscordLayer = Layer.effect(
  Reports,
  Effect.gen(function* () {
    const rest = yield* DiscordREST;
    return Reports.of({
      publish: (r) =>
        Effect.gen(function* () {
          const channel = r.configuration.auditChannel;
          if (!channel)
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "configuration" }),
            );
          const e = r.evidence;
          const root = yield* rest.createMessage(channel, {
            ...safe,
            content:
              `Automatic report — ${e.authorId}\nRecommendation: ${r.judgment.action}\nReason: ${r.judgment.reason}\nExecution: disabled; ban, purgatory and deletion skipped.\nMessage deletion: not attempted. Observed restriction: ${e.restriction}\nRoles at source: ${e.roles.join(", ") || "(none supplied)"}\nObserved roles: ${r.observedRoles?.join(", ") ?? "unavailable"}\nBrief moderation history: unavailable.\nSource: https://discord.com/channels/${e.guildId}/${e.channelId}/${e.messageId}\nSource version: ${e.version}\nCreated: ${Number.isNaN(Date.parse(e.version)) ? "unavailable" : `<t:${Math.floor(Date.parse(e.version) / 1000)}:R>`}`.slice(
                0,
                1900,
              ),
          });
          const thread = yield* rest.createThreadFromMessage(channel, root.id, {
            name: "Automatic report evidence",
            auto_archive_duration: 10080,
          });
          const text = JSON.stringify(r, null, 2);
          for (let offset = 0; offset < text.length; ) {
            let end = Math.min(offset + 1800, text.length);
            if (
              end < text.length &&
              /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))
            )
              end--;
            yield* rest.createMessage(thread.id, {
              ...safe,
              content: text.slice(offset, end),
            });
            offset = end;
          }
          return { rootId: root.id, threadId: thread.id };
        }).pipe(
          Effect.mapError(
            () => new ModerationUnavailable({ reason: "discord" }),
          ),
        ),
      notify: (_guild, channel) =>
        Effect.gen(function* () {
          if (!channel)
            return yield* Effect.fail(
              new ModerationUnavailable({ reason: "configuration" }),
            );
          yield* rest.createMessage(channel, {
            ...safe,
            content:
              "Moderation service failure: assessment, preservation or private delivery incomplete. No punishment attempted. No automatic replay. Check operator readiness and private records; this is not a member finding.",
          });
        }).pipe(
          Effect.mapError(
            () => new ModerationUnavailable({ reason: "discord" }),
          ),
        ),
    });
  }),
);
