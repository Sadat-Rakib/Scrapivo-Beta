import { ReactNode } from "react";
import { MoreHorizontal, ExternalLink, Bookmark } from "lucide-react";

export interface ColumnDef<T> {
  header: string;
  accessor: (row: T) => ReactNode;
  className?: string;
}

export interface EntityTableProps<T> {
  rows: T[];
  keyExtractor: (row: T) => string;
  columns: ColumnDef<T>[];
  onRowClick?: (row: T) => void;
  onBookmark?: (row: T) => void;
  isBookmarked?: (row: T) => boolean;
  emptyMessage?: string;
}

export function EntityTable<T>({
  rows,
  keyExtractor,
  columns,
  onRowClick,
  onBookmark,
  isBookmarked,
  emptyMessage = "No records found.",
}: EntityTableProps<T>) {
  if (!rows || rows.length === 0) {
    return (
      <div className="liquid-glass rounded-2xl p-12 text-center text-sm text-white/50">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="liquid-glass rounded-2xl overflow-hidden min-w-0 w-full">
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-left text-xs border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-white/10 text-white/40 font-medium uppercase tracking-wider text-[10px]">
              {onBookmark && <th className="py-3 px-4 w-10 shrink-0"></th>}
              {columns.map((col, idx) => (
                <th key={idx} className={`py-3 px-4 min-w-0 ${col.className || ""}`}>
                  {col.header}
                </th>
              ))}
              <th className="py-3 px-4 w-10 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row) => {
              const key = keyExtractor(row);
              const bookmarked = isBookmarked ? isBookmarked(row) : false;

              return (
                <tr
                  key={key}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={`group hover:bg-white/[0.04] transition-colors cursor-pointer text-white/80`}
                >
                  {onBookmark && (
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onBookmark(row);
                        }}
                        className={`p-1 rounded-md transition-colors ${
                          bookmarked
                            ? "text-white bg-white/10"
                            : "text-white/30 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        <Bookmark className={`size-3.5 ${bookmarked ? "fill-current" : ""}`} />
                      </button>
                    </td>
                  )}

                  {columns.map((col, idx) => (
                    <td key={idx} className={`py-3.5 px-4 ${col.className || ""}`}>
                      {col.accessor(row)}
                    </td>
                  ))}

                  <td className="py-3.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onRowClick) onRowClick(row);
                      }}
                      className="p-1 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
