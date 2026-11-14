import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Socket from "effect/socket/Socket";
import { moderationProgram } from "../../dist/application.js";

class Gateway extends EventTarget {
  readyState = 0;
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
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                op: 0,
                t: "READY",
                s: 1,
                d: {
                  v: 10,
                  application: { id: "123", flags: 0 },
                  user: { id: "99" },
                  guilds: [{ id: "10" }, { id: "12" }],
                  session_id: "offline",
                  resume_gateway_url: "wss://offline.invalid",
                },
              }),
            }),
          ),
        0,
      );
  }
  close() {
    this.readyState = 3;
  }
}
const transport = Layer.mergeAll(
  Layer.succeed(Socket.WebSocketConstructor, () => {
    const socket = new Gateway();
    socket.open();
    return socket;
  }),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const body = request.url.endsWith("/gateway/bot")
        ? {
            url: "wss://offline.invalid",
            shards: 1,
            session_start_limit: {
              total: 100,
              remaining: 100,
              reset_after: 0,
              max_concurrency: 1,
            },
          }
        : {};
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body))),
      );
    }),
  ),
);
NodeRuntime.runMain(moderationProgram.pipe(Effect.provide(transport)));
