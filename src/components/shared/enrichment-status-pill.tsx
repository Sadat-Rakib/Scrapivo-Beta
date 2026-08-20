/**
 * Scrapivo — Enrichment Status Pill
 *
 * Visual indicator for background enrichment jobs (RapidAPI, EmailSleuth).
 * Displays Queued, Running, Completed, Partially Completed, or Failed states
 * with progress animations and retry actions.
 */

import { CheckCircle2, CircleDashed, Loader2, AlertCircle, RefreshCw, AlertTriangle } from "lucide-react";
import type { SearchRunStatus } from "@/lib/intelligence/domain/types";

interface EnrichmentStatusPillProps {
  status: SearchRunStatus;
  progress?: number; // 0-100
  label?: string;
  onRetry?: () => void;
}

export function EnrichmentStatusPill({ status, progress, label, onRetry }: EnrichmentStatusPillProps) {
  if (status === "queued") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-medium text-white/50">
        <CircleDashed className="size-3" />
        <span>{label || "Queued"}</span>
      </div>
    );
  }

  if (status === "running") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-[10px] font-medium text-blue-400">
        <Loader2 className="size-3 animate-spin" />
        <span className="flex items-center gap-1">
          {label || "Enriching"}
          {progress !== undefined && <span>{progress}%</span>}
        </span>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-medium text-emerald-400">
        <CheckCircle2 className="size-3" />
        <span>{label || "Enriched"}</span>
      </div>
    );
  }

  if (status === "partially_completed") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-medium text-amber-400">
        <AlertTriangle className="size-3" />
        <span>{label || "Partial Data"}</span>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[10px] font-medium text-red-400">
        <AlertCircle className="size-3" />
        <span>{label || "Failed"}</span>
        {onRetry && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="ml-1 p-0.5 rounded-sm hover:bg-red-500/20 transition-colors"
            title="Retry"
          >
            <RefreshCw className="size-3" />
          </button>
        )}
      </div>
    );
  }

  return null;
}
