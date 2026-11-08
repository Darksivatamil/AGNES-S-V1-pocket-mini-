import { admin } from "./db.ts";
import { sha256Hex } from "./crypto.ts";

/**
 * Fixed-window rate limit implemented atomically in PostgreSQL.
 * Fails closed on infrastructure errors for expensive routes.
 */
export async function enforceRateLimit(
  route: string,
  identity: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const identityHash = (await sha256Hex(identity)).slice(0, 32);
  const bucket = `${route}:${identityHash}`;
  const { data, error } = await admin().rpc("agnes_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limit check failed", error.code);
    return false;
  }
  return data === true;
}
