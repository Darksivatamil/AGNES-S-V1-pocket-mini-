import type { z } from "npm:zod@3.23.8";
import { admin } from "./db.ts";
import { ApiError } from "./http.ts";
import type { deviceStatusSchema } from "./validation.ts";

export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export function deviceStatusUpdate(status: DeviceStatus): Record<string, unknown> {
  const update: Record<string, unknown> = {
    firmware_version: status.firmware_version,
    last_seen_at: new Date().toISOString(),
  };
  if (status.battery_voltage_mv !== undefined) update.battery_voltage_mv = status.battery_voltage_mv;
  if (status.battery_percent !== undefined) update.battery_percent = status.battery_percent;
  if (status.wifi_rssi !== undefined) update.wifi_rssi = status.wifi_rssi;
  if (status.free_heap !== undefined) update.free_heap = status.free_heap;
  if (status.uptime_seconds !== undefined) update.uptime_seconds = status.uptime_seconds;
  if (status.current_emotion !== undefined) update.current_emotion = status.current_emotion;
  if (status.current_personality !== undefined) update.current_personality = status.current_personality;
  if (status.last_error !== undefined) update.last_error = status.last_error;
  if (status.oled_controller !== undefined) update.oled_controller = status.oled_controller;
  if (status.status_extra !== undefined) update.status_extra = status.status_extra;
  return update;
}

export async function applyDeviceStatus(
  deviceId: string,
  userId: string,
  status: DeviceStatus,
): Promise<void> {
  const { error } = await admin()
    .from("agnes_devices")
    .update(deviceStatusUpdate(status))
    .eq("id", deviceId)
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw new ApiError("device_status_failed", "Could not store device status", 500);
}

export function safeSettings(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    personality: row.personality,
    theme: row.theme,
    brightness: row.brightness,
    idle_animations: row.idle_animations,
    sleep_timeout_seconds: row.sleep_timeout_seconds,
    cloud_memory_enabled: row.cloud_memory_enabled,
    notifications_enabled: row.notifications_enabled,
    timezone_posix: row.timezone_posix,
    location_name: row.location_name,
    latitude: row.latitude,
    longitude: row.longitude,
    sync_version: row.sync_version,
    updated_at: row.updated_at,
  };
}

export async function readSettings(userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin()
    .from("agnes_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError("settings_failed", "Could not read settings", 500);
  return data ? safeSettings(data as Record<string, unknown>) : null;
}
