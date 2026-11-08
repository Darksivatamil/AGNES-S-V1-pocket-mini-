"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  Check,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { PageHeader, SectionCard } from "@/components/ui";
import { callAgnes, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type {
  CatalogueModel,
  FreeStatus,
  ModelPreferences,
  ProviderCatalogue,
  ProviderId,
} from "@/lib/types";

type PrefsForm = {
  active_provider: ProviderId;
  active_model_id: string;
  fallback_provider: "" | ProviderId;
  fallback_model_id: string;
  automatic_free_model: boolean;
  allow_paid: boolean;
  temperature: number;
  max_response_tokens: number;
  context_messages: number;
  request_timeout_ms: number;
};

const providerNames: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  nvidia: "NVIDIA NIM",
};

function prefsToForm(prefs: ModelPreferences | null): PrefsForm {
  return {
    active_provider: prefs?.active_provider ?? "openrouter",
    active_model_id: prefs?.active_model_id ?? "",
    fallback_provider: prefs?.fallback_provider ?? "",
    fallback_model_id: prefs?.fallback_model_id ?? "",
    automatic_free_model: prefs?.automatic_free_model ?? true,
    allow_paid: prefs?.allow_paid ?? false,
    temperature: prefs?.temperature ?? 0.8,
    max_response_tokens: prefs?.max_response_tokens ?? 300,
    context_messages: prefs?.context_messages ?? 12,
    request_timeout_ms: prefs?.request_timeout_ms ?? 25000,
  };
}

function billingBadge(status: FreeStatus): string {
  if (status === "free") return "badge-mint";
  if (status === "paid") return "badge-rose";
  return "badge-amber";
}

function billingLabel(status: FreeStatus): string {
  if (status === "free") return "free";
  if (status === "paid") return "paid";
  return "account-managed";
}

export function ProvidersClient({
  initialPreferences,
  preselected,
}: {
  initialPreferences: ModelPreferences | null;
  preselected: { provider: ProviderId; model: string; role: "active" | "fallback" } | null;
}) {
  const [providers, setProviders] = useState<ProviderCatalogue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<PrefsForm>(() => {
    const base = prefsToForm(initialPreferences);
    if (!preselected) return base;
    if (preselected.role === "fallback") {
      return {
        ...base,
        fallback_provider: preselected.provider,
        fallback_model_id: preselected.model,
      };
    }
    return { ...base, active_provider: preselected.provider, active_model_id: preselected.model };
  });
  const [savedPrefs, setSavedPrefs] = useState<ModelPreferences | null>(initialPreferences);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [keyInputs, setKeyInputs] = useState<Record<ProviderId, string>>({
    openrouter: "",
    nvidia: "",
  });
  const [keyBusy, setKeyBusy] = useState<ProviderId | null>(null);
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [providerNotice, setProviderNotice] = useState<Partial<Record<ProviderId, string>>>({});

  const loadCatalogue = useCallback(async (refresh = false) => {
    setError(null);
    try {
      const result = await callAgnes<{ providers: ProviderCatalogue[]; server_time: string }>(
        "agnes-models",
        { action: refresh ? "refresh" : "list" },
      );
      setProviders(result.providers);
      if (!form.active_model_id) {
        const firstFree = result.providers
          .find((provider) => provider.provider === form.active_provider)
          ?.models.find((model) => model.free_status === "free");
        if (firstFree) {
          setForm((current) =>
            current.active_model_id ? current : { ...current, active_model_id: firstFree.id },
          );
        }
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [form.active_provider, form.active_model_id]);

  useEffect(() => {
    void loadCatalogue(false).finally(() => setLoading(false));
    // The initial catalogue load runs once. Manual refreshes reuse loadCatalogue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const activeProvider = providers.find((provider) => provider.provider === form.active_provider);
  const fallbackProvider = form.fallback_provider
    ? providers.find((provider) => provider.provider === form.fallback_provider)
    : null;

  const activeModels = activeProvider?.models ?? [];
  const fallbackModels = fallbackProvider?.models ?? [];

  const selectedModel = useMemo(
    () => activeModels.find((model) => model.id === form.active_model_id) ?? null,
    [activeModels, form.active_model_id],
  );

  function modelAllowed(model: CatalogueModel): boolean {
    return form.allow_paid || model.free_status === "free";
  }

  async function saveKey(provider: ProviderId) {
    const key = keyInputs[provider].trim();
    if (key.length < 16) {
      setProviderNotice((current) => ({
        ...current,
        [provider]: "That key looks too short. Paste the complete key.",
      }));
      return;
    }
    setKeyBusy(provider);
    setProviderNotice((current) => ({ ...current, [provider]: undefined }));
    setError(null);
    try {
      await callAgnes("agnes-providers", { action: "save", provider, api_key: key, enabled: true });
      setKeyInputs((current) => ({ ...current, [provider]: "" }));
      setProviderNotice((current) => ({
        ...current,
        [provider]: "Key encrypted and saved. Refreshing the live catalogue…",
      }));
      await loadCatalogue(true);
      setProviderNotice((current) => ({
        ...current,
        [provider]: "Key saved and catalogue refreshed.",
      }));
    } catch (caught) {
      setProviderNotice((current) => ({ ...current, [provider]: errorMessage(caught) }));
    } finally {
      setKeyBusy(null);
    }
  }

  async function testProvider(provider: ProviderId) {
    setTesting(provider);
    setProviderNotice((current) => ({ ...current, [provider]: undefined }));
    try {
      const result = await callAgnes<{ ok: boolean; detail: string; tested_at: string }>(
        "agnes-providers",
        { action: "test", provider },
      );
      setProviderNotice((current) => ({
        ...current,
        [provider]: `${result.ok ? "Connection OK" : "Connection failed"}: ${result.detail}`,
      }));
      await loadCatalogue(false);
    } catch (caught) {
      setProviderNotice((current) => ({ ...current, [provider]: errorMessage(caught) }));
    } finally {
      setTesting(null);
    }
  }

  async function deleteKey(provider: ProviderId) {
    if (
      !window.confirm(
        `Remove the saved ${providerNames[provider]} key? Chat falls back to another configured provider or fails honestly.`,
      )
    ) {
      return;
    }
    setKeyBusy(provider);
    setProviderNotice((current) => ({ ...current, [provider]: undefined }));
    try {
      await callAgnes("agnes-providers", { action: "delete", provider });
      setProviderNotice((current) => ({
        ...current,
        [provider]: "Saved key removed. Environment fallback, if configured, may still be used.",
      }));
      await loadCatalogue(false);
    } catch (caught) {
      setProviderNotice((current) => ({ ...current, [provider]: errorMessage(caught) }));
    } finally {
      setKeyBusy(null);
    }
  }

  async function refreshCatalogue() {
    setRefreshing(true);
    setError(null);
    await loadCatalogue(true);
    setRefreshing(false);
  }

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!form.active_model_id) {
      setError("Choose an active model first.");
      return;
    }
    if (form.fallback_provider && !form.fallback_model_id) {
      setError("Choose a fallback model, or set the fallback provider to none.");
      return;
    }
    if (
      form.fallback_provider &&
      form.fallback_provider === form.active_provider &&
      form.fallback_model_id === form.active_model_id
    ) {
      setError("The fallback must differ from the active model.");
      return;
    }
    setSavingPrefs(true);
    try {
      const result = await callAgnes<{ preferences: ModelPreferences; note?: string }>(
        "agnes-providers",
        {
          action: "select",
          active_provider: form.active_provider,
          active_model_id: form.active_model_id,
          fallback_provider: form.fallback_provider || null,
          fallback_model_id: form.fallback_model_id || null,
          automatic_free_model: form.automatic_free_model,
          allow_paid: form.allow_paid,
          temperature: form.temperature,
          max_response_tokens: form.max_response_tokens,
          context_messages: form.context_messages,
          request_timeout_ms: form.request_timeout_ms,
        },
      );
      setSavedPrefs(result.preferences);
      setNotice(
        "Model preferences saved. New chat replies use this model immediately; the device shares the same configuration.",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSavingPrefs(false);
    }
  }

  const hasAnyKey = providers.some((provider) => provider.has_key);
  const catalogueCount = providers.reduce((total, provider) => total + provider.models.length, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Providers & models"
        description="Keys are encrypted server-side and never reach the browser or firmware. Paid and account-managed models stay disabled until you explicitly allow them."
        action={
          <>
            <button type="button" className="btn" onClick={refreshCatalogue} disabled={refreshing}>
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh catalogue
            </button>
            <Link href="/models" className="btn btn-violet">
              <Boxes size={14} /> Model center
            </Link>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {providers.length === 0 && loading ? (
              <>
                {[0, 1].map((index) => (
                  <div key={index} className="card flex h-56 items-center justify-center text-xs text-muted">
                    <Loader2 size={16} className="mr-2 animate-spin" /> Loading provider catalogue…
                  </div>
                ))}
              </>
            ) : null}

            {providers.map((provider) => {
              const isBusy = keyBusy === provider.provider;
              const isTesting = testing === provider.provider;
              const message = providerNotice[provider.provider];
              return (
                <section key={provider.provider} className="card p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-white">
                        {providerNames[provider.provider]}
                      </h2>
                      <p className="mt-0.5 text-[0.68rem] text-muted">
                        {provider.models.length} models in cache ·{" "}
                        {provider.catalogue.fetched_at
                          ? `fetched ${relativeTime(provider.catalogue.fetched_at)}`
                          : "never fetched"}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`badge ${provider.has_key ? "badge-mint" : "badge-amber"}`}>
                        {provider.has_key
                          ? provider.key_source === "environment"
                            ? "server key"
                            : "key saved"
                          : "no key"}
                      </span>
                      {provider.key_hint ? (
                        <span className="mono text-[0.6rem] text-[#587088]">…{provider.key_hint}</span>
                      ) : null}
                    </div>
                  </div>

                  {provider.provider_error ? (
                    <p className="mt-2 rounded-lg border border-rose/25 bg-rose/[0.08] px-2.5 py-2 text-[0.66rem] leading-4 text-rose-200">
                      {provider.provider_error}
                    </p>
                  ) : null}
                  {provider.catalogue.last_error ? (
                    <p className="mt-2 rounded-lg border border-amber/20 bg-amber/[0.06] px-2.5 py-2 text-[0.66rem] leading-4 text-amber-100/80">
                      Catalogue: {provider.catalogue.last_error}
                    </p>
                  ) : null}

                  <div className="mt-3">
                    <label className="label" htmlFor={`key-${provider.provider}`}>
                      {provider.has_key ? "Replace API key" : "API key"}
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        id={`key-${provider.provider}`}
                        type="password"
                        className="input mono text-xs"
                        autoComplete="off"
                        placeholder="Paste provider API key"
                        value={keyInputs[provider.provider]}
                        onChange={(event) =>
                          setKeyInputs((current) => ({
                            ...current,
                            [provider.provider]: event.target.value,
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-primary shrink-0"
                        onClick={() => saveKey(provider.provider)}
                        disabled={isBusy || !keyInputs[provider.provider].trim()}
                      >
                        {isBusy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                        Save
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => testProvider(provider.provider)}
                      disabled={isTesting || !provider.has_key}
                    >
                      {isTesting ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                      Test connection
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => deleteKey(provider.provider)}
                      disabled={isBusy || provider.key_source !== "user"}
                    >
                      <Trash2 size={11} /> Remove saved key
                    </button>
                  </div>

                  {message ? (
                    <p className="mt-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 text-[0.66rem] leading-4 text-[#c3d3e4]">
                      {message}
                    </p>
                  ) : null}

                  <p className="mt-2 text-[0.6rem] leading-4 text-[#587088]">
                    {provider.last_test_at
                      ? `Last test ${relativeTime(provider.last_test_at)} · ${provider.last_test_ok ? "passed" : "failed"}`
                      : "No connection test has been run yet."}
                  </p>
                </section>
              );
            })}
          </div>

          <SectionCard
            title="Active model"
            description="This is the model used for new replies from both the web and the device."
          >
            <form onSubmit={savePreferences} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="active-provider">
                    Provider
                  </label>
                  <select
                    id="active-provider"
                    className="select"
                    value={form.active_provider}
                    onChange={(event) => {
                      const provider = event.target.value as ProviderId;
                      const firstFree = providers
                        .find((item) => item.provider === provider)
                        ?.models.find((model) => model.free_status === "free");
                      setForm((current) => ({
                        ...current,
                        active_provider: provider,
                        active_model_id: firstFree?.id ?? "",
                      }));
                    }}
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="nvidia">NVIDIA NIM</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="active-model">
                    Model
                  </label>
                  <select
                    id="active-model"
                    className="select"
                    value={form.active_model_id}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, active_model_id: event.target.value }))
                    }
                  >
                    <option value="">Select a model</option>
                    {activeModels.map((model) => (
                      <option key={model.id} value={model.id} disabled={!modelAllowed(model)}>
                        {model.name} ({billingLabel(model.free_status)})
                      </option>
                    ))}
                  </select>
                  {form.active_model_id && !activeModels.some((model) => model.id === form.active_model_id) ? (
                    <p className="mt-1 text-[0.62rem] text-amber-200/80">
                      The saved model is not in the current catalogue. Refresh or choose another.
                    </p>
                  ) : null}
                </div>
              </div>

              {selectedModel ? (
                <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`badge ${billingBadge(selectedModel.free_status)}`}>
                      {billingLabel(selectedModel.free_status)}
                    </span>
                    {selectedModel.supports_structured_output ? (
                      <span className="badge badge-violet">structured output</span>
                    ) : (
                      <span className="badge badge-amber">no structured output</span>
                    )}
                    {selectedModel.context_length ? (
                      <span className="badge">
                        {Math.round(selectedModel.context_length / 1000)}k context
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[0.68rem] leading-5 text-[#8fa6bd]">
                    {selectedModel.billing_note}
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="fallback-provider">
                    Fallback provider
                  </label>
                  <select
                    id="fallback-provider"
                    className="select"
                    value={form.fallback_provider}
                    onChange={(event) => {
                      const value = event.target.value as "" | ProviderId;
                      setForm((current) => ({
                        ...current,
                        fallback_provider: value,
                        fallback_model_id: "",
                      }));
                    }}
                  >
                    <option value="">No fallback</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="nvidia">NVIDIA NIM</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="fallback-model">
                    Fallback model
                  </label>
                  <select
                    id="fallback-model"
                    className="select"
                    value={form.fallback_model_id}
                    disabled={!form.fallback_provider}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, fallback_model_id: event.target.value }))
                    }
                  >
                    <option value="">Select a fallback</option>
                    {fallbackModels.map((model) => (
                      <option key={model.id} value={model.id} disabled={!modelAllowed(model)}>
                        {model.name} ({billingLabel(model.free_status)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-xs">
                  <span>
                    <span className="block font-semibold text-white">Allow paid / account-managed models</span>
                    <span className="block text-[0.65rem] leading-5 text-[#6f879e]">
                      Off by default. When off, only models verified free by the provider are
                      selectable. NVIDIA NIM endpoints are never assumed free.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={form.allow_paid}
                    onChange={(event) => {
                      const allow = event.target.checked;
                      setForm((current) => {
                        const active = activeModels.find((model) => model.id === current.active_model_id);
                        return {
                          ...current,
                          allow_paid: allow,
                          active_model_id:
                            !allow && active && active.free_status !== "free"
                              ? ""
                              : current.active_model_id,
                          fallback_model_id:
                            !allow && current.fallback_model_id
                              ? (fallbackModels.find((model) => model.id === current.fallback_model_id)
                                  ?.free_status === "free"
                                  ? current.fallback_model_id
                                  : "")
                              : current.fallback_model_id,
                        };
                      });
                    }}
                    className="mt-0.5 accent-teal-300"
                  />
                </label>
                <label className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-xs">
                  <span>
                    <span className="block font-semibold text-white">Automatic free-model fallback</span>
                    <span className="block text-[0.65rem] leading-5 text-[#6f879e]">
                      If the active model fails for a retryable reason, AGNES may pick another free
                      OpenRouter model. It never falls back from free to paid.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={form.automatic_free_model}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, automatic_free_model: event.target.checked }))
                    }
                    className="mt-0.5 accent-teal-300"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="temperature">
                    Temperature: {form.temperature.toFixed(2)}
                  </label>
                  <input
                    id="temperature"
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={form.temperature}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, temperature: Number(event.target.value) }))
                    }
                    className="w-full accent-teal-300"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="max-tokens">
                    Max response tokens (64–1024)
                  </label>
                  <input
                    id="max-tokens"
                    className="input"
                    type="number"
                    min={64}
                    max={1024}
                    value={form.max_response_tokens}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        max_response_tokens: Number(event.target.value),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="label" htmlFor="context-messages">
                    Context messages (4–30)
                  </label>
                  <input
                    id="context-messages"
                    className="input"
                    type="number"
                    min={4}
                    max={30}
                    value={form.context_messages}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        context_messages: Number(event.target.value),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="label" htmlFor="timeout">
                    Provider timeout (ms)
                  </label>
                  <input
                    id="timeout"
                    className="input"
                    type="number"
                    min={8000}
                    max={45000}
                    step={1000}
                    value={form.request_timeout_ms}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        request_timeout_ms: Number(event.target.value),
                      }))
                    }
                  />
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={savingPrefs}>
                {savingPrefs ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save model preferences
              </button>
            </form>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Current configuration" description="Last saved server-side.">
            {savedPrefs ? (
              <div className="space-y-2 text-xs">
                <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5">
                  <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">Active</p>
                  <p className="mt-0.5 font-semibold text-white">{savedPrefs.active_model_id}</p>
                  <p className="text-[0.65rem] text-[#587088]">{savedPrefs.active_provider}</p>
                </div>
                <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5">
                  <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#6f879e]">Fallback</p>
                  <p className="mt-0.5 font-semibold text-white">
                    {savedPrefs.fallback_model_id ?? "none"}
                  </p>
                  <p className="text-[0.65rem] text-[#587088]">
                    {savedPrefs.fallback_provider ?? "no fallback provider"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={`badge ${savedPrefs.allow_paid ? "badge-amber" : "badge-mint"}`}>
                    {savedPrefs.allow_paid ? "paid allowed" : "free only"}
                  </span>
                  <span className="badge">temp {savedPrefs.temperature}</span>
                  <span className="badge">{savedPrefs.max_response_tokens} tokens</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">No model has been saved yet. Chat returns a clear error until one is selected.</p>
            )}
          </SectionCard>

          <SectionCard title="Security model" description="What is stored where.">
            <ul className="space-y-2 text-[0.72rem] leading-5 text-muted">
              <li className="flex gap-2">
                <ShieldCheck size={13} className="mt-0.5 shrink-0 text-mint" />
                Provider keys are encrypted with AES-256-GCM using a server-only key. Additional
                authenticated data binds each ciphertext to your user ID and provider.
              </li>
              <li className="flex gap-2">
                <KeyRound size={13} className="mt-0.5 shrink-0 text-violet" />
                The dashboard only ever shows the last four characters. Raw keys never appear in
                table reads, firmware, or chat requests.
              </li>
              <li className="flex gap-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber" />
                Server environment fallback keys are never visible in this UI. If one exists, it may
                keep working after you remove your saved key.
              </li>
            </ul>
          </SectionCard>

          <SectionCard title="Catalogue status" description="Live provider data, cached briefly.">
            <div className="space-y-2 text-xs text-muted">
              <p>
                <span className="font-semibold text-white">{catalogueCount}</span> models cached across{" "}
                {providers.length} providers.
              </p>
              {providers.map((provider) => (
                <p key={provider.provider} className="flex items-center justify-between gap-2">
                  <span>{providerNames[provider.provider]}</span>
                  <span className={`badge ${provider.catalogue.stale ? "badge-amber" : "badge-mint"}`}>
                    {provider.catalogue.stale ? "stale" : "fresh"}
                  </span>
                </p>
              ))}
              {!hasAnyKey ? (
                <p className="rounded-lg border border-amber/20 bg-amber/[0.06] px-2.5 py-2 text-[0.68rem] text-amber-100/80">
                  No user or environment key is available. Add a key above to refresh live catalogues
                  and use chat.
                </p>
              ) : null}
            </div>
          </SectionCard>

          {notice ? (
            <p className="flex items-start gap-2 rounded-xl border border-mint/25 bg-mint/[0.07] px-3 py-2 text-xs leading-5 text-mint-100">
              <Check size={13} className="mt-0.5 shrink-0" /> {notice}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-rose/30 bg-rose/10 px-3 py-2 text-xs leading-5 text-rose-200">
              {error}
            </p>
          ) : null}

          <div className="rounded-xl border border-violet/20 bg-violet/[0.06] px-3 py-3 text-[0.68rem] leading-5 text-violet-100/80">
            <p className="flex items-center gap-1.5 font-semibold text-violet-200">
              <Sparkles size={12} /> Honest billing
            </p>
            <p className="mt-1">
              A model is labelled free only when the provider reports zero pricing. NVIDIA NIM hosted
              endpoints are marked account-managed, not free. Free credits, trial quotas and
              rate-limited tiers are not the same as free.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
