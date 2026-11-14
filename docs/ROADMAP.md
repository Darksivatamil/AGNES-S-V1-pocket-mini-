# AGNES OS 2.x — Restructure & Upgrade Roadmap

> **Scope.** Reorganise what already exists, then prioritise what to build next.
> This is **not** a rewrite: every phase must compile and stay green in CI before
> the next phase starts. Wire formats, database schema and the three-button
> protocol do not change.

---

## 1. Where we are

| Layer | State today | Friction |
|---|---|---|
| Firmware | 17 flat files in `src/`, ~190 KB of source | `UI.cpp` is 82 KB, `Cloud.cpp` 32 KB, `Storage.cpp` 19 KB — three god files hold the product |
| Firmware layout | 18 category folders already created | Every one of them is **empty** — intent exists, mapping does not |
| Cloud | 15 Edge Functions + `_shared` (AI, crypto, auth, rate limit) | Domains are implicit; nothing documents which function owns what |
| Web | 12 routes, all components flat in `src/components` | Cross-feature imports, no single place to change one feature |
| Repo | CI green, Supabase deploy wired, `scripts/` missing | Flashing is a hand-typed command; no local helpers |
| Live project | Schema applied (29 tables), CI passes, functions **not deployed** | First deploy failed at `Link project` — missing GitHub secrets |

---

## 2. Restructure plan

### 2.1 Principles

1. **Move first, split later.** File moves with zero logic changes are cheap and
   reviewable. Splits happen only after the tree is stable.
2. **One green gate per phase.** Compile + CI must pass before the next phase.
3. **Nothing on the wire changes.** Endpoint names, payloads, table names and the
   three-button protocol stay byte-identical.
4. **Empty folder = promise.** Every folder gets a stated purpose and a first
   deliverable, or it gets deleted.

### 2.2 Target firmware tree

Honours the 18 folders already created, plus **one addition: `UI/`** (the shell has
no home in the current taxonomy).

```text
firmware/AGNES_OS_2_0/src/
├── AI/            on-device AI *contract* layer (see 2.3)
├── APPS/          screen applications: chat, pet, notes, settings, diagnostics
├── CLOUD/         endpoint map, JSON encode/decode, auth handshake
├── CONFIG/        build + hardware configuration (Config.h)
├── CORE/          event bus, types, utilities, UI shell
├── DISPLAY/       OLED driver, face renderer, layout helpers
├── EMOTION/       mood engine, 15-emotion definitions
├── INPUT/         button driver, long-press/repeat gestures
├── MEMORY/        local notes, local memories, offline queue
├── NETWORK/       HTTPS transport, retry/backoff, certificate bundle
├── PERSONALITY/   5 personalities: traits, prompt fragments, idle style
├── PET/           pet engine: XP, levels, stages, cooldowns
├── POWER/         battery, charger path, sleep policy
├── SERVICES/      watchdog, scheduler, health reporting, future OTA
├── STORAGE/       NVS settings + atomic file helpers
├── TESTS/         host-side unit tests (protocol, mood math, queue)
├── UI/            *(new)* shell: navigation, render loop, theme
└── WIFI/          connection, provisioning portal, reconnect backoff
```

### 2.3 File mapping (Phase 1 — moves only, no logic changes)

| Today | Moves to |
|---|---|
| `Config.h` | `CONFIG/Config.h` |
| `EventBus.*`, `Types.*`, `Util.*` | `CORE/` |
| `Buttons.*` | `INPUT/` |
| `Battery.*`, `Power.*` | `POWER/` |
| `Display.*`, `Face.*` | `DISPLAY/` |
| `MoodEngine.*` | `EMOTION/` |
| `PetEngine.*` | `PET/` |
| `WifiManager.*` | `WIFI/` |
| `Chat.*` | `APPS/` |
| `Storage.*` | `STORAGE/` + `MEMORY/` (split in Phase 2) |
| `Cloud.*` | `CLOUD/` + `NETWORK/` (split in Phase 2) |
| `UI.*` | `UI/` + `APPS/` (split in Phase 2) |

**What each empty folder is for — and its first deliverable:**

| Folder | Purpose | First deliverable |
|---|---|---|
| `AI/` | Validates server payloads on-device (3-option questions, emotion bounds, model names) and packs device context for sync. **Not a model — no inference runs here.** | Move the existing question/emotion validation out of `Chat.cpp` |
| `APPS/` | One file per screen | Split `UI.cpp` into 5–7 screen files |
| `CLOUD/` | Endpoint paths + JSON codec | Split `Cloud.cpp`: protocol half |
| `CONFIG/` | Build/hardware config | Move `Config.h` |
| `CORE/` | Kernel: event bus, types, util, shell | Move 3 leaf modules |
| `DISPLAY/` | Pixels: driver, face, layout | Move 2 leaf modules |
| `EMOTION/` | Mood + 15 emotions | Move `MoodEngine` |
| `INPUT/` | Buttons + gestures | Move `Buttons` |
| `MEMORY/` | Local memory subsystem | Split `Storage.cpp`: notes/memories/queue |
| `NETWORK/` | Transport, retries, certs | Split `Cloud.cpp`: HTTPS half |
| `PERSONALITY/` | Personality as data, not `if` statements | Extract 5 personalities from UI + prompt builder |
| `PET/` | Pet rules | Move `PetEngine` |
| `POWER/` | Battery + sleep policy | Move `Battery`, `Power` |
| `SERVICES/` | Cross-cutting runtime services | Task watchdog + reset-reason reporting |
| `STORAGE/` | NVS + atomic file writes | Split `Storage.cpp`: settings half |
| `TESTS/` | Host-compiled unit tests | Protocol codec + mood math tests |
| `UI/` | Shell: navigation, render loop | Move shell half of `UI.cpp` |
| `WIFI/` | Connection + provisioning portal | Move `WifiManager` |

### 2.4 The three god-file splits (Phase 2)

**`UI.cpp` (82 KB) → `UI/` + `APPS/`**

| New file | Owns |
|---|---|
| `UI/Shell.*` | navigation stack, render loop, theme, status bar |
| `APPS/ChatScreen.*` | paged reply, three-option selector |
| `APPS/PetScreen.*` | pet face, XP bar, stage |
| `APPS/NotesScreen.*` | local notes list/editor |
| `APPS/SettingsScreen.*` | brightness, sleep, personality, pairing |
| `APPS/DiagnosticsScreen.*` | battery, signal, sync age, queue depth |
| `APPS/FaceScreen.*` | idle face + animations |

**`Cloud.cpp` (32 KB) → `NETWORK/` + `CLOUD/`**

| New file | Owns |
|---|---|
| `NETWORK/Transport.*` | `esp_http_client`, cert bundle, timeouts, retry/backoff classes |
| `CLOUD/Protocol.*` | request/response JSON, endpoint paths, error-code mapping |
| `CLOUD/Handlers.*` | pair/auth/sync/chat job state machine |

**`Storage.cpp` (19 KB) → `STORAGE/` + `MEMORY/`**

| New file | Owns |
|---|---|
| `STORAGE/Settings.*` | NVS keys, defaults, validation |
| `STORAGE/AtomicFile.*` | write-temp-rename helpers |
| `MEMORY/Notes.*` | local notes (bounded) |
| `MEMORY/Store.*` | local memories + offline queue (bounded) |

### 2.5 Include rule (verified on this toolchain)

Arduino does **not** put the `src/` root on the include path for files inside
subdirectories. Verified with `arduino-cli 1.5.1`:

```text
.ino  →  #include "src/CORE/EventBus.h"     (sketch-root relative)
.cpp  →  #include "EventBus.h"               (same directory)
.cpp  →  #include "../CORE/EventBus.h"       (relative across directories)
```

So Phase 1 is mechanical: move the file, rewrite its include lines, compile.

### 2.6 Web restructure (Phase 3)

```text
web/src/
├── app/                 routes only — no business logic
├── features/<domain>/   page + components + hooks for one domain
│     chat/  devices/  memories/  providers/  models/
│     pet/   settings/ diagnostics/ notifications/ notes/
├── lib/                 supabase client, callAgnes() API client, env checks
└── components/          shared UI kit only (buttons, cards, tables)
```

Rule: `features/chat` may import `lib/` and `components/`, never another
feature's internals. Shared TypeScript types come from one generated file so the
web and the documented API contract cannot drift.

### 2.7 Cloud functions (Phase 4) — keep names, add structure

Function folder names **are** the deployed identities (`agnes-chat`, …) and the
deploy script globs `agnes-*`. Do not move them. Instead:

1. `supabase/functions/README.md` — domain map:

   | Domain | Functions |
   |---|---|
   | Core device | `agnes-pair`, `agnes-device-auth`, `agnes-sync`, `agnes-device-status`, `agnes-device-command` |
   | Conversation | `agnes-chat`, `agnes-memory`, `agnes-models` |
   | Administration | `agnes-providers`, `agnes-provider-test`, `agnes-profile`, `agnes-account`, `agnes-tools`, `agnes-notifications`, `agnes-pet` |

2. Contract tests for the AI reply schema shared with the firmware validator —
   one source of truth, two consumers.

### 2.8 Phases and green gates

| Phase | Work | Gate |
|---|---|---|
| 0 | Baseline | CI green (done) |
| 1 | Leaf moves from 2.3, no logic changes | compile + CI after each folder batch |
| 2 | Split the three god files (2.4) | unit tests in `TESTS/` first, then behaviour-identical split |
| 3 | Web `features/` reorg (2.6) | `typecheck` + `build` green |
| 4 | Cloud domain map + contract tests (2.7) | `deno check` + `deno test` green |
| 5 | Services (watchdog, health) + optional OTA | measured power/boot data before enabling |

---

## 3. Upgrade & change list

Effort: **S** hours, **M** a day, **L** multiple days. Risk is to correctness or
power budget.

### P0 — trust & reliability (do first)

| # | Change | Why | Effort | Risk |
|---|---|---|---|---|
| P0.1 | CI preflight that names missing secrets | First deploy died on an opaque `supabase link` error | S | none — **shipped** |
| P0.2 | Deploy gate: assert all 15 functions are live | Smoke test only checks one function | S | none |
| P0.3 | Overview shows offline-queue depth + last-sync age | Users cannot see whether the device is stale | S | none |
| P0.4 | Task watchdog + reset-reason logging | Silent hangs look like "it froze" with no cause | M | low |
| P0.5 | Error-budget panel: last function errors, rate-limit hits, AI fallbacks | `agnes_ai_usage` already records fallbacks — surface them | M | none |
| P0.6 | Secrets runbook: rotate token, rotate encryption key, recover from loss | Key loss currently means re-entering every provider key | S | none |

### P1 — capability (the powerful ones)

| # | Change | Why it matters | Effort | Risk |
|---|---|---|---|---|
| P1.1 | **LAN AI provider** — OpenAI-compatible adapter for Ollama / LM Studio on your network | Real local intelligence with zero per-token cost, without ever claiming the ESP32 runs a model. Server-side only; device code untouched | M | low |
| P1.2 | **Memory consolidation job** — nightly pass turns raw conversation turns into memory *candidates* | The approval flow already exists; today memories only arrive when the AI suggests them mid-chat | M | low |
| P1.3 | **Dashboard PWA + Web Push** | The `agnes_notifications` table already stores events; push makes them reach your phone | M | low |
| P1.4 | **Personality as data** — 5 personalities become traits + prompt fragments + idle style in `PERSONALITY/` | Enables blending (e.g. 70 % curious / 30 % calm) instead of a hard switch | M | medium |
| P1.5 | **Skill packs** — declarative, versioned JSON mini-apps for `APPS/` (timer, unit converter, translate-prompt) | Extends the device without firmware updates; bounded DSL, no arbitrary code, signed packs | L | medium |
| P1.6 | **Multi-device rooms + per-device profile** | Tables already support many devices; UI and personality per device do not | M | low |
| P1.7 | **OTA updates** — two OTA slots instead of one huge app | Image is 1.53 MB, so two slots need ≥1.6 MB each: **measure the real flash size first**; if it does not fit, keep USB flashing and say so | L | medium — power + failure recovery |

### P2 — polish & scale

| # | Change | Why | Effort | Risk |
|---|---|---|---|---|
| P2.1 | Optional Supabase Realtime to replace 15 s polling | Snappier chat; keep polling as fallback and measure payload cost first | M | medium |
| P2.2 | Host-side unit tests in `TESTS/` | Protocol, mood math and queue logic become testable without hardware | M | none |
| P2.3 | Single contract source: Zod → JSON Schema → firmware validator | Kills the drift risk between 15 functions and the device | M | low |
| P2.4 | i18n, light/dark theme, accessibility pass | Reach and comfort | L | none |
| P2.5 | Release automation: tag → changelog → Supabase + Vercel deploy | Removes manual release steps | M | low |
| P2.6 | Passkey login (WebAuthn via Supabase Auth) | Phishing-resistant sign-in for the dashboard | M | low |

### Suggested order

```text
P0.1 ✓ → P0.2 → P0.3 → P1.1 → P1.2 → Phase 1 restructure
        → P1.3 → P1.4 → Phase 2 → P0.4 → P0.5 → P2.2 → P2.3 → …
```

Restructure phases interleave with P0/P1 work: moves are cheap, so do them while
a feature is already touching that file.

---

## 4. Explicit non-goals

- **No on-device LLM.** `AI/` validates and packs data; it never infers.
- **No voice** — the hardware list has no microphone.
- **No fake metrics.** Anything not measured stays marked unverified.
- **No paid model labelled free.** NVIDIA endpoints stay account-managed.
- **No arbitrary plugin code** — skill packs are data, not scripts.
- **No schema edits.** The live database is already migrated; schema changes ship
  as *new* migrations only.

---

## 5. Definition of done

A phase is done when:

1. `scripts/flash.sh` compiles and the device boots on real hardware.
2. CI (dashboard, functions, SQL, firmware) is green on GitHub.
3. Docs for the touched layer match reality (`ARCHITECTURE.md`, `API.md`).
4. Nothing that used to work stopped working — pairing, chat, sync, commands.
