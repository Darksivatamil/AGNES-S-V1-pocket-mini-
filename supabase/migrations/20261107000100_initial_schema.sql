-- AGNES OS 2.0 — initial schema
-- Run with: supabase db push   (or paste into the SQL editor)
-- All timestamps are UTC. All user-owned tables use RLS.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.agnes_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Atomic fixed-window rate limiter. Bucket strings are built server-side and
-- include a hash of the authenticated identity + route.
create or replace function public.agnes_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_bucket is null or length(p_bucket) < 8 or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.agnes_rate_limits (bucket, window_start, count)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set window_start = case
          when public.agnes_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else public.agnes_rate_limits.window_start
        end,
        count = case
          when public.agnes_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else public.agnes_rate_limits.count + 1
        end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.agnes_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.agnes_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------
create table public.agnes_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'AGNES User'
    check (char_length(display_name) between 1 and 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agnes_profiles_updated_at
before update on public.agnes_profiles
for each row execute function public.agnes_set_updated_at();

-- ---------------------------------------------------------------------------
-- Device settings (synced to firmware; writes via Edge Functions only)
-- ---------------------------------------------------------------------------
create table public.agnes_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personality text not null default 'friendly'
    check (personality in ('friendly','genius','savage','shy','sleepy')),
  theme text not null default 'cyber'
    check (theme in ('cyber','minimal','retro')),
  brightness integer not null default 160 check (brightness between 0 and 255),
  idle_animations boolean not null default true,
  sleep_timeout_seconds integer not null default 120
    check (sleep_timeout_seconds between 30 and 3600),
  cloud_memory_enabled boolean not null default true,
  notifications_enabled boolean not null default true,
  timezone_posix text not null default 'UTC0' check (char_length(timezone_posix) between 1 and 64),
  location_name text check (location_name is null or char_length(location_name) <= 120),
  latitude numeric(8,5) check (latitude is null or (latitude between -90 and 90)),
  longitude numeric(8,5) check (longitude is null or (longitude between -180 and 180)),
  sync_version bigint not null default 1 check (sync_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agnes_settings_updated_at
before update on public.agnes_settings
for each row execute function public.agnes_set_updated_at();

-- ---------------------------------------------------------------------------
-- Devices and credentials
-- ---------------------------------------------------------------------------
create table public.agnes_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hardware_id text not null unique check (char_length(hardware_id) between 6 and 80),
  name text not null default 'AGNES' check (char_length(name) between 1 and 80),
  board text not null default 'esp32-c3-super-mini',
  oled_controller text check (oled_controller in ('ssd1306','sh1106')),
  firmware_version text,
  last_seen_at timestamptz,
  battery_voltage_mv integer check (battery_voltage_mv is null or battery_voltage_mv between 2000 and 5000),
  battery_percent integer check (battery_percent is null or battery_percent between 0 and 100),
  wifi_rssi integer check (wifi_rssi is null or wifi_rssi between -120 and 0),
  free_heap integer check (free_heap is null or free_heap >= 0),
  uptime_seconds bigint check (uptime_seconds is null or uptime_seconds >= 0),
  current_emotion text,
  current_personality text check (current_personality is null or current_personality in ('friendly','genius','savage','shy','sleepy')),
  last_error text,
  capabilities jsonb not null default '{}'::jsonb,
  status_extra jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agnes_devices_user_idx on public.agnes_devices(user_id);
create index agnes_devices_last_seen_idx on public.agnes_devices(last_seen_at desc);

create trigger agnes_devices_updated_at
before update on public.agnes_devices
for each row execute function public.agnes_set_updated_at();

-- Device tokens are stored only as SHA-256 hashes. No browser access.
create table public.agnes_device_credentials (
  device_id uuid primary key references public.agnes_devices(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  rotated_at timestamptz
);

-- Codes are stored hashed. The raw code is returned once to the dashboard.
create table public.agnes_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (char_length(code_hash) = 64),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_device uuid references public.agnes_devices(id) on delete set null,
  created_at timestamptz not null default now()
);

create index agnes_pairing_codes_user_idx on public.agnes_pairing_codes(user_id, expires_at desc);

-- ---------------------------------------------------------------------------
-- Conversations and messages
-- ---------------------------------------------------------------------------
create table public.agnes_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.agnes_devices(id) on delete set null,
  title text not null default 'New conversation' check (char_length(title) between 1 and 120),
  archived boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index agnes_conversations_user_recent_idx
  on public.agnes_conversations(user_id, last_message_at desc)
  where deleted_at is null;

create trigger agnes_conversations_updated_at
before update on public.agnes_conversations
for each row execute function public.agnes_set_updated_at();

create table public.agnes_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agnes_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null check (char_length(content) between 1 and 4000),
  input_source text not null default 'web' check (input_source in ('web','device','system')),
  provider text,
  model text,
  emotion text,
  animation text,
  intensity integer check (intensity is null or intensity between 1 and 3),
  mood_delta integer check (mood_delta is null or mood_delta between -3 and 3),
  selected_option_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index agnes_messages_conversation_idx on public.agnes_messages(conversation_id, created_at);
create index agnes_messages_user_idx on public.agnes_messages(user_id, created_at desc);

create table public.agnes_pending_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.agnes_conversations(id) on delete cascade,
  device_id uuid references public.agnes_devices(id) on delete set null,
  question jsonb not null,
  status text not null default 'pending' check (status in ('pending','answered','expired','cancelled')),
  answer_option_id text,
  expires_at timestamptz not null,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create index agnes_pending_questions_lookup_idx
  on public.agnes_pending_questions(conversation_id, status, expires_at);

-- ---------------------------------------------------------------------------
-- Memory
-- ---------------------------------------------------------------------------
create table public.agnes_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('preference','project','learning','fact','conversation_summary','companion')),
  content text not null check (char_length(content) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  source text not null default 'user' check (source in ('user','ai_suggested','device')),
  pinned boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index agnes_memories_user_idx
  on public.agnes_memories(user_id, status, created_at desc)
  where deleted_at is null;

create trigger agnes_memories_updated_at
before update on public.agnes_memories
for each row execute function public.agnes_set_updated_at();

-- ---------------------------------------------------------------------------
-- Pet
-- ---------------------------------------------------------------------------
create table public.agnes_pet_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Agnes' check (char_length(name) between 1 and 40),
  happiness integer not null default 70 check (happiness between 0 and 100),
  energy integer not null default 80 check (energy between 0 and 100),
  hunger integer not null default 20 check (hunger between 0 and 100),
  friendship_xp integer not null default 0 check (friendship_xp >= 0),
  level integer not null default 1 check (level between 1 and 999),
  stage text not null default 'newborn' check (stage in ('newborn','curious','companion','guardian')),
  last_decay_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agnes_pet_state_updated_at
before update on public.agnes_pet_state
for each row execute function public.agnes_set_updated_at();

create table public.agnes_pet_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.agnes_devices(id) on delete set null,
  event_type text not null check (event_type in ('feed','play','rest','pet','chat','achievement','decay','sync')),
  delta_happiness integer not null default 0 check (delta_happiness between -25 and 25),
  delta_energy integer not null default 0 check (delta_energy between -25 and 25),
  delta_hunger integer not null default 0 check (delta_hunger between -25 and 25),
  xp_delta integer not null default 0 check (xp_delta between 0 and 100),
  source text not null default 'device' check (source in ('device','web','system')),
  client_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index agnes_pet_events_client_idx
  on public.agnes_pet_events(user_id, client_event_id)
  where client_event_id is not null;
create index agnes_pet_events_user_idx on public.agnes_pet_events(user_id, created_at desc);

create table public.agnes_pet_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null check (char_length(achievement_id) between 1 and 64),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

-- ---------------------------------------------------------------------------
-- Notes / tasks / diary / study / reminders
-- ---------------------------------------------------------------------------
create table public.agnes_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.agnes_devices(id) on delete set null,
  title text not null default '' check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 8000),
  pinned boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index agnes_notes_user_idx on public.agnes_notes(user_id, updated_at desc) where deleted_at is null;

create trigger agnes_notes_updated_at
before update on public.agnes_notes
for each row execute function public.agnes_set_updated_at();

create table public.agnes_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  notes text not null default '' check (char_length(notes) <= 4000),
  due_at timestamptz,
  completed_at timestamptz,
  priority integer not null default 3 check (priority between 1 and 5),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index agnes_tasks_user_idx on public.agnes_tasks(user_id, completed_at, due_at);

create trigger agnes_tasks_updated_at
before update on public.agnes_tasks
for each row execute function public.agnes_set_updated_at();

create table public.agnes_diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  title text not null default '' check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 16000),
  mood text check (mood is null or char_length(mood) <= 32),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index agnes_diary_user_idx on public.agnes_diary_entries(user_id, entry_date desc) where deleted_at is null;

create trigger agnes_diary_entries_updated_at
before update on public.agnes_diary_entries
for each row execute function public.agnes_set_updated_at();

create table public.agnes_study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes integer not null default 0 check (minutes between 0 and 1440),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);

create index agnes_study_user_idx on public.agnes_study_sessions(user_id, started_at desc);

create table public.agnes_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  notes text not null default '' check (char_length(notes) <= 2000),
  remind_at timestamptz not null,
  repeat_rule text not null default 'none' check (repeat_rule in ('none','daily','weekly','monthly')),
  delivered_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index agnes_reminders_due_idx on public.agnes_reminders(user_id, remind_at) where delivered_at is null and deleted_at is null;

create trigger agnes_reminders_updated_at
before update on public.agnes_reminders
for each row execute function public.agnes_set_updated_at();

-- ---------------------------------------------------------------------------
-- AI providers and model catalogue
-- ---------------------------------------------------------------------------
create table public.agnes_ai_providers (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openrouter','nvidia')),
  enabled boolean not null default true,
  key_hint text check (key_hint is null or char_length(key_hint) <= 12),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create trigger agnes_ai_providers_updated_at
before update on public.agnes_ai_providers
for each row execute function public.agnes_set_updated_at();

-- AES-256-GCM ciphertext, server only. Never granted to browser roles.
create table public.agnes_provider_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openrouter','nvidia')),
  ciphertext text not null,
  iv text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table public.agnes_model_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_provider text not null default 'openrouter' check (active_provider in ('openrouter','nvidia')),
  active_model_id text,
  fallback_provider text check (fallback_provider is null or fallback_provider in ('openrouter','nvidia')),
  fallback_model_id text,
  automatic_free_model boolean not null default true,
  allow_paid boolean not null default false,
  temperature numeric(3,2) not null default 0.70 check (temperature between 0 and 2),
  max_response_tokens integer not null default 220 check (max_response_tokens between 64 and 1024),
  context_messages integer not null default 12 check (context_messages between 4 and 30),
  request_timeout_ms integer not null default 25000 check (request_timeout_ms between 8000 and 45000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agnes_model_preferences_updated_at
before update on public.agnes_model_preferences
for each row execute function public.agnes_set_updated_at();

-- Global server-side catalogue cache.
create table public.agnes_model_catalogue (
  provider text not null check (provider in ('openrouter','nvidia')),
  model_id text not null,
  free_status text not null default 'unknown' check (free_status in ('free','paid','unknown')),
  billing_note text,
  context_length integer,
  max_output_tokens integer,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  primary key (provider, model_id)
);

create index agnes_model_catalogue_free_idx on public.agnes_model_catalogue(provider, free_status);

create table public.agnes_catalogue_meta (
  provider text primary key check (provider in ('openrouter','nvidia')),
  fetched_at timestamptz,
  model_count integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);

create table public.agnes_ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.agnes_messages(id) on delete set null,
  provider text not null,
  model text not null,
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  cost_usd numeric(12,8),
  created_at timestamptz not null default now()
);

create index agnes_ai_usage_user_idx on public.agnes_ai_usage(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Commands, events, notifications, sync, idempotency
-- ---------------------------------------------------------------------------
create table public.agnes_device_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.agnes_devices(id) on delete cascade,
  type text not null check (type in (
    'UPDATE_PERSONALITY','UPDATE_THEME','UPDATE_BRIGHTNESS','UPDATE_SLEEP_TIMEOUT',
    'WIFI_RECONNECT','DEVICE_RESTART','SYNC_NOW','REFRESH_SETTINGS','ENTER_SLEEP'
  )),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING','RECEIVED','EXECUTING','COMPLETED','FAILED','EXPIRED')),
  idempotency_key text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  received_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, idempotency_key)
);

create index agnes_commands_device_pending_idx
  on public.agnes_device_commands(device_id, status, created_at)
  where status in ('PENDING','RECEIVED','EXECUTING');

create trigger agnes_device_commands_updated_at
before update on public.agnes_device_commands
for each row execute function public.agnes_set_updated_at();

create table public.agnes_device_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.agnes_devices(id) on delete cascade,
  type text not null check (char_length(type) between 1 and 64),
  severity text not null default 'info' check (severity in ('debug','info','warning','error','critical')),
  message text check (message is null or char_length(message) <= 500),
  payload jsonb not null default '{}'::jsonb,
  client_event_id text,
  created_at timestamptz not null default now(),
  unique (device_id, client_event_id)
);

create index agnes_device_events_device_idx on public.agnes_device_events(device_id, created_at desc);
create index agnes_device_events_user_idx on public.agnes_device_events(user_id, created_at desc);

create table public.agnes_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.agnes_devices(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  body text not null default '' check (char_length(body) <= 1000),
  kind text not null default 'info' check (kind in ('info','reminder','system','pet','achievement')),
  deliver_at timestamptz not null default now(),
  read_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index agnes_notifications_user_idx
  on public.agnes_notifications(user_id, deliver_at desc)
  where deleted_at is null;

create table public.agnes_sync_state (
  device_id uuid primary key references public.agnes_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  cursor bigint not null default 0,
  last_pull_at timestamptz,
  last_push_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.agnes_idempotency (
  key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index agnes_idempotency_expiry_idx on public.agnes_idempotency(expires_at);

create table public.agnes_rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1
);

-- ---------------------------------------------------------------------------
-- New-user bootstrap
-- ---------------------------------------------------------------------------
create or replace function public.agnes_bootstrap_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agnes_profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email,'AGNES User'), '@', 1)), 80))
  on conflict (user_id) do nothing;

  insert into public.agnes_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.agnes_pet_state (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.agnes_model_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists agnes_on_auth_user_created on auth.users;
create trigger agnes_on_auth_user_created
after insert on auth.users
for each row execute function public.agnes_bootstrap_user();

-- ---------------------------------------------------------------------------
-- RLS enablement
-- ---------------------------------------------------------------------------
alter table public.agnes_profiles enable row level security;
alter table public.agnes_settings enable row level security;
alter table public.agnes_devices enable row level security;
alter table public.agnes_device_credentials enable row level security;
alter table public.agnes_pairing_codes enable row level security;
alter table public.agnes_conversations enable row level security;
alter table public.agnes_messages enable row level security;
alter table public.agnes_pending_questions enable row level security;
alter table public.agnes_memories enable row level security;
alter table public.agnes_pet_state enable row level security;
alter table public.agnes_pet_events enable row level security;
alter table public.agnes_pet_achievements enable row level security;
alter table public.agnes_notes enable row level security;
alter table public.agnes_tasks enable row level security;
alter table public.agnes_diary_entries enable row level security;
alter table public.agnes_study_sessions enable row level security;
alter table public.agnes_reminders enable row level security;
alter table public.agnes_ai_providers enable row level security;
alter table public.agnes_provider_credentials enable row level security;
alter table public.agnes_model_preferences enable row level security;
alter table public.agnes_model_catalogue enable row level security;
alter table public.agnes_catalogue_meta enable row level security;
alter table public.agnes_ai_usage enable row level security;
alter table public.agnes_device_commands enable row level security;
alter table public.agnes_device_events enable row level security;
alter table public.agnes_notifications enable row level security;
alter table public.agnes_sync_state enable row level security;
alter table public.agnes_idempotency enable row level security;
alter table public.agnes_rate_limits enable row level security;

-- Read-only user-owned tables (writes are mediated by Edge Functions).
create policy "profile_read_own" on public.agnes_profiles
  for select using (auth.uid() = user_id);

create policy "settings_read_own" on public.agnes_settings
  for select using (auth.uid() = user_id);

create policy "devices_read_own" on public.agnes_devices
  for select using (auth.uid() = user_id);

create policy "conversations_read_own" on public.agnes_conversations
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "conversations_rename_own" on public.agnes_conversations
  for update using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);
create policy "conversations_delete_own" on public.agnes_conversations
  for delete using (auth.uid() = user_id);

create policy "messages_read_own" on public.agnes_messages
  for select using (auth.uid() = user_id);

create policy "pending_questions_read_own" on public.agnes_pending_questions
  for select using (auth.uid() = user_id);

create policy "memories_read_own" on public.agnes_memories
  for select using (auth.uid() = user_id and deleted_at is null);

create policy "pet_state_read_own" on public.agnes_pet_state
  for select using (auth.uid() = user_id);
create policy "pet_events_read_own" on public.agnes_pet_events
  for select using (auth.uid() = user_id);
create policy "pet_achievements_read_own" on public.agnes_pet_achievements
  for select using (auth.uid() = user_id);

create policy "ai_providers_read_own" on public.agnes_ai_providers
  for select using (auth.uid() = user_id);
create policy "model_preferences_read_own" on public.agnes_model_preferences
  for select using (auth.uid() = user_id);
create policy "ai_usage_read_own" on public.agnes_ai_usage
  for select using (auth.uid() = user_id);

create policy "commands_read_own" on public.agnes_device_commands
  for select using (auth.uid() = user_id);
create policy "device_events_read_own" on public.agnes_device_events
  for select using (auth.uid() = user_id);

create policy "notifications_read_own" on public.agnes_notifications
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "notifications_mark_read_own" on public.agnes_notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notifications_delete_own" on public.agnes_notifications
  for delete using (auth.uid() = user_id);

-- User-editable application data.
create policy "notes_own" on public.agnes_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_own" on public.agnes_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "diary_own" on public.agnes_diary_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "study_own" on public.agnes_study_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reminders_own" on public.agnes_reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on table
  public.agnes_profiles, public.agnes_settings, public.agnes_devices,
  public.agnes_device_credentials, public.agnes_pairing_codes,
  public.agnes_conversations, public.agnes_messages, public.agnes_pending_questions,
  public.agnes_memories, public.agnes_pet_state, public.agnes_pet_events,
  public.agnes_pet_achievements, public.agnes_notes, public.agnes_tasks,
  public.agnes_diary_entries, public.agnes_study_sessions, public.agnes_reminders,
  public.agnes_ai_providers, public.agnes_provider_credentials,
  public.agnes_model_preferences, public.agnes_model_catalogue,
  public.agnes_catalogue_meta, public.agnes_ai_usage, public.agnes_device_commands,
  public.agnes_device_events, public.agnes_notifications, public.agnes_sync_state,
  public.agnes_idempotency, public.agnes_rate_limits
from anon, authenticated;

grant select on
  public.agnes_profiles, public.agnes_settings, public.agnes_devices,
  public.agnes_conversations, public.agnes_messages, public.agnes_pending_questions,
  public.agnes_memories, public.agnes_pet_state, public.agnes_pet_events,
  public.agnes_pet_achievements, public.agnes_ai_providers,
  public.agnes_model_preferences, public.agnes_ai_usage,
  public.agnes_device_commands, public.agnes_device_events
to authenticated;

grant update (title, archived, updated_at) on public.agnes_conversations to authenticated;
grant delete on public.agnes_conversations to authenticated;
grant update (read_at) on public.agnes_notifications to authenticated;
grant delete on public.agnes_notifications to authenticated;
grant select on public.agnes_notifications to authenticated;

grant select, insert, update, delete on
  public.agnes_notes, public.agnes_tasks, public.agnes_diary_entries,
  public.agnes_study_sessions, public.agnes_reminders
to authenticated;

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Realtime publication (RLS applies to subscribers)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agnes_messages') then
      alter publication supabase_realtime add table public.agnes_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agnes_devices') then
      alter publication supabase_realtime add table public.agnes_devices;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agnes_device_commands') then
      alter publication supabase_realtime add table public.agnes_device_commands;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agnes_notifications') then
      alter publication supabase_realtime add table public.agnes_notifications;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agnes_pet_state') then
      alter publication supabase_realtime add table public.agnes_pet_state;
    end if;
  end if;
end $$;
