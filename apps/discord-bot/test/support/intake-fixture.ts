import type { Evidence } from "../../src/capabilities/moderation/contract.ts";
export const evidence: Evidence = {
  guildId: "10",
  messageId: "100",
  version: "2026-11-13T00:00:00Z",
  authorId: "12",
  channelId: "20",
  parentId: null,
  text: "[lesson](https://bilibili.com/video/1)",
  embeds: [],
  quotes: [],
  attachments: [],
  roles: ["course"],
  restriction: "unavailable",
  limitations: ["Conversation/history/attachment contents unavailable"],
};
export const configuration = {
  guildId: "10",
  actorId: "11",
  version: 1,
  changedAt: "today",
  roles: { Owner: [], Admin: [], Moderator: ["mod"] },
  auditChannel: "30",
  reportingChannel: "31",
  prompt: "Policy",
};
