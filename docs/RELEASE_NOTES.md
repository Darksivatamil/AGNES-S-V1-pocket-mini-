# Release notes

## 2.0.0 — source release

Date: 2026-11-08
Status: source-complete; build-verified in this environment; **not deployed or
hardware-tested** here.

### Highlights

- ESP32-C3 firmware with U8g2 OLED rendering (SSD1306/SH1106 switch), three-button
  input, 15 emotions, 5 personalities, virtual pet, local apps, Wi-Fi setup portal,
  NVS/LittleFS storage, and a non-blocking FreeRTOS network worker.
- Shared three-choice conversation protocol between the OLED device and the Next.js
  dashboard, including expiry, ownership checks and a single-use answer lifecycle.
- Supabase schema with 29 application tables, RLS on all user data, atomic rate
  limiting, chat finalization, idempotency, command acknowledgements, pet engine, and
  usage rows.
- 15 Edge Functions with strict Zod validation, manual browser/device authentication,
  AES-256-GCM provider-key encryption, provider adapters for OpenRouter and NVIDIA
  NIM, live catalogue caching, paid/unknown model gating, and retry policy.
- Dashboard pages: overview, devices, chat, memories, notes, notifications, pet,
  providers, model center, settings, diagnostics, login.
- GitHub Actions CI/CD: dashboard typecheck/build, Edge Function checks/tests,
  SQL parsing, firmware compile with artifact upload, and Supabase deployment
  with schema preflight, migration baselining, secrets and function smoke test.
- Nine allowlisted device commands with a full acknowledgement lifecycle and 15-minute
  expiry; local-only settings changes are separate from cloud sync versions.
- Honest offline behavior: no fabricated replies, no on-device LLM, no simulated
  hardware health, no invented deployment status.

### Verification performed

| Check | Result |
|---|---|
| Deno type check, all 15 functions | Pass |
| Deno unit tests | 16/16 pass |
| SQL migrations parsed with `pglast` | Pass (syntax only) |
| Dashboard `tsc --noEmit` | Pass |
| Dashboard production build | Pass, 13 routes |
| Firmware compile (`huge_app`) | Pass |
| Firmware size | 1,528,999 bytes flash (48%), 95,008 bytes RAM (28%) |
| GitHub Actions workflow YAML | Parsed successfully (not yet run on GitHub) |
| Live Supabase schema probe | 29/29 tables and 2/2 RPCs exist; anon denied |
| Live Edge Function probe | Not deployed: all 15 returned `404` |

### Important build notes

- The firmware **requires** the **Huge APP (3 MB No OTA / 1 MB SPIFFS)** partition
  scheme. The default 1.2 MB app partition is too small.
- `AGNES_ALLOWED_ORIGINS` must be set in production. CORS now fails closed when the
  list is empty; `AGNES_ENV=development` allows an empty list locally.
- Set the real project URL in `firmware/AGNES_OS_2_0/src/Config.h`.
- `AGNES_CREDENTIAL_ENC_KEY` is required before provider keys can be saved.

### Fixes and hardening in this release

- Sync requests are single-flight until the response is handled, preventing sent
  acknowledgement counters from being overwritten by a second in-flight sync.
- Free-primary requests can no longer fall back to a paid or account-managed model,
  even when paid usage is enabled; explicit paid primaries may still fall back.
- Chat resume recovery matches the specific missing-conversation errors instead of
  any "not found" message.
- Dashboard Devices refresh now refreshes devices and commands, and polls every 15
  seconds while the tab is visible.
- Provider and service-role secrets remain out of firmware and browser bundles.
- Commands that expire before execution are acknowledged as failed with an explicit
  error instead of silently disappearing.

### Known limitations

- Live PostgreSQL/RLS, deployed functions, provider calls, hardware, charger behavior,
  and Vercel deployment are untested in this environment.
- The live project has the schema applied but the 15 Edge Functions are not
  deployed yet. Run the **Deploy Supabase** workflow once the GitHub secrets are
  configured.
- No OTA update path. Flashing is over USB.
- No Supabase Realtime subscriptions; chat and devices poll every 15 seconds.
- Screen-off does not automatically enter deep sleep. With Wi-Fi connected the device
  stays awake; light sleep is used only when Wi-Fi is disconnected. Deep-sleep helper
  is timer-only and unscheduled.
- Notes, memories and notifications are read-only on the device; authoring/approval is
  in the dashboard.
- Provider key rotation requires re-saving keys; there is no multi-key rotation.
- AI cost/token fields stay blank when the provider does not report them.
- No independent security audit, accessibility audit, or load test.

### Upgrade notes

There is no earlier released schema. Apply both migrations in filename order, deploy
all 15 functions, and set the required secrets. Re-pair devices after a credential
revocation or NVS erase. Existing development databases should be reset or migrated
manually; no downgrade script is provided.

No license has been selected. Treat the source as private until the owner adds one.
