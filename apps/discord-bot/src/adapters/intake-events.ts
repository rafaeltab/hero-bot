import { DiscordREST } from "dfx";
import { DiscordGateway } from "dfx/gateway";
import { Console, Effect, Stream } from "effect";
import { Intake } from "../capabilities/moderation/contract.ts";
/** Structural gateway boundary also accepts controlled fixtures; no SDK types escape. */
export type MessageCreation = {
  guild_id?: string | undefined;
  id: string;
  channel_id: string;
  timestamp: string;
  content: string;
  author: { id: string };
  member?: { roles: readonly string[] };
  embeds?: readonly unknown[];
  referenced_message?: unknown;
  message_reference?: unknown;
  attachments?: readonly unknown[];
};
export const handleMessageCreation = (
  event: MessageCreation,
  guildIds: readonly string[],
) =>
  Effect.gen(function* () {
    if (!event.guild_id || !guildIds.includes(event.guild_id)) return;
    const rest = yield* DiscordREST;
    const channel = yield* rest.getChannel(event.channel_id);
    const parentId =
      "parent_id" in channel ? (channel.parent_id ?? null) : null;
    const intake = yield* Intake;
    yield* intake.receive({
      guildId: event.guild_id,
      messageId: event.id,
      version: event.timestamp,
      authorId: event.author.id,
      channelId: event.channel_id,
      parentId,
      channelContext: {
        type: channel.type,
        name: "name" in channel ? (channel.name ?? null) : null,
      },
      replyReference: event.message_reference ?? null,
      text: event.content,
      embeds: [...(event.embeds ?? [])],
      quotes: event.referenced_message ? [event.referenced_message] : [],
      attachments: [...(event.attachments ?? [])],
      roles: [...(event.member?.roles ?? [])],
      restriction: "unavailable (no restriction-history inspection)",
      limitations: [
        "Reply ancestors and nearby conversation: unavailable.",
        "Moderation history and corrections: unavailable.",
        "Attachment contents and copying: unavailable; metadata only.",
        "English audit translation: unavailable; original evidence retained.",
        "Message edits: unavailable; creation-only workflow.",
        ...(event.message_reference
          ? ["Reply reference supplied; full reply chain unavailable."]
          : []),
      ],
    });
  });
export const runMessageCreations = (guildIds: readonly string[]) =>
  Effect.gen(function* () {
    const gateway = yield* DiscordGateway;
    return yield* gateway.fromDispatch("MESSAGE_CREATE").pipe(
      Stream.mapEffect(
        (e) =>
          handleMessageCreation(e, guildIds).pipe(
            Effect.catch(() =>
              Console.log(
                "moderation message intake unavailable; no judgment or punishment claimed",
              ),
            ),
          ),
        { concurrency: "unbounded", unordered: true },
      ),
      Stream.runDrain,
    );
  });
