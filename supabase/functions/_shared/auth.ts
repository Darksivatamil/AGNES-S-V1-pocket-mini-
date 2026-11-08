import { z } from "npm:zod@3.23.8";
import { admin } from "./db.ts";
import { ApiError } from "./http.ts";
import { sha256Hex } from "./crypto.ts";

export type UserAuth = {
  kind: "user";
  userId: string;
  email: string | null;
};

export type DeviceAuth = {
  kind: "device";
  userId: string;
  deviceId: string;
  hardwareId: string;
  deviceName: string;
};

export type AuthContext = UserAuth | DeviceAuth;

const deviceHeadersSchema = z.object({
  deviceId: z.string().uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});

async function authenticateUser(req: Request): Promise<UserAuth | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const jwt = header.slice(7).trim();
  if (!jwt) return null;

  const { data, error } = await admin().auth.getUser(jwt);
  if (error || !data.user) return null;
  return { kind: "user", userId: data.user.id, email: data.user.email ?? null };
}

async function authenticateDevice(req: Request): Promise<DeviceAuth | null> {
  const parsed = deviceHeadersSchema.safeParse({
    deviceId: req.headers.get("x-agnes-device-id") ?? "",
    token: req.headers.get("x-agnes-device-token") ?? "",
  });
  if (!parsed.success) return null;

  const tokenHash = await sha256Hex(parsed.data.token);
  const { data, error } = await admin()
    .from("agnes_device_credentials")
    .select("device_id, token_hash, agnes_devices!inner(id, user_id, hardware_id, name, revoked_at)")
    .eq("device_id", parsed.data.deviceId)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  const device = Array.isArray(data.agnes_devices) ? data.agnes_devices[0] : data.agnes_devices;
  if (!device || device.revoked_at) return null;

  // Best-effort usage stamp; never blocks the request.
  void admin()
    .from("agnes_device_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("device_id", device.id)
    .then(() => undefined, () => undefined);

  return {
    kind: "device",
    userId: device.user_id,
    deviceId: device.id,
    hardwareId: device.hardware_id,
    deviceName: device.name,
  };
}

export async function authenticate(
  req: Request,
  options: { allowUser?: boolean; allowDevice?: boolean } = {},
): Promise<AuthContext> {
  const allowUser = options.allowUser ?? true;
  const allowDevice = options.allowDevice ?? true;

  if (allowUser) {
    const user = await authenticateUser(req);
    if (user) return user;
  }
  if (allowDevice) {
    const device = await authenticateDevice(req);
    if (device) return device;
  }
  throw new ApiError("unauthorized", "Valid authentication is required", 401);
}

export function assertDeviceMatches(auth: AuthContext, bodyDeviceId?: string): void {
  if (auth.kind !== "device") return;
  if (bodyDeviceId && bodyDeviceId !== auth.deviceId) {
    throw new ApiError("device_mismatch", "Device credentials do not match the request", 403);
  }
}

export function userOnly(auth: AuthContext): UserAuth {
  if (auth.kind !== "user") {
    throw new ApiError("user_auth_required", "This operation requires a signed-in user", 403);
  }
  return auth;
}

export function deviceOnly(auth: AuthContext): DeviceAuth {
  if (auth.kind !== "device") {
    throw new ApiError("device_auth_required", "This operation requires a paired device", 403);
  }
  return auth;
}
