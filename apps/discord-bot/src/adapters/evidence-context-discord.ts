import { DiscordREST } from "dfx";
import { Config, Effect, Layer } from "effect";
import {
  type ConversationMessage,
  type Evidence,
  ModerationUnavailable,
} from "../capabilities/moderation/contract.ts";
import {
  EvidenceContext,
  IntakeStore,
} from "../capabilities/moderation/ports.ts";

export type ContextBounds = {
  replies: number;
  nearby: number;
  history: number;
};
const defaults: ContextBounds = { replies: 10, nearby: 20, history: 10 };
export const contextBounds = Effect.gen(function* () {
  const bounds = {
    replies: yield* Config.Number("HERO_CONTEXT_REPLIES").pipe(
      Config.withDefault(10),
    ),
    nearby: yield* Config.Number("HERO_CONTEXT_NEARBY").pipe(
      Config.withDefault(20),
    ),
    history: yield* Config.Number("HERO_CONTEXT_HISTORY").pipe(
      Config.withDefault(10),
    ),
  };
  yield* validateBounds(bounds);
  return bounds;
}).pipe(
  Effect.mapError(() => new ModerationUnavailable({ reason: "configuration" })),
);
const validateBounds = (bounds: ContextBounds) =>
  Effect.gen(function* () {
    for (const key of ["replies", "nearby", "history"] as const)
      if (
        !Number.isInteger(bounds[key]) ||
        bounds[key] < 0 ||
        bounds[key] > defaults[key]
      )
        return yield* Effect.fail(
          new ModerationUnavailable({ reason: "configuration" }),
        );
  });
// Only Discord-provided messages are decoded here. URLs remain literal untrusted data.
type Message = {
  id: string;
  channel_id: string;
  guild_id?: string | undefined;
  author: { id: string };
  timestamp: string;
  content: string;
  member?: { roles: readonly string[] };
  embeds?: readonly unknown[];
  message_reference?:
    | {
        guild_id?: string | undefined;
        channel_id?: string | undefined;
        message_id?: string | undefined;
      }
    | undefined;
};
const decode = (m: Message, guildId: string): ConversationMessage => {
  return {
    guildId,
    channelId: m.channel_id,
    messageId: m.id,
    authorId: m.author.id,
    timestamp: m.timestamp,
    text: m.content,
    roles: m.member ? [...m.member.roles] : null,
    embeds: [...(m.embeds ?? [])],
    replyReference: m.message_reference ?? null,
  };
};
const validMessage = (m: Message, e: Evidence, channel: string) => {
  return (
    (!m.guild_id || m.guild_id === e.guildId) &&
    m.channel_id === channel &&
    typeof m.content === "string" &&
    typeof m.author?.id === "string"
  );
};

export const evidenceContextDiscordLayer = (bounds: ContextBounds = defaults) =>
  Layer.effect(
    EvidenceContext,
    Effect.gen(function* () {
      const rest = yield* DiscordREST;
      const store = yield* IntakeStore;
      yield* validateBounds(bounds);
      const acquireReplies = (e: Evidence, limitations: string[]) =>
        Effect.gen(function* () {
          const replyAncestors: ConversationMessage[] = [];
          // References outside the source channel are not followed: this prevents audit-route
          // quotations and arbitrary cross-channel references bypassing route exemptions.
          let reference = e.replyReference as Message["message_reference"];
          const seen = new Set([e.messageId]);
          while (
            reference?.message_id &&
            replyAncestors.length < bounds.replies
          ) {
            if (
              (reference.guild_id && reference.guild_id !== e.guildId) ||
              (reference.channel_id && reference.channel_id !== e.channelId) ||
              seen.has(reference.message_id)
            ) {
              limitations.push(
                "Reply context rejected: cross-server/channel reference or cycle.",
              );
              reference = undefined;
              break;
            }
            const id = reference.message_id;
            const message = yield* rest
              .getMessage(e.channelId, id)
              .pipe(Effect.option);
            if (
              message._tag === "None" ||
              !validMessage(message.value, e, e.channelId) ||
              message.value.id !== id
            ) {
              limitations.push(
                "Reply ancestor unavailable: inaccessible, deleted or incomplete; not empty content.",
              );
              reference = undefined;
              break;
            }
            seen.add(id);
            replyAncestors.push(decode(message.value, e.guildId));
            reference = message.value.message_reference;
          }
          if (reference?.message_id)
            limitations.push(
              `Conversation truncated: reply ancestor limit ${bounds.replies}.`,
            );
          return replyAncestors;
        });
      const acquireNearby = (e: Evidence, limitations: string[]) =>
        Effect.gen(function* () {
          const nearbyMessages: ConversationMessage[] = [];
          limitations.push(
            "Nearby context includes only messages preceding the source in this channel; later conversation is not inspected.",
          );
          if (bounds.nearby > 0) {
            const messages = yield* rest
              .listMessages(e.channelId, {
                before: e.messageId,
                limit: bounds.nearby,
              })
              .pipe(Effect.option);
            if (messages._tag === "None" || !Array.isArray(messages.value))
              limitations.push(
                "Nearby conversation unavailable: missing access or transport failure; not empty content.",
              );
            else {
              for (const m of messages.value.slice(0, bounds.nearby)) {
                if (!validMessage(m, e, e.channelId) || m.id === e.messageId) {
                  limitations.push(
                    "Nearby context rejected: mismatched source or incomplete content.",
                  );
                  continue;
                }
                nearbyMessages.push(decode(m, e.guildId));
              }
              if (messages.value.length >= bounds.nearby)
                limitations.push(
                  `Nearby conversation bounded to ${bounds.nearby}; older messages not inspected.`,
                );
            }
          } else
            limitations.push(
              "Nearby conversation disabled by configured limit 0.",
            );
          return nearbyMessages;
        });
      const acquireHistory = (e: Evidence, limitations: string[]) =>
        Effect.gen(function* () {
          const history = store.memberHistory
            ? yield* store
                .memberHistory(e.guildId, e.authorId)
                .pipe(Effect.option)
            : null;
          const current = history?._tag === "Some" ? history.value : [];
          const scoped = current.filter(
            (h) =>
              h.guildId === e.guildId &&
              h.authorId === e.authorId &&
              h.messageId !== e.messageId,
          );
          if (!history || history._tag === "None")
            limitations.push(
              "Moderation history/current recorded restriction unavailable; not a clean-history finding.",
            );
          if (scoped.length !== current.length)
            limitations.push(
              "History excluded: foreign server/author or current source.",
            );
          if (scoped.length > bounds.history)
            limitations.push(
              `Moderation history truncated to ${bounds.history} current findings; corrections resolved before selection.`,
            );
          const moderationHistory = scoped
            .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
            .slice(0, bounds.history);
          limitations.push(
            "History covers recorded findings only; Discord action history and current restriction are unavailable. Prior deletion alone does not prove intent. Context authors are not independent targets.",
          );
          return {
            moderationHistory,
            historyAvailability:
              history?._tag === "Some"
                ? ("available" as const)
                : ("unavailable" as const),
          };
        });
      return EvidenceContext.of({
        acquire: (e) =>
          Effect.gen(function* () {
            const limitations = [...e.limitations];
            const replyAncestors = yield* acquireReplies(e, limitations);
            const nearbyMessages = yield* acquireNearby(e, limitations);
            const history = yield* acquireHistory(e, limitations);
            return {
              ...e,
              replyAncestors,
              nearbyMessages,
              ...history,
              limitations,
            };
          }),
      });
    }),
  );
