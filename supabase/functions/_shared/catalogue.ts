import { admin } from "./db.ts";
import { getAdapter } from "./providers/registry.ts";
import type { CatalogueModel, ProviderId } from "./providers/types.ts";
import { ApiError } from "./http.ts";

export const CATALOGUE_TTL_MS = 15 * 60 * 1000;

export type CatalogueMeta = {
  provider: ProviderId;
  fetchedAt: string | null;
  modelCount: number;
  lastError: string | null;
  stale: boolean;
};

function rowToModel(row: Record<string, unknown>): CatalogueModel {
  const payload = (row.payload && typeof row.payload === "object")
    ? row.payload as Record<string, unknown>
    : {};
  return {
    id: row.model_id as string,
    name: typeof payload.name === "string" ? payload.name : row.model_id as string,
    provider: row.provider as ProviderId,
    freeStatus: row.free_status as CatalogueModel["freeStatus"],
    billingNote: (row.billing_note as string) ?? "",
    contextLength: (row.context_length as number) ?? null,
    maxOutputTokens: (row.max_output_tokens as number) ?? null,
    inputModalities: Array.isArray(payload.inputModalities)
      ? payload.inputModalities as string[]
      : (Array.isArray(payload.input_modalities) ? payload.input_modalities as string[] : ["text"]),
    outputModalities: Array.isArray(payload.outputModalities)
      ? payload.outputModalities as string[]
      : (Array.isArray(payload.output_modalities) ? payload.output_modalities as string[] : ["text"]),
    supportsTools: Boolean(payload.supportsTools ?? payload.supports_tools),
    supportsStructuredOutput: Boolean(
      payload.supportsStructuredOutput ?? payload.supports_structured_output,
    ),
    supportsReasoning: Boolean(payload.supportsReasoning ?? payload.supports_reasoning),
    description: typeof payload.description === "string" ? payload.description : "",
    raw: payload,
  };
}

export async function refreshProviderCatalogue(
  provider: ProviderId,
  apiKey: string,
  timeoutMs = 20_000,
): Promise<{ count: number; models: CatalogueModel[]; fetchedAt: string }> {
  const startedAt = new Date().toISOString();
  let models: CatalogueModel[];
  try {
    models = await getAdapter(provider).listModels(apiKey, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Catalogue refresh failed";
    await admin().from("agnes_catalogue_meta").upsert({
      provider,
      last_error: message,
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider" });
    throw error;
  }

  if (models.length === 0) {
    throw new ApiError("empty_catalogue", `${provider} returned an empty model catalogue`, 502);
  }

  // Upsert in bounded chunks to keep requests small.
  const chunkSize = 150;
  for (let i = 0; i < models.length; i += chunkSize) {
    const rows = models.slice(i, i + chunkSize).map((model) => ({
      provider,
      model_id: model.id,
      free_status: model.freeStatus,
      billing_note: model.billingNote.slice(0, 500),
      context_length: model.contextLength,
      max_output_tokens: model.maxOutputTokens,
      payload: {
        name: model.name,
        description: model.description.slice(0, 600),
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        supportsTools: model.supportsTools,
        supportsStructuredOutput: model.supportsStructuredOutput,
        supportsReasoning: model.supportsReasoning,
      },
      fetched_at: startedAt,
    }));
    const { error } = await admin().from("agnes_model_catalogue").upsert(rows, {
      onConflict: "provider,model_id",
    });
    if (error) {
      console.error("Catalogue upsert failed", error.code);
      throw new ApiError("catalogue_store_failed", "Could not store model catalogue", 500);
    }
  }

  // Models absent from this successful refresh are removed from the active cache.
  await admin()
    .from("agnes_model_catalogue")
    .delete()
    .eq("provider", provider)
    .lt("fetched_at", startedAt);

  const { error: metaError } = await admin().from("agnes_catalogue_meta").upsert({
    provider,
    fetched_at: startedAt,
    model_count: models.length,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider" });
  if (metaError) console.error("Catalogue meta update failed", metaError.code);

  return { count: models.length, models, fetchedAt: startedAt };
}

export async function readProviderCatalogue(
  provider: ProviderId,
): Promise<{ models: CatalogueModel[]; meta: CatalogueMeta }> {
  const [{ data: metaRow }, { data: rows, error }] = await Promise.all([
    admin().from("agnes_catalogue_meta").select("*").eq("provider", provider).maybeSingle(),
    admin().from("agnes_model_catalogue").select("*").eq("provider", provider).order("model_id"),
  ]);
  if (error) throw new ApiError("catalogue_read_failed", "Could not read model catalogue", 500);

  const fetchedAt = (metaRow?.fetched_at as string | null) ?? null;
  const ageMs = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Infinity;
  const models = (rows ?? []).map((row) => rowToModel(row as Record<string, unknown>));
  return {
    models,
    meta: {
      provider,
      fetchedAt,
      modelCount: (metaRow?.model_count as number) ?? models.length,
      lastError: (metaRow?.last_error as string | null) ?? null,
      stale: !Number.isFinite(ageMs) || ageMs > CATALOGUE_TTL_MS,
    },
  };
}

export async function ensureFreshCatalogue(
  provider: ProviderId,
  apiKey: string | null,
): Promise<{ models: CatalogueModel[]; meta: CatalogueMeta; refreshed: boolean }> {
  const current = await readProviderCatalogue(provider);
  if (!current.meta.stale || !apiKey) return { ...current, refreshed: false };

  try {
    await refreshProviderCatalogue(provider, apiKey);
    return { ...(await readProviderCatalogue(provider)), refreshed: true };
  } catch (error) {
    console.error("Catalogue refresh failed; retaining cache", provider);
    const retained = await readProviderCatalogue(provider);
    return { ...retained, refreshed: false };
  }
}

export async function findModel(
  provider: ProviderId,
  modelId: string,
): Promise<CatalogueModel | null> {
  const { data, error } = await admin()
    .from("agnes_model_catalogue")
    .select("*")
    .eq("provider", provider)
    .eq("model_id", modelId)
    .maybeSingle();
  if (error) throw new ApiError("catalogue_read_failed", "Could not read model catalogue", 500);
  return data ? rowToModel(data as Record<string, unknown>) : null;
}

export function assertModelBilling(model: CatalogueModel, allowPaid: boolean): void {
  if (model.freeStatus === "free") return;
  if (!allowPaid) {
    const label = model.freeStatus === "unknown"
      ? "has unverified/account-managed billing"
      : "is paid";
    throw new ApiError(
      "paid_model_disabled",
      `Model ${model.id} ${label}. Enable paid/account usage explicitly in Model Center.`,
      403,
    );
  }
}

/**
 * A request that starts on a free model must never silently continue on a paid
 * or account-managed model, even when the user has enabled paid usage for their
 * primary selection. The user can choose a paid primary explicitly instead.
 */
export function assertFallbackBilling(
  primary: CatalogueModel,
  fallback: CatalogueModel,
): void {
  if (primary.freeStatus === "free" && fallback.freeStatus !== "free") {
    throw new ApiError(
      "paid_fallback_blocked",
      "The active free model failed, and AGNES will not silently fall back to a paid or account-managed model. Choose a free fallback or retry later.",
      502,
    );
  }
}

export async function pickAutomaticFreeModel(
  exclude: string[] = [],
): Promise<CatalogueModel | null> {
  const { models } = await readProviderCatalogue("openrouter");
  const excluded = new Set(exclude);
  const free = models
    .filter((model) => model.freeStatus === "free" && !excluded.has(model.id))
    .filter((model) => model.outputModalities.includes("text") || model.outputModalities.length === 0)
    .sort((a, b) => {
      const ctxA = a.contextLength ?? 0;
      const ctxB = b.contextLength ?? 0;
      if (ctxA !== ctxB) return ctxB - ctxA;
      return a.id.localeCompare(b.id);
    });
  return free[0] ?? null;
}
