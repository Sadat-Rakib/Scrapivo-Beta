/**
 * Shared (client + server) contract for taking control of the visible research
 * browser. Pure: no server imports, safe in the browser bundle.
 */

/** The worker renders every session at this fixed viewport. */
export const SCRAPY_VIEWPORT = { width: 1280, height: 800 } as const;

/** Keys a person may press while in control (subset of the worker allowlist). */
export const SCRAPY_KEYS = ["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "PageUp", "PageDown"] as const;
export type ScrapyKey = (typeof SCRAPY_KEYS)[number];

export const SCRAPY_TEXT_MAX = 500;
export const SCRAPY_SCROLL_MAX = 2_000;

export type ScrapyControlCommand =
  | { type: "take" }
  | { type: "release" }
  | { type: "close" }
  | { type: "click"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: ScrapyKey }
  | { type: "scroll"; deltaY: number };

export type ScrapyControlErrorCode = "NOT_FOUND" | "UNSUPPORTED" | "NOT_IN_CONTROL" | "BUSY" | "WORKER_UNAVAILABLE" | "INVALID_INPUT" | "FAILED";

export type ScrapyControlResult =
  | { ok: true; controller: "agent" | "human"; retained: boolean; closed: boolean }
  | { ok: false; code: ScrapyControlErrorCode; message: string };

/**
 * Map a pointer position on the displayed frame to viewport pixels. The frame
 * is drawn with `object-contain`, so letterbox bars are excluded: a click on a
 * bar maps to nothing (null) instead of the nearest page edge.
 */
export function frameCoordinates(
  point: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number } = SCRAPY_VIEWPORT,
): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / viewport.width, box.height / viewport.height);
  const drawnWidth = viewport.width * scale;
  const drawnHeight = viewport.height * scale;
  const offsetX = (box.width - drawnWidth) / 2;
  const offsetY = (box.height - drawnHeight) / 2;
  const x = (point.clientX - box.left - offsetX) / scale;
  const y = (point.clientY - box.top - offsetY) / scale;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}
