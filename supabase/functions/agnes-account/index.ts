import { z } from "npm:zod@3.23.8";
import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";

const requestSchema = z.object({
  action: z.literal("delete"),
  confirmation: z.literal("DELETE"),
}).strict();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    await parseJson(req, requestSchema);
    const allowed = await enforceRateLimit("agnes-account:delete", auth.userId, 2, 3600);
    if (!allowed) throw new ApiError("rate_limited", "Too many account deletion attempts", 429);

    // Cascades through auth.users -> all agnes_* user-owned tables.
    const { error } = await admin().auth.admin.deleteUser(auth.userId, true);
    if (error) {
      console.error("Account deletion failed", error.status ?? "unknown");
      throw new ApiError("account_delete_failed", "Could not delete the account", 500);
    }
    return ok(req, { deleted: true });
  } catch (error) {
    return fail(req, error);
  }
});
