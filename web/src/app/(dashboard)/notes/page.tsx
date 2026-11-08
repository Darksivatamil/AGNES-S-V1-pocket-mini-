import { redirect } from "next/navigation";
import { NotesClient } from "@/components/notes-client";
import type { Note } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notes" };

export default async function NotesPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("agnes_notes")
    .select("id, title, body, pinned, version, created_at, updated_at")
    .is("deleted_at", null)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  return <NotesClient initialNotes={(data ?? []) as Note[]} userId={user.id} />;
}
