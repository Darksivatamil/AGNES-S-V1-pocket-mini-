import { admin } from "../_shared/db.ts";
import { authenticate, userOnly } from "../_shared/auth.ts";
import { ApiError, fail, ok, optionsResponse, parseJson, requirePost } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/rateLimit.ts";
import { providerActionSchema } from "../_shared/validation.ts";
import { encryptSecret } from "../_shared/crypto.ts";
import { requireProviderKey } from "../_shared/credentials.ts";
import { assertModelBilling, findModel, refreshProviderCatalogue } from "../_shared/catalogue.ts";
import { testProviderConnection } from "../_shared/providerAdmin.ts";
import type { CatalogueModel, ProviderId } from "../_shared/providers/types.ts";

async function resolveSelectableModel(
  userId: string,
  provider: ProviderId,
  modelId: string,
  allowPaid: boolean,
): Promise<CatalogueModel> {
  let model = await findModel(provider, modelId);
  if (!model) {
    const key = await requireProviderKey(userId, provider);
    await refreshProviderCatalogue(provider, key.apiKey);
    model = await findModel(provider, modelId);
  }
  if (!model) {
    throw new ApiError(
      "model_not_in_catalogue",
      "That model is not in the live provider catalogue. Refresh Model Center.",
      400,
    );
  }
  assertModelBilling(model, allowPaid);
  return model;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  try {
    requirePost(req);
    const auth = userOnly(await authenticate(req, { allowUser: true, allowDevice: false }));
    const body = await parseJson(req, providerActionSchema);
    const allowed = await enforceRateLimit("agnes-providers", auth.userId, 30, 60);
    if (!allowed) throw new ApiError("rate_limited", "Too many provider operations", 429);

    if (body.action === "save") {
      const apiKey = body.api_key.trim();
      const { ciphertext, iv, keyVersion } = await encryptSecret(
        apiKey,
        auth.userId,
        body.provider,
      );
      const hint = apiKey.slice(-4);
      const { error: credentialError } = await admin().from("agnes_provider_credentials").upsert({
        user_id: auth.userId,
        provider: body.provider,
        ciphertext,
        iv,
        key_version: keyVersion,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider" });
      if (credentialError) throw new ApiError("credential_save_failed", "Could not store provider key", 500);

      const { error: configError } = await admin().from("agnes_ai_providers").upsert({
        user_id: auth.userId,
        provider: body.provider,
        enabled: body.enabled,
        key_hint: hint,
        last_error: null,
      }, { onConflict: "user_id,provider" });
      if (configError) throw new ApiError("provider_save_failed", "Could not save provider settings", 500);

      return ok(req, {
        provider: body.provider,
        has_key: true,
        key_hint: hint,
        enabled: body.enabled,
      });
    }

    if (body.action === "delete") {
      await admin()
        .from("agnes_provider_credentials")
        .delete()
        .eq("user_id", auth.userId)
        .eq("provider", body.provider);
      const { error } = await admin().from("agnes_ai_providers").upsert({
        user_id: auth.userId,
        provider: body.provider,
        enabled: false,
        key_hint: null,
        last_test_ok: null,
        last_error: null,
      }, { onConflict: "user_id,provider" });
      if (error) throw new ApiError("provider_delete_failed", "Could not disable provider", 500);
      return ok(req, { provider: body.provider, has_key: false, enabled: false });
    }

    if (body.action === "test") {
      const test = await testProviderConnection(auth.userId, body.provider);
      return ok(req, test);
    }

    // select
    if (
      (body.fallback_provider && !body.fallback_model_id) ||
      (!body.fallback_provider && body.fallback_model_id)
    ) {
      throw new ApiError(
        "invalid_fallback",
        "Fallback provider and fallback model must be set together",
        400,
      );
    }

    const active = await resolveSelectableModel(
      auth.userId,
      body.active_provider,
      body.active_model_id,
      body.allow_paid,
    );

    let fallback: CatalogueModel | null = null;
    if (body.fallback_provider && body.fallback_model_id) {
      if (
        body.fallback_provider === body.active_provider &&
        body.fallback_model_id === body.active_model_id
      ) {
        throw new ApiError("invalid_fallback", "Fallback must differ from the active model", 400);
      }
      fallback = await resolveSelectableModel(
        auth.userId,
        body.fallback_provider,
        body.fallback_model_id,
        body.allow_paid,
      );
    }

    const { data, error } = await admin()
      .from("agnes_model_preferences")
      .upsert({
        user_id: auth.userId,
        active_provider: body.active_provider,
        active_model_id: body.active_model_id,
        fallback_provider: body.fallback_provider ?? null,
        fallback_model_id: body.fallback_model_id ?? null,
        automatic_free_model: body.automatic_free_model,
        allow_paid: body.allow_paid,
        temperature: body.temperature,
        max_response_tokens: body.max_response_tokens,
        context_messages: body.context_messages,
        request_timeout_ms: body.request_timeout_ms,
      }, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw new ApiError("preferences_failed", "Could not save model preferences", 500);

    return ok(req, {
      preferences: data,
      active_model: {
        id: active.id,
        name: active.name,
        free_status: active.freeStatus,
        billing_note: active.billingNote,
        supports_structured_output: active.supportsStructuredOutput,
      },
      fallback_model: fallback
        ? { id: fallback.id, name: fallback.name, free_status: fallback.freeStatus }
        : null,
    });
  } catch (error) {
    return fail(req, error);
  }
});
