import { admin } from "./db.ts";
import { decryptSecret } from "./crypto.ts";
import { ApiError } from "./http.ts";
import { providerFallbackKey } from "./env.ts";
import type { ProviderId } from "./providers/types.ts";

export type ProviderKeySource = "user" | "environment";

export type ProviderKey = {
  apiKey: string;
  source: ProviderKeySource;
};

/**
 * Load a provider key server-side. The value is never included in any
 * response, log, error detail or browser payload.
 */
export async function getProviderKey(
  userId: string,
  provider: ProviderId,
): Promise<ProviderKey | null> {
  const { data: config, error: configError } = await admin()
    .from("agnes_ai_providers")
    .select("enabled")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (configError) throw new ApiError("provider_config_error", "Could not load provider configuration", 500);

  if (config && config.enabled === false) {
    throw new ApiError("provider_disabled", `${provider} is disabled in Model Center`, 409);
  }

  const { data: credential, error } = await admin()
    .from("agnes_provider_credentials")
    .select("ciphertext, iv")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) throw new ApiError("provider_config_error", "Could not load provider credential", 500);
  if (credential) {
    const apiKey = await decryptSecret(credential.ciphertext, credential.iv, userId, provider);
    return { apiKey, source: "user" };
  }

  const fallback = providerFallbackKey(provider);
  if (fallback) return { apiKey: fallback, source: "environment" };
  return null;
}

export async function requireProviderKey(
  userId: string,
  provider: ProviderId,
): Promise<ProviderKey> {
  const key = await getProviderKey(userId, provider);
  if (!key) {
    throw new ApiError(
      "provider_not_configured",
      `Add a ${provider} API key in Model Center, or ask the operator to set a server-side fallback key`,
      409,
    );
  }
  return key;
}

export async function providerHasKey(userId: string, provider: ProviderId): Promise<boolean> {
  try {
    return (await getProviderKey(userId, provider)) !== null;
  } catch {
    return false;
  }
}
