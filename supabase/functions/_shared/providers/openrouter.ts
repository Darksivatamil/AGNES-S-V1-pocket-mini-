import {
  asNumber,
  type CatalogueModel,
  type ChatOptions,
  type ChatResult,
  extractTextContent,
  fetchJson,
  isZeroPrice,
  mapHttpError,
  ProviderError,
  providerErrorMessage,
  safeModelId,
  type ProviderAdapter,
} from "./types.ts";

const BASE = "https://openrouter.ai/api/v1";

function headers(apiKey: string): Record<string, string> {
  const result: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "AGNES OS 2.0",
  };
  const appUrl = Deno.env.get("AGNES_APP_URL");
  if (appUrl) result["HTTP-Referer"] = appUrl;
  return result;
}

function modelFromRaw(raw: unknown): CatalogueModel | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = safeModelId(item.id);
  if (!id) return null;

  const architecture = (item.architecture && typeof item.architecture === "object")
    ? item.architecture as Record<string, unknown>
    : {};
  const pricing = (item.pricing && typeof item.pricing === "object")
    ? item.pricing as Record<string, unknown>
    : {};
  const topProvider = (item.top_provider && typeof item.top_provider === "object")
    ? item.top_provider as Record<string, unknown>
    : {};
  const supportedParameters = Array.isArray(item.supported_parameters)
    ? item.supported_parameters.filter((value): value is string => typeof value === "string")
    : [];

  const promptFree = isZeroPrice(pricing.prompt);
  const completionFree = isZeroPrice(pricing.completion);
  const requestFree = pricing.request === undefined || isZeroPrice(pricing.request);
  const free = id.endsWith(":free") || id === "openrouter/free" ||
    (promptFree && completionFree && requestFree);

  const inputModalities = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities.filter((value): value is string => typeof value === "string")
    : ["text"];
  const outputModalities = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities.filter((value): value is string => typeof value === "string")
    : ["text"];

  return {
    id,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 200) : id,
    provider: "openrouter",
    freeStatus: free ? "free" : "paid",
    billingNote: free
      ? "Zero-priced or :free per the live OpenRouter catalogue."
      : "Paid per the live OpenRouter catalogue. Requires explicit paid-usage opt-in.",
    contextLength: asNumber(item.context_length) ?? asNumber(topProvider.context_length),
    maxOutputTokens: asNumber(topProvider.max_completion_tokens),
    inputModalities: inputModalities.slice(0, 8),
    outputModalities: outputModalities.slice(0, 8),
    supportsTools: supportedParameters.includes("tools") ||
      supportedParameters.includes("tool_choice"),
    supportsStructuredOutput: supportedParameters.includes("response_format") ||
      supportedParameters.includes("structured_outputs"),
    supportsReasoning: supportedParameters.includes("reasoning") ||
      supportedParameters.includes("include_reasoning"),
    description: typeof item.description === "string" ? item.description.slice(0, 600) : "",
    raw: item,
  };
}

export const openRouterAdapter: ProviderAdapter = {
  id: "openrouter",

  async listModels(apiKey, timeoutMs = 20_000) {
    const { status, body } = await fetchJson(
      "openrouter",
      `${BASE}/models`,
      { method: "GET", headers: headers(apiKey) },
      timeoutMs,
    );
    if (status < 200 || status >= 300) throw mapHttpError("openrouter", status, body);
    const data = body && typeof body === "object" ? (body as Record<string, unknown>).data : null;
    if (!Array.isArray(data)) {
      throw new ProviderError("openrouter", "server", "OpenRouter returned an invalid model catalogue");
    }
    return data.map(modelFromRaw).filter((model): model is CatalogueModel => model !== null);
  },

  async chat(options: ChatOptions): Promise<ChatResult> {
    if (!safeModelId(options.model)) {
      throw new ProviderError("openrouter", "invalid_request", "Invalid model ID");
    }
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false,
    };
    if (options.jsonMode) body.response_format = { type: "json_object" };

    const { status, body: responseBody, headers: responseHeaders } = await fetchJson(
      "openrouter",
      `${BASE}/chat/completions`,
      { method: "POST", headers: headers(options.apiKey), body: JSON.stringify(body) },
      options.timeoutMs,
    );
    if (status < 200 || status >= 300) {
      throw mapHttpError("openrouter", status, responseBody, responseHeaders);
    }
    if (!responseBody || typeof responseBody !== "object") {
      throw new ProviderError("openrouter", "server", "OpenRouter returned an empty response");
    }
    const parsed = responseBody as Record<string, unknown>;
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first && typeof first.message === "object"
      ? first.message as Record<string, unknown>
      : {};
    const content = extractTextContent(message.content);
    if (!content.trim()) {
      throw new ProviderError("openrouter", "unknown", "OpenRouter returned no text content");
    }
    const usage = parsed.usage && typeof parsed.usage === "object"
      ? parsed.usage as Record<string, unknown>
      : {};
    return {
      provider: "openrouter",
      model: typeof parsed.model === "string" ? parsed.model.slice(0, 200) : options.model,
      content,
      usage: {
        promptTokens: asNumber(usage.prompt_tokens),
        completionTokens: asNumber(usage.completion_tokens),
        totalTokens: asNumber(usage.total_tokens),
        costUsd: asNumber(usage.total_cost ?? usage.cost),
      },
      finishReason: typeof first?.finish_reason === "string" ? first.finish_reason : null,
    };
  },

  async healthCheck(apiKey, timeoutMs = 12_000) {
    const { status, body } = await fetchJson(
      "openrouter",
      `${BASE}/key`,
      { method: "GET", headers: headers(apiKey) },
      timeoutMs,
    );
    if (status >= 200 && status < 300) {
      return { ok: true, detail: "OpenRouter key accepted" };
    }
    return { ok: false, detail: providerErrorMessage(body).slice(0, 300) };
  },
};
