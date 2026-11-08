// Shared environment access. No secrets are ever returned to clients.
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function supabaseUrl(): string {
  return requireEnv("SUPABASE_URL").replace(/\/$/, "");
}

export function serviceRoleKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_KEY") ??
    "";
}

export function anonKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    "";
}

export function providerFallbackKey(provider: "openrouter" | "nvidia"): string | null {
  if (provider === "openrouter") {
    return Deno.env.get("OPENROUTER_API_KEY") || null;
  }
  return Deno.env.get("NVIDIA_API_KEY") || null;
}

export function allowedOrigins(): string[] {
  return (Deno.env.get("AGNES_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function isProduction(): boolean {
  return (Deno.env.get("AGNES_ENV") ?? "production") === "production";
}
