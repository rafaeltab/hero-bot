import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Socket from "effect/socket/Socket";
import { Client } from "pg";
import { moderationProgram } from "../../dist/application.js";

const guild = process.env.DEV_MODERATION_GUILD_IDS;
const calls = [];
let sequence = 0;
let aiCalls = 0;
let delivered;
const firstDelivery = new Promise((resolve) => {
  delivered = resolve;
});
const recordScenario = async () => {
  if (process.env.HERO_TEST_RESTART === "true") {
    // Existing terminal records cannot acknowledge replay processing. Observe the
    // restarted executable for the same bounded interval before asserting silence.
    await delay(2000);
  } else {
    const observer = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 1000,
      statement_timeout: 1000,
    });
    await observer.connect();
    try {
      const deadline = Date.now() + 4000;
      while (true) {
        const { rows } = await observer.query(
          "select message_id, state from moderation_intake where guild_id=$1",
          [guild],
        );
        if (
          rows.filter(
            (row) => row.message_id === "100" && row.state === "delivered",
          ).length === 2 &&
          rows.some(
            (row) => row.message_id === "101" && row.state === "assessed",
          )
        )
          break;
        if (Date.now() >= deadline) throw Error("intake did not complete");
        await delay(25);
      }
    } finally {
      await observer.end();
    }
  }
  writeFileSync(
    process.env.HERO_TEST_REPORT_PATH,
    JSON.stringify({ calls, aiCalls }),
  );
  console.log("intake scenario complete");
};
const source = (id, author, content) => ({
  guild_id: guild,
  id,
  channel_id: "20",
  timestamp: "2026-11-13T00:00:00Z",
  content,
  author: { id: author },
  member: { roles: ["course"] },
  embeds: [],
  attachments: [],
});
class Gateway extends EventTarget {
  readyState = 0;
  receive(t, d) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ op: 0, t, s: ++sequence, d }),
      }),
    );
  }
  open() {
    setTimeout(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
      setTimeout(
        () =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                op: 10,
                d: { heartbeat_interval: 60000 },
              }),
            }),
          ),
        0,
      );
    }, 0);
  }
  send(data) {
    if (JSON.parse(String(data)).op === 2)
      setTimeout(
        () =>
          this.receive("READY", {
            v: 10,
            application: { id: "123", flags: 0 },
            user: { id: "99" },
            guilds: [{ id: guild }],
            session_id: "offline",
            resume_gateway_url: "wss://offline.invalid",
          }),
        0,
      );
  }
  close() {
    this.readyState = 3;
  }
}
const socket = new Gateway();
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init.body));
  aiCalls++;
  const input = JSON.parse(
    body.messages.find((m) => m.role === "user").content,
  );
  if (input.messageId === "100" && input.text === "hello") await firstDelivery;
  const judgment = {
    action: input.text === "hello" ? "none" : "ban",
    reason: "Platform presumption; piracy unverified.",
    offendingUrls:
      input.text === "hello" ? [] : ["https://bilibili.com/video/1"],
  };
  return Response.json({
    id: "controlled",
    object: "chat.completion",
    created: 0,
    model: "gpt-6-luna",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(judgment) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
};
let emitted = false;
const transport = Layer.mergeAll(
  Layer.succeed(Socket.WebSocketConstructor, () => {
    socket.open();
    return socket;
  }),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const body =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : null;
      calls.push({ url: request.url, method: request.method, body });
      let result = {};
      if (request.url.endsWith("/gateway/bot"))
        result = {
          url: "wss://offline.invalid",
          shards: 1,
          session_start_limit: {
            total: 100,
            remaining: 100,
            reset_after: 0,
            max_concurrency: 1,
          },
        };
      if (request.url.endsWith("/commands") && !emitted) {
        emitted = true;
        setTimeout(() => {
          socket.receive(
            "MESSAGE_CREATE",
            source("100", "12", "https://bilibili.com/video/1"),
          );
          socket.receive(
            "MESSAGE_CREATE",
            source("100", "12", "https://bilibili.com/video/1"),
          );
          socket.receive("MESSAGE_CREATE", source("101", "12", "hello"));
          socket.receive(
            "MESSAGE_CREATE",
            source("102", "11", "exempt secret"),
          );
        }, 20);
        setTimeout(() => {
          socket.receive("MESSAGE_UPDATE", {
            guild_id: guild,
            id: "100",
            channel_id: "20",
            edited_timestamp: "2026-11-13T00:01:00Z",
          });
        }, 300);
        void recordScenario().catch(() => {
          console.error("intake scenario did not complete");
        });
      }
      if (request.url.endsWith(`/guilds/${guild}`)) result = { owner_id: "11" };
      if (request.url.includes("/members/"))
        result = { roles: request.url.endsWith("/99") ? ["bot"] : ["course"] };
      if (request.url.endsWith("/roles"))
        result = [
          { id: guild, permissions: "0" },
          { id: "course", permissions: "0" },
          { id: "bot", permissions: "377957223424", tags: { bot_id: "99" } },
        ];
      if (request.url.endsWith("/channels"))
        result = [
          {
            id: "30",
            guild_id: guild,
            type: 0,
            permission_overwrites: [
              { id: guild, type: 0, deny: "1024", allow: "0" },
              { id: "bot", type: 0, deny: "0", allow: "377957223424" },
            ],
          },
        ];
      if (request.url.endsWith("/channels/20"))
        result = { id: "20", guild_id: guild, type: 0, parent_id: null };
      if (request.url.endsWith("/channels/20/messages/100"))
        result = {
          ...source("100", "12", "hello"),
          edited_timestamp: "2026-11-13T00:01:00Z",
        };
      if (request.url.endsWith("/messages") || request.method === "PATCH")
        result = request.method === "GET" ? [] : { id: "root" };
      if (request.url.endsWith("/threads")) result = { id: "thread" };
      if (request.url.endsWith("/channels/thread/messages"))
        setTimeout(() => delivered(), 50);
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(result)),
        ),
      );
    }),
  ),
);
NodeRuntime.runMain(moderationProgram.pipe(Effect.provide(transport)));
