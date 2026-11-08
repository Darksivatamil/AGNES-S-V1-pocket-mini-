import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { profileRequestSchema } from "../_shared/validation.ts";
import { readSettings, safeSettings } from "../_shared/device.ts";
import { readPetState } from "../_shared/pet.ts";

async function ensureSettings(userId: string): Promise<Record<string, unknown>> {
  const existing = await readSettings(userId);
  if (existing) return existing;
  const { error } = await admin().from("agnes_settings").insert({ user_id: userId });
  if (error && error.code !== "23505") {
    throw new ApiError("settings_failed", "Could not create settings", 500);
  }
  const created = await readSettings(userId);
  if (!created) throw new ApiError("settings_failed", "Could not load settings", 500);
  return created;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, profileRequestSchema);
    const allowed = await enforceRateLimit("agnes-profile", auth.userId, 60, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many profile requests", 429);

    if (body.action === "get") {
      const [{ data: profile }, settings, pet, { data: prefs }, { data: devices }] = await Promise.all([
        admin().from("agnes_profiles").select("user_id, display_name, avatar_url, created_at, updated_at").eq("user_id", auth.userId).maybeSingle(),
        ensureSettings(auth.userId),
        readPetState(auth.userId),
        admin().from("agnes_model_preferences").select("*").eq("user_id", auth.userId).maybeSingle(),
        admin()
          .from("agnes_devices")
          .select("id, hardware_id, name, board, oled_controller, firmware_version, last_seen_at, battery_voltage_mv, battery_percent, wifi_rssi, free_heap, uptime_seconds, current_emotion, current_personality, last_error, revoked_at, created_at")
          .eq("user_id", auth.userId)
          .order("created_at", { ascending: false }),
      ]);

      const { data: achievements } = await admin()
        .from("agnes_pet_achievements")
        .select("achievement_id, unlocked_at")
        .eq("user_id", auth.userId);

      return ok(req, {
        profile: profile ?? { user_id: auth.userId, display_name: "AGNES User" },
        settings,
        pet_state: pet,
        model_preferences: prefs ?? null,
        devices: devices ?? [],
        achievements: achievements ?? [],
      });
    }

    if (body.action === "update_profile") {
      const { data, error } = await admin()
        .from("agnes_profiles")
        .upsert({ user_id: auth.userId, display_name: body.display_name }, { onConflict: "user_id" })
        .select("user_id, display_name, avatar_url, updated_at")
        .single();
      if (error) throw new ApiError("profile_update_failed", "Could not update profile", 500);
      return ok(req, { profile: data });
    }

    if (body.action === "update_pet_name") {
      const { data, error } = await admin()
        .from("agnes_pet_state")
        .update({ name: body.name, version: Math.floor(Date.now() / 1000) })
        .eq("user_id", auth.userId)
        .select("*")
        .maybeSingle();
      if (error) throw new ApiError("pet_update_failed", "Could not rename pet", 500);
      if (!data) throw new ApiError("pet_not_found", "Pet state not found", 404);
      return ok(req, { pet_state: data });
    }

    // update_settings
    const current = await ensureSettings(auth.userId);
    const changes: Record<string, unknown> = {};
    const fields = [
      "personality",
      "theme",
      "brightness",
      "idle_animations",
      "sleep_timeout_seconds",
      "cloud_memory_enabled",
      "notifications_enabled",
      "timezone_posix",
      "location_name",
      "latitude",
      "longitude",
    ] as const;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        changes[field] = (body as Record<string, unknown>)[field];
      }
    }

    const newLat = Object.prototype.hasOwnProperty.call(changes, "latitude")
      ? changes.latitude
      : current.latitude;
    const newLon = Object.prototype.hasOwnProperty.call(changes, "longitude")
      ? changes.longitude
      : current.longitude;
    if ((newLat === null) !== (newLon === null) || (newLat === undefined) !== (newLon === undefined)) {
      throw new ApiError("invalid_location", "Set both latitude and longitude, or neither", 400);
    }
    if (Object.keys(changes).length === 0) {
      return ok(req, { settings: current });
    }

    changes.sync_version = Number(current.sync_version ?? 1) + 1;
    const { data, error } = await admin()
      .from("agnes_settings")
      .update(changes)
      .eq("user_id", auth.userId)
      .select("*")
      .single();
    if (error) throw new ApiError("settings_update_failed", "Could not update settings", 500);

    return ok(req, {
      settings: safeSettings(data as Record<string, unknown>),
      note: "Settings are applied on the device at its next sync; queue a device command for immediate application.",
    });
  } catch (error) {
    return fail(req, error);
  }
});
