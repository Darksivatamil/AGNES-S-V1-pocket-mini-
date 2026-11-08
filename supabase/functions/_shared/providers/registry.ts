import type { ProviderAdapter, ProviderId } from "./types.ts";
import { openRouterAdapter } from "./openrouter.ts";
import { nvidiaAdapter } from "./nvidia.ts";

export const adapters: Record<ProviderId, ProviderAdapter> = {
  openrouter: openRouterAdapter,
  nvidia: nvidiaAdapter,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  return adapters[provider];
}
