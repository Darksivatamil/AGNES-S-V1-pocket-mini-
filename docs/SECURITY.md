# Security — AGNES OS 2.0

This document describes the implemented controls, the threat model, and the parts
that are **not** verified or guaranteed by this repository.

## Trust boundaries

| Component | Secrets it may hold | Must never hold |
|---|---|---|
| ESP32-C3 firmware | Device token, Wi-Fi credentials, pairing code | Provider API keys, Supabase service-role key, database password |
| Browser | Public Supabase anon/publishable key, user JWT | Service-role key, provider keys, device token |
| Edge Functions | Service-role key, AES key, provider keys | User passwords |
| PostgreSQL | Data at rest (unless your project enables encryption) | Plaintext provider keys (they are encrypted before insert) |
| AI providers | Prompt/context sent for one reply | Device tokens, service-role key, other users' data |

The browser never calls privileged RPCs directly. Writes to devices, settings,
provider credentials, memories, commands, notifications, pet state and usage go
through Edge Functions.

## Authentication

### Browser users

Supabase Auth issues a JWT. Every user-only function verifies it with
`auth.getUser(jwt)` server-side. RLS also checks `auth.uid()` on every read.

### Devices

1. The dashboard creates a pairing code (`AGN-XXXXX-XXXXX`). Only its SHA-256 hash
   is stored; it is single-use and expires after 10 minutes.
2. The device exchanges the code for a random 64-hex device token during `claim`.
3. Only the token's SHA-256 hash is stored. The raw token is returned once and kept
   in device NVS.
4. Device requests send `x-agnes-device-id` and `x-agnes-device-token`.
5. Revoking a device deletes its credential row; subsequent requests fail with 401.
6. Tokens are per-device, so one compromised device does not authorize another.

Device auth is not a substitute for physical security. Anyone with flash access can
read NVS unless flash encryption is enabled on the ESP32.

### Pairing race handling

`claim` consumes the pairing code with a conditional update
(`used_at IS NULL`, unexpired) before issuing credentials. A device already owned
by another account cannot be re-paired unless it was revoked there first.

## Provider credentials

- Encrypted with AES-256-GCM using `AGNES_CREDENTIAL_ENC_KEY` (32 random bytes,
  base64-encoded in the function environment).
- A fresh 12-byte IV per write.
- Additional authenticated data binds ciphertext to `agnes:v1:<user-id>:<provider>`,
  preventing a ciphertext from being moved between users or providers.
- Only the last four characters are returned as a hint.
- Per-user keys take precedence over operator fallback keys. Fallback keys are never
  returned to a client.
- Missing or invalid encryption configuration fails closed; keys cannot be stored in
  plaintext as a fallback.
- Rotating the encryption key requires re-saving provider keys. There is no
  multi-key rotation path in 2.0.0; this is documented as a limitation.

## Database access

- RLS is enabled on every `agnes_*` table.
- Users can `select` their own profile, settings, devices, conversations, messages,
  pending questions, memories, pet rows, provider status, preferences, usage,
  commands and device events.
- Sensitive writes are revoked from `anon` and `authenticated`; the service role
  performs them inside Edge Functions.
- Notes, tasks, diary, study sessions and reminders are user-owned CRUD tables with
  `for all` policies and explicit grants.
- Conversations can only be renamed/deleted through narrow grants. Messages are
  read-only to users.
- Notifications allow update of `read_at` only, plus delete/select.
- `agnes_device_credentials`, `agnes_pairing_codes`, `agnes_provider_credentials`,
  `agnes_model_catalogue`, `agnes_catalogue_meta`, `agnes_sync_state`,
  `agnes_idempotency` and `agnes_rate_limits` have no direct user grants.
- SECURITY DEFINER helpers pin `search_path = public`.

RLS policies are only as good as the deployed migrations. This repository does not
include an independent RLS audit against a live project.

## Edge Function controls

- Every request body is parsed with a strict Zod schema (`.strict()` on most
  objects); unknown fields are rejected.
- JSON `content-type` is required, and bodies over 64 KB are rejected.
- CORS allows only configured origins. Production fails closed when
  `AGNES_ALLOWED_ORIGINS` is empty. Device requests do not use CORS.
- Fixed-window rate limits live in PostgreSQL and are applied before expensive work.
  Infrastructure failures fail closed for those routes.
- `agnes-chat` and other create operations reserve a request UUID in
  `agnes_idempotency`, preventing duplicate messages or pet events on retry.
- Responses are `no-store`; unhandled errors return a generic message and log only
  the error class, not message content.
- Message bodies, prompts, provider keys and tokens are never logged by the
  functions.
- The service-role client is instantiated only in `_shared/db.ts` and is never
  serialized into a response.

## AI-specific controls

- Provider keys stay server-side. The device and browser only receive the reply,
  metadata and usage.
- Prompt input is untrusted data. The system prompt fixes the response contract;
  model output is parsed and validated before use. AI output cannot execute shell or
  device commands.
- The three-choice contract is validated: exactly three unique IDs and labels, max
  32 characters each.
- Emotion, animation, intensity and mood delta are validated against enums/bounds.
  The firmware validates them again.
- Memories are only injected when approved and when cloud memory is enabled.
- Fallback never moves a free request to a paid model. Paid/unknown models require
  `allow_paid: true` and an explicit user selection. NVIDIA NIM is never labelled
  free.
- Retries are limited to retryable provider classes; authentication and invalid
  request errors are not retried.
- No on-device LLM exists. When cloud AI is unavailable, the firmware says so and
  never fabricates a reply.

## Data lifecycle

- Paid/account-managed AI usage is recorded only when the provider reports token
  usage. Missing values remain `null`; AGNES does not estimate costs.
- Memories have `pending|approved|rejected` states and soft deletes.
- Notes use soft deletes and version checks; a stale device cannot overwrite a newer
  edit.
- Account deletion calls `auth.admin.deleteUser(..., true)` and cascades through all
  user-owned tables.
- Backups, point-in-time recovery and retention are properties of your Supabase plan
  and configuration, not of this code.

## Firmware security

- HTTPS only, with the ESP-IDF certificate bundle. No insecure TLS fallback is
  compiled in.
- No provider/service-role key is present in firmware source or build flags.
- Commands are allowlisted server-side and re-validated on-device (type, payload,
  range).
- The device only accepts commands addressed to its paired device ID and user.
- Wi-Fi and pairing credentials are stored in NVS. Flash encryption and secure boot
  are **not enabled by default** and must be provisioned per device if your threat
  model requires them.
- Physical access to the board can expose NVS and the serial console.

## Known limitations and residual risks

- No independent penetration test or audit has been performed.
- RLS behavior and RPC signatures are not tested against a live PostgreSQL instance
  in this build environment.
- Provider-side logging, retention and training policies are outside AGNES's
  control. Review each provider's terms before sending personal data.
- Prompt injection remains possible in model output semantics; it cannot directly
  execute code or commands.
- Operator fallback keys let all users of a deployment consume that key. Monitor
  usage and set provider-side spend limits.
- If `AGNES_CREDENTIAL_ENC_KEY` leaks together with a database dump, stored provider
  keys can be decrypted. Keep the key in a secret manager and rotate by re-saving
  credentials.
- The dashboard's account-deletion flow is irreversible and does not export data
  first.
- No formal data-processing agreement, GDPR tooling, or audit log export is
  included.

## Reporting a vulnerability

Do not publish secrets or exploit details in a public issue. Contact the repository
owner privately with the affected function/table, reproduction steps, and impact.
Rotate any exposed Supabase or provider key immediately; assume a leaked key is
compromised even if you cannot see misuse.
