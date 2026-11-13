import { Effect } from "effect";
import type { AttachmentContent } from "../text-generation/contract.ts";
import type { AttachmentInput } from "./contract.ts";
import type { AttachmentSession } from "./ports.ts";

const supported = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);
/** Signature checks reject mismatched content; decoding/readability remains provider work. */
function matches(bytes: Uint8Array, type: string) {
  const head = Array.from(bytes.subarray(0, 12), (b) =>
    String.fromCharCode(b),
  ).join("");
  switch (type) {
    case "image/png":
      return head.startsWith("\x89PNG\r\n\x1a\n");
    case "image/jpeg":
      return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/gif":
      return head.startsWith("GIF87a") || head.startsWith("GIF89a");
    case "image/webp":
      return head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
    default:
      return head.startsWith("%PDF-");
  }
}
/** Select at most four original contents; metadata never substitutes for unread bytes. */
export const attachmentInputs = (
  attachments: unknown[],
  session?: AttachmentSession,
) =>
  Effect.gen(function* () {
    const inputs: AttachmentInput[] = [];
    const contents: AttachmentContent[] = [];
    for (const [index, metadata] of attachments.entries()) {
      const m = metadata as {
        id?: string;
        filename?: string;
        content_type?: string;
        url?: string;
        size?: number;
      } | null;
      const input: AttachmentInput = {
        index,
        attachmentId: typeof m?.id === "string" ? m.id : null,
        filename: typeof m?.filename === "string" ? m.filename : null,
        status: "unavailable",
        reason: "malformed-metadata",
      };
      inputs.push(input);
      if (
        typeof m?.url !== "string" ||
        typeof m.size !== "number" ||
        !input.filename
      )
        continue;
      const mediaType = m.content_type ?? "";
      if (!supported.has(mediaType)) {
        input.reason = "unsupported-format";
        continue;
      }
      if (contents.length === 4) {
        input.reason = "content-limit";
        continue;
      }
      if (!session) {
        input.reason = "acquisition-unavailable";
        continue;
      }
      const downloaded = yield* Effect.tryPromise({
        try: () => session.acquire(m.url as string, m.size as number),
        catch: (error) =>
          error instanceof Error && error.message === "download-budget"
            ? "download-budget"
            : "download-unavailable",
      }).pipe(Effect.result);
      if (downloaded._tag === "Failure") {
        input.reason = downloaded.failure;
        continue;
      }
      const data = downloaded.success;
      if (data.byteLength !== m.size) {
        input.reason = "size-mismatch-or-truncated";
        continue;
      }
      if (!matches(data, mediaType)) {
        input.reason = "unreadable-or-format-mismatch";
        continue;
      }
      input.status = "supplied";
      delete input.reason;
      input.mediaType = mediaType;
      input.bytes = data.byteLength;
      contents.push({ filename: input.filename, mediaType, data });
    }
    return { inputs, contents };
  });
