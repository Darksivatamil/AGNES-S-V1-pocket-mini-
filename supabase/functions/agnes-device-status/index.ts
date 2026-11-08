import { authenticate, deviceOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { deviceStatusRequestSchema } from "../_shared/validation.ts";
import { applyDeviceStatus } from "../_shared/device.ts";
import { admin } from "../_shared/db.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = deviceOnly(await authenticate(req, { allowUser: false, allowDevice: true }));
    const body = await parseJson(req, deviceStatusRequestSchema);
    const allowed = await enforceRateLimit("agnes-device-status", auth.deviceId, 60, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many status updates", 429);

    await applyDeviceStatus(auth.deviceId, auth.userId, body.status);

    if (body.status.last_error) {
      await admin().from("agnes_device_events").insert({
        user_id: auth.userId,
        device_id: auth.deviceId,
        type: "status_error",
        severity: "warning",
        message: body.status.last_error.slice(0, 500),
        payload: {
          firmware_version: body.status.firmware_version,
          free_heap: body.status.free_heap ?? null,
          battery_percent: body.status.battery_percent ?? null,
        },
      });
    }

    return ok(req, { server_time: new Date().toISOString() });
  } catch (error) {
    return fail(req, error);
  }
});
