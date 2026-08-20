/**
 * Scrapivo Global Search State Store
 * Persists search results, active queries, and filter parameters across route navigation.
 */

export interface SearchState<T = any> {
  query: string;
  filters: Record<string, any>;
  results: T[];
  timestamp: number;
}

const STORAGE_PREFIX = "scrapivo:search_store:";

export function saveRouteSearchState<T>(routeKey: string, state: SearchState<T>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${routeKey}`, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to persist search state to sessionStorage", e);
  }
}

export function loadRouteSearchState<T>(routeKey: string): SearchState<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${routeKey}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearRouteSearchState(routeKey: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(`${STORAGE_PREFIX}${routeKey}`);
}
