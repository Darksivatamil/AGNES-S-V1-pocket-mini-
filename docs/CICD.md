# CI/CD — AGNES OS 2.0

This repository uses GitHub Actions for continuous integration and for deploying
the Supabase backend. The dashboard can deploy through Vercel's Git integration
(recommended) or the manual Vercel workflow.

## 1. Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | Push to `main`, pull request, manual | Dashboard typecheck + production build; Deno check + 16 unit tests; SQL migration parse; aggregate CI check |
| `.github/workflows/firmware.yml` | Push/PR touching `firmware/**`, manual | Installs ESP32 core 3.3.12, U8g2 2.36.19, ArduinoJson 7.4.3; compiles with `huge_app`; uploads `.bin` artifacts |
| `.github/workflows/deploy-supabase.yml` | Push to `main` touching `supabase/**`, manual | Preflight, link, migrations, Edge Function secrets, deploy 15 functions, smoke test |
| `.github/workflows/deploy-web.yml` | Manual only | Token-based Vercel CLI production deploy |

The firmware is compiled and uploaded as an artifact, but flashing remains
manual. There is no OTA path in 2.0.0.

## 2. Current project status (verified 2026-11-08)

Project URL: `https://cvoiqoydjqmowhjewxle.supabase.co`
Project ref: `cvoiqoydjqmowhjewxle`
Public key: `sb_publishable_R46rGIvdH5VlHnLmtZwK_Q_-mIDs2lV`

Live checks performed with the publishable key:

| Check | Result |
|---|---|
| Auth health endpoint | **200** (GoTrue reached) |
| AGNES tables | **29/29 exist** (anon gets expected `permission denied`, not `not found`) |
| `agnes_rate_limit` RPC | **Exists**, rejects anon with `42501` |
| `agnes_finalize_chat` RPC | **Exists**, rejects anon with `42501` |
| 15 Edge Functions | **Not deployed** — every endpoint returns `404` |

So the database schema is in place, but the Edge Functions still need their first
deployment. The deploy workflow handles this.

## 3. GitHub repository setup

This workspace is already initialized as a git repository with an initial commit
on `main`. Add your remote and push:

```bash
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

If you copied the files without `.git`, initialize first:

```bash
git init -b main
git add .
git commit -m "AGNES OS 2.0"
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

`.gitignore` excludes `web/node_modules`, `web/.next`, `web/.env.local`,
`supabase/functions/.env`, `dist/`, and Supabase/Vercel local state.

## 4. Required GitHub configuration

Open **Settings → Secrets and variables → Actions**.

### 4.1 Repository secrets

| Secret | Required | Purpose |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Yes, for deploy | Supabase personal access token (`sbp_...`) |
| `SUPABASE_DB_PASSWORD` | Yes, for migrations | Database password from project creation |
| `AGNES_CREDENTIAL_ENC_KEY` | Yes, for provider keys | Base64 32-byte AES key |
| `OPENROUTER_API_KEY` | Optional | Global fallback OpenRouter key |
| `NVIDIA_API_KEY` | Optional | Global fallback NVIDIA key |
| `VERCEL_TOKEN` | Only for manual Web deploy | Vercel account token |
| `VERCEL_ORG_ID` | Only for manual Web deploy | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Only for manual Web deploy | Vercel project ID |

Generate the encryption key locally:

```bash
openssl rand -base64 32
```

Copy the output into the `AGNES_CREDENTIAL_ENC_KEY` secret. Keep a backup: without
it, stored provider keys cannot be decrypted.

Create a Supabase access token:

1. Open <https://supabase.com/dashboard/account/tokens>.
2. Click **Generate new token**.
3. Name it `agnes-cicd`.
4. Copy the `sbp_...` value into `SUPABASE_ACCESS_TOKEN`.

The database password is the one chosen when the project was created. If it is
lost, reset it under **Project Settings → Database → Reset database password**.

### 4.2 Repository variables

| Variable | Suggested value |
|---|---|
| `SUPABASE_PROJECT_REF` | `cvoiqoydjqmowhjewxle` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://cvoiqoydjqmowhjewxle.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_R46rGIvdH5VlHnLmtZwK_Q_-mIDs2lV` |
| `AGNES_ALLOWED_ORIGINS` | `http://localhost:3000,https://<your-vercel-domain>` |
| `AGNES_APP_URL` | `https://<your-vercel-domain>` |

The workflows fall back to the current project URL, ref, and publishable key, so
CI works before these variables are created. Set them anyway when you rotate keys
or deploy a different project.

`AGNES_ALLOWED_ORIGINS` must include the exact dashboard origin. Production CORS
fails closed when it is empty.

## 5. How the Supabase deploy handles the existing schema

The current database was created with the SQL Editor, so the Supabase CLI
migration history may be empty even though the tables exist. The workflow runs
`.github/scripts/supabase-preflight.sh` first:

| Preflight state | Meaning | Action |
|---|---|---|
| `full` | All 29 tables and both RPCs exist | Mark both migrations as applied with `supabase migration repair`, then `db push` becomes a no-op |
| `empty` | No AGNES tables exist | Skip repair; `supabase db push` applies both migrations |
| `partial` | Some objects exist | Fail the workflow; fix manually before deploying |

The script only uses the public publishable key. Existing tables return
`401/403` because anon has no grants, which is still proof that they exist.

After the first successful deploy, future migrations are applied normally by
`supabase db push --remote --yes`.

The workflow commands target Supabase CLI v3 (local-by-default, `--remote` and
`--yes` for hosted changes) and were checked against CLI 3.0.0. If you use an
older CLI locally, omit `--remote` and use that version's confirmation flags.

## 6. Supabase deployment sequence

On a push to `main` that changes `supabase/**`, the workflow:

1. Checks out the repository and installs the latest Supabase CLI.
2. Runs the schema preflight.
3. Links the project with `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.
4. Baselines the two existing migrations when the schema is already full.
5. Pushes pending migrations.
6. Sets function secrets from GitHub:
   - `AGNES_CREDENTIAL_ENC_KEY`
   - `AGNES_ALLOWED_ORIGINS`
   - `AGNES_ENV=production`
   - optional `AGNES_APP_URL`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`
7. Deploys each of the 15 functions with `--no-verify-jwt`.
8. Calls `agnes-pair` with an empty body and verifies it returns the AGNES
   `{ "ok": ... }` envelope instead of a gateway `404`.

You can also run it manually from **Actions → Deploy Supabase → Run workflow**.

The workflow uses the GitHub `production` environment. Add required reviewers
there if you want manual approval before backend changes.

## 7. Dashboard deployment

### Option A — Vercel Git integration (recommended)

1. Import the repository at <https://vercel.com/new>.
2. Set **Root Directory** to `web`.
3. Framework preset: **Next.js**.
4. Add environment variables for Production and Preview:
   - `NEXT_PUBLIC_SUPABASE_URL=https://cvoiqoydjqmowhjewxle.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_R46rGIvdH5VlHnLmtZwK_Q_-mIDs2lV`
   - optional `NEXT_PUBLIC_AGNES_FUNCTIONS_URL`
5. Deploy.
6. Add the final domain to `AGNES_ALLOWED_ORIGINS` and re-run the Supabase deploy
   workflow (or update the secret in the Supabase dashboard).

Vercel deploys every push to `main` automatically. Do not also enable the manual
workflow's trigger; it is intentionally `workflow_dispatch` only.

### Option B — Manual Vercel CLI workflow

1. Create the Vercel project and set the same environment variables.
2. Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as GitHub secrets.
3. Run **Actions → Deploy Dashboard (manual) → Run workflow**.

If you deploy from the repository root instead of setting Root Directory to
`web`, use the included root `vercel.json`; do not combine it with a `web` root
directory setting.

## 8. Firmware CI

The firmware workflow compiles:

```bash
arduino-cli compile \
  --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app \
  --output-dir build/firmware \
  firmware/AGNES_OS_2_0
```

It uploads the `.bin` files to the workflow run. Download
`AGNES_OS_2_0.ino.merged.bin` and flash it at offset `0x0`, or flash the app image
with the bootloader and partition table. Hardware verification still applies:
OLED controller, pins, battery divider, charger/power path.

`firmware/AGNES_OS_2_0/src/Config.h` is already configured with the live project
URL and public publishable key. No secret belongs in firmware.

## 9. Local commands equivalent to CI

```bash
# Dashboard
cd web
npm ci
npm run typecheck
npm run build

# Edge Functions
cd ../supabase/functions
deno check agnes-*/index.ts
deno test --allow-env --allow-net

# SQL
cd ../..
PYTHONPATH=/tmp/opencode/pglast python3 - <<'PY'
from pathlib import Path
from pglast import parse_sql
for path in sorted(Path("supabase/migrations").glob("*.sql")):
    parse_sql(path.read_text())
    print("OK", path)
PY

# Firmware
arduino-cli compile \
  --fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app \
  firmware/AGNES_OS_2_0
```

## 10. Security rules

- The publishable key is public by design. The service-role key is not.
- Never add `SUPABASE_SERVICE_ROLE_KEY` to GitHub, Vercel, firmware, or browser.
- `AGNES_CREDENTIAL_ENC_KEY` and provider keys live only in Supabase secrets.
- `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` live only in GitHub secrets.
- Keep `AGNES_ALLOWED_ORIGINS` limited to real origins.
- Rotate any token or key that is exposed.
- The deploy workflow only runs from `main` and uses the `production`
  environment.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| `supabase link` asks for a password | Set `SUPABASE_DB_PASSWORD`; the CLI reads it in CI |
| `db push` re-runs existing migrations | The preflight did not detect `full`; run `supabase migration repair --status applied <version> --remote --yes` once |
| `relation ... already exists` | The migration history is out of sync; inspect with `supabase migration list --remote`, then repair |
| `permission denied for function` in CI | The RPC probe expects `401/403`; a `404` means the function is missing |
| CORS error after Vercel deploy | Add the exact Vercel origin to `AGNES_ALLOWED_ORIGINS` and redeploy |
| `server_misconfigured` from a function | Missing `AGNES_CREDENTIAL_ENC_KEY` or Supabase-injected variables |
| Function returns `404` after deploy | The function name or project ref is wrong; check `supabase functions list` |
| Firmware artifact not found | The compile failed; read the **Compile firmware** step |

## 12. What is still not verified

- The 15 functions have not been deployed yet (live probes returned `404`).
- Live RLS behavior with two real users has not been tested.
- Provider calls need real OpenRouter/NVIDIA keys.
- Pairing has not been tested end-to-end.
- Hardware, battery, charging, OLED controller, and sleep current are unverified.
- Vercel deployment is not configured yet.

The first successful run of **Deploy Supabase** and **Vercel** closes the
backend/dashboard deployment gap. The hardware checks remain manual.
