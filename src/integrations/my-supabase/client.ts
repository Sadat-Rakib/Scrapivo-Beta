import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_MY_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_MY_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!URL || !KEY) {
  // eslint-disable-next-line no-console
  console.error("[my-supabase] Missing VITE_MY_SUPABASE_URL / VITE_MY_SUPABASE_PUBLISHABLE_KEY");
}

let _client: SupabaseClient | undefined;
function get(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(URL ?? "https://invalid.invalid", KEY ?? "invalid", {
    auth: {
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

export const mySupabase = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    return Reflect.get(get(), prop, receiver);
  },
});
