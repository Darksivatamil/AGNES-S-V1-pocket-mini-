# Testing — AGNES OS 2.0

Honesty rule: a test is listed as **executed** only if it ran in this repository's
build environment. Everything requiring real accounts, hardware, or a deployed
Postgres instance is **not executed** unless stated.

## 1. What was executed

Environment: Linux, Node 22.23.4 / npm 10.9.9, Deno 2.9.8, ESP32 Arduino core
3.3.12, U8g2 2.36.19, ArduinoJson 7.4.3, Next.js 16.4.5.

GitHub Actions runs the same dashboard, Edge Function, and SQL checks (see
`docs/CICD.md`). The workflow YAML and preflight shell script were validated
locally, but the workflows have not yet run on GitHub.

| Check | Command | Result |
|---|---|---|
| Edge Function type check | `deno check agnes-*/index.ts` (from `supabase/functions`) | **Pass**, all 15 functions |
| Shared unit tests | `deno test --allow-env --allow-net` | **Pass**, 16/16 |
| SQL syntax | `pglast.parse_sql(...)` on both migrations | **Pass** (syntax only) |
| Dashboard type check | `npm run typecheck` in `web/` | **Pass** |
| Dashboard production build | `npm run build` in `web/` | **Pass**, 13 routes |
| Firmware compile | `arduino-cli compile --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app firmware/AGNES_OS_2_0` | **Pass** |
| Firmware size | same compile | 1,528,999 bytes flash (48% of 3 MB), 95,008 bytes static RAM (28%) |
| Live schema preflight | `.github/scripts/supabase-preflight.sh` against the real project | **Pass**, 29/29 tables and 2/2 RPCs found; anon access denied |
| Live Edge Function probe | `POST /functions/v1/<name>` for all 15 functions | **Not deployed** — all returned `404` |

The 16 unit tests cover:

- Structured AI JSON parsing, markdown-fence stripping, invalid question rejection,
  plain-text fallback, and sensitive-memory rejection.
- AES-256-GCM provider-credential round trip bound to user + provider.
- Pet XP/level/stage behavior.
- OpenRouter free-model detection and NVIDIA `unknown` billing behavior.
- Exactly-three-option validation, command field/type rejection, and emotion/intensity
  bounds.
- Free→paid and free→account-managed fallback blocking, plus allowed free→free and
  explicit-paid fallback paths.

### Commands used

```bash
cd supabase/functions
/tmp/opencode/toolchain/deno check agnes-*/index.ts
/tmp/opencode/toolchain/deno test --allow-env --allow-net

cd ../..
PYTHONPATH=/tmp/opencode/pglast python3 - <<'PY'
from pathlib import Path
from pglast import parse_sql
for path in sorted(Path("supabase/migrations").glob("*.sql")):
    parse_sql(path.read_text())
    print("OK", path.name)
PY

cd web
PATH=/tmp/opencode/toolchain/node/bin:$PATH npm run typecheck
PATH=/tmp/opencode/toolchain/node/bin:$PATH npm run build

cd ..
/home/sivaraman/bin/arduino-cli compile \
  --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app \
  firmware/AGNES_OS_2_0
```

No ESLint configuration is included. Next.js 16 removed the `next lint` command, so
`tsc --noEmit` and `next build` are the dashboard checks.

## 2. What was NOT executed

| Area | Why not | Risk |
|---|---|---|
| Apply migrations to live PostgreSQL | No Supabase project, Docker, local PostgreSQL, or `psql` in this environment | RLS/RPC defects could exist despite syntax validation |
| RLS policy behavior tests | Same | A policy could be too broad or too narrow |
| RPC signature/behavior tests | Same | `agnes_finalize_chat`/`agnes_rate_limit` untested live |
| Edge Function integration with Supabase | No project URL/service key | Auth, storage and function wiring untested live |
| OpenRouter/NVIDIA live calls | No provider keys | Error mapping and live catalogue parsing untested against current APIs |
| Pairing end-to-end | No deployed backend or device | Pairing races, token storage, portal flow untested physically |
| Firmware on hardware | No ESP32-C3 board | GPIO, OLED controller, ADC divider, power path, sleep current unverified |
| Vercel deployment | No Vercel account/project | Build settings and domain CORS unverified |
| Load/soak testing | No deployment | Rate limits and battery runtime unmeasured |
| Browser/accessibility testing | No browser matrix | Layout and keyboard behavior unverified beyond compilation |
| OTA updates | Not implemented in 2.0.0 | USB flashing required |

No test result in this document should be read as a claim that the live system
works. The source compiles and the pure logic tests pass.

## 3. Manual acceptance plan (to run after deployment)

### 3.1 Backend / database

1. Apply both migrations to a fresh Supabase project.
2. Create two users, A and B. Insert one row per user into a few tables.
3. With user A's JWT, attempt `select` on user B's rows through PostgREST. Expect
   zero rows, not an error leak.
4. Attempt direct `insert`/`update` on `agnes_devices`, `agnes_settings`,
   `agnes_provider_credentials` and `agnes_messages`. Expect permission denied.
5. Call `agnes_rate_limit` with the anon key. Expect permission denied.
6. Call `agnes_finalize_chat` with the anon key. Expect permission denied.
7. Verify a repeated `agnes-chat` request UUID returns the same message IDs and does
   not duplicate rows.
8. Verify account deletion removes profile, devices, conversations, messages,
   memories, pet state, credentials and preferences.

### 3.2 Provider and chat

1. Save an OpenRouter key, test the connection, refresh the catalogue.
2. Confirm a free model can be selected with `allow_paid=false`.
3. Confirm a paid model is rejected with `allow_paid=false`.
4. Confirm an NVIDIA model is shown as account-managed and rejected until paid
   models are enabled.
5. Send a chat message. Confirm reply, emotion, usage and provider/model rows.
6. Trigger a provider outage or invalid key. Confirm the error is shown and no fake
   reply is stored.
7. Confirm the three-choice question appears once, expires after 30 minutes, and
   rejects a second answer.

### 3.3 Device and firmware

1. Verify the OLED controller and I2C address. Try SSD1306 and SH1106 builds.
2. Test PREV/SELECT/NEXT with active-low pull-ups; check for missed/duplicate
   presses and long-press behavior.
3. Measure battery voltage with a multimeter and calibrate the divider.
4. Verify the charger current and power path under load; check temperature.
5. Pair via the portal, restart, and confirm the token persists.
6. Send each allowlisted command and watch `PENDING → RECEIVED → EXECUTING →
   COMPLETED` in Diagnostics. Test an invalid payload and expiry.
7. Disconnect Wi-Fi. Confirm local apps, pet and cached content work; cloud chat
   reports unavailability. Reconnect and confirm queued events/pet actions sync.
8. Read a notification on the device, sync, and confirm it disappears from the
   unread list after a successful ack.
9. Power-cycle during a sync and verify no duplicate messages or pet events.
10. Measure deep-sleep/screen-off current and 24-hour stability.

### 3.4 Dashboard

1. Sign in, pair, rename, revoke, and re-pair a device.
2. Start a conversation; verify the composer is disabled until a conversation
   exists.
3. Answer the same pending question from both dashboard and device; the second
   answer must be rejected.
4. Create/edit/delete a note and verify the version conflict path.
5. Approve a pending memory and confirm only approved memories affect context.
6. Model Center filters, pagination, and active/fallback prefills.
7. Diagnostics refresh and backend check; confirm missing token counts stay blank.
8. Settings save and queue `REFRESH_SETTINGS`; confirm the device applies the new
   sync version.

## 4. Security checks

- Search the firmware and web bundles for `service_role`, provider keys or private
  URLs before release.
- Confirm `AGNES_ALLOWED_ORIGINS` is set in production; an empty list fails closed.
- Confirm `AGNES_CREDENTIAL_ENC_KEY` is 32 bytes and stored only in Supabase secrets.
- Rotate any key pasted into a chat, issue, or commit.
- Review provider-side logging/retention settings.
