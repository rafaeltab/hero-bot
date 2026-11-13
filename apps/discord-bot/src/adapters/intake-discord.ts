import { createHash } from "node:crypto";
import { DiscordREST } from "dfx";
import { Effect, Layer } from "effect";
import type {
  AttachmentCopy,
  Delivery,
} from "../capabilities/moderation/contract.ts";
import { ModerationUnavailable } from "../capabilities/moderation/contract.ts";
import { Reports } from "../capabilities/moderation/ports.ts";
import { createAttachmentSession } from "./attachment-acquisition.ts";

const safe = { allowed_mentions: { parse: [] }, flags: 4 } as const;
/** Threads inherit the proven-private audit text channel. No extra users invited. */
export const createReportsDiscordLayer = (transport: typeof fetch = fetch) =>
  Layer.effect(
    Reports,
    Effect.gen(function* () {
      const rest = yield* DiscordREST;
      return Reports.of({
        refresh: (delivery) =>
          Effect.gen(function* () {
            const updated = structuredClone(delivery);
            for (const item of updated.attachments ?? []) {
              if (!item.copy) continue;
              const result = yield* rest
                .getMessage(item.copy.channelId, item.copy.messageId)
                .pipe(Effect.result);
              item.checkedAt = new Date().toISOString();
              if (result._tag === "Failure") {
                // Forbidden/network failures establish no deletion. Only 404 means missing.
                item.status =
                  "response" in result.failure &&
                  result.failure.response?.status === 404
                    ? "missing"
                    : "unavailable";
              } else {
                const attachment = result.success.attachments.find(
                  (a) => a.id === item.copy?.attachmentId,
                );
                item.status = attachment ? "available" : "missing";
                if (attachment) item.copy.url = attachment.url;
              }
            }
            if (updated.attachments?.some((a) => a.status !== "available"))
              updated.state = "partial";
            return updated;
          }).pipe(
            Effect.mapError(
              () => new ModerationUnavailable({ reason: "discord" }),
            ),
          ),
        publish: (r, checkpoint = () => Effect.void, acquisition) =>
          Effect.gen(function* () {
            const channel = r.configuration.auditChannel;
            if (!channel)
              return yield* Effect.fail(
                new ModerationUnavailable({ reason: "configuration" }),
              );
            const e = r.evidence;
            const history =
              e.moderationHistory === undefined ||
              e.historyAvailability === "unavailable"
                ? "unavailable (not a clean-history finding)"
                : e.moderationHistory.length === 0
                  ? "No relevant recorded entries supplied; Discord action history unavailable."
                  : e.moderationHistory
                      .slice(0, 3)
                      .map(
                        (h) =>
                          `${h.origin} ${h.status} — ${h.authorId}, source ${h.messageId}, <t:${Math.floor(Date.parse(h.at) / 1000)}:R>: ${h.summary.slice(0, 120)}${h.correction ? `; correction: ${h.correction.slice(0, 120)}` : ""}`,
                      )
                      .join("\n");
            const root = yield* rest.createMessage(channel, {
              ...safe,
              content:
                `Automatic report — ${e.authorId}\nRecommendation: ${r.judgment.action}\nReason: ${r.judgment.reason}\nExecution: disabled; ban, purgatory and deletion skipped.\nMessage deletion: not attempted. Observed restriction: ${e.restriction}\nRoles at source: ${e.roles.join(", ") || "(none supplied)"}\nObserved roles: ${r.observedRoles?.join(", ") ?? "unavailable"}\nBrief moderation history: ${history}\nContext: ${(e.replyAncestors ?? []).length} ancestors; ${(e.nearbyMessages ?? []).length} nearby. Full attributed evidence and omissions in thread.\nAttachment preservation: see evidence thread and private delivery record; partial until confirmed.\nSource: https://discord.com/channels/${e.guildId}/${e.channelId}/${e.messageId}\nSource version: ${e.version}\nCreated: ${Number.isNaN(Date.parse(e.version)) ? "unavailable" : `<t:${Math.floor(Date.parse(e.version) / 1000)}:R>`}`.slice(
                  0,
                  1900,
                ),
            });
            const delivery: Delivery = {
              rootId: root.id,
              threadId: "",
              state: "partial",
              attachments: [],
            };
            yield* checkpoint(delivery);
            const thread = yield* rest.createThreadFromMessage(
              channel,
              root.id,
              {
                name: "Automatic report evidence",
                auto_archive_duration: 10080,
              },
            );
            delivery.threadId = thread.id;
            yield* checkpoint(delivery);
            const session = acquisition ?? createAttachmentSession(transport);
            for (const metadata of e.attachments) {
              const m = metadata as {
                id?: string;
                filename?: string;
                size?: number;
                url?: string;
              } | null;
              const copy: AttachmentCopy = {
                sourceAttachmentId: m?.id ?? null,
                sourceMessageId: e.messageId,
                sourceVersion: e.version,
                metadata,
                status: "pending",
              };
              delivery.attachments?.push(copy);
              yield* checkpoint(delivery);
              const downloaded = yield* Effect.tryPromise({
                try: () => session.acquire(m?.url ?? "", m?.size ?? -1),
                catch: (error) =>
                  error instanceof Error && error.message === "download-budget"
                    ? ("oversized" as const)
                    : ("unavailable" as const),
              }).pipe(Effect.result);
              if (downloaded._tag === "Failure") {
                copy.status = downloaded.failure;
              } else {
                // Persist uncertainty before the network side effect; never retry an upload.
                copy.status = "upload-unknown";
                yield* checkpoint(delivery);
                const form = new FormData();
                form.append(
                  "files[0]",
                  new Blob([new Uint8Array(downloaded.success)]),
                  m?.filename ?? "evidence.bin",
                );
                const uploaded = yield* rest
                  .createMessage(thread.id, {
                    ...safe,
                    nonce: createHash("sha256")
                      .update(
                        `${e.guildId}/${e.messageId}/${e.version}/${m?.id}`,
                      )
                      .digest("hex")
                      .slice(0, 24),
                    enforce_nonce: true,
                    content: `Original attachment ${m?.id ?? "unknown"}; source ${e.messageId}; version ${e.version}`,
                  })
                  .pipe(rest.withFormData(form), Effect.result);
                if (uploaded._tag === "Success") {
                  const a = uploaded.success.attachments?.[0];
                  if (a) {
                    copy.status = "available";
                    copy.copy = {
                      channelId: thread.id,
                      messageId: uploaded.success.id,
                      attachmentId: a.id,
                      filename: a.filename,
                      url: a.url,
                      size: a.size,
                    };
                    copy.checkedAt = new Date().toISOString();
                  }
                }
              }
              yield* checkpoint(delivery);
            }
            const complete =
              delivery.attachments?.every((a) => a.status === "available") ??
              true;
            const text = JSON.stringify(
              {
                ...r,
                attachmentPreservation: {
                  complete,
                  attachments: delivery.attachments,
                },
              },
              null,
              2,
            );
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
            if (e.attachments.length === 0)
              return { rootId: root.id, threadId: thread.id };
            delivery.state = complete ? "complete" : "partial";
            return delivery;
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

export const reportsDiscordLayer = createReportsDiscordLayer();
