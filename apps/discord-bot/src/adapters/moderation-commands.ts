import { type Discord, DiscordREST } from "dfx";
import { Effect, Schema } from "effect";
import {
  type Command,
  Intake,
  Moderation,
} from "../capabilities/moderation/contract.ts";

type Option = NonNullable<
  Discord.ApplicationCommandCreateRequest["options"]
>[number];
const field = (
  name: string,
  type: 3 | 7 | 8,
  description: string,
): Exclude<Option, { type: 1 | 2 }> => {
  return {
    name,
    type,
    description,
    required: true,
  };
};
const sub = (
  name: string,
  description: string,
  options: NonNullable<
    Discord.ApplicationCommandSubcommandOption["options"]
  > = [],
): Discord.ApplicationCommandSubcommandOption => {
  return {
    name,
    type: 1,
    description,
    options,
  };
};
const definitions: Discord.ApplicationCommandCreateRequest[] = [
  {
    name: "moderation",
    description: "Private notification-only configuration",
    type: 1,
    options: [
      {
        name: "config",
        description: "Owner/Admin configuration",
        type: 2,
        options: [
          sub("show", "View current policy and disabled actions"),
          sub("history", "Download attributed configuration history"),
          sub("prompt", "Set policy prompt", [
            field("value", 3, "Policy (1–4000 characters)"),
          ]),
          sub("role", "Map an existing permission role", [
            {
              name: "group",
              type: 3,
              description: "Permission, separate from course groups",
              required: true,
              choices: [
                { name: "Owner", value: "Owner" },
                { name: "Admin", value: "Admin" },
                { name: "Moderator", value: "Moderator" },
              ],
            },
            field("role", 8, "Existing server role"),
            {
              name: "remove",
              type: 5,
              description: "Remove mapping",
              required: false,
            },
          ]),
          sub("unmap", "Remove a mapping, including a deleted role", [
            {
              name: "group",
              type: 3,
              description: "Permission group mapping",
              required: true,
              choices: [
                { name: "Owner", value: "Owner" },
                { name: "Admin", value: "Admin" },
                { name: "Moderator", value: "Moderator" },
              ],
            },
            field("role-id", 3, "Role ID from configuration history"),
          ]),
          sub("channel", "Select an existing private report channel", [
            {
              name: "purpose",
              type: 3,
              description: "Channel purpose",
              required: true,
              choices: [
                { name: "Audit", value: "auditChannel" },
                { name: "Reporting entry", value: "reportingChannel" },
              ],
            },
            field("channel", 7, "Private text channel (intake is unavailable)"),
          ]),
        ],
      },
    ],
  },
  {
    name: "channel-status",
    description: "Private setup, access and unavailable features",
    type: 1,
    options: [
      {
        name: "channel",
        type: 7,
        description: "Defaults to current channel",
        required: false,
      },
    ],
  },
  {
    name: "doctor",
    description: "Private setup diagnostics (no message judgment yet)",
    type: 1,
  },
];
/** Upsert only owned commands, preserving other applications' command additions. */
export const registerModerationCommands = (
  applicationId: string,
  guildIds: readonly string[],
) =>
  Effect.gen(function* () {
    const rest = yield* DiscordREST;
    for (const guildId of guildIds)
      for (const definition of definitions)
        yield* rest.createGuildApplicationCommand(
          applicationId,
          guildId,
          definition,
        );
  });
const leaf = Schema.Struct({
  name: Schema.String,
  value: Schema.optionalKey(Schema.Unknown),
});
const child = Schema.Struct({
  name: Schema.String,
  options: Schema.optionalKey(Schema.Array(leaf)),
});
const option = Schema.Struct({
  name: Schema.String,
  value: Schema.optionalKey(Schema.Unknown),
  options: Schema.optionalKey(Schema.Array(child)),
});
const interaction = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
  application_id: Schema.String,
  type: Schema.Number,
  guild_id: Schema.String,
  channel_id: Schema.String,
  member: Schema.Struct({ user: Schema.Struct({ id: Schema.String }) }),
  data: Schema.Struct({
    name: Schema.String,
    options: Schema.optionalKey(Schema.Array(option)),
  }),
});
type Input = typeof interaction.Type;
const parseCommand = (input: Input): Command | undefined => {
  const options = input.data.options ?? [];
  if (input.data.name === "channel-status" || input.data.name === "doctor") {
    const channel = options.find((o) => o.name === "channel")?.value;
    return {
      kind: "status",
      channelId: typeof channel === "string" ? channel : input.channel_id,
    };
  }
  if (input.data.name !== "moderation" || options[0]?.name !== "config")
    return undefined;
  const subcommand = options[0].options?.[0];
  const get = (name: string) =>
    subcommand?.options?.find((o) => o.name === name)?.value;
  switch (subcommand?.name) {
    case "show":
      return { kind: "show" };
    case "history":
      return { kind: "history" };
    case "prompt": {
      const value = get("value");
      return typeof value === "string" ? { kind: "prompt", value } : undefined;
    }
    case "unmap":
    case "role": {
      const group = get("group");
      const roleId = get("role") ?? get("role-id");
      if (
        (group === "Owner" || group === "Admin" || group === "Moderator") &&
        typeof roleId === "string"
      )
        return {
          kind: "role",
          group,
          roleId,
          remove: subcommand.name === "unmap" || get("remove") === true,
        };
      return undefined;
    }
    case "channel": {
      const purpose = get("purpose");
      const channelId = get("channel");
      if (
        (purpose === "auditChannel" || purpose === "reportingChannel") &&
        typeof channelId === "string"
      )
        return { kind: "channel", purpose, channelId };
      return undefined;
    }
  }
};
/** Only guild command events are decoded. No ordinary messages or raw errors logged.
 * Acknowledge before REST/database work; complete through an ephemeral webhook.
 */
export const handleModerationInteraction = (event: unknown) =>
  Effect.gen(function* () {
    const decoded = Schema.decodeUnknownOption(interaction)(event);
    if (decoded._tag === "None" || decoded.value.type !== 2) return;
    const input = decoded.value;
    const rest = yield* DiscordREST;
    const moderation = yield* Moderation;
    yield* rest.createInteractionResponse(input.id, input.token, {
      payload: { type: 5, data: { flags: 64 } },
    });
    const command = parseCommand(input);
    let content = command
      ? yield* moderation
          .execute({
            guildId: input.guild_id,
            actorId: input.member.user.id,
            command,
          })
          .pipe(
            Effect.catch(() =>
              Effect.succeed(
                "Setup unavailable: verify Discord access and database connectivity; retry this command. No change confirmed.",
              ),
            ),
          )
      : "Invalid configuration command.";
    if (
      command?.kind === "status" &&
      !content.startsWith("Denied:") &&
      !content.startsWith("Setup unavailable")
    ) {
      const intake = yield* Effect.serviceOption(Intake);
      if (intake._tag === "Some") {
        const health = yield* intake.value.status(input.guild_id);
        content += `\nService observations since process start ${health.since}: missed messages ${health.missedMessages}; active failures ${health.active.join(", ") || "none observed"}; failures ${JSON.stringify(health.failures)}. Historical loss before process start unknown. No automatic replay. Translation unavailable.`;
      }
    }
    const payload = {
      content:
        content.length <= 1900 ? content : "Private configuration attached.",
      allowed_mentions: { parse: [] },
    };
    const update = rest.updateOriginalWebhookMessage(
      input.application_id,
      input.token,
      { payload },
    );
    if (content.length <= 1900) yield* update;
    else
      yield* update.pipe(
        rest.withFiles([
          new File([content], "configuration.txt", { type: "text/plain" }),
        ]),
      );
  });
