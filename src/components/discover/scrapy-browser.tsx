/**
 * Scrapy — Scrapivo's visible research browser.
 *
 * Renders the ACTUAL browser session (frames + live state from
 * scrapy-browser.server), never an iframe of the target site. Collapsed: one
 * pill. Expanded: live frame, current page, current action, pages visited.
 *
 * Worker sessions support Take control: the agent pauses, the person clicks,
 * types and scrolls in the same real browser, then gives control back. A
 * finished run's browser stays open (retained) until the person closes it or
 * the worker's retention window ends.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, Globe, Hand, PlayCircle, X } from "lucide-react";
import { getScrapyBrowserState } from "@/lib/spec-search.functions";
import { controlScrapyBrowserFn } from "@/lib/search/scrapy-browser-control.functions";
import { frameCoordinates, SCRAPY_TEXT_MAX, type ScrapyControlCommand } from "@/lib/search/scrapy-browser-control";
import { presentActivityEvent, publicSourceLabel } from "@/lib/search/activity-presenter";

export type ScrapyState = Awaited<ReturnType<typeof getScrapyBrowserState>>;

function domainOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return publicSourceLabel(null, url);
  } catch {
    return "";
  }
}

function elapsed(ms: number | null): string {
  if (ms == null || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Poll cadence: fast while a person drives, slower when idle, stop once closed. */
export function scrapyPollDelay(state: ScrapyState | null): number | null {
  if (!state || !state.status) return 5_000;
  if (state.controller === "human") return 1_000;
  if (state.active) return 1_500;
  if (state.retained) return 4_000;
  return null;
}

const button = "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:opacity-50";

export function ScrapyBrowserView({
  state,
  expanded,
  busy = false,
  error = null,
  onExpand,
  onCollapse,
  onCommand,
}: {
  state: ScrapyState;
  expanded: boolean;
  busy?: boolean;
  error?: string | null;
  onExpand: () => void;
  onCollapse: () => void;
  onCommand: (command: ScrapyControlCommand) => void;
}) {
  const [text, setText] = useState("");
  const domain = domainOf(state.currentUrl);
  const browsing = state.active && state.controller === "agent";
  const human = state.controller === "human";
  const closed = !state.active && !state.retained;
  const title = state.currentTitle ? presentActivityEvent({ action: state.currentTitle }).action : null;
  const label = human
    ? "You're controlling the browser"
    : browsing
      ? "Scrapy is browsing"
      : state.retained
        ? "Scrapy browser kept open"
        : "Scrapy browser session";

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="mt-2 flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40"
      >
        <span className="relative flex size-2 shrink-0">
          {browsing && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />}
          <span className={`relative inline-flex size-2 rounded-full ${human ? "bg-amber-400" : "bg-primary"}`} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {label}
          {domain ? ` · ${domain}` : ""} · {state.pagesVisited} pages · {elapsed(state.elapsedMs)}
        </span>
        <Eye className="size-3.5 shrink-0" aria-hidden="true" />
      </button>
    );
  }

  const onFrameClick = (event: MouseEvent<HTMLButtonElement>) => {
    const image = event.currentTarget.querySelector("img");
    if (!image) return;
    const point = frameCoordinates(event, image.getBoundingClientRect());
    if (point) onCommand({ type: "click", x: point.x, y: point.y });
  };
  const onType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.slice(0, SCRAPY_TEXT_MAX);
    if (!value) return;
    onCommand({ type: "text", text: value });
    setText("");
  };
  const frameClass = "max-h-64 w-full bg-black/60 object-contain sm:max-h-80";

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="relative flex size-2 shrink-0">
          {browsing && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />}
          <span className={`relative inline-flex size-2 rounded-full ${human ? "bg-amber-400" : "bg-primary"}`} />
        </span>
        <span className="text-xs font-medium text-foreground">Scrapy</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{human ? "you're in control" : state.retained && !state.active ? "kept open" : state.status}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{domain || "…"}</span>
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Hide browser"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <EyeOff className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {state.screenshotDataUrl ? (
        human ? (
          <button
            type="button"
            onClick={onFrameClick}
            disabled={busy}
            aria-label="Click this point in the page"
            className="block w-full cursor-crosshair outline-none ring-amber-400 focus-visible:ring-2"
          >
            <img src={state.screenshotDataUrl} alt="Live page in the Scrapy browser" className={frameClass} draggable={false} />
          </button>
        ) : (
          <img src={state.screenshotDataUrl} alt="Scrapy browser session" className={frameClass} loading="lazy" />
        )
      ) : (
        <div className="flex h-32 items-center justify-center bg-black/40 text-xs text-muted-foreground">
          {browsing ? "Opening a page…" : "No page captured"}
        </div>
      )}
      <div className="space-y-1.5 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5" aria-live="polite">
          <span className="text-foreground">
            {human
              ? "You're in control. Scrapy is paused."
              : closed && state.adapter === "worker"
                ? "Browser closed"
                : presentActivityEvent({ action: state.currentAction ?? "Working" }).action}
          </span>
          {title && title !== "Working" ? <span className="truncate">· {title}</span> : null}
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
              Open original <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {human && (
          <div className="space-y-1.5">
            <form onSubmit={onType} className="flex items-center gap-1.5">
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={SCRAPY_TEXT_MAX}
                aria-label="Type into the page"
                placeholder="Type into the focused field"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
              />
              <button type="submit" disabled={busy || !text} className={button}>Type</button>
            </form>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "key", key: "Enter" })} className={button}>Enter</button>
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "key", key: "Backspace" })} className={button}>Backspace</button>
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "key", key: "Tab" })} className={button}>Tab</button>
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "scroll", deltaY: -600 })} aria-label="Scroll up" className={button}>
                <ArrowUp className="size-3" aria-hidden="true" />
              </button>
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "scroll", deltaY: 600 })} aria-label="Scroll down" className={button}>
                <ArrowDown className="size-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        {state.canControl ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {human ? (
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "release" })} className={button}>
                <PlayCircle className="size-3" aria-hidden="true" /> {state.active ? "Give control back" : "Stop controlling"}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "take" })} className={button}>
                <Hand className="size-3" aria-hidden="true" /> Take control
              </button>
            )}
            {state.retained && !state.active && (
              <button type="button" disabled={busy} onClick={() => onCommand({ type: "close" })} className={button}>
                <X className="size-3" aria-hidden="true" /> Close browser
              </button>
            )}
          </div>
        ) : state.adapter && state.adapter !== "worker" ? (
          <div className="text-[11px]">Viewing only. Taking control needs the browser worker.</div>
        ) : null}
        {error ? (
          <div role="alert" className="text-[11px] text-destructive">{error}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ScrapyBrowser({ runId }: { runId: string | null }) {
  const [state, setState] = useState<ScrapyState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    setError(null);
    if (!runId) {
      setState(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (timer) clearTimeout(timer);
      try {
        const next = await getScrapyBrowserState({ data: { search_run_id: runId } });
        if (stopped) return;
        setState(next);
        const delay = scrapyPollDelay(next);
        if (delay != null) timer = setTimeout(poll, delay);
      } catch {
        if (!stopped) timer = setTimeout(poll, 2_500);
      }
    };
    pollNow.current = () => void poll();
    void poll();
    return () => {
      stopped = true;
      pollNow.current = null;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  const onCommand = useCallback(
    async (command: ScrapyControlCommand) => {
      if (!runId) return;
      setBusy(true);
      setError(null);
      try {
        const result = await controlScrapyBrowserFn({ data: { search_run_id: runId, command } });
        if (!result.ok) setError(result.message);
      } catch {
        setError("The browser action could not be completed.");
      } finally {
        setBusy(false);
        pollNow.current?.();
      }
    },
    [runId],
  );

  // A session can exist before its first navigation; show that state so the
  // research surface does not disappear while the browser is starting.
  if (!runId || !state || !state.status) return null;
  return (
    <ScrapyBrowserView
      state={state}
      expanded={expanded}
      busy={busy}
      error={error}
      onExpand={() => setExpanded(true)}
      onCollapse={() => setExpanded(false)}
      onCommand={(command) => void onCommand(command)}
    />
  );
}
