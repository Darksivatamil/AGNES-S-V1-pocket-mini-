"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BatteryMedium,
  Check,
  ClipboardCopy,
  Cpu,
  Loader2,
  Power,
  RefreshCw,
  Send,
  Trash2,
  Wifi,
} from "lucide-react";
import { HonestyNote, PageHeader, SectionCard } from "@/components/ui";
import { callAgnes, errorMessage, newRequestId } from "@/lib/api";
import { commandCatalog, personalities, themes } from "@/lib/constants";
import { isOnline, relativeTime, titleCase } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Command, Device, Personality, Theme } from "@/lib/types";

type PairingCode = { code: string; expires_at: string; instructions: string };

const commandBadge: Record<string, string> = {
  PENDING: "badge-amber",
  RECEIVED: "badge-violet",
  EXECUTING: "badge-violet",
  COMPLETED: "badge-mint",
  FAILED: "badge-rose",
  EXPIRED: "badge-muted",
};

export function DevicesClient({
  initialDevices,
  initialCommands,
  signedInEmail,
}: {
  initialDevices: Device[];
  initialCommands: Command[];
  signedInEmail: string;
}) {
  const [devices, setDevices] = useState(initialDevices);
  const [commands, setCommands] = useState(initialCommands);
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    initialDevices.find((device) => isOnline(device.last_seen_at))?.id ?? initialDevices[0]?.id ?? "",
  );

  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [commandType, setCommandType] = useState<string>("UPDATE_PERSONALITY");
  const [personality, setPersonality] = useState<Personality>("friendly");
  const [theme, setTheme] = useState<Theme>("cyber");
  const [brightness, setBrightness] = useState(160);
  const [sleepSeconds, setSleepSeconds] = useState(120);
  const [sending, setSending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? null;
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const onlineCount = devices.filter((device) => isOnline(device.last_seen_at)).length;

  const pairingSecondsLeft = pairing
    ? Math.max(0, Math.floor((Date.parse(pairing.expires_at) - now) / 1000))
    : 0;
  const pairingExpired = pairing !== null && pairingSecondsLeft <= 0;

  async function createPairingCode() {
    setPairBusy(true);
    setPairError(null);
    setCopied(false);
    try {
      const result = await callAgnes<PairingCode>("agnes-pair", { action: "create_code" });
      setPairing(result);
    } catch (error) {
      setPairError(errorMessage(error));
    } finally {
      setPairBusy(false);
    }
  }

  async function copyCode() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setPairError("Clipboard access was blocked. Select the code manually.");
    }
  }

  function buildPayload(): Record<string, unknown> {
    switch (commandType) {
      case "UPDATE_PERSONALITY":
        return { personality };
      case "UPDATE_THEME":
        return { theme };
      case "UPDATE_BRIGHTNESS":
        return { brightness };
      case "UPDATE_SLEEP_TIMEOUT":
        return { seconds: sleepSeconds };
      default:
        return {};
    }
  }

  async function sendCommand() {
    if (!selectedDeviceId) {
      setCommandError("Select a device first.");
      return;
    }
    setSending(true);
    setCommandError(null);
    setCommandNotice(null);
    try {
      const command = await callAgnes<Command & { acknowledged?: boolean }>("agnes-device-command", {
        request_id: newRequestId(),
        device_id: selectedDeviceId,
        type: commandType,
        payload: buildPayload(),
      });
      setCommands((current) => [command, ...current].slice(0, 30));
      setCommandNotice(
        "Command queued. The device applies it on its next sync; unacknowledged commands expire after 15 minutes.",
      );
    } catch (error) {
      setCommandError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  const refreshState = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    try {
      const supabase = supabaseBrowser();
      const [deviceResult, commandResult] = await Promise.all([
        supabase.from("agnes_devices").select("*").order("created_at", { ascending: false }),
        supabase
          .from("agnes_device_commands")
          .select("id, device_id, type, payload, status, error, expires_at, created_at, completed_at")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const failure = deviceResult.error ?? commandResult.error;
      if (failure) throw new Error(failure.message);
      const nextDevices = (deviceResult.data ?? []) as Device[];
      setDevices(nextDevices);
      setCommands((commandResult.data ?? []) as Command[]);
      setSelectedDeviceId((current) =>
        nextDevices.some((device) => device.id === current)
          ? current
          : (nextDevices.find((device) => isOnline(device.last_seen_at))?.id ??
            nextDevices[0]?.id ??
            ""),
      );
    } catch (error) {
      if (showSpinner) setCommandError(errorMessage(error));
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshState(false);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refreshState]);

  async function renameDevice(device: Device) {
    const nextName = renameValue.trim();
    if (!nextName) return;
    setRenameBusy(true);
    try {
      await callAgnes("agnes-pair", { action: "rename", device_id: device.id, name: nextName });
      setDevices((current) =>
        current.map((item) => (item.id === device.id ? { ...item, name: nextName } : item)),
      );
      setRenamingId(null);
      setRenameValue("");
    } catch (error) {
      setCommandError(errorMessage(error));
    } finally {
      setRenameBusy(false);
    }
  }

  async function revokeDevice(device: Device) {
    const confirmed = window.confirm(
      `Revoke ${device.name}? The device token is deleted immediately and the device must be paired again.`,
    );
    if (!confirmed) return;
    setRevokingId(device.id);
    try {
      await callAgnes("agnes-pair", { action: "revoke", device_id: device.id });
      setDevices((current) => current.filter((item) => item.id !== device.id));
      if (selectedDeviceId === device.id) setSelectedDeviceId("");
    } catch (error) {
      setCommandError(errorMessage(error));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Hardware"
        title="Devices"
        description="Pair, inspect and command your ESP32-C3 companion. Telemetry is only as fresh as the last sync."
        action={
          <button type="button" className="btn" onClick={() => refreshState()} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh state
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {devices.length === 0 ? (
            <SectionCard title="No paired devices" description="Start by generating a pairing code.">
              <p className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-8 text-center text-xs text-muted">
                Nothing is paired to {signedInEmail} yet. The code below is single-use and expires in
                10 minutes.
              </p>
            </SectionCard>
          ) : (
            devices.map((device) => {
              const online = isOnline(device.last_seen_at);
              return (
                <section key={device.id} className="card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-2.5">
                        <Cpu size={20} className="text-mint" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-bold text-white">{device.name}</h2>
                          <span className={`badge ${online ? "badge-mint" : "badge-muted"}`}>
                            <span className={`dot ${online ? "dot-online" : "dot-offline"}`} />
                            {online ? "online" : "offline"}
                          </span>
                          {device.oled_controller ? (
                            <span className="badge">{device.oled_controller}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {device.hardware_id} · firmware {device.firmware_version ?? "unknown"}
                        </p>
                        <p className="text-[0.68rem] text-[#6f879e]">
                          Last seen {relativeTime(device.last_seen_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setRenamingId(renamingId === device.id ? null : device.id);
                          setRenameValue(device.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => revokeDevice(device)}
                        disabled={revokingId === device.id}
                      >
                        {revokingId === device.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Trash2 size={12} />
                        )}
                        Revoke
                      </button>
                    </div>
                  </div>

                  {renamingId === device.id ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        className="input max-w-xs"
                        value={renameValue}
                        maxLength={80}
                        onChange={(event) => setRenameValue(event.target.value)}
                        placeholder="Device name"
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => renameDevice(device)}
                        disabled={renameBusy || !renameValue.trim()}
                      >
                        {renameBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setRenamingId(null)}
                        disabled={renameBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                      <p className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">
                        <BatteryMedium size={11} /> Battery
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {device.battery_percent != null ? `${device.battery_percent}%` : "—"}
                      </p>
                      <p className="text-[0.62rem] text-[#587088]">
                        {device.battery_voltage_mv != null
                          ? `${(device.battery_voltage_mv / 1000).toFixed(2)} V`
                          : "no reading"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                      <p className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">
                        <Wifi size={11} /> Wi-Fi
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {device.wifi_rssi != null ? `${device.wifi_rssi} dBm` : "—"}
                      </p>
                      <p className="text-[0.62rem] text-[#587088]">
                        heap {device.free_heap != null ? `${Math.round(device.free_heap / 1024)} KB` : "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                      <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">
                        Personality
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {device.current_personality ?? "unknown"}
                      </p>
                      <p className="text-[0.62rem] text-[#587088]">
                        emotion {device.current_emotion ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
                      <p className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">
                        <Power size={11} /> Uptime
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {device.uptime_seconds != null
                          ? `${Math.floor(device.uptime_seconds / 60)} min`
                          : "—"}
                      </p>
                      <p className="text-[0.62rem] text-[#587088]">since last boot</p>
                    </div>
                  </div>

                  {device.last_error ? (
                    <p className="mt-3 rounded-lg border border-rose/25 bg-rose/10 px-3 py-2 text-[0.7rem] text-rose-200">
                      Last device error: {device.last_error}
                    </p>
                  ) : null}
                </section>
              );
            })
          )}

          <SectionCard
            title="Command console"
            description="Only the nine allowlisted command types can be sent. Each is validated server-side and expires after 15 minutes."
          >
            {devices.length === 0 ? (
              <p className="text-xs text-muted">Pair a device before queueing commands.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="command-device">
                      Target device
                    </label>
                    <select
                      id="command-device"
                      className="select"
                      value={selectedDeviceId}
                      onChange={(event) => setSelectedDeviceId(event.target.value)}
                    >
                      <option value="">Select a device</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name} {isOnline(device.last_seen_at) ? "(online)" : "(offline)"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="command-type">
                      Command
                    </label>
                    <select
                      id="command-type"
                      className="select"
                      value={commandType}
                      onChange={(event) => setCommandType(event.target.value)}
                    >
                      {commandCatalog.map((command) => (
                        <option key={command.type} value={command.type}>
                          {command.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {commandType === "UPDATE_PERSONALITY" ? (
                  <div>
                    <label className="label" htmlFor="command-personality">
                      Personality
                    </label>
                    <select
                      id="command-personality"
                      className="select"
                      value={personality}
                      onChange={(event) => setPersonality(event.target.value as Personality)}
                    >
                      {personalities.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {commandType === "UPDATE_THEME" ? (
                  <div>
                    <label className="label" htmlFor="command-theme">
                      Theme
                    </label>
                    <select
                      id="command-theme"
                      className="select"
                      value={theme}
                      onChange={(event) => setTheme(event.target.value as Theme)}
                    >
                      {themes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {commandType === "UPDATE_BRIGHTNESS" ? (
                  <div>
                    <label className="label" htmlFor="command-brightness">
                      Brightness: {brightness}
                    </label>
                    <input
                      id="command-brightness"
                      type="range"
                      min={0}
                      max={255}
                      value={brightness}
                      onChange={(event) => setBrightness(Number(event.target.value))}
                      className="w-full accent-teal-300"
                    />
                  </div>
                ) : null}

                {commandType === "UPDATE_SLEEP_TIMEOUT" ? (
                  <div>
                    <label className="label" htmlFor="command-sleep">
                      Sleep timeout (30–3600 seconds)
                    </label>
                    <input
                      id="command-sleep"
                      className="input"
                      type="number"
                      min={30}
                      max={3600}
                      value={sleepSeconds}
                      onChange={(event) => setSleepSeconds(Number(event.target.value))}
                    />
                  </div>
                ) : null}

                <p className="text-[0.7rem] leading-5 text-[#6f879e]">
                  {commandCatalog.find((command) => command.type === commandType)?.description}
                </p>

                {commandError ? (
                  <p className="rounded-lg border border-rose/30 bg-rose/10 px-3 py-2 text-xs text-rose-200">
                    {commandError}
                  </p>
                ) : null}
                {commandNotice ? (
                  <p className="rounded-lg border border-mint/25 bg-mint/[0.07] px-3 py-2 text-xs text-mint-100">
                    {commandNotice}
                  </p>
                ) : null}

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={sendCommand}
                  disabled={sending || !selectedDeviceId}
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Queue command
                </button>
                {selectedDevice && !isOnline(selectedDevice.last_seen_at) ? (
                  <p className="text-[0.68rem] text-amber-200/80">
                    {selectedDevice.name} is offline. The command will wait until it reconnects, but it
                    expires after 15 minutes.
                  </p>
                ) : null}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Command history"
            description="Lifecycle: PENDING → RECEIVED → EXECUTING → COMPLETED or FAILED."
          >
            {commands.length === 0 ? (
              <p className="text-xs text-muted">No commands have been sent yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Command</th>
                      <th>Device</th>
                      <th>Status</th>
                      <th>Queued</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commands.map((command) => (
                      <tr key={command.id}>
                        <td className="font-semibold text-[#dbe8f3]">{titleCase(command.type)}</td>
                        <td className="text-[#8fa6bd]">
                          {deviceById.get(command.device_id)?.name ?? "removed device"}
                        </td>
                        <td>
                          <span className={`badge ${commandBadge[command.status] ?? ""}`}>
                            {command.status}
                          </span>
                          {command.error ? (
                            <span className="mt-1 block max-w-[180px] truncate text-[0.62rem] text-rose-300">
                              {command.error}
                            </span>
                          ) : null}
                        </td>
                        <td className="text-[#8fa6bd]">{relativeTime(command.created_at)}</td>
                        <td className="mono max-w-[200px] truncate text-[0.68rem] text-[#6f879e]">
                          {JSON.stringify(command.payload)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            title="Pair a new device"
            description="Generate a single-use code, then enter it during the device's Wi-Fi setup."
          >
            {!pairing ? (
              <button
                type="button"
                className="btn btn-primary w-full"
                onClick={createPairingCode}
                disabled={pairBusy}
              >
                {pairBusy ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />}
                Generate pairing code
              </button>
            ) : (
              <div>
                <div className="rounded-xl border border-mint/25 bg-mint/[0.06] px-4 py-4 text-center">
                  <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-mint/80">
                    Pairing code
                  </p>
                  <p className="mono mt-2 text-xl font-bold tracking-[0.12em] text-white">
                    {pairing.code}
                  </p>
                  <p className={`mt-1 text-[0.68rem] ${pairingExpired ? "text-rose-300" : "text-[#8fa6bd]"}`}>
                    {pairingExpired
                      ? "Expired — generate a new code"
                      : `Expires in ${Math.floor(pairingSecondsLeft / 60)}:${String(pairingSecondsLeft % 60).padStart(2, "0")}`}
                  </p>
                  <button
                    type="button"
                    className="btn btn-sm mt-3"
                    onClick={copyCode}
                    disabled={pairingExpired}
                  >
                    {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
                    {copied ? "Copied" : "Copy code"}
                  </button>
                </div>
                <ol className="mt-4 space-y-2 text-[0.72rem] leading-5 text-muted">
                  <li>
                    <span className="font-semibold text-white">1.</span> On AGNES open Settings →
                    Wi-Fi setup and start the setup portal.
                  </li>
                  <li>
                    <span className="font-semibold text-white">2.</span> Join the{" "}
                    <span className="mono text-mint">AGNES-XXXX</span> Wi-Fi. Its password is shown on
                    the OLED.
                  </li>
                  <li>
                    <span className="font-semibold text-white">3.</span> Open{" "}
                    <span className="mono text-mint">http://192.168.4.1</span>, enter your 2.4 GHz
                    Wi-Fi credentials and this pairing code.
                  </li>
                  <li>
                    <span className="font-semibold text-white">4.</span> The device restarts, joins
                    your network and claims the code on its first cloud request.
                  </li>
                </ol>
                <button
                  type="button"
                  className="btn btn-sm mt-3 w-full"
                  onClick={createPairingCode}
                  disabled={pairBusy}
                >
                  {pairBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  New code
                </button>
              </div>
            )}
            {pairError ? (
              <p className="mt-3 rounded-lg border border-rose/30 bg-rose/10 px-3 py-2 text-xs text-rose-200">
                {pairError}
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title="Device rules" description="What the firmware actually supports.">
            <ul className="space-y-2 text-[0.72rem] leading-5 text-muted">
              <li>• Local settings changes on the device are not overwritten by cloud settings unless sync_version increases.</li>
              <li>• Deep sleep uses timer wake only; GPIO 6/7/8 are not RTC-capable on ESP32-C3.</li>
              <li>• Notes, memories and notifications are read-only on the device; authoring happens here.</li>
              <li>• A revoked device immediately loses API access and must be re-paired.</li>
            </ul>
          </SectionCard>

          <HonestyNote>
            {onlineCount === 0
              ? "No device is currently online. Everything here still works, but telemetry and command acknowledgements wait for the next sync."
              : `${onlineCount} device${onlineCount === 1 ? "" : "s"} online. Status is based on the last sync timestamp, not a live socket.`}
          </HonestyNote>
        </div>
      </div>
    </div>
  );
}
