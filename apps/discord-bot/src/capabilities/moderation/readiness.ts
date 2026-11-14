import type { Configuration } from "./contract.ts";
import type { Access } from "./ports.ts";

const setup =
  "https://github.com/rafaeltab/hero-bot/blob/integration/spec-26-notification-only/docs/moderation-configuration.md";
const operations =
  "https://github.com/rafaeltab/hero-bot/blob/integration/spec-26-notification-only/docs/moderation-intake.md";
const routes = (c: Configuration) => [c.auditChannel, c.reportingChannel];
const surface = (
  c: Configuration,
  channel: NonNullable<Access["monitoring"]>[number],
) => {
  const exempt =
    routes(c).includes(channel.id) ||
    (channel.thread && routes(c).includes(channel.parentId));
  if (exempt)
    return `Channel ${channel.id}: configured exempt route true; not assessed.`;
  if (!channel.supported)
    return `WARNING Channel ${channel.id}: unsupported surface; no audio/DM monitoring.`;
  return `Channel ${channel.id}: configured exempt route false; ${channel.readable ? "eligible for creation/edit monitoring (subject to author exemptions and service readiness)" : "ERROR monitoring/context inaccessible; grant bot View Channel and Read Message History on this channel/parent and invite bot to private threads"}.${channel.thread ? " Thread membership/archive state may still prevent access; verify with a controlled probe." : ""}`;
};
/** Non-destructive permission/configuration evidence, never a live delivery certificate. */
export const describeReadiness = (
  config: Configuration,
  access: Access,
  problems: string[],
  command: { kind: "doctor" } | { kind: "status"; channelId: string },
): string => {
  const channels = access.monitoring ?? [];
  const selected =
    command.kind === "status"
      ? channels.filter((c) => c.id === command.channelId)
      : channels;
  const fallback =
    command.kind === "status" && selected.length === 0
      ? [
          `Channel ${command.channelId}: ${access.channels.some((c) => c.id === command.channelId) ? "available" : "ERROR missing or cross-server; choose an existing channel in this server"}; configured exempt route ${routes(config).includes(command.channelId)}; WARNING monitoring access unverified.`,
        ]
      : [];
  return [
    `Notification-only readiness; configuration version ${config.version}. Fresh Discord identities/owner/member roles and channel overwrites read; mapped-role identities validated.`,
    "Database: configuration read succeeded; write/retention connectivity not probed by this read-only command.",
    ...problems.map(
      (p) => `ERROR server monitoring/private evidence blocked: ${p}`,
    ),
    access.messageContent === true
      ? "Message Content application flag enabled; runtime requests Guilds, Guild Messages and Message Content. Live event content still requires a controlled probe."
      : "ERROR Message Content intent unverified/disabled: enable Message Content Intent in https://discord.com/developers/applications > application > Bot; restart --moderation. Without it ordinary content may be missing. Runtime requests Guilds/Guild Messages/Message Content.",
    ...selected.map((c) => surface(config, c)),
    ...fallback,
    ...(channels.length === 0
      ? [
          "WARNING monitored surfaces unverified; run --moderation and inspect each ordinary/private course, forum/thread and voice-text channel.",
        ]
      : []),
    "Private audit/report channel, mapped recipients, thread creation and uploads: configured permissions checked; actual creation/upload requires an explicit controlled probe. No evidence messages or paid calls sent here.",
    "Member roles: current REST observation; actual restriction and Discord action-history ingestion unavailable. Empty recorded history does not mean clean history.",
    "Automatic ban, purgatory and deletion: disabled. Execution is outside this slice. Confidential intake/full review and execution/purgatory/isolation checks: unavailable until later slices. No server-wide isolation certification.",
    `Owner/Admin repairs: /moderation config role, unmap, channel or prompt. Moderator access is read-only; actual owner can always repair. Setup: ${setup}; service/budget/probe procedures: ${operations}. Re-run after repairs; no automatic permission changes.`,
  ].join("\n");
};
