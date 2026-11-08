import type { MemoryCategory, Personality, Theme } from "@/lib/types";

export const personalities: { id: Personality; label: string; blurb: string }[] = [
  { id: "friendly", label: "Friendly", blurb: "Warm, upbeat and encouraging." },
  { id: "genius", label: "Genius", blurb: "Precise, analytical and curious." },
  { id: "savage", label: "Savage", blurb: "Blunt, witty and a little merciless." },
  { id: "shy", label: "Shy", blurb: "Soft-spoken, gentle and thoughtful." },
  { id: "sleepy", label: "Sleepy", blurb: "Slow, cozy and low-energy." },
];

export const themes: { id: Theme; label: string }[] = [
  { id: "cyber", label: "Cyber" },
  { id: "minimal", label: "Minimal" },
  { id: "retro", label: "Retro" },
];

export const memoryCategories: { id: MemoryCategory; label: string }[] = [
  { id: "preference", label: "Preference" },
  { id: "project", label: "Project" },
  { id: "learning", label: "Learning" },
  { id: "fact", label: "Fact" },
  { id: "conversation_summary", label: "Conversation summary" },
  { id: "companion", label: "Companion" },
];

export const notificationKinds = [
  { id: "info", label: "Info" },
  { id: "reminder", label: "Reminder" },
  { id: "system", label: "System" },
  { id: "pet", label: "Pet" },
  { id: "achievement", label: "Achievement" },
] as const;

export const commandCatalog = [
  {
    type: "UPDATE_PERSONALITY",
    label: "Set personality",
    description: "Applies a new personality on the device.",
    fields: ["personality"],
  },
  {
    type: "UPDATE_THEME",
    label: "Set theme",
    description: "Switches the OLED color scheme.",
    fields: ["theme"],
  },
  {
    type: "UPDATE_BRIGHTNESS",
    label: "Set brightness",
    description: "Changes display brightness (0-255).",
    fields: ["brightness"],
  },
  {
    type: "UPDATE_SLEEP_TIMEOUT",
    label: "Set sleep timeout",
    description: "Screen-off timeout in seconds (30-3600).",
    fields: ["seconds"],
  },
  {
    type: "WIFI_RECONNECT",
    label: "Reconnect Wi-Fi",
    description: "Drops and reconnects the current Wi-Fi network.",
    fields: [],
  },
  {
    type: "DEVICE_RESTART",
    label: "Restart device",
    description: "Reboots the ESP32-C3.",
    fields: [],
  },
  {
    type: "SYNC_NOW",
    label: "Sync now",
    description: "Requests an immediate cloud sync.",
    fields: [],
  },
  {
    type: "REFRESH_SETTINGS",
    label: "Refresh settings",
    description: "Pulls the latest cloud settings.",
    fields: [],
  },
  {
    type: "ENTER_SLEEP",
    label: "Enter sleep",
    description: "Puts the device into screen-off sleep.",
    fields: [],
  },
] as const;

export const achievementLabels: Record<string, string> = {
  friendship_5: "Friendship 5",
  friendship_10: "Friendship 10",
  level_5: "Reached level 5",
  level_10: "Reached level 10",
  level_20: "Reached level 20",
};

export function achievementLabel(id: string): string {
  return achievementLabels[id] ?? id.replace(/[-_]/g, " ");
}

export const emotionEmoji: Record<string, string> = {
  normal: "•",
  happy: "◡",
  excited: "!",
  love: "♥",
  angry: ">",
  sad: ";",
  sleepy: "z",
  surprised: "o",
  thinking: "…",
  curious: "?",
  shy: "~",
  cool: "B",
  confused: "?",
  concerned: "!",
  playful: ":P",
};
