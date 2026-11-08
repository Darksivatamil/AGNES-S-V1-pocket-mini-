import { redirect } from "next/navigation";
import { NotificationsClient } from "@/components/notifications-client";
import type { Device, Notification } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [notificationsResult, devicesResult] = await Promise.all([
    supabase
      .from("agnes_notifications")
      .select("id, device_id, title, body, kind, deliver_at, read_at, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("agnes_devices")
      .select("id, name")
      .is("revoked_at", null),
  ]);

  return (
    <NotificationsClient
      initialNotifications={(notificationsResult.data ?? []) as Notification[]}
      devices={(devicesResult.data ?? []) as Pick<Device, "id" | "name">[]}
    />
  );
}
