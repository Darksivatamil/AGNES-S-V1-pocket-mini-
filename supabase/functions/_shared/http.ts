import { z } from "npm:zod@3.23.8";
import { allowedOrigins, isProduction } from "./env.ts";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowed = allowedOrigins();
  // Fail closed in production when no allowlist is configured. Local development
  // may omit the list and receive a permissive response.
  const allowOrigin = allowed.includes(origin)
    ? origin
    : allowed.length === 0 && !isProduction()
      ? (origin || "*")
      : "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-agnes-device-id, x-agnes-device-token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

export function optionsResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function ok(req: Request, data: unknown, status = 200): Response {
  return jsonResponse(req, { ok: true, data }, status);
}

export function fail(req: Request, error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(req, {
      ok: false,
      error: { code: error.code, message: error.message, details: error.details ?? null },
    }, error.status);
  }
  if (error instanceof z.ZodError) {
    const issues = error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return jsonResponse(req, {
      ok: false,
      error: { code: "invalid_request", message: "Request validation failed", details: issues },
    }, 400);
  }
  console.error("Unhandled function error", error instanceof Error ? error.name : "unknown");
  return jsonResponse(req, {
    ok: false,
    error: { code: "internal_error", message: "Internal server error" },
  }, 500);
}

export async function parseJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError("unsupported_media_type", "Content-Type must be application/json", 415);
  }
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > 64 * 1024) {
    throw new ApiError("payload_too_large", "Request body is too large", 413);
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("invalid_json", "Request body is not valid JSON", 400);
  }
  return schema.parse(raw);
}

export function requirePost(req: Request): void {
  if (req.method !== "POST") {
    throw new ApiError("method_not_allowed", "Use POST", 405);
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
}
