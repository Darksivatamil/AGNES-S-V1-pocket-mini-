import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { memoryRequestSchema } from "../_shared/validation.ts";
import {
  beginIdempotent,
  completeIdempotent,
  failIdempotent,
} from "../_shared/idempotency.ts";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function cloudMemoryEnabled(userId: string): Promise<boolean> {
  const { data } = await admin()
    .from("agnes_settings")
    .select("cloud_memory_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.cloud_memory_enabled !== false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, memoryRequestSchema);
    const allowed = await enforceRateLimit("agnes-memory", auth.userId, 60, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many memory requests", 429);

    if (body.action === "list") {
      const limit = body.limit ?? 50;
      const offset = body.offset ?? 0;
      let query = admin()
        .from("agnes_memories")
        .select("id, category, content, status, source, pinned, version, created_at, updated_at")
        .eq("user_id", auth.userId)
        .is("deleted_at", null)
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (body.category) query = query.eq("category", body.category);
      if (body.status) query = query.eq("status", body.status);
      if (body.query) query = query.ilike("content", `%${escapeLike(body.query)}%`);
      const { data, error } = await query;
      if (error) throw new ApiError("memory_list_failed", "Could not load memories", 500);
      return ok(req, { memories: data ?? [], cloud_memory_enabled: await cloudMemoryEnabled(auth.userId) });
    }

    if (body.action === "create") {
      if (!(await cloudMemoryEnabled(auth.userId))) {
        throw new ApiError("cloud_memory_disabled", "Cloud memory is disabled. Enable it before saving memories.", 409);
      }
      const key = `memory:create:${auth.userId}:${body.request_id}`;
      const state = await beginIdempotent(admin(), key, auth.userId);
      if (state.kind === "completed") return ok(req, state.response);
      if (state.kind === "in_progress") throw new ApiError("request_in_progress", "Still saving", 409);
      try {
        const { data, error } = await admin()
          .from("agnes_memories")
          .insert({
            user_id: auth.userId,
            category: body.category,
            content: body.content,
            status: "approved",
            source: "user",
            pinned: body.pinned,
          })
          .select("id, category, content, status, source, pinned, version, created_at, updated_at")
          .single();
        if (error) throw new ApiError("memory_create_failed", "Could not save memory", 500);
        await completeIdempotent(admin(), key, auth.userId, { memory: data });
        return ok(req, { memory: data });
      } catch (error) {
        await failIdempotent(admin(), key, auth.userId);
        throw error;
      }
    }

    if (body.action === "update") {
      const { data: current, error: readError } = await admin()
        .from("agnes_memories")
        .select("id, category, content, status, pinned, version, source, created_at, updated_at")
        .eq("id", body.id)
        .eq("user_id", auth.userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (readError) throw new ApiError("memory_read_failed", "Could not load memory", 500);
      if (!current) throw new ApiError("memory_not_found", "Memory not found", 404);

      const editsContent = body.content !== undefined || body.category !== undefined;
      if (editsContent && !(await cloudMemoryEnabled(auth.userId))) {
        throw new ApiError("cloud_memory_disabled", "Cloud memory is disabled", 409);
      }

      const changes: Record<string, unknown> = { version: current.version + 1 };
      if (body.content !== undefined) changes.content = body.content;
      if (body.category !== undefined) changes.category = body.category;
      if (body.status !== undefined) changes.status = body.status;
      if (body.pinned !== undefined) changes.pinned = body.pinned;

      const { data, error } = await admin()
        .from("agnes_memories")
        .update(changes)
        .eq("id", body.id)
        .eq("user_id", auth.userId)
        .eq("version", current.version)
        .select("id, category, content, status, source, pinned, version, created_at, updated_at")
        .maybeSingle();
      if (error) throw new ApiError("memory_update_failed", "Could not update memory", 500);
      if (!data) throw new ApiError("memory_conflict", "Memory changed; refresh and retry", 409);
      return ok(req, { memory: data });
    }

    // delete (soft)
    const { data, error } = await admin()
      .from("agnes_memories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", body.id)
      .eq("user_id", auth.userId)
      .select("id")
      .maybeSingle();
    if (error) throw new ApiError("memory_delete_failed", "Could not delete memory", 500);
    if (!data) throw new ApiError("memory_not_found", "Memory not found", 404);
    return ok(req, { deleted: true, id: data.id });
  } catch (error) {
    return fail(req, error);
  }
});
