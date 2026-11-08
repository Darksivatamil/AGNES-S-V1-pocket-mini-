import { admin } from "./db.ts";
import { getProviderKey, requireProviderKey } from "./credentials.ts";
import { getAdapter } from "./providers/registry.ts";
import type { ProviderId } from "./providers/types.ts";
import { ApiError } from "./http.ts";

export type ProviderOverview = {
  provider: ProviderId;
  enabled: boolean;
  has_key: boolean;
  key_source: "user" | "environment" | null;
  key_hint: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
};

export async function providerOverview(
  userId: string,
  provider: ProviderId,
): Promise<ProviderOverview> {
  const { data: config } = await admin()
    .from("agnes_ai_providers")
    .select("enabled, key_hint, last_test_at, last_test_ok, last_error")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  let hasKey = false;
  let source: "user" | "environment" | null = null;
  try {
    const key = await getProviderKey(userId, provider);
    if (key) {
      hasKey = true;
      source = key.source;
    }
  } catch {
    hasKey = false;
  }

  return {
    provider,
    enabled: config?.enabled ?? true,
    has_key: hasKey,
    key_source: source,
    key_hint: config?.key_hint ?? null,
    last_test_at: config?.last_test_at ?? null,
    last_test_ok: config?.last_test_ok ?? null,
    last_error: config?.last_error ?? null,
  };
}

export async function testProviderConnection(
  userId: string,
  provider: ProviderId,
): Promise<{ ok: boolean; detail: string; tested_at: string }> {
  const key = await requireProviderKey(userId, provider);
  const testedAt = new Date().toISOString();
  let ok = false;
  let detail = "";
  try {
    const health = await getAdapter(provider).healthCheck(key.apiKey, 15_000);
    ok = health.ok;
    detail = health.detail.slice(0, 300);
  } catch (error) {
    ok = false;
    detail = error instanceof Error ? error.message.slice(0, 300) : "Connection test failed";
    if (error instanceof ApiError) detail = error.message;
  }

  await admin().from("agnes_ai_providers").upsert({
    user_id: userId,
    provider,
    enabled: true,
    last_test_at: testedAt,
    last_test_ok: ok,
    last_error: ok ? null : detail,
  }, { onConflict: "user_id,provider" });

  return { ok, detail, tested_at: testedAt };
}
