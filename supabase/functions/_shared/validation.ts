import { z } from "npm:zod@3.23.8";

export const API_VERSION = "2.0";

export const uuid = z.string().uuid();
export const providerSchema = z.enum(["openrouter", "nvidia"]);
export const personalitySchema = z.enum(["friendly", "genius", "savage", "shy", "sleepy"]);
export const emotionSchema = z.enum([
  "normal", "happy", "excited", "love", "angry", "sad", "sleepy", "surprised",
  "thinking", "curious", "shy", "cool", "confused", "concerned", "playful",
]);
export const animationSchema = z.enum([
  "blink", "bounce", "sway", "sparkle", "shake", "float", "none",
]);
export const memoryCategorySchema = z.enum([
  "preference", "project", "learning", "fact", "conversation_summary", "companion",
]);
export const memoryStatusSchema = z.enum(["pending", "approved", "rejected"]);
export const themeSchema = z.enum(["cyber", "minimal", "retro"]);

export const requestBase = z.object({
  request_id: uuid,
  api_version: z.literal(API_VERSION).optional(),
  device_id: uuid.optional(),
}).strict();

export const chatRequestSchema = z.discriminatedUnion("action", [
  requestBase.extend({
    action: z.literal("start"),
    conversation_id: uuid.nullable().optional(),
    input_source: z.enum(["web", "device"]).optional(),
  }),
  requestBase.extend({
    action: z.literal("resume"),
    conversation_id: uuid.nullable().optional(),
    input_source: z.enum(["web", "device"]).optional(),
  }),
  requestBase.extend({
    action: z.literal("message"),
    conversation_id: uuid.nullable().optional(),
    message: z.string().trim().min(1).max(1000),
    input_source: z.enum(["web", "device"]).optional(),
  }),
  requestBase.extend({
    action: z.literal("select"),
    conversation_id: uuid.nullable().optional(),
    question_id: uuid,
    selected_option_id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    input_source: z.enum(["web", "device"]).optional(),
  }),
]);

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const questionOptionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  label: z.string().trim().min(1).max(32),
}).strict();

export const questionSchema = z.object({
  type: z.literal("choice"),
  text: z.string().trim().min(1).max(80),
  options: z.array(questionOptionSchema).length(3),
}).strict().superRefine((question, ctx) => {
  const ids = new Set(question.options.map((option) => option.id));
  if (ids.size !== question.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Option IDs must be unique" });
  }
  const labels = new Set(question.options.map((option) => option.label.toLowerCase()));
  if (labels.size !== question.options.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "Option labels must be unique" });
  }
});

export const aiReplySchema = z.object({
  reply: z.string().trim().min(1).max(600),
  emotion: emotionSchema,
  animation: animationSchema,
  intensity: z.number().int().min(1).max(3),
  mood_delta: z.number().int().min(-3).max(3),
  ask_question: z.boolean(),
  question: questionSchema.nullish(),
  memory_suggestion: z.object({
    category: memoryCategorySchema,
    content: z.string().trim().min(1).max(280),
  }).strict().nullish(),
}).strict();

export type AiReply = z.infer<typeof aiReplySchema>;

export const memoryRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    query: z.string().trim().max(120).optional(),
    category: memoryCategorySchema.optional(),
    status: memoryStatusSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(5000).default(0),
  }).strict(),
  z.object({
    action: z.literal("create"),
    request_id: uuid,
    category: memoryCategorySchema,
    content: z.string().trim().min(1).max(1000),
    pinned: z.boolean().default(false),
  }).strict(),
  z.object({
    action: z.literal("update"),
    id: uuid,
    category: memoryCategorySchema.optional(),
    content: z.string().trim().min(1).max(1000).optional(),
    status: memoryStatusSchema.optional(),
    pinned: z.boolean().optional(),
  }).strict(),
  z.object({ action: z.literal("delete"), id: uuid }).strict(),
]);

export const providerActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    provider: providerSchema,
    api_key: z.string().trim().min(16).max(300),
    enabled: z.boolean().default(true),
  }).strict(),
  z.object({ action: z.literal("delete"), provider: providerSchema }).strict(),
  z.object({ action: z.literal("test"), provider: providerSchema }).strict(),
  z.object({
    action: z.literal("select"),
    active_provider: providerSchema,
    active_model_id: z.string().trim().min(1).max(200),
    fallback_provider: providerSchema.nullish(),
    fallback_model_id: z.string().trim().min(1).max(200).nullish(),
    automatic_free_model: z.boolean(),
    allow_paid: z.boolean(),
    temperature: z.number().min(0).max(2),
    max_response_tokens: z.number().int().min(64).max(1024),
    context_messages: z.number().int().min(4).max(30),
    request_timeout_ms: z.number().int().min(8000).max(45000),
  }).strict(),
]);

export const modelsRequestSchema = z.object({
  action: z.enum(["list", "refresh"]).default("list"),
  provider: providerSchema.optional(),
}).strict();

export const profileRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get") }).strict(),
  z.object({
    action: z.literal("update_profile"),
    display_name: z.string().trim().min(1).max(80),
  }).strict(),
  z.object({
    action: z.literal("update_settings"),
    personality: personalitySchema.optional(),
    theme: themeSchema.optional(),
    brightness: z.number().int().min(0).max(255).optional(),
    idle_animations: z.boolean().optional(),
    sleep_timeout_seconds: z.number().int().min(30).max(3600).optional(),
    cloud_memory_enabled: z.boolean().optional(),
    notifications_enabled: z.boolean().optional(),
    timezone_posix: z.string().trim().min(1).max(64).optional(),
    location_name: z.string().trim().max(120).nullish(),
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
  }).strict(),
  z.object({
    action: z.literal("update_pet_name"),
    name: z.string().trim().min(1).max(40),
  }).strict(),
]);

export const commandTypes = [
  "UPDATE_PERSONALITY",
  "UPDATE_THEME",
  "UPDATE_BRIGHTNESS",
  "UPDATE_SLEEP_TIMEOUT",
  "WIFI_RECONNECT",
  "DEVICE_RESTART",
  "SYNC_NOW",
  "REFRESH_SETTINGS",
  "ENTER_SLEEP",
] as const;

export const commandTypeSchema = z.enum(commandTypes);

export function validateCommandPayload(type: string, payload: unknown): Record<string, unknown> {
  switch (type) {
    case "UPDATE_PERSONALITY":
      return z.object({ personality: personalitySchema }).strict().parse(payload);
    case "UPDATE_THEME":
      return z.object({ theme: themeSchema }).strict().parse(payload);
    case "UPDATE_BRIGHTNESS":
      return z.object({ brightness: z.number().int().min(0).max(255) }).strict().parse(payload);
    case "UPDATE_SLEEP_TIMEOUT":
      return z.object({ seconds: z.number().int().min(30).max(3600) }).strict().parse(payload);
    case "WIFI_RECONNECT":
    case "DEVICE_RESTART":
    case "SYNC_NOW":
    case "REFRESH_SETTINGS":
    case "ENTER_SLEEP":
      return z.object({}).strict().parse(payload ?? {});
    default:
      throw new Error("Unknown command type");
  }
}

export const commandRequestSchema = z.object({
  request_id: uuid,
  device_id: uuid,
  type: commandTypeSchema,
  payload: z.unknown().default({}),
}).strict();

export const petRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("interact"),
    request_id: uuid,
    interaction: z.enum(["feed", "play", "rest", "pet"]),
  }).strict(),
  z.object({
    action: z.literal("list_events"),
    limit: z.number().int().min(1).max(100).default(30),
  }).strict(),
]);

export const notificationRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    limit: z.number().int().min(1).max(100).default(50),
  }).strict(),
  z.object({
    action: z.literal("create"),
    request_id: uuid,
    device_id: uuid.nullish(),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().max(1000).default(""),
    kind: z.enum(["info", "reminder", "system", "pet", "achievement"]).default("info"),
    deliver_at: z.string().datetime({ offset: true }).optional(),
  }).strict(),
  z.object({ action: z.literal("mark_read"), id: uuid }).strict(),
  z.object({ action: z.literal("delete"), id: uuid }).strict(),
]);

export const toolRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("weather"),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }).strict(),
  z.object({
    action: z.literal("dictionary"),
    word: z.string().trim().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z' -]*$/),
  }).strict(),
  z.object({
    action: z.literal("translate"),
    text: z.string().trim().min(1).max(800),
    target_language: z.string().trim().min(2).max(40),
  }).strict(),
]);

export const deviceStatusSchema = z.object({
  firmware_version: z.string().trim().min(1).max(40),
  battery_voltage_mv: z.number().int().min(2000).max(5000).optional(),
  battery_percent: z.number().int().min(0).max(100).optional(),
  wifi_rssi: z.number().int().min(-120).max(0).optional(),
  free_heap: z.number().int().min(0).max(1_000_000_000).optional(),
  uptime_seconds: z.number().int().min(0).max(1_000_000_000).optional(),
  current_emotion: emotionSchema.optional(),
  current_personality: personalitySchema.optional(),
  last_error: z.string().trim().max(500).nullish(),
  oled_controller: z.enum(["ssd1306", "sh1106"]).optional(),
  status_extra: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict();

export const deviceStatusRequestSchema = z.object({
  request_id: uuid,
  status: deviceStatusSchema,
}).strict();

export const syncRequestSchema = z.object({
  request_id: uuid,
  action: z.literal("sync"),
  settings_version: z.number().int().min(0).max(1_000_000_000).optional(),
  status: deviceStatusSchema.optional(),
  pet_events: z.array(z.object({
    client_event_id: z.string().trim().min(1).max(80),
    event_type: z.enum(["feed", "play", "rest", "pet"]),
  }).strict()).max(20).default([]),
  notes: z.array(z.object({
    id: uuid,
    title: z.string().max(160).default(""),
    body: z.string().max(8000).default(""),
    pinned: z.boolean().default(false),
    version: z.number().int().min(1).max(1_000_000),
    deleted: z.boolean().default(false),
  }).strict()).max(30).default([]),
  device_events: z.array(z.object({
    client_event_id: z.string().trim().min(1).max(80),
    type: z.string().trim().min(1).max(64),
    severity: z.enum(["debug", "info", "warning", "error", "critical"]).default("info"),
    message: z.string().trim().max(500).nullish(),
    payload: z.record(z.unknown()).default({}),
  }).strict()).max(30).default([]),
  commands_ack: z.array(z.object({
    id: uuid,
    status: z.enum(["RECEIVED", "EXECUTING", "COMPLETED", "FAILED"]),
    error: z.string().trim().max(500).nullish(),
  }).strict()).max(20).default([]),
  notifications_read: z.array(uuid).max(30).default([]),
}).strict();

export const deviceAuthRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify") }).strict(),
  z.object({ action: z.literal("rotate") }).strict(),
]);

