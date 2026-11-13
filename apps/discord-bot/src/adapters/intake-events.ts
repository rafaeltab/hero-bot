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
  edited_timestamp?: string | null;
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
      version: event.edited_timestamp ?? event.timestamp,
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
        ...(event.message_reference
          ? ["Reply reference supplied; full reply chain unavailable."]
          : []),
      ],
    });
  });
/** Discord updates are partial. Hydrate only from Discord, and reject snapshots of a
 * different version rather than attributing newer contents to an older edit. */
export const handleMessageUpdate = (
  event: Partial<MessageCreation> & { id: string; channel_id: string },
  guildIds: readonly string[],
) =>
  Effect.gen(function* () {
    if (
      !event.guild_id ||
      !guildIds.includes(event.guild_id) ||
      !event.edited_timestamp
    )
      return;
    if (
      event.author &&
      typeof event.content === "string" &&
      event.timestamp &&
      event.embeds &&
      event.attachments
    ) {
      yield* handleMessageCreation(
        {
          ...event,
          author: event.author,
          content: event.content,
          timestamp: event.timestamp,
        },
        guildIds,
      );
      return;
    }
    const rest = yield* DiscordREST;
    const message = yield* rest.getMessage(event.channel_id, event.id);
    if (message.edited_timestamp !== event.edited_timestamp) {
      yield* Console.log(
        "moderation edit snapshot unavailable for exact version; no replay or finding claimed",
      );
      return;
    }
    yield* handleMessageCreation(
      { ...message, guild_id: event.guild_id },
      guildIds,
    );
  });
export const runMessageCreations = (guildIds: readonly string[]) =>
  Effect.gen(function* () {
    const gateway = yield* DiscordGateway;
    const creations = gateway
      .fromDispatch("MESSAGE_CREATE")
      .pipe(Stream.map((e) => handleMessageCreation(e, guildIds)));
    const edits = gateway
      .fromDispatch("MESSAGE_UPDATE")
      .pipe(Stream.map((e) => handleMessageUpdate(e, guildIds)));
    return yield* Stream.merge(creations, edits).pipe(
      Stream.mapEffect(
        (task) =>
          task.pipe(
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
