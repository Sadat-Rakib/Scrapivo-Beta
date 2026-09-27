/**
 * Scrapy — Scrapivo's visible research browser.
 *
 * Renders the ACTUAL persistent Chromium session (screenshots + live state
 * from scrapy-browser.server), never an iframe of the target site. Collapsed:
 * one pill while Scrapy works. Expanded: live screenshot, current page,
 * current action, pages visited, elapsed time.
 *
 * Take Control intentionally ships behind a flag (protocol ready: sessions
 * are stateful and actions serializable) — not enabled in this pass.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, EyeOff, Globe, PauseCircle } from "lucide-react";
import { getScrapyBrowserState } from "@/lib/spec-search.functions";

type ScrapyState = Awaited<ReturnType<typeof getScrapyBrowserState>>;

function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function elapsed(ms: number | null): string {
  if (ms == null || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function ScrapyBrowser({ runId }: { runId: string | null }) {
  const [state, setState] = useState<ScrapyState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const cursor = useRef(0);

  useEffect(() => {
    if (!runId) {
      setState(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getScrapyBrowserState({ data: { search_run_id: runId } });
        if (stopped) return;
        setState(next);
        timer = setTimeout(poll, next?.active ? 1_500 : 5_000);
      } catch {
        if (!stopped) timer = setTimeout(poll, 2_500);
      }
    };
    cursor.current += 1;
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  if (!runId || !state || state.pagesVisited === 0) return null;
  const domain = domainOf(state.currentUrl);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40"
      >
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          Scrapy is browsing{domain ? ` · ${domain}` : ""} · {state.pagesVisited} pages · {elapsed(state.elapsedMs)}
        </span>
        <Eye className="size-3.5 shrink-0" />
      </button>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <span className="text-xs font-medium text-foreground">Scrapy</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {state.status}
        </span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="size-3 shrink-0" />
          <span className="truncate">{domain || "…"}</span>
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Hide browser"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <EyeOff className="size-3.5" />
        </button>
      </div>
      {state.screenshotDataUrl ? (
        <img
          src={state.screenshotDataUrl}
          alt="Scrapy browser session"
          className="max-h-64 w-full bg-black/60 object-contain sm:max-h-80"
          loading="lazy"
        />
      ) : (
        <div className="flex h-32 items-center justify-center bg-black/40 text-xs text-muted-foreground">
          Capturing page…
        </div>
      )}
      <div className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground">{state.currentAction ?? "Working"}</span>
          {state.currentTitle ? <span className="truncate">· {state.currentTitle}</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <span>{state.pagesVisited} pages</span>
          <span>{state.actionCount} actions</span>
          <span>{elapsed(state.elapsedMs)}</span>
          {state.currentUrl ? (
            <a
              href={state.currentUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open original <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
        <button
          type="button"
          disabled
          title="Take Control ships next"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground opacity-50"
        >
          <PauseCircle className="size-3" /> Take control (coming next)
        </button>
      </div>
    </div>
  );
}
