import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Progressive rendering for large result sets.
 *
 * Instead of mounting hundreds/thousands of cards at once (which freezes
 * scrolling and typing), render a first page and grow the visible window
 * as the user approaches the bottom (see LoadMoreSentinel).
 */
export function useProgressiveCount<T>(items: T[], step = 24) {
  const [count, setCount] = useState(step);

  // Reset the window whenever the dataset itself changes (new search).
  useEffect(() => {
    setCount(step);
  }, [items, step]);

  const visible = useMemo(() => items.slice(0, count), [items, count]);
  const hasMore = count < items.length;

  const loadMore = useCallback(() => {
    setCount((c) => Math.min(c + step * 2, items.length));
  }, [items.length, step]);

  return { visible, hasMore, loadMore, shown: visible.length, total: items.length };
}
