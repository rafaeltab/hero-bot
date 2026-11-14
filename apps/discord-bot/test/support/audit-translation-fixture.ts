/** Controlled QA originals and meaning rubrics, not deterministic paid-model wording. */
export const auditFixtures = [
  {
    language: "es",
    original: "Tengo copias del curso de pago, escríbeme por privado.",
    english: "I have copies of the paid course; message me privately.",
  },
  {
    language: "zh",
    original: "我有完整的付费课程，私信我。",
    english: "I have the complete paid course; message me privately.",
  },
  {
    language: "ru",
    original: "У меня есть копии платного курса.",
    english: "I have copies of the paid course.",
  },
  {
    language: "pt",
    original: "Tenho cópias do curso pago, fale comigo em particular.",
    english: "I have copies of the paid course; contact me privately.",
  },
  {
    language: "ar",
    original: "لدي نسخ من الدورة المدفوعة، راسلني على الخاص.",
    english: "I have copies of the paid course; message me privately.",
  },
];
export const auditRecord = {
  targetLanguage: "en" as const,
  status: "available" as const,
  source: { guildId: "10", messageId: "100", version: "2026-11-13T00:00:00Z" },
  detector: "tinyld/1.3.4",
  selectionOmissions: [],
  systemPrompt: "Controlled audit translation instructions",
  model: "gpt-6-luna",
  provider: "openai/chat",
  configurationVersion: 1,
  attemptedAt: "2026-11-13T00:00:01Z",
  limitation: "Audit aid only; original judgment retained.",
  excerpts: [
    {
      pointer: "/text",
      original: "我有完整的付费课程，私信我。",
      language: "zh",
      english: "I have the complete paid course; message me privately.",
      status: "available" as const,
    },
  ],
};
