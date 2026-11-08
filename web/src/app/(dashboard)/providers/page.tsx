import { redirect } from "next/navigation";
import { ProvidersClient } from "@/components/providers-client";
import { supabaseServer } from "@/lib/supabase/server";
import type { ModelPreferences, ProviderId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Providers" };

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; model?: string; role?: string }>;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const { data } = await supabase.from("agnes_model_preferences").select("*").maybeSingle();

  const provider =
    params.provider === "openrouter" || params.provider === "nvidia"
      ? (params.provider as ProviderId)
      : null;

  return (
    <ProvidersClient
      initialPreferences={(data ?? null) as ModelPreferences | null}
      preselected={
        provider && params.model
          ? {
              provider,
              model: params.model,
              role: params.role === "fallback" ? "fallback" : "active",
            }
          : null
      }
    />
  );
}
