import { z } from "npm:zod@3.23.8";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { providerSchema } from "../_shared/validation.ts";
import { testProviderConnection } from "../_shared/providerAdmin.ts";

const requestSchema = z.object({ provider: providerSchema }).strict();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, requestSchema);
    const allowed = await enforceRateLimit("agnes-provider-test", auth.userId, 8, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many connection tests", 429);
    const result = await testProviderConnection(auth.userId, body.provider);
    return ok(req, result);
  } catch (error) {
    return fail(req, error);
  }
});
