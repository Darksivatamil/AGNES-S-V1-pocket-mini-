# AGNES OS 2.0

AGNES is an offline-first ESP32-C3 companion with a 128×64 OLED face, three physical
buttons, a Supabase backend, server-side OpenRouter/NVIDIA NIM orchestration, and a
Next.js control dashboard.

```text
firmware/AGNES_OS_2_0/      Arduino C++ firmware for ESP32-C3 Super Mini
supabase/migrations/        PostgreSQL schema, RLS, helper RPCs
supabase/functions/         Deno Edge Functions (all privileged operations)
web/                        Next.js 16 + TypeScript dashboard
docs/                       Setup, architecture, API, security, testing, hardware
```

## Status and honesty

This is a source-complete implementation, not a claim that the physical device, a
Supabase project, or a Vercel deployment already exists. In this build environment:

- **Verified:** all 15 Edge Functions type-check; 16/16 unit tests pass; both SQL
  migrations parse; the dashboard type-checks and produces a production build; the
  firmware compiles at 1,528,999 bytes flash / 95,008 bytes static RAM with the
  `huge_app` partition.
- **Live project check (2026-11-08):** the Supabase auth endpoint is reachable, all
  29 tables and both RPCs exist, and anon access is correctly denied. The 15 Edge
  Functions are **not deployed yet**; every function endpoint returns `404`.
- **Not verified:** live RLS behavior with real users, deployed function
  integration, real provider calls, pairing end-to-end, physical hardware,
  battery/charger behavior, and Vercel deployment. See `docs/TESTING.md` for the
  full matrix.
- **CI/CD:** GitHub Actions builds/tests the dashboard, functions, SQL, and
  firmware, and deploys Supabase on `main`. See `docs/CICD.md`.

Requirements before real use:

- Verify the OLED controller (SSD1306 vs SH1106) on the actual module.
- Prefer moving NEXT from GPIO8 to GPIO10 if the clone exposes GPIO10.
- Verify the battery divider, charging current, regulator and power path against the
  actual hardware. TP4056 has no power path.
- Provide your own Supabase project and OpenRouter/NVIDIA credentials.
- Use the **Huge APP (3 MB No OTA / 1 MB SPIFFS)** partition; the default 1.2 MB app
  partition is too small.

No API keys, project URLs, deployment results, or hardware measurements are invented.
Cloud AI is never simulated on-device; offline mode says so explicitly.

## Quick start

1. Read `docs/SETUP.md`.
2. Create a Supabase project, apply both migrations, deploy the functions, and set
   `AGNES_CREDENTIAL_ENC_KEY` plus `AGNES_ALLOWED_ORIGINS`.
3. Configure `web/.env.local` from `web/.env.example`; run `npm install && npm run dev`.
4. The project URL in `firmware/AGNES_OS_2_0/src/Config.h` is preconfigured; compile with
   `esp32:esp32:esp32c3:PartitionScheme=huge_app`; flash.
5. Generate a pairing code in **Devices**, enter it with your 2.4 GHz Wi-Fi credentials
   in the device portal, then configure a provider in **Providers**.

## Features

- **Three-button conversation protocol:** the AI returns a short reply and exactly
  three validated choices (or plain text with a warning). PREV/NEXT navigate,
  SELECT opens/submits; long SELECT returns to the reply; long NEXT starts a new
  conversation. The device and dashboard share the same conversation history.
- **15 emotions, 5 personalities, virtual pet, mood engine** with server-authoritative
  pet state and idempotent device interactions.
- **Dual memory:** local bounded cache plus cloud memories with `pending/approved/
  rejected` approval. Only approved memories are injected when cloud memory is on.
- **18 working device apps:** Chat, Pet, Memories, Notes, Notifications, Weather,
  Clock, Timer, Stopwatch, Calculator, Dice, Coin Flip, Mood Log, Sync, Settings,
  Diagnostics, Wi-Fi Setup, About. Notes, memories and notifications are read-only on
  the device by design.
- **Nine allowlisted remote commands** with 15-minute expiry and a
  `PENDING → RECEIVED → EXECUTING → COMPLETED/FAILED/EXPIRED` lifecycle.
- **Dashboard:** overview, devices/pairing/commands, shared chat, memories, notes,
  notifications, pet, providers/keys/model preferences, model center, settings,
  diagnostics, account deletion.
- **Server-side AI:** OpenRouter and NVIDIA NIM adapters, encrypted provider keys,
  live catalogue cache, paid/unknown model gating, retries only for retryable
  classes, honest errors, usage recording.
- **Offline-first device:** face, menus, pet, notes, cached chat and local apps remain
  usable without Wi-Fi. Cloud chat is reported unavailable; no on-device LLM claim.

## Documentation

| Document | Contents |
|---|---|
| `docs/SETUP.md` | Supabase, secrets, Vercel, firmware build/flash, pairing |
| `docs/ARCHITECTURE.md` | Trust boundaries, protocol, AI/pet/memory design |
| `docs/API.md` | Edge Function actions, payloads, response shapes, limits |
| `docs/SECURITY.md` | Encryption, RLS, token handling, threat model, limitations |
| `docs/HARDWARE.md` | Wiring, OLED, charger/power-path, bring-up checklist |
| `docs/TESTING.md` | Executed vs. unexecuted tests, manual acceptance plan |
| `docs/CICD.md` | GitHub Actions, Supabase deploy, Vercel, secrets, live status |
| `docs/TROUBLESHOOTING.md` | Dashboard, pairing, firmware, AI, power issues |
| `docs/RELEASE_NOTES.md` | 2.0.0 scope, verification, known limitations |

## Architecture

```text
Browser (Next.js) ── Supabase Auth/PostgREST (RLS) ── PostgreSQL
        │                                                │
        └──────────────► Edge Functions ◄────────────── ESP32-C3
                         agnes-chat, agnes-sync, ...    (device token)
                              │
                    OpenRouter / NVIDIA NIM
```

The ESP32 never receives provider keys, service-role keys, or database credentials.
All AI calls are authenticated server-side. Device credentials are random, hashed at
rest, scoped to one device, and revocable.

## License

No license has been selected by the project owner. Treat as private until a license is
added.
