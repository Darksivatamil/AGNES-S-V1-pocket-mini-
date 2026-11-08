# Setup — AGNES OS 2.0

This guide sets up the three deployable parts:

1. Supabase project (PostgreSQL schema, RLS, Edge Functions, secrets)
2. Vercel/Next.js dashboard (`web/`)
3. ESP32-C3 firmware (`firmware/AGNES_OS_2_0/`)

The repository is preconfigured for the current Supabase project
`https://cvoiqoydjqmowhjewxle.supabase.co` with its public publishable key.
Replace those public values if you use a different project. Live deployment,
RLS behavior, and hardware still require verification; see `docs/TESTING.md`.
CI/CD setup is documented in `docs/CICD.md`.

---

## 0. Prerequisites

| Tool | Version used here | Purpose |
|---|---|---|
| Node.js | 22.x | Dashboard build |
| npm | 10.x | Dashboard dependencies |
| Deno | 2.x | Edge Function check/test (Supabase also runs Deno) |
| Supabase CLI | current | Migrations, function deploys, secrets |
| Arduino CLI / IDE | ESP32 core **3.3.12** | Firmware |
| U8g2 | **2.36.19** | OLED |
| ArduinoJson | **7.4.3** | Firmware JSON |

The firmware was compiled with `arduino-cli` and the `esp32:esp32@3.3.12`
platform. Other core versions may compile but were not tested.

---

## 1. Supabase project

### 1.1 Create the project

The repository is preconfigured for project `cvoiqoydjqmowhjewxle`
(`https://cvoiqoydjqmowhjewxle.supabase.co`). Its schema is already applied and
verified: 29/29 tables and both RPCs exist. The 15 Edge Functions are **not
deployed yet** as of 2026-11-08.

To use a different project, create one at <https://supabase.com> and record:

- Project URL, e.g. `https://<project-ref>.supabase.co`
- Anon/publishable key (safe for the browser)
- Service-role key (**server-only**, never in `web/` or firmware)

The service-role key is injected into Edge Functions by Supabase. Do not add it to
any committed file.

### 1.2 Apply migrations

Migrations must run in filename order:

```text
supabase/migrations/20261107000100_initial_schema.sql
supabase/migrations/20261107000200_chat_finalize.sql
```

With the Supabase CLI, from the repository root:

```bash
supabase link --project-ref <project-ref> --yes
supabase db push --remote --yes
```

Or paste each file into the dashboard SQL editor, in order. The first migration
requires the `pgcrypto` extension; the SQL creates it if your project allows it.

If the schema was applied through the SQL Editor, the CLI migration history is
empty. Baseline it once before `db push`:

```bash
supabase migration repair --status applied 20261107000100 --remote --yes
supabase migration repair --status applied 20261107000200 --remote --yes
supabase db push --remote --yes
```

The CI/CD workflow performs this detection automatically. See `docs/CICD.md`.

`supabase/config.toml` sets `verify_jwt = false` for every function because the
functions authenticate browser JWTs and device tokens themselves. Keep this
setting when deploying.

### 1.3 Deploy Edge Functions

From the repository root:

```bash
for fn in agnes-pair agnes-device-auth agnes-chat agnes-models \
          agnes-providers agnes-provider-test agnes-memory agnes-sync \
          agnes-profile agnes-device-status agnes-device-command \
          agnes-notifications agnes-pet agnes-tools agnes-account; do
  supabase functions deploy "$fn" --no-verify-jwt --yes
done
```

Run this after `supabase link`. The 15 function names are listed above.
`docs/CICD.md` shows the same loop used by GitHub Actions.

### 1.4 Set Edge Function secrets

Copy `supabase/functions/.env.example` to an untracked file, fill it, and push it:

```bash
cp supabase/functions/.env.example supabase/functions/.env
# edit supabase/functions/.env
supabase secrets set --env-file supabase/functions/.env --yes
```

Required:

| Secret | Notes |
|---|---|
| `AGNES_CREDENTIAL_ENC_KEY` | Base64 of exactly 32 random bytes. Generate with `openssl rand -base64 32`. Losing it makes saved provider keys undecryptable. |
| `AGNES_ALLOWED_ORIGINS` | Comma-separated browser origins, e.g. `https://your-app.vercel.app,http://localhost:3000`. Production CORS fails closed when empty. |

Optional:

| Secret | Notes |
|---|---|
| `OPENROUTER_API_KEY` | Operator fallback key. Per-user keys take precedence. |
| `NVIDIA_API_KEY` | Same, for NVIDIA NIM. NVIDIA is never treated as free. |
| `AGNES_APP_URL` | OpenRouter HTTP-Referer attribution. |
| `AGNES_ENV` | Defaults to `production`. Set `development` only for local work. |

Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` to deployed functions. Do not set your own values
unless you are running functions outside Supabase.

### 1.5 Auth settings

In **Authentication → URL Configuration**:

- Set the Site URL to your dashboard URL.
- Add `http://localhost:3000/**` for local development and your Vercel
  preview/production callback URLs.
- Email/password auth is used by the dashboard. Configure email delivery before
  inviting real users.

### 1.6 Database verification

After migrations, confirm in the SQL editor:

```sql
select count(*) from pg_policies where schemaname = 'public';
select proname from pg_proc where proname in ('agnes_rate_limit', 'agnes_finalize_chat');
```

Both RPCs must exist and be executable only by `service_role`.

---

## 2. Dashboard (`web/`)

### 2.1 Local development

```bash
cd web
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open <http://localhost:3000>. If the environment variables are missing, the app
shows a setup notice instead of pretending to be configured.

Useful checks:

```bash
npm run typecheck
npm run build
```

### 2.2 Deploy to Vercel

Recommended: import the repository and set **Root Directory** to `web`.

Environment variables (Production + Preview):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
- optional `NEXT_PUBLIC_AGNES_FUNCTIONS_URL`

Never add `SUPABASE_SERVICE_ROLE_KEY`, `AGNES_CREDENTIAL_ENC_KEY`, or provider
API keys to Vercel. The browser only needs the public Supabase key.

If you deploy from the repository root instead, the included `vercel.json`
builds `web/` and points Vercel at `web/.next`. Update
`AGNES_ALLOWED_ORIGINS` with the final Vercel domain.

---

## 3. Firmware

### 3.1 Install libraries

Arduino IDE Library Manager, or:

```bash
arduino-cli lib install "U8g2@2.36.19"
arduino-cli lib install "ArduinoJson@7.4.3"
arduino-cli core install esp32:esp32@3.3.12
```

### 3.2 Configure the project URL

`firmware/AGNES_OS_2_0/src/Config.h` is already set to:

```cpp
#define AGNES_SUPABASE_URL "https://cvoiqoydjqmowhjewxle.supabase.co"
#define AGNES_SUPABASE_ANON_KEY "sb_publishable_..."
```

Replace both values if you use a different project. `AGNES_SUPABASE_ANON_KEY`
holds the public publishable key, which is safe to ship; it is only sent as an
`apikey` header for gateways that require one. **Never** put a service-role key or
provider key in firmware.

Hardware defaults live in the same file. Verify them against the physical board
first; see `docs/HARDWARE.md`.

### 3.3 Required partition scheme

The firmware is about **1.53 MB**, so the default 1.2 MB app partition is too
small. Use **Huge APP (3 MB No OTA / 1 MB SPIFFS)**.

Arduino IDE: **Tools → Partition Scheme → Huge APP (3MB No OTA/1MB SPIFFS)**.

Arduino CLI:

```bash
arduino-cli compile \
  --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app \
  firmware/AGNES_OS_2_0
```

Build outputs observed in this environment:

```text
Sketch uses 1,528,999 bytes (48%) of 3,145,728 bytes
Global variables use 95,008 bytes (28%) of 327,680 bytes
```

If you move NEXT to GPIO10, add:

```bash
--build-property "compiler.cpp.extra_flags=-DAGNES_BUTTON_NEXT_PIN=10"
```

### 3.4 Flash and monitor

```bash
arduino-cli upload \
  --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app \
  --port /dev/ttyACM0 \
  firmware/AGNES_OS_2_0

arduino-cli monitor --port /dev/ttyACM0 --config baudrate=115200
```

The serial device (`/dev/ttyACM0`, `/dev/ttyUSB0`, `COM5`, …) depends on your
board and OS. On Linux, add your user to the `dialout` group if upload permission
is denied.

### 3.5 First boot and pairing

1. Open **Devices** in the dashboard and create a pairing code. It is single-use
   and expires after 10 minutes.
2. On the device, open **Wi-Fi Setup** (or let first boot start the portal).
3. Connect to the `AGNES-XXXX` access point. The random WPA2 password is shown on
   the OLED and serial log.
4. Open <http://192.168.4.1>, enter your 2.4 GHz Wi-Fi credentials and the pairing
   code, then save. The device restarts and claims the code.
5. The dashboard shows the device after its first sync. Rename it, then send a
   command to verify the acknowledgement lifecycle.

The portal only supports 2.4 GHz Wi-Fi, matching the ESP32-C3 radio.

### 3.6 Provider setup

1. Open **Providers**, paste an OpenRouter key, save, and run **Test connection**.
2. Refresh the catalogue, choose an active model, and save preferences.
3. NVIDIA NIM models are shown as **account-managed** until you explicitly enable
   paid/account-managed models. AGNES does not claim they are free.
4. Open **Conversation**, start a conversation, and verify exactly three choices
   appear when the AI asks a question. The same pending question is visible on the
   device after its next sync.

---

## 4. Minimal acceptance checks

- Dashboard login works and shows the active email.
- Device pairing succeeds; the device appears under **Devices**.
- A command reaches `COMPLETED` after the device syncs.
- Chat reply from the dashboard is stored and appears in the shared history.
- A pending three-choice question appears on both dashboard and device.
- Device loses Wi-Fi and honestly shows that cloud AI is unavailable; local UI,
  pet and cached content still work.
- Diagnostics shows the same command and AI usage rows without inventing values.

Full test coverage and what has/has not been executed are listed in
`docs/TESTING.md`.
