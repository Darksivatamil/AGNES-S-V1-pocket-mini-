# AGNES OS 2.0 — Architecture

## 1. Trust boundaries

| Boundary | Trusted | Rules |
|---|---|---|
| ESP32-C3 firmware | Device token only | No provider/service keys. HTTPS certificate bundle verification. Commands allowlisted and re-validated on-device. |
| Browser | Public Supabase anon key + user session | RLS on every user table. No privileged calls. |
| Edge Functions | Supabase service role, provider secrets | Manual user/device authentication. Zod validation. Rate limits. Idempotency. Never log message bodies. |
| PostgreSQL | RLS | Users read only their rows. Writes to sensitive tables only through service role. |
| AI providers | Data needed for one reply | Bounded context. Approved memories only. AI output is untrusted data, never executable. |

## 2. Device behavior

- Single-core ESP32-C3, Arduino framework.
- Main loop owns display, buttons, animation and local state.
- One FreeRTOS network worker performs HTTPS with `esp_http_client` and the ESP-IDF
  certificate bundle; it posts compact events back to the UI. No network call blocks
  drawing or button input.
- A central fixed-size event queue avoids cross-task pointers and heap churn.
- Settings in NVS; notes/queue/chat cache in LittleFS with atomic rename.
- Offline: face, menus, pet, local apps, notes and cached chat remain usable. Cloud AI
  is explicitly unavailable; there is no fake on-device LLM.
- Power: the screen turns off after the idle timeout. Light sleep is entered only
  when the screen is off **and** Wi-Fi is disconnected; with Wi-Fi connected the
  device stays awake so it can sync. A timer-only deep-sleep helper exists, but no
  automatic deep-sleep transition is scheduled in 2.0.0 because the button GPIOs are
  not RTC wake sources on the ESP32-C3. Runtime claims must be measured.
- Wi-Fi reconnects with capped exponential backoff; the radio remains connected while
  the device is awake unless the connection drops.

## 3. Three-button conversation protocol

1. Device calls `agnes-chat` with `action=start` or `action=resume`.
2. Server returns a short `reply` plus an optional validated `question` with exactly
   three options `{id,label}` and a `question_id`.
3. Device renders the reply (paged) and options. PREV/NEXT move the selection;
   SELECT sends `action=select` with `question_id` and `selected_option_id`.
4. Server verifies the pending question, expiry, ownership and option membership;
   it converts the label into the next user turn and calls the AI.
5. Web chat uses the same conversation and message tables and can also answer the same
   pending question. Both interfaces share one history.

The device never interprets an option as a hardware or shell command.

## 4. AI orchestration

- Provider-independent adapters: OpenRouter and NVIDIA NIM (OpenAI-compatible chat
  completions, separate error mapping and health checks).
- Live model catalogues are cached in `agnes_model_catalogue` with timestamps.
- Free/paid status comes from live metadata. OpenRouter zero-priced/`:free` models are
  free; NVIDIA hosted endpoints expose no pricing metadata, so they are marked
  `unknown`/account-managed and require explicit paid/account enablement — they are
  never falsely labeled free.
- Paid requests are blocked unless `allow_paid=true`. A fallback never silently moves
  a free request to a paid model.
- Retry only temporary classes (429, 5xx, timeout, network, model unavailable).
  Authentication/validation errors are not retried.
- Every message records the provider/model that actually answered, and whether a
  fallback occurred.

## 5. Memory

- Cloud memories have `status=pending|approved|rejected`, category, source and version.
- AI suggestions are always pending. Only approved memories are injected into context,
  and only when cloud memory is enabled.
- Local memory: NVS settings, LittleFS notes/memories/offline queue, bounded RAM chat
  context.
- Sync uses UUIDs, `client_event_id`/idempotency keys, versions and soft deletes.

## 6. Pet and emotion

- Server pet engine validates events, cooldowns, bounded deltas and idempotency; the
  device keeps a local cache and adopts the canonical server state after sync.
- AI output can suggest only a validated emotion/animation/intensity and bounded mood
  delta. The device independently validates it; AI never writes pet values directly.
- 15 emotions have compact rounded-rectangle eye designs; personality changes prompt,
  greetings, idle behavior and animation preference.

## 7. Web

- Next.js App Router, TypeScript, Tailwind, Supabase SSR auth.
- RLS-protected reads and app CRUD; privileged operations through Edge Functions.
- No Supabase Realtime subscription is used in 2.0.0. Chat refreshes the shared thread
  every 15 seconds, and the Devices page polls devices/commands every 15 seconds while
  visible. Reads remain RLS-scoped.
- Responsive dark "cyber" UI with explicit loading/empty/offline/error states.

## 8. Deployment

- Vercel hosts `web/`; Supabase hosts the database and Edge Functions. No Realtime
  service is used.
- Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` reach the browser.
- Function secrets: `AGNES_CREDENTIAL_ENC_KEY`, optional global
  `OPENROUTER_API_KEY`/`NVIDIA_API_KEY`, `AGNES_ALLOWED_ORIGINS`.
