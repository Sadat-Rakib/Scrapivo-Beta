import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

export const requireMyAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const url = process.env.MY_SUPABASE_URL;
  const anon = process.env.MY_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("MY_SUPABASE_URL / PUBLISHABLE_KEY missing");

  const req = getRequest();
  const auth = req?.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = auth.slice(7);

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");

  return next({ context: { supabase, userId: data.user.id, user: data.user } });
});
