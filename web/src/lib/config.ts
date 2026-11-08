const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

export const functionsUrl = (
  process.env.NEXT_PUBLIC_AGNES_FUNCTIONS_URL ?? (supabaseUrl ? `${supabaseUrl}/functions/v1` : "")
).replace(/\/+$/, "");

export const supabaseConfig = {
  url: supabaseUrl,
  anonKey,
  configured: Boolean(supabaseUrl && anonKey),
  functionsUrl,
};

export function assertSupabaseConfigured(): void {
  if (!supabaseConfig.configured) {
    throw new Error(
      "Supabase is not configured. Copy web/.env.example to web/.env.local and fill in your project URL and anon key.",
    );
  }
}
