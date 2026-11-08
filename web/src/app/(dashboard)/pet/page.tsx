import { redirect } from "next/navigation";
import { PetClient } from "@/components/pet-client";
import type { Achievement, PetEvent, PetState } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pet" };

export default async function PetPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [petResult, eventsResult, achievementsResult] = await Promise.all([
    supabase.from("agnes_pet_state").select("*").maybeSingle(),
    supabase
      .from("agnes_pet_events")
      .select("id, event_type, delta_happiness, delta_energy, delta_hunger, xp_delta, source, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("agnes_pet_achievements")
      .select("achievement_id, unlocked_at")
      .order("unlocked_at", { ascending: false }),
  ]);

  return (
    <PetClient
      initialPet={(petResult.data ?? null) as PetState | null}
      initialEvents={(eventsResult.data ?? []) as PetEvent[]}
      initialAchievements={(achievementsResult.data ?? []) as Achievement[]}
    />
  );
}
