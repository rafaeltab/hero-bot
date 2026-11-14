import { Effect, Layer } from "effect";
import {
  type Configuration,
  Moderation,
  type Permission,
  type PermissionGroup,
  type Request,
} from "./contract.ts";
import { initialPolicy } from "./policy.ts";
import { type Access, ConfigurationStore, GuildAccess } from "./ports.ts";
import { describeReadiness } from "./readiness.ts";

// Permissions are independent of fixed initial groups. No group/permission editor
// is delivered in this slice; course groups never participate in these grants.
const groupPermissions: Record<PermissionGroup, readonly Permission[]> = {
  Owner: ["configure", "inspect-channel-status"],
  Admin: ["configure", "inspect-channel-status"],
  Moderator: ["inspect-channel-status"],
};
const disabled =
  "Automatic ban, purgatory and deletion: disabled. Execution is outside this slice.";
const empty = (guildId: string): Configuration => {
  return {
    guildId,
    actorId: "",
    version: 0,
    changedAt: "",
    roles: { Owner: [], Admin: [], Moderator: [] },
    auditChannel: null,
    reportingChannel: null,
    prompt: initialPolicy,
  };
};
const channelProblem = (id: string | null, access: Access): string[] => {
  const channel = access.channels.find((c) => c.id === id);
  if (!channel) return ["Select an existing server reporting channel."];
  if (!channel.private)
    return ["Reporting channel is unsafe: deny ordinary members View Channel."];
  if (!channel.usable)
    return [
      "Grant bot View Channel, Read Message History, Send Messages, Attach Files, Create Public/Private Threads and Send Messages in Threads; remove Administrator. Grant each mapped permission role View Channel and Read Message History.",
    ];
  return [];
};
const problems = (config: Configuration, access: Access) => [
  ...access.problems,
  ...channelProblem(config.auditChannel, access).map((p) => `Audit: ${p}`),
  ...channelProblem(config.reportingChannel, access).map(
    (p) => `Reporting entry: ${p}`,
  ),
  ...(!config.prompt ? ["Set a policy prompt."] : []),
  ...Object.values(config.roles)
    .flat()
    .filter((id) => !access.roles.includes(id))
    .map(() => "A mapped role is missing; replace it."),
];
const edit = (
  request: Request,
  config: Configuration,
  access: Access,
): string | undefined => {
  const command = request.command;
  switch (command.kind) {
    case "prompt":
      if (!command.value.trim() || command.value.length > 4000)
        return "Prompt must contain 1–4000 characters.";
      config.prompt = command.value;
      break;
    case "role":
      if (!["Owner", "Admin", "Moderator"].includes(command.group))
        return "Invalid permission group; course groups confer no authority.";
      if (
        !(command.remove ? config.roles[command.group] : access.roles).includes(
          command.roleId,
        ) ||
        command.roleId === request.guildId
      )
        return "Choose an existing server role other than @everyone.";
      config.roles[command.group] = config.roles[command.group].filter(
        (id) => id !== command.roleId,
      );
      if (!command.remove) config.roles[command.group].push(command.roleId);
      break;
    case "channel": {
      const failures = channelProblem(command.channelId, access);
      if (failures.length) return failures.join("\n");
      config[command.purpose] = command.channelId;
      break;
    }
  }
  return undefined;
};

export const ModerationLive = Layer.effect(
  Moderation,
  Effect.gen(function* () {
    const store = yield* ConfigurationStore;
    const discord = yield* GuildAccess;
    return Moderation.of({
      execute: (request) =>
        Effect.gen(function* () {
          const history = yield* store.history(request.guildId);
          const config = structuredClone(
            history.at(-1) ?? empty(request.guildId),
          );
          const access = yield* discord.inspect(
            request.guildId,
            request.actorId,
            config.roles,
            request.command.kind === "status"
              ? request.command.channelId
              : undefined,
            request.command.kind === "status" ||
              request.command.kind === "doctor",
          );
          const owner = access.ownerId === request.actorId;
          const can = (permission: Permission) =>
            owner ||
            (["Owner", "Admin", "Moderator"] satisfies PermissionGroup[]).some(
              (group) =>
                groupPermissions[group].includes(permission) &&
                config.roles[group].some((id) =>
                  access.actorRoles.includes(id),
                ),
            );
          const admin = can("configure");
          const moderator = can("inspect-channel-status");
          if (!moderator)
            return "Denied: current Owner/Admin or Moderator permission required.";
          if (
            request.command.kind === "status" ||
            request.command.kind === "doctor"
          )
            return describeReadiness(
              config,
              access,
              problems(config, access),
              request.command,
            );
          if (!admin)
            return "Denied: only current Owner/Admin may configure or view policy history.";
          switch (request.command.kind) {
            case "show":
              return `${JSON.stringify(config)}\n${disabled}`;
            case "history":
              return (
                history
                  .map(
                    (c) =>
                      `version ${c.version} by ${c.actorId} at ${c.changedAt}: ${JSON.stringify(c)}`,
                  )
                  .join("\n") || "No configuration history."
              );
            case "actions":
              return disabled;
          }
          const failure = edit(request, config, access);
          if (failure) return failure;
          config.actorId = request.actorId;
          config.changedAt = new Date().toISOString();
          const version = yield* store.save(config);
          return `Saved version ${version}. No old messages will be reprocessed.\n${disabled}`;
        }),
    });
  }),
);
