import { redirect } from "next/navigation";
import { DiagnosticsClient } from "@/components/diagnostics-client";
import { supabaseServer } from "@/lib/supabase/server";
import type { AiUsage, Command, Device, DeviceEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Diagnostics" };

export default async function DiagnosticsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [devicesResult, eventsResult, commandsResult, usageResult] = await Promise.all([
    supabase.from("agnes_devices").select("*").order("created_at", { ascending: false }),
    supabase
      .from("agnes_device_events")
      .select("id, device_id, type, severity, message, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("agnes_device_commands")
      .select("id, device_id, type, payload, status, error, expires_at, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("agnes_ai_usage")
      .select(
        "id, message_id, provider, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <DiagnosticsClient
      initialDevices={(devicesResult.data ?? []) as Device[]}
      initialEvents={(eventsResult.data ?? []) as DeviceEvent[]}
      initialCommands={(commandsResult.data ?? []) as Command[]}
      initialUsage={(usageResult.data ?? []) as AiUsage[]}
    />
  );
}
