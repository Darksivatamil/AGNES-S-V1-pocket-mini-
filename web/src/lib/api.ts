import { supabaseBrowser } from "@/lib/supabase/client";
import { functionsUrl } from "@/lib/config";

export type ApiErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiErrorShape };

export class AgnesApiError extends Error {
  code: string;
  details?: unknown;
  status: number;

  constructor(error: ApiErrorShape, status: number) {
    super(error.message);
    this.name = "AgnesApiError";
    this.code = error.code;
    this.details = error.details;
    this.status = status;
  }
}

/** Call an AGNES Edge Function with the signed-in user's JWT. */
export async function callAgnes<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const supabase = supabaseBrowser();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new AgnesApiError({ code: "signed_out", message: "Your session expired. Sign in again." }, 401);
  }

  const response = await fetch(`${functionsUrl}/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    payload = null;
  }

  if (!payload) {
    throw new AgnesApiError(
      { code: "bad_response", message: `The server returned an unreadable response (${response.status}).` },
      response.status,
    );
  }

  if (!response.ok || !payload.ok) {
    const error = payload.ok
      ? { code: "request_failed", message: `Request failed (${response.status}).` }
      : payload.error;
    throw new AgnesApiError(error, response.status);
  }

  return payload.data;
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  throw new Error("This browser does not support crypto.randomUUID.");
}

export function errorMessage(error: unknown): string {
  if (error instanceof AgnesApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
