import { createBrowserClient } from "@supabase/ssr";
import { assertSupabaseConfigured, supabaseConfig } from "@/lib/config";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  assertSupabaseConfigured();
  if (!client) {
    client = createBrowserClient(supabaseConfig.url, supabaseConfig.anonKey);
  }
  return client;
}
