# API — AGNES Edge Functions

All endpoints are Supabase Edge Functions under:

```text
https://<project-ref>.supabase.co/functions/v1/<function>
```

They accept `POST` only (plus `OPTIONS` for CORS) and JSON bodies. Every deployed
function uses `verify_jwt = false` and performs authentication inside the function:

| Caller | Headers |
|---|---|
| Browser | `Authorization: Bearer <Supabase user access token>` |
| Device | `x-agnes-device-id: <uuid>` and `x-agnes-device-token: <64 lowercase hex>` |
| Device login | `Authorization: Bearer <64 lowercase hex device token>` plus `x-agnes-device-id` where required by the function |

`apikey` may also be required by your Supabase gateway. The browser sends the
public anon/publishable key. Never send a service-role key.

## Response envelope

Success:

```json
{ "ok": true, "data": { } }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "rate_limited",
    "message": "Too many chat requests; wait a moment",
    "details": null
  }
}
```

Validation failures use `code: "invalid_request"` with up to eight
`{ path, message }` details. Responses are `Cache-Control: no-store`.

Common errors: `unauthorized` (401), `user_auth_required` / `device_auth_required`
(403), `device_mismatch` (403), `invalid_request` (400), `rate_limited` (429),
`server_misconfigured` (500), `internal_error` (500).

## Idempotency and retries

Expensive create operations require a UUID `request_id`. The server reserves it in
`agnes_idempotency` before doing work:

- Completed request → the stored response is returned verbatim.
- Same request still running → `request_in_progress` (409).
- Failed request → reservation removed so a retry can proceed.

Use a new UUID for a genuinely new action. Retrying a network timeout with the same
UUID is safe.

## Rate limits

Fixed windows, enforced in PostgreSQL via `agnes_rate_limit`. Limits shown are per
identity (user or device) unless noted.

| Function | Limit |
|---|---|
| `agnes-chat` | 20/min and 150/hour per user |
| `agnes-models` | 20/min |
| `agnes-providers` | 30/min |
| `agnes-provider-test` | 8/min |
| `agnes-memory` | 60/min |
| `agnes-profile` | 60/min |
| `agnes-device-command` | 30/min |
| `agnes-notifications` | 60/min |
| `agnes-pet` | 30/min |
| `agnes-tools` | 30/min |
| `agnes-account` | 2/hour |
| `agnes-pair` (create code) | 10/10 min |
| `agnes-pair` (claim) | 12/10 min per IP and 8/10 min per hardware ID |
| `agnes-device-auth` | 60/min per device |
| `agnes-device-status` | 60/min per device |
| `agnes-sync` | 60/min per device |

## Functions

### `agnes-pair`

User actions (`create_code`, `revoke`, `rename`) require a browser JWT. `claim`
requires no JWT: the single-use pairing code is the proof of authorization.

```json
{ "action": "create_code" }
{ "action": "claim", "hardware_id": "agnes-abc123", "pairing_code": "AGN-XXXXX-XXXXX",
  "name": "Desk AGNES", "firmware_version": "2.0.0", "oled_controller": "ssd1306" }
{ "action": "rename", "device_id": "<uuid>", "name": "New name" }
{ "action": "revoke", "device_id": "<uuid>" }
```

`create_code` returns `{ code, expires_at, instructions }`. The code is stored as
SHA-256 and expires after 10 minutes. `claim` returns the raw 64-hex device token
**once**; only its hash is stored. Revoking deletes the credential and requires
re-pairing.

### `agnes-device-auth`

Device-only. Actions: `verify` (returns settings, device name, server time) and
`rotate` (issues a new token and invalidates the old one). The firmware calls this
after pairing and after reconnecting.

### `agnes-chat`

Browser JWT or device token. Requires `request_id` (UUID) and `action`:

```json
{ "request_id": "<uuid>", "action": "start", "input_source": "web" }
{ "request_id": "<uuid>", "action": "resume", "conversation_id": "<uuid>" }
{ "request_id": "<uuid>", "action": "message", "conversation_id": "<uuid>",
  "message": "Tell me about your day" }
{ "request_id": "<uuid>", "action": "select", "conversation_id": "<uuid>",
  "question_id": "<uuid>", "selected_option_id": "opt_1" }
```

Notes:

- `action: "message"` with `conversation_id: null` appends to the latest
  conversation. The dashboard always starts a conversation first.
- The AI is instructed to return strict JSON and exactly three short choices when
  `ask_question` is true. Plain-text legacy responses are accepted with a warning
  and without a question.
- A pending question is single-use, owned by the user, expires after 30 minutes,
  and is cancelled when a newer turn arrives.
- Response data: `reply`, `emotion`, `animation`, `intensity`, `mood_delta`,
  `question` (`{ id, type: "choice", text, options[3], expires_at }` or `null`),
  `provider`, `model`, `fallback_used`, `fallback_reason`, `selection_reason`,
  `usage`, `warning`, `pet`, `achievements`, `conversation_id`,
  `conversation_title`, `message_id`, `user_message_id`, `created_at`.

Provider and model selection, paid-model gating, retry classes and fallback policy
are described in `docs/ARCHITECTURE.md` and `docs/SECURITY.md`.

### `agnes-models`

Browser JWT. Model catalogue cache.

```json
{ "action": "list" }
{ "action": "refresh" }
{ "action": "list", "provider": "openrouter" }
```

Returns per provider: `enabled`, `has_key`, `key_source`, `key_hint`, test status,
provider error, catalogue metadata (`fetched_at`, `model_count`, `stale`,
`last_error`) and `models[]` with billing status, capabilities, context limits and
descriptions. `free_status` is `free`, `paid`, or `unknown`. NVIDIA is
`unknown`/account-managed unless the provider explicitly reports pricing.

### `agnes-providers`

Browser JWT. Actions:

```json
{ "action": "save", "provider": "openrouter", "api_key": "...", "enabled": true }
{ "action": "delete", "provider": "openrouter" }
{ "action": "test", "provider": "openrouter" }
{ "action": "select", "active_provider": "openrouter", "active_model_id": "...",
  "fallback_provider": null, "fallback_model_id": null,
  "automatic_free_model": true, "allow_paid": false,
  "temperature": 0.8, "max_response_tokens": 300, "context_messages": 12,
  "request_timeout_ms": 25000 }
```

Keys are encrypted before storage and only a hint is returned. `select` rejects a
paid/unknown model unless `allow_paid: true`; the fallback cannot equal the active
model.

### `agnes-provider-test`

Browser JWT. `{ "provider": "openrouter" }` sends a minimal authenticated request
and records `last_test_at`, `last_test_ok`, and `last_error`.

### `agnes-memory`

Browser JWT. Actions: `list` (`query`, `category`, `status`, `limit`, `offset`),
`create`, `update`, `delete`. AI-suggested memories are `pending` until the user
approves them. Only approved memories are sent to the AI when cloud memory is
enabled.

### `agnes-sync`

Device only. One compact request carries uploads and pulls down the device state:

```json
{
  "request_id": "<uuid>",
  "action": "sync",
  "settings_version": 3,
  "status": { "firmware_version": "2.0.0", "battery_voltage_mv": 3980, "...": "..." },
  "pet_events": [{ "client_event_id": "evt-1", "event_type": "play" }],
  "notes": [{ "id": "<uuid>", "title": "...", "body": "...", "pinned": false,
              "version": 2, "deleted": false }],
  "device_events": [{ "client_event_id": "evt-2", "type": "wifi_reconnect",
                      "severity": "info", "message": "...", "payload": {} }],
  "commands_ack": [{ "id": "<uuid>", "status": "COMPLETED", "error": null }],
  "notifications_read": ["<uuid>"]
}
```

Caps: pet events 20, notes 30, device events 30, acknowledgements 20, read IDs 30.
The response is capped to firmware buffers: 20 notes (title 48/body 400), 12
memories (240 chars), 5 notifications, 8 commands and one pending question with
exactly three options. Empty/absent arrays are valid.

### `agnes-device-status`

Device only. `{ "request_id": "<uuid>", "status": { ... } }`. Updates last-seen,
battery, RSSI, heap, uptime, emotion/personality. A non-empty `last_error` also
creates a warning event.

### `agnes-device-command`

Browser JWT. Queues one allowlisted command:

```json
{ "request_id": "<uuid>", "device_id": "<uuid>", "type": "UPDATE_BRIGHTNESS",
  "payload": { "brightness": 180 } }
```

Allowed types and payloads:

| Type | Payload |
|---|---|
| `UPDATE_PERSONALITY` | `{ "personality": "friendly" }` |
| `UPDATE_THEME` | `{ "theme": "cyber" }` |
| `UPDATE_BRIGHTNESS` | `{ "brightness": 0–255 }` |
| `UPDATE_SLEEP_TIMEOUT` | `{ "seconds": 30–3600 }` |
| `WIFI_RECONNECT` | `{}` |
| `DEVICE_RESTART` | `{}` |
| `SYNC_NOW` | `{}` |
| `REFRESH_SETTINGS` | `{}` |
| `ENTER_SLEEP` | `{}` |

Lifecycle: `PENDING → RECEIVED → EXECUTING → COMPLETED|FAILED`, or `EXPIRED` after
15 minutes. The device validates the payload again before applying it.

### `agnes-profile`

Browser JWT. Actions:

- `get` — profile, settings, pet state, model preferences, devices, achievements.
- `update_profile` — `display_name` (1–80 chars).
- `update_settings` — personality, theme, brightness, idle animations, sleep
  timeout, cloud memory, notifications, POSIX timezone, location name/lat/lon.
  Increments `sync_version`; the device applies it on the next sync.
- `update_pet_name` — 1–40 chars.

Latitude and longitude must be supplied together or both omitted.

### `agnes-notifications`

Browser JWT. Actions: `list`, `create` (`request_id`, title, body, kind,
optional device and `deliver_at`), `mark_read`, `delete`. Device notifications are
read-only on the physical device; approval/authoring happens in the dashboard.

### `agnes-pet`

Browser JWT. Actions: `interact` (`request_id`, one of `feed`, `play`, `rest`,
`pet`) and `list_events`. Cooldowns, bounded deltas, achievements and levels are
server-authoritative. Device interactions sync through `agnes-sync` and are
replayed idempotently.

### `agnes-tools`

Browser JWT or device token. Actions:

- `weather` with optional `latitude`/`longitude` (Open-Meteo).
- `dictionary` with a word.
- `translate` with text and target language (uses the configured AI model and the
  same paid-model guardrails).

External tools return their source and error honestly when the upstream service
fails.

### `agnes-account`

Browser JWT. Destructive account deletion:

```json
{ "action": "delete", "confirmation": "DELETE" }
```

Deletes the user's data through the documented cascade. This cannot be undone.

## CORS

Browser origins are allowlisted by `AGNES_ALLOWED_ORIGINS`. Production fails closed
when the list is empty. Device requests have no `Origin` and rely on device
authentication, not CORS.
