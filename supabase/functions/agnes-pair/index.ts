import { z } from "npm:zod@3.23.8";
import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, clientIp, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { normalizePairingCode, randomHex, randomPairingCode, sha256Hex } from "../_shared/crypto.ts";
import { readPetState } from "../_shared/pet.ts";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_code") }).strict(),
  z.object({
    action: z.literal("claim"),
    hardware_id: z.string().trim().regex(/^[A-Za-z0-9._:-]{6,80}$/),
    pairing_code: z.string().trim().min(10).max(32),
    name: z.string().trim().min(1).max(80).optional(),
    firmware_version: z.string().trim().max(40).optional(),
    oled_controller: z.enum(["ssd1306", "sh1106"]).optional(),
    capabilities: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  }).strict(),
  z.object({ action: z.literal("revoke"), device_id: z.string().uuid() }).strict(),
  z.object({
    action: z.literal("rename"),
    device_id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }).strict(),
]);

function defaultName(hardwareId: string): string {
  const suffix = hardwareId.replace(/^agnes-/i, "").slice(-6).toUpperCase();
  return `AGNES ${suffix}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const body = await parseJson(req, actionSchema);

    if (body.action === "claim") {
      // Device-initiated claim. The single-use, short-lived code is the proof
      // of user authorization; no user JWT exists on the device.
      const ip = clientIp(req);
      const allowedIp = await enforceRateLimit("agnes-pair:claim:ip", ip, 12, 600);
      const allowedHardware = await enforceRateLimit(
        "agnes-pair:claim:hw",
        body.hardware_id,
        8,
        600,
      );
      if (!allowedIp || !allowedHardware) {
        throw new ApiError("rate_limited", "Too many pairing attempts", 429);
      }

      const codeHash = await sha256Hex(normalizePairingCode(body.pairing_code));
      const now = new Date().toISOString();

      const { data: existingDevice, error: deviceReadError } = await admin()
        .from("agnes_devices")
        .select("id, user_id, revoked_at")
        .eq("hardware_id", body.hardware_id)
        .maybeSingle();
      if (deviceReadError) throw new ApiError("pairing_failed", "Could not check device", 500);

      // Consume the code atomically before issuing credentials.
      const { data: codeRow, error: codeError } = await admin()
        .from("agnes_pairing_codes")
        .update({ used_at: now })
        .eq("code_hash", codeHash)
        .is("used_at", null)
        .gt("expires_at", now)
        .select("id, user_id")
        .maybeSingle();
      if (codeError) throw new ApiError("pairing_failed", "Could not validate pairing code", 500);
      if (!codeRow) {
        throw new ApiError("invalid_pairing_code", "Pairing code is invalid or expired", 400);
      }

      if (
        existingDevice &&
        existingDevice.user_id !== codeRow.user_id &&
        !existingDevice.revoked_at
      ) {
        throw new ApiError(
          "device_owned",
          "This device is already paired to another account. Revoke it there before re-pairing.",
          409,
        );
      }

      const token = randomHex(32);
      const tokenHash = await sha256Hex(token);
      const deviceName = body.name?.trim() || defaultName(body.hardware_id);

      let deviceId: string;
      if (existingDevice) {
        const { data, error } = await admin()
          .from("agnes_devices")
          .update({
            user_id: codeRow.user_id,
            name: deviceName,
            firmware_version: body.firmware_version ?? null,
            oled_controller: body.oled_controller ?? null,
            capabilities: body.capabilities,
            revoked_at: null,
            last_seen_at: now,
          })
          .eq("id", existingDevice.id)
          .select("id")
          .single();
        if (error) throw new ApiError("pairing_failed", "Could not update device", 500);
        deviceId = data.id;
      } else {
        const { data, error } = await admin()
          .from("agnes_devices")
          .insert({
            user_id: codeRow.user_id,
            hardware_id: body.hardware_id,
            name: deviceName,
            firmware_version: body.firmware_version ?? null,
            oled_controller: body.oled_controller ?? null,
            capabilities: body.capabilities,
            last_seen_at: now,
          })
          .select("id")
          .single();
        if (error) {
          if (error.code === "23505") {
            throw new ApiError("device_exists", "Device pairing raced; retry", 409);
          }
          throw new ApiError("pairing_failed", "Could not register device", 500);
        }
        deviceId = data.id;
      }

      const { error: credentialError } = await admin()
        .from("agnes_device_credentials")
        .upsert({
          device_id: deviceId,
          token_hash: tokenHash,
          created_at: now,
          rotated_at: now,
        }, { onConflict: "device_id" });
      if (credentialError) throw new ApiError("pairing_failed", "Could not issue device credential", 500);

      await admin()
        .from("agnes_pairing_codes")
        .update({ used_by_device: deviceId })
        .eq("id", codeRow.id);

      const [{ data: settings }, pet] = await Promise.all([
        admin().from("agnes_settings").select("*").eq("user_id", codeRow.user_id).maybeSingle(),
        readPetState(codeRow.user_id),
      ]);

      return ok(req, {
        device_id: deviceId,
        device_token: token,
        name: deviceName,
        server_time: new Date().toISOString(),
        settings: settings ?? null,
        pet_state: pet,
      });
    }

    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));

    if (body.action === "create_code") {
      const allowed = await enforceRateLimit("agnes-pair:create", auth.userId, 10, 600);
      if (!allowed) throw new ApiError("rate_limited", "Too many pairing codes; wait a few minutes", 429);
      const raw = randomPairingCode();
      const codeHash = await sha256Hex(normalizePairingCode(raw));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error } = await admin().from("agnes_pairing_codes").insert({
        user_id: auth.userId,
        code_hash: codeHash,
        expires_at: expiresAt,
      });
      if (error) throw new ApiError("pairing_failed", "Could not create pairing code", 500);
      return ok(req, {
        code: raw,
        expires_at: expiresAt,
        instructions:
          "On AGNES choose Settings > Wi-Fi setup. Join the AGNES setup Wi-Fi, then enter this code with your Wi-Fi credentials.",
      });
    }

    if (body.action === "revoke") {
      const { data: device, error } = await admin()
        .from("agnes_devices")
        .select("id")
        .eq("id", body.device_id)
        .eq("user_id", auth.userId)
        .maybeSingle();
      if (error) throw new ApiError("device_read_failed", "Could not load device", 500);
      if (!device) throw new ApiError("device_not_found", "Device not found", 404);
      const revokeError = await admin()
        .from("agnes_devices")
        .update({ revoked_at: new Date().toISOString(), last_error: "Revoked by user" })
        .eq("id", device.id)
        .eq("user_id", auth.userId);
      if (revokeError.error) throw new ApiError("revoke_failed", "Could not revoke device", 500);
      await admin().from("agnes_device_credentials").delete().eq("device_id", device.id);
      return ok(req, { revoked: true, device_id: device.id });
    }

    // rename
    const { data: device, error } = await admin()
      .from("agnes_devices")
      .update({ name: body.name })
      .eq("id", body.device_id)
      .eq("user_id", auth.userId)
      .select("id, name")
      .maybeSingle();
    if (error) throw new ApiError("rename_failed", "Could not rename device", 500);
    if (!device) throw new ApiError("device_not_found", "Device not found", 404);
    return ok(req, { device });
  } catch (error) {
    return fail(req, error);
  }
});
