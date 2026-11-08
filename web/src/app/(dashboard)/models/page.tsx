import { redirect } from "next/navigation";
import { ModelsClient } from "@/components/models-client";
import { supabaseServer } from "@/lib/supabase/server";
import type { ModelPreferences } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model center" };

export default async function ModelsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("agnes_model_preferences").select("*").maybeSingle();

  return <ModelsClient initialPreferences={(data ?? null) as ModelPreferences | null} />;
}
