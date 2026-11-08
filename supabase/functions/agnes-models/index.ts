import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { modelsRequestSchema } from "../_shared/validation.ts";
import { readProviderCatalogue, refreshProviderCatalogue } from "../_shared/catalogue.ts";
import { getProviderKey } from "../_shared/credentials.ts";
import { providerOverview } from "../_shared/providerAdmin.ts";
import type { ProviderId } from "../_shared/providers/types.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, modelsRequestSchema);
    const allowed = await enforceRateLimit("agnes-models", auth.userId, 20, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many catalogue requests", 429);

    const providers: ProviderId[] = body.provider
      ? [body.provider]
      : ["openrouter", "nvidia"];
    const results = [];

    for (const provider of providers) {
      const overview = await providerOverview(auth.userId, provider);
      let key: { apiKey: string; source: "user" | "environment" } | null = null;
      try {
        key = await getProviderKey(auth.userId, provider);
      } catch {
        key = null;
      }

      let refreshError: string | null = null;
      let current = await readProviderCatalogue(provider);
      if (body.action === "refresh" || (current.meta.stale && key)) {
        if (key) {
          try {
            await refreshProviderCatalogue(provider, key.apiKey);
            current = await readProviderCatalogue(provider);
          } catch (error) {
            refreshError = error instanceof ApiError ? error.message : "Catalogue refresh failed";
          }
        } else {
          refreshError = "No provider API key configured; showing cached catalogue only";
        }
      }

      const { data: metaRow } = await admin()
        .from("agnes_catalogue_meta")
        .select("last_error")
        .eq("provider", provider)
        .maybeSingle();

      results.push({
        provider,
        enabled: overview.enabled,
        has_key: overview.has_key,
        key_source: overview.key_source,
        key_hint: overview.key_hint,
        last_test_at: overview.last_test_at,
        last_test_ok: overview.last_test_ok,
        provider_error: overview.last_error,
        catalogue: {
          fetched_at: current.meta.fetchedAt,
          model_count: current.models.length,
          stale: current.meta.stale,
          last_error: refreshError ?? metaRow?.last_error ?? current.meta.lastError,
        },
        models: current.models.map((model) => ({
          id: model.id,
          name: model.name,
          free_status: model.freeStatus,
          billing_note: model.billingNote,
          context_length: model.contextLength,
          max_output_tokens: model.maxOutputTokens,
          input_modalities: model.inputModalities,
          output_modalities: model.outputModalities,
          supports_tools: model.supportsTools,
          supports_structured_output: model.supportsStructuredOutput,
          supports_reasoning: model.supportsReasoning,
          description: model.description,
        })),
      });
    }

    return ok(req, {
      providers: results,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    return fail(req, error);
  }
});
