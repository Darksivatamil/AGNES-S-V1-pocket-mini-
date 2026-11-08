import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { notificationRequestSchema } from "../_shared/validation.ts";
import {
  beginIdempotent,
  completeIdempotent,
  failIdempotent,
} from "../_shared/idempotency.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, notificationRequestSchema);
    const allowed = await enforceRateLimit("agnes-notifications", auth.userId, 60, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many notification requests", 429);

    if (body.action === "list") {
      const { data, error } = await admin()
        .from("agnes_notifications")
        .select("id, device_id, title, body, kind, deliver_at, read_at, created_at")
        .eq("user_id", auth.userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(body.limit ?? 50);
      if (error) throw new ApiError("notifications_failed", "Could not load notifications", 500);
      return ok(req, { notifications: data ?? [] });
    }

    if (body.action === "create") {
      if (body.device_id) {
        const { data: device } = await admin()
          .from("agnes_devices")
          .select("id")
          .eq("id", body.device_id)
          .eq("user_id", auth.userId)
          .is("revoked_at", null)
          .maybeSingle();
        if (!device) throw new ApiError("device_not_found", "Device not found", 404);
      }
      const key = `notification:create:${auth.userId}:${body.request_id}`;
      const state = await beginIdempotent(admin(), key, auth.userId);
      if (state.kind === "completed") return ok(req, state.response);
      if (state.kind === "in_progress") throw new ApiError("request_in_progress", "Still creating", 409);
      try {
        const { data, error } = await admin()
          .from("agnes_notifications")
          .insert({
            user_id: auth.userId,
            device_id: body.device_id ?? null,
            title: body.title,
            body: body.body,
            kind: body.kind,
            deliver_at: body.deliver_at ?? new Date().toISOString(),
          })
          .select("id, device_id, title, body, kind, deliver_at, read_at, created_at")
          .single();
        if (error) throw new ApiError("notification_create_failed", "Could not create notification", 500);
        await completeIdempotent(admin(), key, auth.userId, { notification: data });
        return ok(req, { notification: data });
      } catch (error) {
        await failIdempotent(admin(), key, auth.userId);
        throw error;
      }
    }

    if (body.action === "mark_read") {
      const { data, error } = await admin()
        .from("agnes_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("user_id", auth.userId)
        .is("deleted_at", null)
        .select("id, read_at")
        .maybeSingle();
      if (error) throw new ApiError("notification_update_failed", "Could not update notification", 500);
      if (!data) throw new ApiError("notification_not_found", "Notification not found", 404);
      return ok(req, { notification: data });
    }

    // delete (soft)
    const { data, error } = await admin()
      .from("agnes_notifications")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", body.id)
      .eq("user_id", auth.userId)
      .select("id")
      .maybeSingle();
    if (error) throw new ApiError("notification_delete_failed", "Could not delete notification", 500);
    if (!data) throw new ApiError("notification_not_found", "Notification not found", 404);
    return ok(req, { deleted: true, id: data.id });
  } catch (error) {
    return fail(req, error);
  }
});
