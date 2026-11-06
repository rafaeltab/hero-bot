import { NodeHttpClient, NodeSocket } from "@effect/platform-node";
import { Layer } from "effect";

/** No connection is made until the development connection is run. */
export const DiscordNodeTransport = Layer.mergeAll(
  NodeHttpClient.layerUndici,
  NodeSocket.layerWebSocketConstructor,
);
