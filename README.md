# 🤖 AGNES OS 2.0 — Pocket AI Companion

[![CI](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/ci.yml/badge.svg)](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/ci.yml)
[![Deploy Supabase](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/deploy-supabase.yml/badge.svg)](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/deploy-supabase.yml)
[![Deploy Web](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/deploy-web.yml/badge.svg)](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/deploy-web.yml)
[![Firmware](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/firmware.yml/badge.svg)](https://github.com/Darksivatamil/AGNES-S-V1-pocket-mini-/actions/workflows/firmware.yml)
![Version](https://img.shields.io/badge/version-2.0.0-00e5ff?style=flat-square)
![License](https://img.shields.io/badge/license-unspecified-lightgrey?style=flat-square)
![Platform](https://img.shields.io/badge/platform-ESP32--C3%20Super%20Mini-orange?style=flat-square)
![Dashboard](https://img.shields.io/badge/dashboard-Next.js%2016-black?style=flat-square&logo=next.js)
![Backend](https://img.shields.io/badge/backend-Supabase-3ECF8E?style=flat-square&logo=supabase)
![Edge](https://img.shields.io/badge/edge-Deno%202.x-000000?style=flat-square&logo=deno)

> **An offline-first ESP32-C3 pocket companion** with a 128×64 OLED face, three physical
> buttons, a Supabase backend, server-side OpenRouter / NVIDIA NIM orchestration, and a
> Next.js control dashboard. Cloud AI never runs on the device — and the device never
> pretends it does.

<p align="center">
  <img src="web/public/icon.svg" alt="AGNES icon" width="96" />
</p>

---

## 📑 Table of Contents

- [✨ Highlights](#-highlights)
- [🏗️ Architecture](#️-architecture)
- [🧰 Tech Stack](#-tech-stack)
- [📁 Project Structure](#-project-structure)
- [🚀 Quick Start](#-quick-start)
- [📚 Documentation](#-documentation)
- [📊 Status & Verification](#-status--verification)
- [🔐 Security Model](#-security-model)
- [🛠️ Hardware](#️-hardware)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Highlights

- 🎛️ **Three-button conversation protocol** — the AI returns a short reply plus exactly
  three validated choices (or plain text with a warning). `PREV`/`NEXT` navigate,
  `SELECT` opens/submits, long `SELECT` returns to the reply, long `NEXT` starts a new
  conversation. Device and dashboard share one history.
- 🎭 **15 emotions · 5 personalities · virtual pet · mood engine** with
  server-authoritative pet state and idempotent device interactions.
- 🧠 **Dual memory** — local bounded cache plus cloud memories with
  `pending / approved / rejected` approval. Only **approved** memories are injected, and
  only when cloud memory is on.
- 📱 **18 working device apps** — Chat, Pet, Memories, Notes, Notifications, Weather,
  Clock, Timer, Stopwatch, Calculator, Dice, Coin Flip, Mood Log, Sync, Settings,
  Diagnostics, Wi-Fi Setup, About. Notes, memories and notifications are read-only on
  the device by design.
- 🎮 **Nine allowlisted remote commands** with 15-minute expiry and a
  `PENDING → RECEIVED → EXECUTING → COMPLETED / FAILED / EXPIRED` lifecycle.
- 🖥️ **Dashboard** — overview, devices/pairing/commands, shared chat, memories, notes,
  notifications, pet, providers/keys/model preferences, model center, settings,
  diagnostics, account deletion.
- ☁️ **Server-side AI** — OpenRouter and NVIDIA NIM adapters, encrypted provider keys,
  live catalogue cache, paid/unknown model gating, retries only for retryable classes,
  honest errors, usage recording.
- 📴 **Offline-first device** — face, menus, pet, notes, cached chat and local apps stay
  usable without Wi-Fi. Cloud chat is reported unavailable; no on-device LLM claim.

---

## 🏗️ Architecture

```text
Browser (Next.js) ── Supabase Auth / PostgREST (RLS) ── PostgreSQL
        │                                                │
        └──────────────► Edge Functions ◄────────────── ESP32-C3
                         agnes-chat, agnes-sync, ...    (device token)
                              │
                    OpenRouter / NVIDIA NIM
```

The ESP32 never receives provider keys, service-role keys, or database credentials.
All AI calls are authenticated server-side. Device credentials are random, hashed at
rest, scoped to one device, and revocable.

**Trust boundaries**

| Boundary | Trusted | Rules |
|---|---|---|
| ESP32-C3 firmware | Device token only | No provider/service keys. HTTPS cert-bundle verification. Commands allowlisted & re-validated on-device. |
| Browser | Public anon key + user session | RLS on every user table. No privileged calls. |
| Edge Functions | Service role, provider secrets | Manual user/device auth. Zod validation. Rate limits. Idempotency. Never log message bodies. |
| PostgreSQL | RLS | Users read only their rows. Writes to sensitive tables only through service role. |
| AI providers | Data for one reply | Bounded context. Approved memories only. AI output is untrusted data, never executable. |

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Firmware | Arduino C++ · ESP32-C3 Super Mini · FreeRTOS · U8g2 2.36.19 · ArduinoJson 7.4.3 · LittleFS · NVS |
| Backend | Supabase (PostgreSQL + RLS + Edge Functions) · Deno 2.x · Zod validation |
| AI Providers | OpenRouter · NVIDIA NIM (OpenAI-compatible chat completions) |
| Dashboard | Next.js 16.4.5 · React 19.3 · TypeScript 5.9 · Tailwind CSS 4.3 · Supabase SSR |
| CI/CD | GitHub Actions · Vercel · Supabase CLI 3.x |
| Partition | Huge APP (3 MB No OTA / 1 MB SPIFFS) — default 1.2 MB app partition is too small |

---

## 📁 Project Structure

```text
AGNES-S-V1-pocket-mini/
├── firmware/AGNES_OS_2_0/     # Arduino C++ firmware for ESP32-C3 Super Mini
│   ├── AGNES_OS_2_0.ino
│   └── src/                  # Buttons, Display, Face, Pet/Mood engines, Chat, Cloud, ...
├── supabase/
│   ├── migrations/           # PostgreSQL schema, RLS, helper RPCs
│   ├── functions/            # 15 Deno Edge Functions + shared modules + tests
│   └── config.toml
├── web/                      # Next.js 16 + TypeScript dashboard
│   ├── src/app/              # App Router pages
│   ├── src/components/       # UI + feature clients
│   └── src/lib/              # Supabase clients, types, helpers
├── docs/                     # Setup, architecture, API, security, testing, ...
├── .github/workflows/        # CI, Supabase deploy, Vercel deploy, firmware
└── dist/                     # (gitignored) release artifacts
```

---

## 🚀 Quick Start

1. Read [`docs/SETUP.md`](docs/SETUP.md).
2. Create a Supabase project, apply both migrations, deploy the functions, and set
   `AGNES_CREDENTIAL_ENC_KEY` plus `AGNES_ALLOWED_ORIGINS`.
3. Configure `web/.env.local` from `web/.env.example`; run `npm install && npm run dev`.
4. The project URL in `firmware/AGNES_OS_2_0/src/Config.h` is preconfigured; compile with
   `esp32:esp32:esp32c3:PartitionScheme=huge_app`; flash.
5. Generate a pairing code in **Devices**, enter it with your 2.4 GHz Wi-Fi credentials
   in the device portal, then configure a provider in **Providers**.

```bash
# Dashboard
cd web && npm install && npm run dev

# Edge Functions (check + tests)
cd supabase/functions && deno check **/index.ts && deno test --allow-env --allow-net

# Firmware
arduino-cli compile --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app firmware/AGNES_OS_2_0
```

---

## 📚 Documentation

| Document | Contents |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | Supabase, secrets, Vercel, firmware build/flash, pairing |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Trust boundaries, protocol, AI/pet/memory design |
| [`docs/API.md`](docs/API.md) | Edge Function actions, payloads, response shapes, limits |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Encryption, RLS, token handling, threat model, limitations |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Wiring, OLED, charger/power-path, bring-up checklist |
| [`docs/TESTING.md`](docs/TESTING.md) | Executed vs. unexecuted tests, manual acceptance plan |
| [`docs/CICD.md`](docs/CICD.md) | GitHub Actions, Supabase deploy, Vercel, secrets, live status |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Dashboard, pairing, firmware, AI, power issues |
| [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md) | 2.0.0 scope, verification, known limitations |

---

## 📊 Status & Verification

This is a **source-complete implementation** — not a claim that the physical device, a
Supabase project, or a Vercel deployment already exists. In this build environment:

- ✅ **Verified:** all 15 Edge Functions type-check; 16/16 unit tests pass; both SQL
  migrations parse; the dashboard type-checks and produces a production build; the
  firmware compiles at **1,528,999 bytes flash / 95,008 bytes static RAM** with the
  `huge_app` partition.
- 🔍 **Live project check (2026-11-08):** the Supabase auth endpoint is reachable, all
  29 tables and both RPCs exist, and anon access is correctly denied. The 15 Edge
  Functions are **not deployed yet**; every function endpoint returns `404`.
- ⚠️ **Not verified:** live RLS behavior with real users, deployed function
  integration, real provider calls, pairing end-to-end, physical hardware,
  battery/charger behavior, and Vercel deployment. See [`docs/TESTING.md`](docs/TESTING.md).
- 🚀 **CI/CD:** GitHub Actions builds/tests the dashboard, functions, SQL, and
  firmware, and deploys Supabase on `main`. See [`docs/CICD.md`](docs/CICD.md).

**Requirements before real use**

- Verify the OLED controller (SSD1306 vs SH1106) on the actual module.
- Prefer moving `NEXT` from GPIO8 to GPIO10 if the clone exposes GPIO10.
- Verify the battery divider, charging current, regulator and power path against the
  actual hardware. TP4056 has no power path.
- Provide your own Supabase project and OpenRouter / NVIDIA credentials.
- Use the **Huge APP (3 MB No OTA / 1 MB SPIFFS)** partition; the default 1.2 MB app
  partition is too small.

> No API keys, project URLs, deployment results, or hardware measurements are invented.
> Cloud AI is never simulated on-device; offline mode says so explicitly.

---

## 🔐 Security Model

- The ESP32 receives **only a device token** — never provider, service-role, or DB keys.
- HTTPS with the ESP-IDF certificate bundle; manual auth inside every Edge Function.
- Provider keys are **encrypted at rest** (`AGNES_CREDENTIAL_ENC_KEY`).
- RLS on every user table; sensitive writes go through the service role only.
- Commands are allowlisted, re-validated on-device, and expire in 15 minutes.
- AI output is treated as **untrusted data** — never executable, never a direct pet write.

See [`docs/SECURITY.md`](docs/SECURITY.md) for the full threat model and limitations.

---

## 🛠️ Hardware

- ESP32-C3 Super Mini (single-core, Arduino framework)
- 128×64 OLED (SSD1306 **or** SH1106 — verify on the actual module)
- 3 push buttons (`PREV`, `NEXT`, `SELECT`)
- Li-ion cell + TP4056 charger (no power path — verify power path)
- Battery divider for voltage sensing

Full wiring, bring-up checklist and power notes: [`docs/HARDWARE.md`](docs/HARDWARE.md).

---

## 🤝 Contributing

Contributions are welcome. Please:

1. Keep changes focused and follow the existing code style and conventions.
2. Do **not** commit secrets — `.env`, `.env.local`, provider keys, service-role keys.
3. Run the relevant checks before opening a PR:
   - Dashboard: `cd web && npm run typecheck && npm run build`
   - Functions: `cd supabase/functions && deno check **/index.ts && deno test --allow-env --allow-net`
   - Firmware: compile with `PartitionScheme=huge_app`.
4. Update documentation when behavior changes.

---

## 📄 License

No license has been selected by the project owner. Treat as **private** until a license
is added.

---

<p align="center">
  Built with ❤️ for a pocket-sized AI companion that stays honest about what it can and
  cannot do offline.
</p>
