import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Sentinel placed under a progressively-rendered list. When it scrolls into
 * view (with a generous rootMargin so loading feels instant), the next page
 * is appended. A manual button remains as a fallback.
 */
export function LoadMoreSentinel({
  hasMore,
  onLoadMore,
  shown,
  total,
}: {
  hasMore: boolean;
  onLoadMore: () => void;
  shown: number;
  total: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!hasMore || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  if (!hasMore) return null;

  return (
    <div ref={ref} className="pt-4 flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onLoadMore}
        className="glass-pill px-5 py-2 text-xs font-medium text-white/80 hover:text-white flex items-center gap-1.5"
      >
        <ChevronDown className="size-3.5" />
        <span>
          Load more ({shown}/{total})
        </span>
      </button>
    </div>
  );
}
