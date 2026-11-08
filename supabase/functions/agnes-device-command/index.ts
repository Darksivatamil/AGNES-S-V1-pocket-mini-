import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import {
  beginIdempotent,
  completeIdempotent,
  failIdempotent,
} from "../_shared/idempotency.ts";
import {
  commandRequestSchema,
  validateCommandPayload,
} from "../_shared/validation.ts";

const COMMAND_TTL_MS = 15 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, commandRequestSchema);
    const allowed = await enforceRateLimit("agnes-device-command", auth.userId, 30, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many commands", 429);

    const payload = validateCommandPayload(body.type, body.payload);

    const { data: device, error: deviceError } = await admin()
      .from("agnes_devices")
      .select("id, name")
      .eq("id", body.device_id)
      .eq("user_id", auth.userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (deviceError) throw new ApiError("device_read_failed", "Could not load device", 500);
    if (!device) throw new ApiError("device_not_found", "Paired device not found", 404);

    const key = `command:${auth.userId}:${body.device_id}:${body.request_id}`;
    const state = await beginIdempotent(admin(), key, auth.userId);
    if (state.kind === "completed") return ok(req, state.response);
    if (state.kind === "in_progress") {
      throw new ApiError("request_in_progress", "Command is still being queued", 409);
    }

    try {
      const { data: command, error } = await admin()
        .from("agnes_device_commands")
        .insert({
          user_id: auth.userId,
          device_id: body.device_id,
          type: body.type,
          payload,
          idempotency_key: body.request_id,
          expires_at: new Date(Date.now() + COMMAND_TTL_MS).toISOString(),
        })
        .select("id, device_id, type, payload, status, expires_at, created_at")
        .single();
      if (error) {
        if (error.code === "23505") {
          const { data: existing } = await admin()
            .from("agnes_device_commands")
            .select("id, device_id, type, payload, status, expires_at, created_at")
            .eq("device_id", body.device_id)
            .eq("idempotency_key", body.request_id)
            .maybeSingle();
          if (existing) {
            await completeIdempotent(admin(), key, auth.userId, existing);
            return ok(req, existing);
          }
        }
        throw new ApiError("command_failed", "Could not queue device command", 500);
      }
      await completeIdempotent(admin(), key, auth.userId, command);
      return ok(req, { ...command, acknowledged: false });
    } catch (error) {
      await failIdempotent(admin(), key, auth.userId);
      throw error;
    }
  } catch (error) {
    return fail(req, error);
  }
});
