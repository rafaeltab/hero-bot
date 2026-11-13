import { NodeRuntime } from "@effect/platform-node";
import { withDevelopmentProcess } from "./adapters/development-process.ts";
import {
  applicationForDevelopment,
  moderationApplication,
} from "./application.ts";

const development = process.argv.includes("--discord-development");
if (process.argv.includes("--moderation")) {
  NodeRuntime.runMain(moderationApplication);
} else {
  const program = applicationForDevelopment(development);
  NodeRuntime.runMain(development ? withDevelopmentProcess(program) : program);
}
