import { createMiddleware } from "@tanstack/react-start";
import { mySupabase } from "./client";

export const attachMyAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  let token: string | undefined;
  try {
    const { data } = await mySupabase.auth.getSession();
    token = data.session?.access_token;
  } catch {
    // ignore
  }
  return next({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
