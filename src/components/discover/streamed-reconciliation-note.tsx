/**
 * Streamed-vs-final reconciliation. Leads appear live ("verified while
 * researching") before the final checks run; any that the final list does not
 * include are named here with the reason instead of silently disappearing.
 */
export function StreamedReconciliationNote({ items }: { items: Array<{ key: string; title: string; label: string }> }) {
  if (!items.length) return null;
  const shown = items.slice(0, 5);
  return (
    <div role="status" className="mt-2 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      <div className="text-foreground">
        {items.length === 1
          ? "1 lead seen while researching isn't in this list"
          : `${items.length} leads seen while researching aren't in this list`}
      </div>
      <ul className="mt-1 space-y-0.5">
        {shown.map((item) => (
          <li key={item.key} className="truncate">
            {item.title} · {item.label}
          </li>
        ))}
        {items.length > shown.length && <li>and {items.length - shown.length} more</li>}
      </ul>
    </div>
  );
}
