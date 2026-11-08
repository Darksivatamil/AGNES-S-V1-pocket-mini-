import { AppShell } from "@/components/app-shell";
import { supabaseConfig } from "@/lib/config";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfig.configured) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <AppShell email={user.email ?? "signed in"}>{children}</AppShell>;
}
