import type { PageSnapshot } from "./browser";

/** Friction markers from a page's title and opening text (shared by every browser runtime). */
export function frictionOf(title: string, text: string): PageSnapshot["friction"] {
  const head = `${title} ${text.slice(0, 600)}`.toLowerCase();
  const friction: PageSnapshot["friction"] = [];
  if (/verify you are human|captcha|are you a robot|bots use duckduckgo too|complete the following challenge|confirm this search was made by a human|unusual traffic/.test(head)) friction.push("CAPTCHA");
  if (/sign in to continue|log in to continue|please log in|create an account to/.test(head)) friction.push("LOGIN_WALL");
  if (/access denied|forbidden|you have been blocked/.test(head)) friction.push("ACCESS_BLOCK");
  if (/too many requests|rate limit/.test(head)) friction.push("RATE_LIMIT");
  return friction;
}
