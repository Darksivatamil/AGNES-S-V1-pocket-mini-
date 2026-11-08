export type ProviderId = "openrouter" | "nvidia";

export type CatalogueModel = {
  id: string;
  name: string;
  provider: ProviderId;
  freeStatus: "free" | "paid" | "unknown";
  billingNote: string;
  contextLength: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
  description: string;
  raw: Record<string, unknown>;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  jsonMode: boolean;
};

export type ChatResult = {
  provider: ProviderId;
  model: string;
  content: string;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
  };
  finishReason: string | null;
};

export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "model_unavailable"
  | "invalid_request"
  | "server"
  | "unknown";

export class ProviderError extends Error {
  provider: ProviderId;
  kind: ProviderErrorKind;
  status: number | null;
  retryable: boolean;
  retryAfterMs: number | null;

  constructor(
    provider: ProviderId,
    kind: ProviderErrorKind,
    message: string,
    options: { status?: number | null; retryable?: boolean; retryAfterMs?: number | null } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export type ProviderAdapter = {
  id: ProviderId;
  listModels(apiKey: string, timeoutMs?: number): Promise<CatalogueModel[]>;
  chat(options: ChatOptions): Promise<ChatResult>;
  healthCheck(apiKey: string, timeoutMs?: number): Promise<{ ok: boolean; detail: string }>;
};

export function asNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function isZeroPrice(value: unknown): boolean {
  const n = asNumber(value, null);
  return n !== null && n === 0;
}

export function safeModelId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!/^[A-Za-z0-9._:/@+-]{1,200}$/.test(trimmed)) return null;
  return trimmed;
}

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

export async function fetchJson(
  provider: ProviderId,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ProviderError(provider, "timeout", "Provider request timed out", { retryable: true });
    }
    throw new ProviderError(provider, "network", "Provider network request failed", { retryable: true });
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body, headers: response.headers };
}

export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), 15_000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 15_000);
  return null;
}

export function providerErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "Provider returned an error";
  const object = body as Record<string, unknown>;
  if (typeof object.message === "string") return object.message.slice(0, 300);
  if (object.error) {
    if (typeof object.error === "string") return object.error.slice(0, 300);
    if (typeof object.error === "object" && object.error !== null) {
      const message = (object.error as Record<string, unknown>).message;
      if (typeof message === "string") return message.slice(0, 300);
    }
  }
  return "Provider returned an error";
}

export function mapHttpError(
  provider: ProviderId,
  status: number,
  body: unknown,
  headers?: Headers,
): ProviderError {
  const message = providerErrorMessage(body);
  const retryAfterMs = headers ? parseRetryAfter(headers) : null;
  if (status === 401 || status === 403) {
    return new ProviderError(provider, "auth", "Provider rejected the API key", { status });
  }
  if (status === 429) {
    return new ProviderError(provider, "rate_limit", message, { status, retryable: true, retryAfterMs });
  }
  if (status === 400 || status === 422) {
    return new ProviderError(provider, "invalid_request", message, { status });
  }
  if (status === 404) {
    return new ProviderError(provider, "model_unavailable", message, { status, retryable: true });
  }
  if (status >= 500) {
    return new ProviderError(provider, "server", message, { status, retryable: true, retryAfterMs });
  }
  return new ProviderError(provider, "unknown", message, { status });
}
