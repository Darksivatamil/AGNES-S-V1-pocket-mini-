import Link from "next/link";
import {
  ArrowRight,
  BatteryMedium,
  Bell,
  Brain,
  Cpu,
  Heart,
  MessageSquare,
  Sparkles,
  Wifi,
} from "lucide-react";
import { AgnesFace } from "@/components/agnes-face";
import { HonestyNote, PageHeader, SectionCard, StatCard } from "@/components/ui";
import { relativeTime, isOnline } from "@/lib/format";
import { achievementLabel as achievementText } from "@/lib/constants";
import type {
  Achievement,
  Conversation,
  Device,
  ModelPreferences,
  Notification,
  PetState,
  Profile,
  Settings,
} from "@/lib/types";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const supabase = await supabaseServer();

  const [
    profileResult,
    settingsResult,
    devicesResult,
    petResult,
    achievementsResult,
    pendingMemoriesResult,
    unreadNotificationsResult,
    conversationsResult,
    notificationsResult,
    preferencesResult,
    providersResult,
  ] = await Promise.all([
    supabase.from("agnes_profiles").select("user_id, display_name, avatar_url").maybeSingle(),
    supabase.from("agnes_settings").select("*").maybeSingle(),
    supabase
      .from("agnes_devices")
      .select("*")
      .is("revoked_at", null)
      .order("last_seen_at", { ascending: false, nullsFirst: false }),
    supabase.from("agnes_pet_state").select("*").maybeSingle(),
    supabase
      .from("agnes_pet_achievements")
      .select("achievement_id, unlocked_at")
      .order("unlocked_at", { ascending: false })
      .limit(4),
    supabase
      .from("agnes_memories")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .is("deleted_at", null),
    supabase
      .from("agnes_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .is("deleted_at", null),
    supabase
      .from("agnes_conversations")
      .select("id, title, device_id, archived, last_message_at, created_at")
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .limit(5),
    supabase
      .from("agnes_notifications")
      .select("id, title, kind, read_at, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(4),
    supabase.from("agnes_model_preferences").select("*").maybeSingle(),
    supabase.from("agnes_ai_providers").select("provider, enabled, key_hint, last_test_ok"),
  ]);

  const profile = (profileResult.data ?? { user_id: "", display_name: "AGNES User" }) as Profile;
  const settings = settingsResult.data as Settings | null;
  const devices = (devicesResult.data ?? []) as Device[];
  const pet = petResult.data as PetState | null;
  const achievements = (achievementsResult.data ?? []) as Achievement[];
  const conversations = (conversationsResult.data ?? []) as Conversation[];
  const notifications = (notificationsResult.data ?? []) as Pick<
    Notification,
    "id" | "title" | "kind" | "read_at" | "created_at"
  >[];
  const preferences = preferencesResult.data as ModelPreferences | null;
  const providers = providersResult.data ?? [];

  const queryErrors = [
    profileResult,
    settingsResult,
    devicesResult,
    petResult,
    achievementsResult,
    pendingMemoriesResult,
    unreadNotificationsResult,
    conversationsResult,
    notificationsResult,
    preferencesResult,
    providersResult,
  ].flatMap((result) => (result.error ? [result.error] : []));
  const supabaseHealthy = queryErrors.length === 0;

  const onlineDevices = devices.filter((device) => isOnline(device.last_seen_at));
  const primaryDevice = onlineDevices[0] ?? devices[0] ?? null;
  const pendingMemories = pendingMemoriesResult.count ?? 0;
  const unreadNotifications = unreadNotificationsResult.count ?? 0;
  const savedProviderKeys = providers.filter((provider) => provider.key_hint);
  const checkedItems = [
    {
      label: supabaseHealthy ? "Supabase queries healthy" : "Supabase query errors",
      done: supabaseHealthy,
      href: "/diagnostics",
    },
    {
      label: "AI provider key saved",
      done: savedProviderKeys.length > 0,
      href: "/providers",
    },
    { label: "Model selected", done: preferences !== null, href: "/providers" },
    { label: "Device paired", done: devices.length > 0, href: "/devices" },
  ];
  const setupComplete = checkedItems.every((item) => item.done);

  return (
    <div>
      <PageHeader
        eyebrow="Companion overview"
        title={`Hello, ${profile.display_name}.`}
        description="One companion, shared across the OLED device and this dashboard. Status below comes directly from your database."
        action={
          <>
            <Link href="/chat" className="btn btn-primary">
              <MessageSquare size={15} /> Open conversation
            </Link>
            <Link href="/devices" className="btn">
              <Cpu size={15} /> Devices
            </Link>
          </>
        }
      />

      {!supabaseHealthy ? (
        <p className="mb-4 rounded-xl border border-rose/25 bg-rose/[0.08] px-3.5 py-2.5 text-xs leading-5 text-rose-200">
          Some dashboard reads failed: {queryErrors[0]?.message}. Values below may be incomplete.{" "}
          <Link href="/diagnostics" className="font-semibold underline underline-offset-2">
            Open diagnostics
          </Link>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Devices online"
          value={`${onlineDevices.length}/${devices.length}`}
          hint={primaryDevice ? `Latest: ${primaryDevice.name}` : "No device paired yet"}
          accent="mint"
        />
        <StatCard
          label="Battery"
          value={
            primaryDevice?.battery_percent != null ? `${primaryDevice.battery_percent}%` : "—"
          }
          hint={primaryDevice ? relativeTime(primaryDevice.last_seen_at) : "Pair a device to see telemetry"}
          accent="violet"
        />
        <StatCard
          label="Friendship level"
          value={pet ? `Lv ${pet.level}` : "—"}
          hint={pet ? `${pet.stage} · ${pet.friendship_xp} XP` : "Pet state appears after first sign-in"}
          accent="amber"
        />
        <StatCard
          label="Pending memories"
          value={String(pendingMemories)}
          hint={pendingMemories ? "Waiting for your approval" : "Nothing waiting"}
          accent="rose"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <section className="card relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-mint/[0.07] blur-2xl" />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <AgnesFace size={64} mood={primaryDevice?.current_emotion ?? "normal"} />
              <div>
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-mint/70">
                  Your companion
                </p>
                <h2 className="text-xl font-bold text-white">{pet?.name ?? "Agnes"}</h2>
                <p className="mt-0.5 text-xs text-muted">
                  {pet ? `${pet.stage} · Level ${pet.level}` : "Pet state not created yet"}
                </p>
              </div>
            </div>
            <Link href="/pet" className="btn btn-sm btn-violet">
              <Heart size={13} /> Visit pet
            </Link>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Happiness", value: pet?.happiness ?? 0 },
              { label: "Energy", value: pet?.energy ?? 0 },
              { label: "Hunger", value: pet?.hunger ?? 0 },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                <div className="flex items-center justify-between text-[0.68rem] font-semibold text-muted">
                  <span>{stat.label}</span>
                  <span className="text-white">{stat.value}</span>
                </div>
                <div className="bar mt-2">
                  <span style={{ width: `${stat.value}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[0.7rem] text-muted">
            <span className="badge badge-mint">
              <Sparkles size={11} /> {settings?.personality ?? "friendly"}
            </span>
            <span className="badge">theme: {settings?.theme ?? "cyber"}</span>
            {preferences ? (
              <span className="badge badge-violet">
                {preferences.active_provider} · {preferences.active_model_id.split("/").slice(-1)[0]}
              </span>
            ) : (
              <span className="badge badge-amber">No model selected</span>
            )}
            {achievements.length ? (
              <span className="badge">{achievementText(achievements[0].achievement_id)}</span>
            ) : null}
          </div>
        </section>

        <SectionCard
          title={primaryDevice ? primaryDevice.name : "No device paired"}
          description={
            primaryDevice
              ? `${isOnline(primaryDevice.last_seen_at) ? "Online" : "Offline"} · seen ${relativeTime(primaryDevice.last_seen_at)}`
              : "Generate a pairing code and enter it on the device's Wi-Fi setup screen."
          }
          action={
            <Link href="/devices" className="btn btn-sm">
              Manage
            </Link>
          }
        >
          {primaryDevice ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                  <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">Battery</p>
                  <p className="mt-1 flex items-center gap-1.5 font-semibold text-white">
                    <BatteryMedium size={13} className="text-mint" />
                    {primaryDevice.battery_voltage_mv != null
                      ? `${(primaryDevice.battery_voltage_mv / 1000).toFixed(2)} V`
                      : "—"}
                    {primaryDevice.battery_percent != null
                      ? ` · ${primaryDevice.battery_percent}%`
                      : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                  <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">Wi-Fi</p>
                  <p className="mt-1 flex items-center gap-1.5 font-semibold text-white">
                    <Wifi size={13} className="text-violet" />
                    {primaryDevice.wifi_rssi != null ? `${primaryDevice.wifi_rssi} dBm` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                  <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">Firmware</p>
                  <p className="mt-1 font-semibold text-white">
                    {primaryDevice.firmware_version ?? "unknown"}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                  <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">Emotion</p>
                  <p className="mt-1 font-semibold text-white">
                    {primaryDevice.current_emotion ?? "unknown"}
                  </p>
                </div>
              </div>
              {primaryDevice.last_error ? (
                <p className="rounded-lg border border-rose/25 bg-rose/10 px-2.5 py-2 text-[0.7rem] text-rose-200">
                  Last error: {primaryDevice.last_error}
                </p>
              ) : null}
              <Link href="/diagnostics" className="text-[0.7rem] font-semibold text-mint hover:underline">
                Open diagnostics <ArrowRight size={11} className="inline" />
              </Link>
            </div>
          ) : (
            <Link href="/devices" className="btn btn-primary w-full">
              Pair your first device
            </Link>
          )}
        </SectionCard>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Setup checklist"
          description="These checks are read from your project, not assumed."
          action={
            <span className={`badge ${setupComplete ? "badge-mint" : "badge-amber"}`}>
              {checkedItems.filter((item) => item.done).length}/{checkedItems.length}
            </span>
          }
        >
          <ul className="space-y-2">
            {checkedItems.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5 text-xs text-[#c3d3e4] hover:border-white/15"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`dot ${item.done ? "bg-mint" : "border border-amber/60 bg-transparent"}`}
                    />
                    {item.label}
                  </span>
                  <ArrowRight size={12} className="text-[#587088]" />
                </Link>
              </li>
            ))}
          </ul>
          {!setupComplete ? (
            <p className="mt-3 text-[0.68rem] leading-5 text-[#6f879e]">
              Provider keys can also come from server-side environment fallbacks. Those are not
              visible here by design.
            </p>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Recent conversations"
          description="The same thread is visible to the device and this dashboard."
          action={
            <Link href="/chat" className="btn btn-sm">
              All chats
            </Link>
          }
        >
          {conversations.length === 0 ? (
            <p className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-6 text-center text-xs text-muted">
              No conversations yet. Start one from the dashboard or the device.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href={`/chat?c=${conversation.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-xs hover:text-white"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[#dbe8f3]">
                        {conversation.title}
                      </span>
                      <span className="text-[0.66rem] text-[#6f879e]">
                        {conversation.device_id ? "shared with device" : "web conversation"} ·{" "}
                        {relativeTime(conversation.last_message_at)}
                      </span>
                    </span>
                    <MessageSquare size={13} className="shrink-0 text-[#587088]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Notifications"
          description={`${unreadNotifications} unread`}
          action={
            <Link href="/notifications" className="btn btn-sm">
              <Bell size={13} /> Manage
            </Link>
          }
        >
          {notifications.length === 0 ? (
            <p className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-6 text-center text-xs text-muted">
              No notifications yet. Create one for the device from the notifications page.
            </p>
          ) : (
            <ul className="space-y-2">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#dbe8f3]">
                      {notification.title}
                    </p>
                    <p className="text-[0.65rem] text-[#6f879e]">
                      {notification.kind} · {relativeTime(notification.created_at)}
                    </p>
                  </div>
                  <span className={`badge ${notification.read_at ? "badge-muted" : "badge-amber"}`}>
                    {notification.read_at ? "read" : "unread"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Memory & privacy" description="What the companion is allowed to keep.">
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5">
              <span className="flex items-center gap-2 text-[#c3d3e4]">
                <Brain size={14} className="text-violet" /> Cloud memory
              </span>
              <span className={`badge ${settings?.cloud_memory_enabled ? "badge-mint" : "badge-rose"}`}>
                {settings?.cloud_memory_enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5">
              <span className="flex items-center gap-2 text-[#c3d3e4]">
                <Bell size={14} className="text-amber" /> Device notifications
              </span>
              <span className={`badge ${settings?.notifications_enabled ? "badge-mint" : "badge-muted"}`}>
                {settings?.notifications_enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <Link href="/memories" className="btn w-full">
              Review memories <ArrowRight size={13} />
            </Link>
          </div>
        </SectionCard>
      </div>

      <div className="mt-5">
        <HonestyNote>
          Cloud AI is unavailable when the device or browser is offline. AGNES has no on-device
          language model; it only caches replies and the 3-choice question for offline review.
        </HonestyNote>
      </div>
    </div>
  );
}
