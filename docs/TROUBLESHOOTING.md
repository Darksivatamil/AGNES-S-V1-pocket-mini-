# Troubleshooting — AGNES OS 2.0

Start with the layer that fails. Do not assume the AI, the database, and the
hardware are all working until each has been checked independently.

## Dashboard

### "Supabase is not configured" notice

`web/.env.local` (or the Vercel environment) is missing values. Required:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

Restart `npm run dev` after editing env files. On Vercel, redeploy after changing
variables; preview and production environments are separate.

### Login succeeds, then redirects back to `/login`

- Confirm the Supabase Site URL and redirect allowlist include your exact origin.
- Clear stale cookies for the domain.
- Check that `web/src/proxy.ts` is present. Next 16 renamed middleware to proxy; an
  old `middleware.ts` is not used.
- Confirm the anon key belongs to the same project as the URL.

### Edge Function returns 401

- Browser: the session expired. Sign in again.
- Device: the token may have been revoked or rotated. Re-pair the device.
- Confirm the function was deployed with `verify_jwt = false`; otherwise Supabase
  rejects the request before the function runs.

### CORS error in the browser

`AGNES_ALLOWED_ORIGINS` must contain the exact origin (`https://app.example.com`,
`http://localhost:3000`), with scheme and port, comma-separated. No trailing slash.
After changing it, re-run `supabase secrets set` and redeploy/restart the functions.

Production intentionally fails closed when the list is empty. For local-only work,
either add `http://localhost:3000` or set `AGNES_ENV=development`.

### 429 rate limited

Limits are per user/device (see `docs/API.md`). Wait for the window to pass. A
device reconnecting repeatedly can consume `agnes-sync` or `agnes-device-auth`
budgets; check for a reconnect loop in serial logs.

### "This request is still being processed"

The same `request_id` is still in flight. Reuse the same UUID and retry after a
couple of seconds. After two minutes a stale reservation can be taken over.

### Dashboard tables are empty

- Confirm you are signed into the account that owns the rows.
- The browser reads with RLS. No service-role key is used by the dashboard.
- New installs legitimately have no rows.
- If every table is empty but the API works, verify migrations actually ran.

## Pairing and devices

### Pairing code invalid or expired

Codes are single-use and expire after 10 minutes. Create a new one. Normalization
is case-insensitive, but copy the `AGN-XXXXX-XXXXX` shape.

### `device_owned`

The hardware ID is paired to another account. Revoke it there, then create a new
code and retry. If you no longer control the other account, you must use a new
hardware ID or manually clear the device row as the project operator.

### Device never appears online

- ESP32-C3 supports **2.4 GHz only**. 5 GHz networks will not connect.
- Check the OLED/serial log for the Wi-Fi failure reason.
- Verify `AGNES_SUPABASE_URL` is the base project URL, not the dashboard URL.
- The device needs a valid clock for TLS/expiry checks. It uses network time; wait
  for the first successful connection and sync.
- Confirm the functions are deployed and the device token was not revoked.

### Device shows "not paired" after reflashing

NVS was erased or the token was overwritten. Create a new pairing code and pair
again. Re-pairing the same hardware ID rotates the credential.

## Firmware build and upload

### "Sketch too big; see ... program storage space"

The default 1.2 MB app partition is too small (firmware is ~1.53 MB). Select
**Huge APP (3 MB No OTA/1 MB SPIFFS)** or pass
`--fqbn esp32:esp32:esp32c3:PartitionScheme=huge_app`.

### Upload fails to open the port

- Use a data-capable USB-C cable.
- Hold BOOT, tap RESET, release BOOT, then upload.
- Linux permissions: add your user to `dialout` and re-login.
- Check the actual port with `arduino-cli board list`.
- If the board uses native USB CDC, try enabling **USB CDC On Boot** or use the
  UART port exposed by the board.

### OLED stays blank

1. Confirm 3.3 V and GND.
2. Run an I2C scanner; the address is usually `0x3C` or `0x3D`.
3. Set `AGNES_OLED_I2C_ADDRESS` accordingly.
4. Try the other controller: `-DAGNES_OLED_SH1106=1` for SH1106, or `0` for
   SSD1306.
5. Check SDA/SCL are GPIO4/GPIO5 in `Config.h` and not swapped.
6. A 0.93" module may be SH1106 despite being sold as SSD1306.

### Buttons do nothing or trigger at boot

- Buttons must connect GPIO to GND (`INPUT_PULLUP`, active LOW).
- GPIO8 is a strapping pin. A button held low at reset can prevent boot. This is why
  GPIO10 is preferred for NEXT.
- If using GPIO10, compile with `-DAGNES_BUTTON_NEXT_PIN=10`; verify the clone
  actually exposes GPIO10.
- Do not use GPIO9 for a button.
- Check for solder bridges and add 100 nF debounce capacitors if needed.

### Battery percentage is wrong

- Verify the divider ratio (`AGNES_BATTERY_DIVIDER_RATIO`) and that the ADC input
  never exceeds 3.1 V.
- Calibrate against a multimeter: `AGNES_BATTERY_CALIBRATION = Vbat / Vfw`.
- The ESP32-C3 ADC is noisy; use the recommended capacitor and average readings.
- Never connect the LiPo directly to the 3.3 V rail.

### Charger or regulator gets hot

Stop immediately. A 500 mAh cell should generally charge at ≤250 mA; many TP4056
boards default to 1 A. Verify `RPROG`, cell protection, and the power path. TP4056
has no load sharing; do not run the ESP32 from the battery while charging without a
proper power-path design. See `docs/HARDWARE.md`.

### Battery runtime is short

The display and Wi-Fi dominate. In 2.0.0, screen-off disables the OLED but the
device stays awake while Wi-Fi is connected. Light sleep is only entered when the
screen is off **and** Wi-Fi is disconnected. Deep sleep is not scheduled
automatically because the three buttons are not RTC wake sources on the ESP32-C3.
Measure current; do not trust runtime estimates.

## Chat and AI

### "Add a provider key" / no model selected

Open **Providers**, save a key, test it, refresh the catalogue, pick a free model,
and save preferences. Until then chat fails honestly.

### NVIDIA models are blocked

NVIDIA hosted endpoints do not expose reliable pricing metadata, so AGNES marks them
`unknown`/account-managed. Enable **Allow paid / account-managed models** explicitly
and confirm you accept the billing. AGNES will not call them free.

### "Provider returned plain text" warning

The model ignored the strict JSON contract. AGNES accepts the reply as plain text
with a warning and no three-choice question. Try a model with structured-output
support, or keep the current one and answer with the explicit continuation.

### The three choices are missing

- The provider must return `ask_question: true` with exactly three unique options,
  each at most 32 characters.
- Invalid questions are discarded rather than shown.
- Questions expire after 30 minutes and are cancelled when a newer turn arrives.

### Chat works on the web but not on the device

- The device shares the same conversation table, but needs Wi-Fi, a valid token and
  clock, and a sync.
- The device never generates text locally. Offline, it shows cached content and an
  explicit unavailability message.
- Check `agnes-chat` rate limits and the serial log for HTTP status codes.

### "That choice expired or was answered elsewhere"

Another surface answered first, or 30 minutes elapsed. Press SELECT on the device to
send the explicit "Ask AGNES to continue" message, or send a new message in the
dashboard.

## Commands and sync

### Command stays PENDING

The device has not synced. Confirm it is online and within the 15-minute command
expiry. Commands are delivered on the next sync; `SYNC_NOW` itself still needs a
sync to arrive. Expired commands show `EXPIRED`, not a fake success.

### Command shows FAILED

Open Diagnostics for the device's error string. Common causes: invalid personality
or theme string, brightness outside 0–255, or sleep timeout outside 30–3600 seconds.
The device validates payloads again even though the server already did.

### Notifications do not disappear after reading

Read IDs are queued and delivered with the next sync. If the queue is full or the
sync fails, the local read cache persists and retries. Check Diagnostics for command
and sync events.

## Data and account

### Notes are read-only on the device

This is intentional in 2.0.0. Notes can be created/edited/deleted in the dashboard;
the device displays the synced copy. Memories are also approved in the dashboard.

### Account deletion did not free the email

Auth deletion normally frees it, but Supabase project policies and confirmation
settings can affect this. Check the Auth users list and your project's retention
settings. Deletion is irreversible and there is no export step.

## Still stuck

Collect:

- Function name, HTTP status, `error.code`, and `request_id` (never the full token).
- Dashboard browser console/network details with secrets redacted.
- Serial log from boot with Wi-Fi SSID redacted.
- Firmware version and partition scheme.
- Steps to reproduce and whether it happens on a second account/device.

Do not paste provider keys, service-role keys, device tokens, or full JWTs into an
issue.
