import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serviceRoleKey, supabaseUrl } from "./env.ts";

let cached: SupabaseClient | null = null;

/** Service-role client. Only use after authenticating the caller. */
export function admin(): SupabaseClient {
  if (!cached) {
    const key = serviceRoleKey();
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    cached = createClient(supabaseUrl(), key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { "X-Client-Info": "agnes-edge/2.0" } },
    });
  }
  return cached;
}
