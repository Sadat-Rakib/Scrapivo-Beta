import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | undefined;
export function getAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.MY_SUPABASE_URL;
  const key = process.env.MY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("[my-supabase admin] MY_SUPABASE_URL or MY_SUPABASE_SERVICE_ROLE_KEY missing");
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
