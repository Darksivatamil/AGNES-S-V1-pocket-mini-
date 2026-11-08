import { authenticate, assertDeviceMatches } from "../_shared/auth.ts";
import { admin } from "../_shared/db.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import {
  beginIdempotent,
  completeIdempotent,
  failIdempotent,
} from "../_shared/idempotency.ts";
import { chatRequestSchema } from "../_shared/validation.ts";
import { handleChat } from "../_shared/ai/chatEngine.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = await authenticate(req, { allowUser: true, allowDevice: true });
    const body = await parseJson(req, chatRequestSchema);
    assertDeviceMatches(auth, body.device_id);

    const key = `chat:${auth.kind}:${auth.kind === "device" ? auth.deviceId : auth.userId}:${body.request_id}`;
    const state = await beginIdempotent(admin(), key, auth.userId);
    if (state.kind === "completed") return ok(req, state.response);
    if (state.kind === "in_progress") {
      throw new ApiError(
        "request_in_progress",
        "This request is still being processed; retry shortly",
        409,
      );
    }

    try {
      const allowedMinute = await enforceRateLimit("agnes-chat:minute", auth.userId, 20, 60);
      const allowedHour = allowedMinute
        ? await enforceRateLimit("agnes-chat:hour", auth.userId, 150, 3600)
        : false;
      if (!allowedMinute || !allowedHour) {
        throw new ApiError("rate_limited", "Too many chat requests; wait a moment", 429);
      }

      const result = await handleChat(auth, body);
      await completeIdempotent(admin(), key, auth.userId, result);
      return ok(req, result);
    } catch (error) {
      await failIdempotent(admin(), key, auth.userId);
      throw error;
    }
  } catch (error) {
    return fail(req, error);
  }
});
