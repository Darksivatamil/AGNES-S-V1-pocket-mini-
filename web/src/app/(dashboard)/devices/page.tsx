import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { DevicesClient } from "@/components/devices-client";
import type { Command, Device } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Devices" };

export default async function DevicesPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [devicesResult, commandsResult] = await Promise.all([
    supabase
      .from("agnes_devices")
      .select("*")
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("agnes_device_commands")
      .select("id, device_id, type, payload, status, error, expires_at, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <DevicesClient
      initialDevices={(devicesResult.data ?? []) as Device[]}
      initialCommands={(commandsResult.data ?? []) as Command[]}
      signedInEmail={user.email ?? ""}
    />
  );
}
