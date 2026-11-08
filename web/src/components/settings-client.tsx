"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { PageHeader, SectionCard } from "@/components/ui";
import { callAgnes, errorMessage, newRequestId } from "@/lib/api";
import { personalities, themes } from "@/lib/constants";
import { clamp } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Device, Personality, Profile, Settings, Theme } from "@/lib/types";

type DeviceRef = Pick<Device, "id" | "name">;

type FormState = {
  display_name: string;
  personality: Personality;
  theme: Theme;
  brightness: number;
  idle_animations: boolean;
  sleep_timeout_seconds: number;
  cloud_memory_enabled: boolean;
  notifications_enabled: boolean;
  timezone_posix: string;
  location_name: string;
  latitude: string;
  longitude: string;
};

const defaults: Settings = {
  personality: "friendly",
  theme: "cyber",
  brightness: 160,
  idle_animations: true,
  sleep_timeout_seconds: 120,
  cloud_memory_enabled: true,
  notifications_enabled: true,
  timezone_posix: "UTC0",
  location_name: null,
  latitude: null,
  longitude: null,
  sync_version: 1,
};

export function SettingsClient({
  email,
  initialProfile,
  initialSettings,
  devices,
}: {
  email: string;
  initialProfile: Profile;
  initialSettings: Settings | null;
  devices: DeviceRef[];
}) {
  const router = useRouter();
  const startingSettings = { ...defaults, ...(initialSettings ?? {}) };
  const [form, setForm] = useState<FormState>({
    display_name: initialProfile.display_name,
    personality: startingSettings.personality,
    theme: startingSettings.theme,
    brightness: startingSettings.brightness,
    idle_animations: startingSettings.idle_animations,
    sleep_timeout_seconds: startingSettings.sleep_timeout_seconds,
    cloud_memory_enabled: startingSettings.cloud_memory_enabled,
    notifications_enabled: startingSettings.notifications_enabled,
    timezone_posix: startingSettings.timezone_posix,
    location_name: startingSettings.location_name ?? "",
    latitude: startingSettings.latitude != null ? String(startingSettings.latitude) : "",
    longitude: startingSettings.longitude != null ? String(startingSettings.longitude) : "",
  });
  const [syncVersion, setSyncVersion] = useState(startingSettings.sync_version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [queueing, setQueueing] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (form.brightness < 0 || form.brightness > 255) {
        throw new Error("Brightness must be between 0 and 255.");
      }
      if (form.sleep_timeout_seconds < 30 || form.sleep_timeout_seconds > 3600) {
        throw new Error("Sleep timeout must be between 30 and 3600 seconds.");
      }
      const latitude = form.latitude.trim() === "" ? null : Number(form.latitude);
      const longitude = form.longitude.trim() === "" ? null : Number(form.longitude);
      if ((latitude === null) !== (longitude === null)) {
        throw new Error("Set both latitude and longitude, or neither.");
      }
      if (latitude !== null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
        throw new Error("Latitude must be between -90 and 90.");
      }
      if (longitude !== null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
        throw new Error("Longitude must be between -180 and 180.");
      }

      const profileResult = await callAgnes<{ profile: Profile }>("agnes-profile", {
        action: "update_profile",
        display_name: form.display_name.trim(),
      });

      const settingsResult = await callAgnes<{ settings: Settings; note: string }>("agnes-profile", {
        action: "update_settings",
        personality: form.personality,
        theme: form.theme,
        brightness: Math.round(clamp(form.brightness, 0, 255)),
        idle_animations: form.idle_animations,
        sleep_timeout_seconds: Math.round(form.sleep_timeout_seconds),
        cloud_memory_enabled: form.cloud_memory_enabled,
        notifications_enabled: form.notifications_enabled,
        timezone_posix: form.timezone_posix.trim(),
        location_name: form.location_name.trim() === "" ? null : form.location_name.trim(),
        latitude,
        longitude,
      });

      setSyncVersion(settingsResult.settings.sync_version);
      setNotice(
        `Saved. Profile is “${profileResult.profile.display_name}”. Settings version is now ${settingsResult.settings.sync_version}; the device applies it on the next sync.`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function queueRefresh() {
    if (!deviceId) {
      setCommandNotice("Pair a device first.");
      return;
    }
    setQueueing(true);
    setCommandNotice(null);
    try {
      await callAgnes("agnes-device-command", {
        request_id: newRequestId(),
        device_id: deviceId,
        type: "REFRESH_SETTINGS",
        payload: {},
      });
      setCommandNotice(
        "REFRESH_SETTINGS queued. The device will pull the new settings on its next sync (15-minute expiry).",
      );
    } catch (caught) {
      setCommandNotice(errorMessage(caught));
    } finally {
      setQueueing(false);
    }
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    if (deleteConfirm !== "DELETE") return;
    const confirmed = window.confirm(
      "This permanently deletes your account, devices, conversations, memories, notes and provider keys. There is no recovery.",
    );
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await callAgnes("agnes-account", { action: "delete", confirmation: "DELETE" });
      await supabaseBrowser().auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (caught) {
      setDeleteError(errorMessage(caught));
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Companion profile"
        title="Settings"
        description="These values drive both the dashboard and the device. Device-local changes win until the cloud sync_version increases."
        action={
          <button type="submit" form="settings-form" className="btn btn-primary" disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save settings
          </button>
        }
      />

      <form id="settings-form" onSubmit={saveSettings} className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <SectionCard title="Identity" description="Shown in the dashboard and used to greet you.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="display-name">
                  Display name
                </label>
                <input
                  id="display-name"
                  className="input"
                  value={form.display_name}
                  maxLength={80}
                  onChange={(event) => update("display_name", event.target.value)}
                />
              </div>
              <div>
                <label className="label">Account email</label>
                <input className="input opacity-70" value={email} readOnly />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Personality & look" description="The same values are sent to the OLED face and copy.">
            <div>
              <span className="label">Personality</span>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {personalities.map((personality) => (
                  <button
                    key={personality.id}
                    type="button"
                    onClick={() => update("personality", personality.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                      form.personality === personality.id
                        ? "border-mint/40 bg-mint/[0.08]"
                        : "border-white/10 bg-black/20 hover:border-white/20"
                    }`}
                  >
                    <span className="flex items-center justify-between text-xs font-semibold text-white">
                      {personality.label}
                      {form.personality === personality.id ? (
                        <Check size={12} className="text-mint" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[0.65rem] text-[#6f879e]">
                      {personality.blurb}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="theme">
                  OLED theme
                </label>
                <select
                  id="theme"
                  className="select"
                  value={form.theme}
                  onChange={(event) => update("theme", event.target.value as Theme)}
                >
                  {themes.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sleep-timeout">
                  Sleep timeout (seconds)
                </label>
                <input
                  id="sleep-timeout"
                  className="input"
                  type="number"
                  min={30}
                  max={3600}
                  value={form.sleep_timeout_seconds}
                  onChange={(event) => update("sleep_timeout_seconds", Number(event.target.value))}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="label" htmlFor="brightness">
                Brightness: {form.brightness} / 255
              </label>
              <input
                id="brightness"
                type="range"
                min={0}
                max={255}
                value={form.brightness}
                onChange={(event) => update("brightness", Number(event.target.value))}
                className="w-full accent-teal-300"
              />
            </div>

            <label className="mt-4 flex items-center gap-2 text-xs text-[#c3d3e4]">
              <input
                type="checkbox"
                checked={form.idle_animations}
                onChange={(event) => update("idle_animations", event.target.checked)}
                className="accent-teal-300"
              />
              Idle face animations
            </label>
          </SectionCard>

          <SectionCard title="Privacy & delivery" description="You decide what leaves the device.">
            <div className="space-y-2">
              <label className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-xs">
                <span>
                  <span className="block font-semibold text-white">Cloud memory</span>
                  <span className="block text-[0.65rem] leading-5 text-[#6f879e]">
                    Allows approved memories to inform chat and lets AI suggest new ones.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={form.cloud_memory_enabled}
                  onChange={(event) => update("cloud_memory_enabled", event.target.checked)}
                  className="mt-0.5 accent-teal-300"
                />
              </label>
              <label className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-xs">
                <span>
                  <span className="block font-semibold text-white">Notifications on device</span>
                  <span className="block text-[0.65rem] leading-5 text-[#6f879e]">
                    Unread notifications are included in the next device sync.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={form.notifications_enabled}
                  onChange={(event) => update("notifications_enabled", event.target.checked)}
                  className="mt-0.5 accent-teal-300"
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Clock & weather" description="Weather is fetched server-side from Open-Meteo; no API key is required.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="timezone">
                  POSIX timezone
                </label>
                <input
                  id="timezone"
                  className="input mono"
                  value={form.timezone_posix}
                  maxLength={64}
                  placeholder="UTC0 or IST-5:30"
                  onChange={(event) => update("timezone_posix", event.target.value)}
                />
                <p className="mt-1 text-[0.62rem] leading-4 text-[#587088]">
                  POSIX offsets are inverted: IST is UTC+5:30, written IST-5:30.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="location-name">
                  Location label
                </label>
                <input
                  id="location-name"
                  className="input"
                  value={form.location_name}
                  maxLength={120}
                  placeholder="Chennai"
                  onChange={(event) => update("location_name", event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="latitude">
                  Latitude
                </label>
                <input
                  id="latitude"
                  className="input"
                  value={form.latitude}
                  placeholder="13.0827"
                  onChange={(event) => update("latitude", event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="longitude">
                  Longitude
                </label>
                <input
                  id="longitude"
                  className="input"
                  value={form.longitude}
                  placeholder="80.2707"
                  onChange={(event) => update("longitude", event.target.value)}
                />
              </div>
            </div>
            <p className="mt-2 text-[0.65rem] leading-5 text-[#6f879e]">
              Both coordinates are required together. Weather on the device fails honestly if they are
              not set.
            </p>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Apply now" description="Settings otherwise reach the device at its next automatic sync.">
            <select
              className="select"
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
            >
              <option value="">Select a device</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn mt-2 w-full"
              onClick={queueRefresh}
              disabled={queueing || !deviceId}
            >
              {queueing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Queue REFRESH_SETTINGS
            </button>
            <p className="mt-2 text-[0.65rem] leading-5 text-[#6f879e]">
              Current cloud settings version: <span className="mono text-white">{syncVersion}</span>.
              Save first, then queue a refresh.
            </p>
            {commandNotice ? (
              <p className="mt-2 rounded-lg border border-mint/25 bg-mint/[0.07] px-3 py-2 text-[0.68rem] leading-5 text-mint-100">
                {commandNotice}
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title="Firmware behavior" description="Read this before expecting instant changes.">
            <ul className="space-y-2 text-[0.72rem] leading-5 text-muted">
              <li>• Brightness, sleep timeout, animations and theme are stored locally on the device too.</li>
              <li>• Cloud settings only overwrite local values when sync_version increases.</li>
              <li>• Command payloads are validated against the allowlist before they are queued.</li>
              <li>• Notes, memories and notifications remain read-only on the device.</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/devices" className="btn btn-sm">
                <SlidersHorizontal size={12} /> Device commands
              </Link>
              <Link href="/providers" className="btn btn-sm">
                Provider settings
              </Link>
            </div>
          </SectionCard>

          {notice ? (
            <p className="rounded-xl border border-mint/25 bg-mint/[0.07] px-3 py-2 text-xs leading-5 text-mint-100">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-2 text-xs leading-5 text-rose-200">
              {error}
            </p>
          ) : null}
        </div>

        <div className="lg:col-span-2">
          <section className="card border-rose/25 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-rose/25 bg-rose/[0.08] p-2.5">
                <ShieldAlert size={18} className="text-rose-300" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-bold text-rose-200">Danger zone: delete account</h2>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-[#a8bccf]">
                  This permanently removes your Supabase auth user and cascades to devices, pairing
                  codes, conversations, messages, memories, pet state, notes, provider credentials,
                  commands and usage records. Devices are revoked immediately. Type DELETE to enable
                  the button.
                </p>
                <form onSubmit={deleteAccount} className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    className="input max-w-[180px]"
                    value={deleteConfirm}
                    onChange={(event) => setDeleteConfirm(event.target.value)}
                    placeholder="DELETE"
                    aria-label="Type DELETE to confirm"
                  />
                  <button
                    type="submit"
                    className="btn btn-danger"
                    disabled={deleteConfirm !== "DELETE" || deleting}
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                    Delete my account
                  </button>
                </form>
                {deleteError ? (
                  <p className="mt-2 text-xs text-rose-200">{deleteError}</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </form>
    </div>
  );
}
