"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { EmptyState, HonestyNote, PageHeader, SectionCard, StatCard } from "@/components/ui";
import { callAgnes, errorMessage } from "@/lib/api";
import { formatDate, isOnline, relativeTime, shortId, titleCase } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { AiUsage, Command, Device, DeviceEvent } from "@/lib/types";

type BackendCheck = {
  ok: boolean;
  at: string;
  ms: number;
  detail: string;
};

function severityBadge(severity: DeviceEvent["severity"]): string {
  if (severity === "critical" || severity === "error") return "badge-rose";
  if (severity === "warning") return "badge-amber";
  if (severity === "debug") return "badge-muted";
  return "badge";
}

function commandBadge(status: Command["status"]): string {
  if (status === "COMPLETED") return "badge-mint";
  if (status === "FAILED") return "badge-rose";
  if (status === "EXPIRED") return "badge-muted";
  if (status === "EXECUTING" || status === "RECEIVED") return "badge-violet";
  return "badge-amber";
}

function usd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function PayloadDetails({ payload }: { payload: Record<string, unknown> | null | undefined }) {
  if (!payload || Object.keys(payload).length === 0) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[0.62rem] text-[#6f879e] hover:text-[#9fb4c9]">
        payload
      </summary>
      <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-black/30 p-2 text-[0.6rem] leading-4 text-[#8fa6bd]">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

export function DiagnosticsClient({
  initialDevices,
  initialEvents,
  initialCommands,
  initialUsage,
}: {
  initialDevices: Device[];
  initialEvents: DeviceEvent[];
  initialCommands: Command[];
  initialUsage: AiUsage[];
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [events, setEvents] = useState(initialEvents);
  const [commands, setCommands] = useState(initialCommands);
  const [usage, setUsage] = useState(initialUsage);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<BackendCheck | null>(null);

  async function refreshAll() {
    setRefreshing(true);
    setLoadError(null);
    const supabase = supabaseBrowser();
    const [deviceResult, eventResult, commandResult, usageResult] = await Promise.all([
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

    const failure =
      deviceResult.error ?? eventResult.error ?? commandResult.error ?? usageResult.error ?? null;
    if (failure) {
      setLoadError(failure.message);
    } else {
      setDevices((deviceResult.data ?? []) as Device[]);
      setEvents((eventResult.data ?? []) as DeviceEvent[]);
      setCommands((commandResult.data ?? []) as Command[]);
      setUsage((usageResult.data ?? []) as AiUsage[]);
      setLastRefreshed(new Date().toISOString());
    }
    setRefreshing(false);
  }

  async function testBackend() {
    setChecking(true);
    setCheck(null);
    const started = performance.now();
    try {
      const result = await callAgnes<{
        profile: { display_name?: string };
        settings: { sync_version?: number } | null;
        devices: Device[];
      }>("agnes-profile", { action: "get" });
      const elapsed = Math.round(performance.now() - started);
      const name = result.profile?.display_name ?? "unnamed profile";
      setCheck({
        ok: true,
        at: new Date().toISOString(),
        ms: elapsed,
        detail: `Authenticated as ${name}; ${result.devices?.length ?? 0} device record(s); settings sync version ${result.settings?.sync_version ?? "unknown"}.`,
      });
    } catch (caught) {
      setCheck({
        ok: false,
        at: new Date().toISOString(),
        ms: Math.round(performance.now() - started),
        detail: errorMessage(caught),
      });
    } finally {
      setChecking(false);
    }
  }

  const deviceNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const device of devices) map.set(device.id, device.name);
    return map;
  }, [devices]);

  const summary = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const activeDevices = devices.filter((device) => !device.revoked_at);
    const recentEvents = events.filter((event) => Date.parse(event.created_at) >= dayAgo);
    const recentUsage = usage.filter((row) => Date.parse(row.created_at) >= dayAgo);
    const reportedCost = recentUsage.reduce((total, row) => {
      const value = typeof row.cost_usd === "string" ? Number(row.cost_usd) : row.cost_usd;
      return total + (value && Number.isFinite(value) ? value : 0);
    }, 0);
    return {
      online: activeDevices.filter((device) => isOnline(device.last_seen_at)).length,
      activeDevices: activeDevices.length,
      alerts: recentEvents.filter((event) =>
        ["warning", "error", "critical"].includes(event.severity),
      ).length,
      pending: commands.filter((command) =>
        ["PENDING", "RECEIVED", "EXECUTING"].includes(command.status),
      ).length,
      calls: recentUsage.length,
      tokens: recentUsage.reduce((total, row) => total + (row.total_tokens ?? 0), 0),
      cost: reportedCost,
    };
  }, [devices, events, commands, usage]);

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="System"
        title="Diagnostics"
        description="Telemetry reported by your devices, command acknowledgements, AI usage, and an honest backend reachability check."
        action={
          <>
            <button type="button" className="btn" onClick={refreshAll} disabled={refreshing}>
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh data
            </button>
            <button type="button" className="btn btn-primary" onClick={testBackend} disabled={checking}>
              {checking ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Test backend
            </button>
          </>
        }
      />

      <HonestyNote>
        Device rows, events and command states are only as fresh as the last device sync. Nothing on
        this page fabricates hardware health: an offline device keeps its last reported values with a
        stale timestamp. The backend test checks your session, the Edge Function and a database read;
        it does not test AI provider keys or physical hardware.
      </HonestyNote>

      {loadError ? (
        <p className="mt-4 rounded-xl border border-rose/25 bg-rose/[0.08] px-3.5 py-2.5 text-xs leading-5 text-rose-200">
          Refresh failed: {loadError}
        </p>
      ) : null}
      {lastRefreshed ? (
        <p className="mt-3 text-[0.68rem] text-muted">Snapshot refreshed {relativeTime(lastRefreshed)}.</p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Devices online"
          value={`${summary.online}/${summary.activeDevices}`}
          hint="Seen in the last 5 minutes"
        />
        <StatCard
          label="Alerts · 24h"
          value={String(summary.alerts)}
          hint="Warning, error or critical events"
          accent={summary.alerts > 0 ? "rose" : "mint"}
        />
        <StatCard
          label="Pending commands"
          value={String(summary.pending)}
          hint="Awaiting device acknowledgement"
          accent={summary.pending > 0 ? "amber" : "mint"}
        />
        <StatCard
          label="AI calls · 24h"
          value={String(summary.calls)}
          hint={`${summary.tokens.toLocaleString()} tokens`}
          accent="violet"
        />
        <StatCard
          label="Reported AI cost · 24h"
          value={usd(summary.cost)}
          hint="Only provider-reported costs"
          accent="amber"
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_380px]">
        <SectionCard title="Devices" description="Latest state reported by each paired device.">
          {devices.length === 0 ? (
            <EmptyState
              title="No devices paired"
              description="Pair an ESP32-C3 from the Devices page to start receiving telemetry."
              action={
                <Link href="/devices" className="btn btn-primary">
                  <Cpu size={14} /> Pair a device
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Link</th>
                    <th>Battery</th>
                    <th>Wi-Fi</th>
                    <th>Heap</th>
                    <th>Firmware</th>
                    <th>Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <p className="font-semibold text-white">{device.name}</p>
                        <p className="mono text-[0.62rem] text-[#587088]">
                          {shortId(device.hardware_id)}
                          {device.revoked_at ? " · revoked" : ""}
                        </p>
                      </td>
                      <td>
                        <span
                          className={`badge ${isOnline(device.last_seen_at) ? "badge-mint" : "badge-amber"}`}
                        >
                          {isOnline(device.last_seen_at) ? "online" : "stale"}
                        </span>
                        <p className="mt-1 text-[0.62rem] text-[#6f879e]">
                          {relativeTime(device.last_seen_at)}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-xs text-[#c3d3e4]">
                        {device.battery_percent !== null ? `${device.battery_percent}%` : "—"}
                        <p className="text-[0.62rem] text-[#6f879e]">
                          {device.battery_voltage_mv !== null ? `${device.battery_voltage_mv} mV` : "no reading"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap text-xs text-[#c3d3e4]">
                        {device.wifi_rssi !== null ? `${device.wifi_rssi} dBm` : "—"}
                      </td>
                      <td className="whitespace-nowrap text-xs text-[#c3d3e4]">
                        {device.free_heap !== null
                          ? `${Math.round(device.free_heap / 1024)} KB`
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap text-xs text-[#c3d3e4]">
                        {device.firmware_version ?? "—"}
                      </td>
                      <td className="max-w-[220px] text-[0.68rem] leading-4 text-[#8fa6bd]">
                        {device.last_error ? (
                          <span className="text-rose-200">{device.last_error}</span>
                        ) : (
                          "none reported"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Backend check" description="Live call using your signed-in session.">
            <div className="space-y-3 text-xs leading-5 text-muted">
              <div className="flex items-start gap-2">
                <Server size={14} className="mt-0.5 shrink-0 text-violet" />
                <p>
                  Calls <span className="mono text-[0.68rem] text-[#c3d3e4]">agnes-profile</span>,
                  which authenticates the request, reads your profile/settings, and returns device
                  records through the service layer.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-mint" />
                <p>
                  No provider key, service-role key, or device token is exposed to the browser by
                  this check.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm w-full"
                onClick={testBackend}
                disabled={checking}
              >
                {checking ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                Run backend check
              </button>
              {check ? (
                <div
                  className={`rounded-xl border px-3 py-2.5 text-[0.7rem] leading-5 ${
                    check.ok
                      ? "border-mint/25 bg-mint/[0.06] text-mint/90"
                      : "border-rose/25 bg-rose/[0.08] text-rose-200"
                  }`}
                >
                  <p className="flex items-center gap-1.5 font-semibold">
                    {check.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    {check.ok ? "Backend reachable" : "Backend check failed"} · {check.ms} ms
                  </p>
                  <p className="mt-1">{check.detail}</p>
                  <p className="mt-1 text-[0.62rem] opacity-70">Run {formatDate(check.at)}</p>
                </div>
              ) : (
                <p className="text-[0.66rem] text-[#587088]">No check has been run in this view.</p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="What this page cannot tell you">
            <ul className="space-y-2 text-[0.7rem] leading-5 text-muted">
              <li className="flex gap-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber" />
                Whether the OLED, buttons, battery divider or charger wiring is physically correct.
              </li>
              <li className="flex gap-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber" />
                Whether an unconfigured AI provider would work. Use the connection test on the
                Providers page with a real key.
              </li>
              <li className="flex gap-2">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber" />
                Token counts or costs that a provider did not report. Missing values stay blank rather
                than estimated.
              </li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Link href="/providers" className="btn btn-sm">
                Test AI providers
              </Link>
              <Link href="/devices" className="btn btn-sm">
                Manage devices
              </Link>
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Recent device events"
          description="Newest 50 events reported through sync or status updates."
        >
          {events.length === 0 ? (
            <p className="text-xs text-muted">
              No events have been reported. Events appear after a device syncs or reports an error.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Severity</th>
                    <th>Event</th>
                    <th>Device</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap text-[0.68rem] text-[#8fa6bd]">
                        {relativeTime(event.created_at)}
                      </td>
                      <td>
                        <span className={`badge ${severityBadge(event.severity)}`}>
                          {event.severity}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-xs text-white">{titleCase(event.type)}</td>
                      <td className="whitespace-nowrap text-[0.68rem] text-[#8fa6bd]">
                        {event.device_id
                          ? (deviceNames.get(event.device_id) ?? shortId(event.device_id))
                          : "account"}
                      </td>
                      <td className="max-w-[280px] text-[0.68rem] leading-4 text-[#8fa6bd]">
                        {event.message ?? "—"}
                        <PayloadDetails payload={event.payload} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Command history"
          description="Newest 30 allowlisted commands and their acknowledgement lifecycle."
        >
          {commands.length === 0 ? (
            <p className="text-xs text-muted">
              No commands have been queued yet. Commands are created from the Devices page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Command</th>
                    <th>Status</th>
                    <th>Device</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((command) => (
                    <tr key={command.id}>
                      <td className="whitespace-nowrap text-[0.68rem] text-[#8fa6bd]">
                        {relativeTime(command.created_at)}
                      </td>
                      <td className="whitespace-nowrap text-xs text-white">
                        {titleCase(command.type)}
                      </td>
                      <td>
                        <span className={`badge ${commandBadge(command.status)}`}>
                          {command.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-[0.68rem] text-[#8fa6bd]">
                        {deviceNames.get(command.device_id) ?? shortId(command.device_id)}
                      </td>
                      <td className="max-w-[260px] text-[0.68rem] leading-4 text-[#8fa6bd]">
                        {command.error ? (
                          <span className="text-rose-200">{command.error}</span>
                        ) : command.completed_at ? (
                          `Completed ${relativeTime(command.completed_at)}`
                        ) : (
                          `Expires ${relativeTime(command.expires_at)}`
                        )}
                        <PayloadDetails payload={command.payload} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-5">
        <SectionCard
          title="AI usage"
          description="Recorded when an AI reply is finalized. Providers that omit token counts are shown as unreported."
          action={
            <span className="badge badge-muted">
              <Terminal size={10} /> newest 30
            </span>
          }
        >
          {usage.length === 0 ? (
            <p className="text-xs text-muted">
              No AI usage has been recorded yet. Send a chat message from the dashboard or device.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Prompt</th>
                    <th>Completion</th>
                    <th>Total</th>
                    <th>Reported cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((row) => {
                    const cost = typeof row.cost_usd === "string" ? Number(row.cost_usd) : row.cost_usd;
                    return (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap text-[0.68rem] text-[#8fa6bd]">
                          {relativeTime(row.created_at)}
                        </td>
                        <td className="whitespace-nowrap text-xs text-white">{row.provider}</td>
                        <td className="mono max-w-[260px] truncate text-[0.66rem] text-[#8fa6bd]">
                          {row.model}
                        </td>
                        <td className="text-[0.68rem] text-[#c3d3e4]">
                          {row.prompt_tokens ?? "not reported"}
                        </td>
                        <td className="text-[0.68rem] text-[#c3d3e4]">
                          {row.completion_tokens ?? "not reported"}
                        </td>
                        <td className="text-[0.68rem] text-[#c3d3e4]">
                          {row.total_tokens ?? "not reported"}
                        </td>
                        <td className="text-[0.68rem] text-[#c3d3e4]">
                          {cost === null || !Number.isFinite(cost) ? "not reported" : usd(cost)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
