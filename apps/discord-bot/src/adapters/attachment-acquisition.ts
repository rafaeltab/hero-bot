/** One session per judgment. Both AI selection and evidence copying must share
 * this cache/budget; selection limits never imply preservation completeness. */
export const createAttachmentSession = (transport: typeof fetch) => {
  let remaining = 20 * 1024 * 1024;
  const cache = new Map<string, Promise<Uint8Array>>();
  return {
    acquire: (url: string, size: number) => {
      const cached = cache.get(url);
      if (cached) return cached;
      const download = async () => {
        const target = new URL(url);
        if (
          target.protocol !== "https:" ||
          target.hostname !== "cdn.discordapp.com" ||
          !target.pathname.startsWith("/attachments/") ||
          target.username ||
          target.password
        )
          throw Error("unsupported-source");
        if (!Number.isSafeInteger(size) || size < 0 || size > remaining)
          throw Error("download-budget");
        const response = await transport(url, { redirect: "error" });
        if (!response.ok || !response.body) throw Error("download-unavailable");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            // Count actual bytes, including a dishonest size declaration.
            remaining -= chunk.value.byteLength;
            if (remaining < 0) throw Error("download-budget");
            length += chunk.value.byteLength;
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return bytes;
      };
      const result = download();
      cache.set(url, result);
      return result;
    },
  };
};
