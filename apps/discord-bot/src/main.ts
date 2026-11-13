import { NodeRuntime } from "@effect/platform-node";
import { registerDevelopmentProcess } from "./adapters/development-process.ts";
import { applicationForDevelopment } from "./application.ts";

const development = process.argv.includes("--discord-development");
if (development) registerDevelopmentProcess();

NodeRuntime.runMain(applicationForDevelopment(development));
