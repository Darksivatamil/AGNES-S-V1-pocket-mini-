import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ApiError } from "./http.ts";

export type IdempotentState =
  | { kind: "new" }
  | { kind: "completed"; response: unknown }
  | { kind: "in_progress" };

/**
 * Reserve a request ID before doing expensive work. If a completed response
 * exists it is returned verbatim, preventing duplicate messages on retry.
 */
export async function beginIdempotent(
  client: SupabaseClient,
  key: string,
  userId: string,
): Promise<IdempotentState> {
  const now = new Date();
  const { error } = await client.from("agnes_idempotency").insert({
    key,
    user_id: userId,
    status: "pending",
  });

  if (!error) return { kind: "new" };
  if (error.code !== "23505") {
    console.error("Idempotency reservation failed", error.code);
    throw new ApiError("idempotency_unavailable", "Could not reserve request ID", 500);
  }

  const { data, error: readError } = await client
    .from("agnes_idempotency")
    .select("status, response, created_at")
    .eq("key", key)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError || !data) {
    throw new ApiError("idempotency_unavailable", "Could not read request state", 500);
  }
  if (data.status === "completed") {
    return { kind: "completed", response: data.response };
  }

  const createdAt = new Date(data.created_at as string).getTime();
  if (data.status === "pending" && now.getTime() - createdAt < 120_000) {
    return { kind: "in_progress" };
  }

  // Failed or stale pending reservation: take it over atomically.
  const { error: takeoverError } = await client
    .from("agnes_idempotency")
    .update({ status: "pending", response: null, created_at: now.toISOString() })
    .eq("key", key)
    .eq("user_id", userId)
    .neq("status", "completed");
  if (takeoverError) {
    throw new ApiError("idempotency_unavailable", "Could not reserve request ID", 500);
  }
  return { kind: "new" };
}

export async function completeIdempotent(
  client: SupabaseClient,
  key: string,
  userId: string,
  response: unknown,
): Promise<void> {
  const { error } = await client
    .from("agnes_idempotency")
    .update({ status: "completed", response })
    .eq("key", key)
    .eq("user_id", userId);
  if (error) console.error("Idempotency completion failed", error.code);
}

export async function failIdempotent(
  client: SupabaseClient,
  key: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("agnes_idempotency")
    .delete()
    .eq("key", key)
    .eq("user_id", userId)
    .neq("status", "completed");
  if (error) console.error("Idempotency cleanup failed", error.code);
}
