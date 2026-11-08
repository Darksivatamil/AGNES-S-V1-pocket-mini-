import { MemoriesClient } from "@/components/memories-client";
import type { Memory, Settings } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Memories" };

export default async function MemoriesPage() {
  const supabase = await supabaseServer();
  const [memoriesResult, settingsResult] = await Promise.all([
    supabase
      .from("agnes_memories")
      .select("id, category, content, status, source, pinned, version, created_at, updated_at")
      .is("deleted_at", null)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase.from("agnes_settings").select("cloud_memory_enabled").maybeSingle(),
  ]);

  return (
    <MemoriesClient
      initialMemories={(memoriesResult.data ?? []) as Memory[]}
      initialCloudMemoryEnabled={
        (settingsResult.data as Pick<Settings, "cloud_memory_enabled"> | null)?.cloud_memory_enabled ?? true
      }
    />
  );
}
