import { admin } from "./db.ts";
import { ApiError } from "./http.ts";

export type PetState = {
  user_id: string;
  name: string;
  happiness: number;
  energy: number;
  hunger: number;
  friendship_xp: number;
  level: number;
  stage: "newborn" | "curious" | "companion" | "guardian";
  last_decay_at: string;
  version: number;
  updated_at: string;
};

const INTERACTIONS = {
  feed: {
    happiness: 3, energy: 1, hunger: -18, xp: 5, cooldownSeconds: 300,
  },
  play: {
    happiness: 8, energy: -7, hunger: 5, xp: 10, cooldownSeconds: 180,
  },
  rest: {
    happiness: 2, energy: 15, hunger: 0, xp: 4, cooldownSeconds: 600,
  },
  pet: {
    happiness: 5, energy: 0, hunger: 0, xp: 3, cooldownSeconds: 60,
  },
} as const;

export type Interaction = keyof typeof INTERACTIONS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function levelForXp(xp: number): number {
  return clamp(Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1, 1, 999);
}

export function stageForLevel(level: number): PetState["stage"] {
  if (level < 5) return "newborn";
  if (level < 15) return "curious";
  if (level < 30) return "companion";
  return "guardian";
}

async function ensureState(userId: string): Promise<PetState> {
  const { data, error } = await admin()
    .from("agnes_pet_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError("pet_state_failed", "Could not load pet state", 500);
  if (data) return data as PetState;
  const { data: created, error: createError } = await admin()
    .from("agnes_pet_state")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (createError) throw new ApiError("pet_state_failed", "Could not create pet state", 500);
  return created as PetState;
}

/** Apply time-based decay once, capped at 7 days, and persist a new version. */
export async function decayPetState(userId: string): Promise<PetState> {
  const state = await ensureState(userId);
  const now = Date.now();
  const last = Date.parse(state.last_decay_at);
  const hours = Math.min(Math.max((now - last) / 3_600_000, 0), 24 * 7);
  if (hours < 0.25) return state;

  const hunger = clamp(state.hunger + hours * 2.2, 0, 100);
  const energy = clamp(state.energy - hours * 1.0, 0, 100);
  const happinessPenalty = hunger > 70 ? hours * 1.2 : hours * 0.25;
  const happiness = clamp(state.happiness - happinessPenalty, 0, 100);
  return await updateState(state, {
    hunger,
    energy,
    happiness,
    last_decay_at: new Date(now).toISOString(),
  });
}

async function updateState(
  current: PetState,
  changes: Partial<PetState>,
): Promise<PetState> {
  const nextVersion = current.version + 1;
  const { data, error } = await admin()
    .from("agnes_pet_state")
    .update({ ...changes, version: nextVersion })
    .eq("user_id", current.user_id)
    .eq("version", current.version)
    .select("*")
    .maybeSingle();
  if (error) throw new ApiError("pet_state_failed", "Could not update pet state", 500);
  if (data) return data as PetState;

  // Concurrent update: reload and retry once with the caller's bounded changes.
  return await applyChanges(await ensureState(current.user_id), changes);
}

async function applyChanges(
  current: PetState,
  changes: Partial<PetState>,
): Promise<PetState> {
  const nextVersion = current.version + 1;
  const { data, error } = await admin()
    .from("agnes_pet_state")
    .update({ ...changes, version: nextVersion })
    .eq("user_id", current.user_id)
    .eq("version", current.version)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    throw new ApiError("pet_conflict", "Pet state changed concurrently; refresh and retry", 409);
  }
  return data as PetState;
}

export type PetUpdateResult = {
  state: PetState;
  event: Record<string, unknown> | null;
  achievements: string[];
};

export async function interact(
  userId: string,
  interaction: Interaction,
  source: "web" | "device",
  deviceId: string | null,
  clientEventId: string,
): Promise<PetUpdateResult> {
  const config = INTERACTIONS[interaction];
  if (!config) throw new ApiError("invalid_interaction", "Unknown pet interaction", 400);

  const duplicate = await admin()
    .from("agnes_pet_events")
    .select("id")
    .eq("user_id", userId)
    .eq("client_event_id", clientEventId)
    .maybeSingle();
  if (duplicate.data) {
    return { state: await decayPetState(userId), event: null, achievements: [] };
  }

  const since = new Date(Date.now() - config.cooldownSeconds * 1000).toISOString();
  const { data: recent } = await admin()
    .from("agnes_pet_events")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("event_type", interaction)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (recent && recent.length > 0) {
    throw new ApiError(
      "pet_cooldown",
      `Too soon for ${interaction}; try again shortly`,
      429,
      { retry_after_seconds: config.cooldownSeconds },
    );
  }

  const current = await decayPetState(userId);
  const happiness = clamp(current.happiness + config.happiness, 0, 100);
  const energy = clamp(current.energy + config.energy, 0, 100);
  const hunger = clamp(current.hunger + config.hunger, 0, 100);
  const xp = current.friendship_xp + config.xp;
  const level = levelForXp(xp);
  const stage = stageForLevel(level);

  const state = await updateState(current, {
    happiness,
    energy,
    hunger,
    friendship_xp: xp,
    level,
    stage,
    last_decay_at: current.last_decay_at,
  });

  const { data: event } = await admin().from("agnes_pet_events").insert({
    user_id: userId,
    device_id: deviceId,
    event_type: interaction,
    delta_happiness: config.happiness,
    delta_energy: config.energy,
    delta_hunger: config.hunger,
    xp_delta: config.xp,
    source,
    client_event_id: clientEventId,
    payload: { interaction },
  }).select("*").maybeSingle();

  const achievements = await evaluateAchievements(userId, state);
  return { state, event, achievements };
}

/** AI mood deltas are bounded and applied as a pet event, never arbitrary values. */
export async function applyChatMood(
  userId: string,
  moodDelta: number,
  deviceId: string | null,
  clientEventId: string,
): Promise<PetUpdateResult> {
  const duplicate = await admin()
    .from("agnes_pet_events")
    .select("id")
    .eq("user_id", userId)
    .eq("client_event_id", clientEventId)
    .maybeSingle();
  if (duplicate.data) {
    return { state: await decayPetState(userId), event: null, achievements: [] };
  }
  const bounded = clamp(moodDelta, -3, 3);
  if (bounded === 0) {
    return { state: await decayPetState(userId), event: null, achievements: [] };
  }
  const current = await decayPetState(userId);
  const happiness = clamp(current.happiness + bounded, 0, 100);
  const xp = current.friendship_xp + 1;
  const level = levelForXp(xp);
  const state = await updateState(current, {
    happiness,
    friendship_xp: xp,
    level,
    stage: stageForLevel(level),
  });
  const { data: event } = await admin().from("agnes_pet_events").insert({
    user_id: userId,
    device_id: deviceId,
    event_type: "chat",
    delta_happiness: bounded,
    xp_delta: 1,
    source: "system",
    client_event_id: clientEventId,
    payload: { bounded_mood_delta: bounded },
  }).select("*").maybeSingle();
  const achievements = await evaluateAchievements(userId, state);
  return { state, event, achievements };
}

async function evaluateAchievements(userId: string, state: PetState): Promise<string[]> {
  const candidates: string[] = [];
  if (state.friendship_xp >= 50) candidates.push("friendship_5");
  if (state.friendship_xp >= 150) candidates.push("friendship_10");
  if (state.level >= 5) candidates.push("level_5");
  if (state.level >= 10) candidates.push("level_10");
  if (state.level >= 20) candidates.push("level_20");
  if (candidates.length === 0) return [];

  const { data: existing } = await admin()
    .from("agnes_pet_achievements")
    .select("achievement_id")
    .eq("user_id", userId)
    .in("achievement_id", candidates);
  const have = new Set((existing ?? []).map((row) => row.achievement_id));
  const unlock = candidates.filter((id) => !have.has(id));
  if (unlock.length === 0) return [];

  await admin().from("agnes_pet_achievements").upsert(
    unlock.map((achievementId) => ({ user_id: userId, achievement_id: achievementId })),
    { onConflict: "user_id,achievement_id", ignoreDuplicates: true },
  );
  await admin().from("agnes_pet_events").insert(
    unlock.map((achievementId) => ({
      user_id: userId,
      event_type: "achievement",
      xp_delta: 0,
      source: "system",
      payload: { achievement_id: achievementId },
    })),
  );
  return unlock;
}

export async function readPetState(userId: string): Promise<PetState> {
  return await decayPetState(userId);
}
