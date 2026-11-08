import {
  asNumber,
  type CatalogueModel,
  type ChatOptions,
  type ChatResult,
  extractTextContent,
  fetchJson,
  mapHttpError,
  ProviderError,
  providerErrorMessage,
  safeModelId,
  type ProviderAdapter,
} from "./types.ts";

const BASE = "https://integrate.api.nvidia.com/v1";

function headers(apiKey: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

function modelFromRaw(raw: unknown): CatalogueModel | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = safeModelId(item.id);
  if (!id) return null;
  return {
    id,
    name: id,
    provider: "nvidia",
    // NVIDIA's hosted /v1/models endpoint does not expose pricing. Do not
    // pretend these are free, and do not call downloadable NGC models hosted.
    freeStatus: "unknown",
    billingNote:
      "Hosted NIM endpoint. Pricing/entitlement is account-managed and is not exposed by this API; account/paid usage must be enabled explicitly. Downloadable NGC models are not hosted inference endpoints.",
    contextLength: asNumber(item.context_length),
    maxOutputTokens: asNumber(item.max_tokens),
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsTools: false,
    supportsStructuredOutput: false,
    supportsReasoning: /reason|think|r1/i.test(id),
    description: typeof item.description === "string" ? item.description.slice(0, 600) : "",
    raw: item,
  };
}

export const nvidiaAdapter: ProviderAdapter = {
  id: "nvidia",

  async listModels(apiKey, timeoutMs = 20_000) {
    const { status, body } = await fetchJson(
      "nvidia",
      `${BASE}/models`,
      { method: "GET", headers: headers(apiKey) },
      timeoutMs,
    );
    if (status < 200 || status >= 300) throw mapHttpError("nvidia", status, body);
    const data = body && typeof body === "object" ? (body as Record<string, unknown>).data : null;
    if (!Array.isArray(data)) {
      throw new ProviderError("nvidia", "server", "NVIDIA NIM returned an invalid model catalogue");
    }
    return data.map(modelFromRaw).filter((model): model is CatalogueModel => model !== null);
  },

  async chat(options: ChatOptions): Promise<ChatResult> {
    if (!safeModelId(options.model)) {
      throw new ProviderError("nvidia", "invalid_request", "Invalid model ID");
    }
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false,
    };
    // Only set response_format if the caller explicitly knows the endpoint
    // supports it. NVIDIA endpoints vary.
    if (options.jsonMode) body.response_format = { type: "json_object" };

    const { status, body: responseBody, headers: responseHeaders } = await fetchJson(
      "nvidia",
      `${BASE}/chat/completions`,
      { method: "POST", headers: headers(options.apiKey), body: JSON.stringify(body) },
      options.timeoutMs,
    );
    if (status < 200 || status >= 300) {
      throw mapHttpError("nvidia", status, responseBody, responseHeaders);
    }
    if (!responseBody || typeof responseBody !== "object") {
      throw new ProviderError("nvidia", "server", "NVIDIA NIM returned an empty response");
    }
    const parsed = responseBody as Record<string, unknown>;
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first && typeof first.message === "object"
      ? first.message as Record<string, unknown>
      : {};
    const content = extractTextContent(message.content);
    if (!content.trim()) {
      throw new ProviderError("nvidia", "unknown", "NVIDIA NIM returned no text content");
    }
    const usage = parsed.usage && typeof parsed.usage === "object"
      ? parsed.usage as Record<string, unknown>
      : {};
    return {
      provider: "nvidia",
      model: typeof parsed.model === "string" ? parsed.model.slice(0, 200) : options.model,
      content,
      usage: {
        promptTokens: asNumber(usage.prompt_tokens),
        completionTokens: asNumber(usage.completion_tokens),
        totalTokens: asNumber(usage.total_tokens),
        costUsd: null,
      },
      finishReason: typeof first?.finish_reason === "string" ? first.finish_reason : null,
    };
  },

  async healthCheck(apiKey, timeoutMs = 12_000) {
    const { status, body } = await fetchJson(
      "nvidia",
      `${BASE}/models`,
      { method: "GET", headers: headers(apiKey) },
      timeoutMs,
    );
    if (status >= 200 && status < 300) {
      return { ok: true, detail: "NVIDIA NIM key accepted; catalogue reachable" };
    }
    return { ok: false, detail: providerErrorMessage(body).slice(0, 300) };
  },
};
