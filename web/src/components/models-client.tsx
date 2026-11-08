"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { EmptyState, HonestyNote, PageHeader, SectionCard, StatCard } from "@/components/ui";
import { callAgnes, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type {
  CatalogueModel,
  FreeStatus,
  ModelPreferences,
  ProviderCatalogue,
  ProviderId,
} from "@/lib/types";

const providerNames: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  nvidia: "NVIDIA NIM",
};

const PAGE_SIZE = 80;

type ProviderFilter = "all" | ProviderId;
type BillingFilter = "all" | FreeStatus;
type CapabilityFilter = "any" | "tools" | "structured" | "reasoning";

function billingBadge(status: FreeStatus): string {
  if (status === "free") return "badge-mint";
  if (status === "paid") return "badge-rose";
  return "badge-amber";
}

function billingLabel(status: FreeStatus): string {
  if (status === "free") return "verified free";
  if (status === "paid") return "paid";
  return "account-managed";
}

function modelHref(provider: ProviderId, model: string, role: "active" | "fallback"): string {
  return `/providers?provider=${provider}&model=${encodeURIComponent(model)}&role=${role}`;
}

function matchesCapability(model: CatalogueModel, capability: CapabilityFilter): boolean {
  if (capability === "tools") return model.supports_tools;
  if (capability === "structured") return model.supports_structured_output;
  if (capability === "reasoning") return model.supports_reasoning;
  return true;
}

export function ModelsClient({
  initialPreferences,
}: {
  initialPreferences: ModelPreferences | null;
}) {
  const [providers, setProviders] = useState<ProviderCatalogue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");
  const [capability, setCapability] = useState<CapabilityFilter>("any");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadCatalogue = useCallback(async (refresh = false) => {
    setError(null);
    try {
      const result = await callAgnes<{ providers: ProviderCatalogue[]; server_time: string }>(
        "agnes-models",
        { action: refresh ? "refresh" : "list" },
      );
      setProviders(result.providers);
      if (refresh) {
        const keys = result.providers.filter((provider) => provider.has_key).length;
        setNotice(
          keys > 0
            ? "Catalogue refresh requested. Provider errors, if any, are shown under each provider."
            : "No provider keys are configured, so only cached catalogue data is available.",
        );
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void loadCatalogue(false).finally(() => setLoading(false));
  }, [loadCatalogue]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, providerFilter, billingFilter, capability]);

  const totals = useMemo(() => {
    const all = providers.flatMap((provider) => provider.models);
    return {
      models: all.length,
      free: all.filter((model) => model.free_status === "free").length,
      structured: all.filter((model) => model.supports_structured_output).length,
      providersWithKeys: providers.filter((provider) => provider.has_key).length,
      stale: providers.filter((provider) => provider.catalogue.stale).length,
    };
  }, [providers]);

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return providers
      .filter((provider) => providerFilter === "all" || provider.provider === providerFilter)
      .map((provider) => ({
        provider,
        models: provider.models.filter((model) => {
          if (billingFilter !== "all" && model.free_status !== billingFilter) return false;
          if (!matchesCapability(model, capability)) return false;
          if (!needle) return true;
          return `${model.id} ${model.name} ${model.description ?? ""}`
            .toLowerCase()
            .includes(needle);
        }),
      }))
      .filter((group) => group.models.length > 0);
  }, [providers, providerFilter, billingFilter, capability, query]);

  const totalFiltered = filteredGroups.reduce((count, group) => count + group.models.length, 0);

  const visibleGroups = useMemo(() => {
    let budget = visibleCount;
    return filteredGroups.map((group) => {
      const models = group.models.slice(0, Math.max(0, budget));
      budget -= models.length;
      return { provider: group.provider, models, total: group.models.length };
    });
  }, [filteredGroups, visibleCount]);

  async function refreshCatalogue() {
    setRefreshing(true);
    await loadCatalogue(true);
    setRefreshing(false);
  }

  const filtersActive =
    query.trim().length > 0 ||
    providerFilter !== "all" ||
    billingFilter !== "all" ||
    capability !== "any";

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Intelligence"
        title="Model center"
        description="Every model AGNES currently knows about from your configured providers. Free means the provider's catalogue reports it as free; account-managed models are never relabelled."
        action={
          <>
            <button type="button" className="btn" onClick={refreshCatalogue} disabled={refreshing}>
              {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh catalogue
            </button>
            <Link href="/providers" className="btn btn-violet">
              <Sparkles size={14} /> Configure providers
            </Link>
          </>
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl border border-rose/25 bg-rose/[0.08] px-3.5 py-2.5 text-xs leading-5 text-rose-200">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-xl border border-mint/20 bg-mint/[0.06] px-3.5 py-2.5 text-xs leading-5 text-mint/90">
          {notice}
        </p>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Cached models"
          value={loading ? "…" : String(totals.models)}
          hint={`${providers.length} providers queried`}
        />
        <StatCard
          label="Verified free"
          value={loading ? "…" : String(totals.free)}
          hint="Provider-reported free status"
          accent="violet"
        />
        <StatCard
          label="Structured output"
          value={loading ? "…" : String(totals.structured)}
          hint="Suitable for the three-choice contract"
          accent="amber"
        />
        <StatCard
          label="Providers with keys"
          value={loading ? "…" : `${totals.providersWithKeys}/${providers.length || 2}`}
          hint={totals.stale > 0 ? `${totals.stale} stale catalogue(s)` : "Catalogue cache status"}
          accent={totals.providersWithKeys > 0 ? "mint" : "rose"}
        />
      </div>

      <SectionCard
        title="Filter catalogue"
        description="Search by name or ID, then narrow by billing status and capability."
        className="mb-4"
        action={
          filtersActive ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setQuery("");
                setProviderFilter("all");
                setBillingFilter("all");
                setCapability("any");
              }}
            >
              Clear filters
            </button>
          ) : null
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="label" htmlFor="model-search">
              Search
            </label>
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#587088]"
              />
              <input
                id="model-search"
                className="input pl-9"
                placeholder="Model name or ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="provider-filter">
              Provider
            </label>
            <select
              id="provider-filter"
              className="select"
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value as ProviderFilter)}
            >
              <option value="all">All providers</option>
              <option value="openrouter">OpenRouter</option>
              <option value="nvidia">NVIDIA NIM</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="billing-filter">
              Billing
            </label>
            <select
              id="billing-filter"
              className="select"
              value={billingFilter}
              onChange={(event) => setBillingFilter(event.target.value as BillingFilter)}
            >
              <option value="all">Any billing status</option>
              <option value="free">Verified free</option>
              <option value="paid">Paid</option>
              <option value="unknown">Account-managed / unknown</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="capability-filter">
              Capability
            </label>
            <select
              id="capability-filter"
              className="select"
              value={capability}
              onChange={(event) => setCapability(event.target.value as CapabilityFilter)}
            >
              <option value="any">Any capability</option>
              <option value="tools">Tool calling</option>
              <option value="structured">Structured output</option>
              <option value="reasoning">Reasoning</option>
            </select>
          </div>
        </div>
        <p className="mt-3 text-[0.68rem] text-muted">
          {loading
            ? "Loading catalogue…"
            : `${totalFiltered} matching model${totalFiltered === 1 ? "" : "s"} across ${filteredGroups.length} provider${filteredGroups.length === 1 ? "" : "s"}.`}
        </p>
      </SectionCard>

      <HonestyNote>
        Free/paid labels come from the provider catalogue at the last fetch and can change. NVIDIA
        NIM pricing is account-managed, so those models stay blocked until you enable paid models on
        the Providers page. Selecting a model here only prefills the choice; nothing is saved until
        you review and save it there.
      </HonestyNote>

      <div className="mt-5 space-y-4">
        {loading ? (
          <div className="card flex h-40 items-center justify-center text-xs text-muted">
            <Loader2 size={16} className="mr-2 animate-spin" /> Loading model catalogue…
          </div>
        ) : null}

        {!loading && providers.length === 0 ? (
          <EmptyState
            title="No catalogue available"
            description="AGNES could not read any provider catalogue. Check the backend configuration, then try refreshing."
            action={
              <button type="button" className="btn" onClick={refreshCatalogue} disabled={refreshing}>
                <RefreshCw size={14} /> Try again
              </button>
            }
          />
        ) : null}

        {!loading && providers.length > 0 && totalFiltered === 0 ? (
          <EmptyState
            title={filtersActive ? "No models match these filters" : "No models cached yet"}
            description={
              filtersActive
                ? "Widen the filters or clear the search to see the rest of the catalogue."
                : "Add a provider key on the Providers page and refresh the catalogue to populate this list."
            }
            action={
              filtersActive ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuery("");
                    setProviderFilter("all");
                    setBillingFilter("all");
                    setCapability("any");
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <Link href="/providers" className="btn btn-primary">
                  <KeyRound size={14} /> Add a provider key
                </Link>
              )
            }
          />
        ) : null}

        {visibleGroups.map(({ provider, models, total }) => {
          if (models.length === 0) return null;
          return (
            <section key={provider.provider} className="card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-white">
                      {providerNames[provider.provider]}
                    </h2>
                    <span className={`badge ${provider.has_key ? "badge-mint" : "badge-amber"}`}>
                      {provider.has_key
                        ? provider.key_source === "environment"
                          ? "server key"
                          : "key saved"
                        : "no key"}
                    </span>
                    <span
                      className={`badge ${provider.catalogue.stale ? "badge-amber" : "badge-muted"}`}
                    >
                      {provider.catalogue.stale ? "stale cache" : "fresh cache"}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.68rem] text-muted">
                    Showing {models.length} of {total} matching · {provider.models.length} cached ·{" "}
                    {provider.catalogue.fetched_at
                      ? `fetched ${relativeTime(provider.catalogue.fetched_at)}`
                      : "never fetched"}
                  </p>
                </div>
                <Link href="/providers" className="btn btn-sm">
                  <KeyRound size={12} /> Manage key
                </Link>
              </div>

              {provider.provider_error ? (
                <p className="mx-5 mt-3 rounded-lg border border-rose/25 bg-rose/[0.08] px-3 py-2 text-[0.68rem] leading-4 text-rose-200">
                  {provider.provider_error}
                </p>
              ) : null}
              {provider.catalogue.last_error ? (
                <p className="mx-5 mt-3 rounded-lg border border-amber/20 bg-amber/[0.06] px-3 py-2 text-[0.68rem] leading-4 text-amber-100/80">
                  Catalogue: {provider.catalogue.last_error}
                </p>
              ) : null}
              {!provider.has_key ? (
                <p className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[0.68rem] leading-4 text-[#8fa6bd]">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber" />
                  No key is configured for this provider. Cached entries are shown, but live model
                  discovery and chat through this provider are unavailable.
                </p>
              ) : null}

              <ul className="divide-y divide-white/[0.06]">
                {models.map((model) => {
                  const isActive =
                    initialPreferences?.active_provider === provider.provider &&
                    initialPreferences.active_model_id === model.id;
                  const isFallback =
                    initialPreferences?.fallback_provider === provider.provider &&
                    initialPreferences.fallback_model_id === model.id;
                  return (
                    <li
                      key={`${provider.provider}:${model.id}`}
                      className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-white/[0.015] lg:flex-row lg:items-start lg:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{model.name}</p>
                          <span className={`badge ${billingBadge(model.free_status)}`}>
                            {billingLabel(model.free_status)}
                          </span>
                          {isActive ? (
                            <span className="badge badge-mint">
                              <CheckCircle2 size={10} /> active
                            </span>
                          ) : null}
                          {isFallback ? <span className="badge badge-violet">fallback</span> : null}
                        </div>
                        <p className="mono mt-0.5 truncate text-[0.64rem] text-[#587088]" title={model.id}>
                          {model.id}
                        </p>
                        {model.description ? (
                          <p className="mt-1.5 line-clamp-2 max-w-3xl text-[0.72rem] leading-5 text-[#8fa6bd]">
                            {model.description}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {model.context_length ? (
                            <span className="badge badge-muted">
                              {Math.round(model.context_length / 1000)}k context
                            </span>
                          ) : null}
                          {model.max_output_tokens ? (
                            <span className="badge badge-muted">
                              {Math.round(model.max_output_tokens / 1000)}k max out
                            </span>
                          ) : null}
                          {model.supports_tools ? <span className="badge">tools</span> : null}
                          {model.supports_structured_output ? (
                            <span className="badge badge-violet">structured</span>
                          ) : null}
                          {model.supports_reasoning ? <span className="badge">reasoning</span> : null}
                          {model.input_modalities.length > 0 ? (
                            <span className="badge badge-muted">
                              in: {model.input_modalities.join(", ")}
                            </span>
                          ) : null}
                        </div>
                        {model.billing_note ? (
                          <p className="mt-1.5 text-[0.66rem] leading-4 text-[#6f879e]">
                            {model.billing_note}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <Link
                          href={modelHref(provider.provider, model.id, "active")}
                          className="btn btn-sm btn-primary"
                          title={
                            model.free_status === "free"
                              ? "Prefill this model as the active model"
                              : "Prefill as active; you must enable paid models before saving"
                          }
                        >
                          <Sparkles size={11} /> Use as active
                        </Link>
                        <Link
                          href={modelHref(provider.provider, model.id, "fallback")}
                          className="btn btn-sm"
                          title="Prefill this model as the fallback model"
                        >
                          Use as fallback
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {visibleCount < totalFiltered ? (
          <div className="flex justify-center">
            <button
              type="button"
              className="btn"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              <Boxes size={14} /> Show {Math.min(PAGE_SIZE, totalFiltered - visibleCount)} more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
