import { NodeRuntime } from "@effect/platform-node";
import { applicationForDevelopment } from "./application.ts";

NodeRuntime.runMain(
  applicationForDevelopment(process.argv.includes("--discord-development")),
);
