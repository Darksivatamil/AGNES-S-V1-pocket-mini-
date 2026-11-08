export type ProviderId = "openrouter" | "nvidia";
export type FreeStatus = "free" | "paid" | "unknown";
export type Personality = "friendly" | "genius" | "savage" | "shy" | "sleepy";
export type Theme = "cyber" | "minimal" | "retro";
export type MemoryCategory =
  | "preference"
  | "project"
  | "learning"
  | "fact"
  | "conversation_summary"
  | "companion";
export type MemoryStatus = "pending" | "approved" | "rejected";

export type Profile = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Settings = {
  personality: Personality;
  theme: Theme;
  brightness: number;
  idle_animations: boolean;
  sleep_timeout_seconds: number;
  cloud_memory_enabled: boolean;
  notifications_enabled: boolean;
  timezone_posix: string;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  sync_version: number;
  updated_at?: string;
};

export type Device = {
  id: string;
  hardware_id: string;
  name: string;
  board?: string;
  oled_controller: "ssd1306" | "sh1106" | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  battery_voltage_mv: number | null;
  battery_percent: number | null;
  wifi_rssi: number | null;
  free_heap: number | null;
  uptime_seconds: number | null;
  current_emotion: string | null;
  current_personality: Personality | null;
  last_error: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type PetState = {
  user_id: string;
  name: string;
  happiness: number;
  energy: number;
  hunger: number;
  friendship_xp: number;
  level: number;
  stage: "newborn" | "curious" | "companion" | "guardian";
  last_decay_at: string;
  version: number;
  updated_at: string;
};

export type PetEvent = {
  id: string;
  event_type: string;
  delta_happiness: number;
  delta_energy: number;
  delta_hunger: number;
  xp_delta: number;
  source: string;
  payload?: Record<string, unknown>;
  created_at: string;
};

export type Achievement = {
  achievement_id: string;
  unlocked_at: string;
};

export type Conversation = {
  id: string;
  title: string;
  device_id: string | null;
  archived: boolean;
  last_message_at: string;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  input_source: "web" | "device" | "system";
  provider: string | null;
  model: string | null;
  emotion: string | null;
  animation: string | null;
  intensity: number | null;
  selected_option_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type PendingQuestion = {
  id: string;
  conversation_id: string;
  question: {
    type: "choice";
    text: string;
    options: { id: string; label: string }[];
  };
  status: string;
  expires_at: string;
  created_at: string;
};

export type Memory = {
  id: string;
  category: MemoryCategory;
  content: string;
  status: MemoryStatus;
  source: "user" | "ai_suggested" | "device";
  pinned: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: string;
  device_id: string | null;
  title: string;
  body: string;
  kind: "info" | "reminder" | "system" | "pet" | "achievement";
  deliver_at: string;
  read_at: string | null;
  created_at: string;
};

export type CatalogueModel = {
  id: string;
  name: string;
  free_status: FreeStatus;
  billing_note: string | null;
  context_length: number | null;
  max_output_tokens: number | null;
  input_modalities: string[];
  output_modalities: string[];
  supports_tools: boolean;
  supports_structured_output: boolean;
  supports_reasoning: boolean;
  description: string | null;
};

export type ProviderCatalogue = {
  provider: ProviderId;
  enabled: boolean;
  has_key: boolean;
  key_source: "user" | "environment" | null;
  key_hint: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  provider_error: string | null;
  catalogue: {
    fetched_at: string | null;
    model_count: number;
    stale: boolean;
    last_error: string | null;
  };
  models: CatalogueModel[];
};

export type ModelPreferences = {
  user_id?: string;
  active_provider: ProviderId;
  active_model_id: string;
  fallback_provider: ProviderId | null;
  fallback_model_id: string | null;
  automatic_free_model: boolean;
  allow_paid: boolean;
  temperature: number;
  max_response_tokens: number;
  context_messages: number;
  request_timeout_ms: number;
};

export type Command = {
  id: string;
  device_id: string;
  type: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "RECEIVED" | "EXECUTING" | "COMPLETED" | "FAILED" | "EXPIRED";
  error?: string | null;
  expires_at: string;
  created_at: string;
  acknowledged_at?: string | null;
  completed_at?: string | null;
};

export type DeviceEvent = {
  id: string;
  device_id: string | null;
  type: string;
  severity: "debug" | "info" | "warning" | "error" | "critical";
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type AiUsage = {
  id: string;
  message_id: string | null;
  provider: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | string | null;
  created_at: string;
};

export type ChatResult = {
  request_id: string;
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  user_message_id: string | null;
  reply: string;
  emotion: string;
  animation: string;
  intensity: number;
  mood_delta: number;
  question: {
    id: string;
    type: "choice";
    text: string;
    options: { id: string; label: string }[];
    expires_at: string;
  } | null;
  provider: ProviderId;
  model: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  selection_reason: string | null;
  warning: string | null;
  pet: { happiness: number; level: number; friendship_xp: number };
  achievements: string[];
  created_at: string;
};

export type ProfilePayload = {
  profile: Profile;
  settings: Settings;
  pet_state: PetState;
  model_preferences: ModelPreferences | null;
  devices: Device[];
  achievements: Achievement[];
};
