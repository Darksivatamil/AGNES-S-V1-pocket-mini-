import { admin } from "../_shared/db.ts";
import { authenticate, deviceOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { deviceAuthRequestSchema } from "../_shared/validation.ts";
import { randomHex, sha256Hex } from "../_shared/crypto.ts";
import { readPetState } from "../_shared/pet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = deviceOnly(await authenticate(req, { allowUser: false, allowDevice: true }));
    const body = await parseJson(req, deviceAuthRequestSchema);
    const allowed = await enforceRateLimit("agnes-device-auth", auth.deviceId, 60, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many device auth checks", 429);

    if (body.action === "rotate") {
      const token = randomHex(32);
      const tokenHash = await sha256Hex(token);
      const { error } = await admin()
        .from("agnes_device_credentials")
        .update({ token_hash: tokenHash, rotated_at: new Date().toISOString() })
        .eq("device_id", auth.deviceId);
      if (error) throw new ApiError("rotate_failed", "Could not rotate device credential", 500);
      return ok(req, {
        device_id: auth.deviceId,
        device_token: token,
        server_time: new Date().toISOString(),
      });
    }

    const now = new Date().toISOString();
    const [{ data: device, error: deviceError }, { data: settings }, pet] = await Promise.all([
      admin()
        .from("agnes_devices")
        .update({ last_seen_at: now })
        .eq("id", auth.deviceId)
        .eq("user_id", auth.userId)
        .is("revoked_at", null)
        .select("id, user_id, hardware_id, name, board, firmware_version, oled_controller, last_seen_at, battery_voltage_mv, battery_percent, wifi_rssi, free_heap, uptime_seconds, current_emotion, current_personality, capabilities, created_at")
        .maybeSingle(),
      admin().from("agnes_settings").select("*").eq("user_id", auth.userId).maybeSingle(),
      readPetState(auth.userId),
    ]);
    if (deviceError) throw new ApiError("device_auth_failed", "Could not update device state", 500);
    if (!device) throw new ApiError("device_revoked", "Device is revoked", 403);

    return ok(req, {
      device,
      settings: settings ?? null,
      pet_state: pet,
      server_time: now,
    });
  } catch (error) {
    return fail(req, error);
  }
});
