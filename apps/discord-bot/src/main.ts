import { NodeRuntime } from "@effect/platform-node";
import { withDevelopmentProcess } from "./adapters/development-process.ts";
import { applicationForDevelopment } from "./application.ts";

const development = process.argv.includes("--discord-development");
const program = applicationForDevelopment(development);

NodeRuntime.runMain(development ? withDevelopmentProcess(program) : program);
