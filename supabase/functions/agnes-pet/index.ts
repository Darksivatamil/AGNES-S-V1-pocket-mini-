import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { petRequestSchema } from "../_shared/validation.ts";
import { interact, readPetState } from "../_shared/pet.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, petRequestSchema);
    const allowed = await enforceRateLimit("agnes-pet", auth.userId, 30, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many pet interactions", 429);

    if (body.action === "interact") {
      const result = await interact(
        auth.userId,
        body.interaction,
        "web",
        null,
        `web:${body.request_id}`,
      );
      return ok(req, {
        pet_state: result.state,
        event: result.event,
        achievements: result.achievements,
      });
    }

    const [{ data: events }, state, { data: achievements }] = await Promise.all([
      admin()
        .from("agnes_pet_events")
        .select("id, event_type, delta_happiness, delta_energy, delta_hunger, xp_delta, source, payload, created_at")
        .eq("user_id", auth.userId)
        .order("created_at", { ascending: false })
        .limit(body.limit ?? 30),
      readPetState(auth.userId),
      admin()
        .from("agnes_pet_achievements")
        .select("achievement_id, unlocked_at")
        .eq("user_id", auth.userId)
        .order("unlocked_at", { ascending: false }),
    ]);

    return ok(req, {
      pet_state: state,
      events: events ?? [],
      achievements: achievements ?? [],
    });
  } catch (error) {
    return fail(req, error);
  }
});
