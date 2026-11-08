import { redirect } from "next/navigation";
import { SettingsClient } from "@/components/settings-client";
import type { Device, Profile, Settings } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileResult, settingsResult, devicesResult] = await Promise.all([
    supabase.from("agnes_profiles").select("user_id, display_name, avatar_url").maybeSingle(),
    supabase.from("agnes_settings").select("*").maybeSingle(),
    supabase
      .from("agnes_devices")
      .select("id, name")
      .is("revoked_at", null),
  ]);

  return (
    <SettingsClient
      email={user.email ?? ""}
      initialProfile={
        (profileResult.data ?? {
          user_id: user.id,
          display_name: "AGNES User",
          avatar_url: null,
        }) as Profile
      }
      initialSettings={(settingsResult.data ?? null) as Settings | null}
      devices={(devicesResult.data ?? []) as Pick<Device, "id" | "name">[]}
    />
  );
}
