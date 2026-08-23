import { ReactNode, useEffect, useState } from "react";
import { Bookmark, ExternalLink, MapPin } from "lucide-react";

export interface EntityCardStat {
  label: string;
  value: string | number;
}

export interface EntityCardProps {
  id: string;
  title: string;
  subtitle?: string;
  category?: string;
  location?: string;
  avatarUrl?: string;
  avatarFallback?: string;
  /** Called when avatarUrl fails to load (caller can re-rank the row). */
  onAvatarError?: () => void;
  stats?: EntityCardStat[];
  tags?: string[];
  description?: string;
  relevantBecause?: string;
  saved?: boolean;
  onSaveToggle?: () => void;
  onViewDetails?: () => void;
  primaryActionLabel?: string;
  primaryActionUrl?: string;
  onClick?: () => void;
  children?: ReactNode;
}

export function EntityCard({
  title,
  subtitle,
  category,
  location,
  avatarUrl,
  avatarFallback,
  onAvatarError,
  stats,
  tags,
  description,
  relevantBecause,
  saved,
  onSaveToggle,
  onViewDetails,
  primaryActionLabel = "View Profile",
  primaryActionUrl,
  onClick,
}: EntityCardProps) {
  const fallback = avatarFallback || (title ? title[0]?.toUpperCase() : "?");

  // A broken avatar URL drops to the initials fallback (and notifies the
  // caller so the row can be re-ranked into the no-image group).
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => setAvatarBroken(false), [avatarUrl]);
  const showAvatar = Boolean(avatarUrl) && !avatarBroken;

  return (
    <div
      onClick={onClick}
      className="liquid-glass rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:bg-white/[0.03] transition-all cursor-pointer group"
    >
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {showAvatar ? (
            <img
              src={avatarUrl}
              alt={title}
              loading="lazy"
              onError={() => {
                setAvatarBroken(true);
                onAvatarError?.();
              }}
              className="size-11 rounded-xl object-cover border border-white/10 shrink-0"
            />
          ) : (
            <div className="size-11 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-white text-sm font-semibold shrink-0">
              {fallback}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm text-white truncate group-hover:text-white/90">
                {title}
              </h3>
              {category && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.08] text-white/70 border border-white/10 shrink-0 font-medium">
                  {category}
                </span>
              )}
            </div>
            {subtitle && <p className="text-xs text-white/50 truncate mt-0.5">{subtitle}</p>}
            {location && (
              <div className="flex items-center gap-1 text-xs text-white/40 mt-1 truncate">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{location}</span>
              </div>
            )}
          </div>
        </div>

        {onSaveToggle && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSaveToggle();
            }}
            className={`p-2 rounded-xl transition-colors shrink-0 ${
              saved
                ? "bg-white/15 text-white border border-white/20"
                : "text-white/40 hover:text-white hover:bg-white/10"
            }`}
          >
            <Bookmark className={`size-4 ${saved ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {/* Description */}
      {description && (
        <p className="text-xs text-white/60 line-clamp-2 leading-relaxed">{description}</p>
      )}

      {/* Stats Mini Columns */}
      {stats && stats.length > 0 && (
        <div className="grid grid-cols-3 gap-2 py-3 border-y border-white/5">
          {stats.map((stat, idx) => (
            <div key={idx} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-white/40 truncate">
                {stat.label}
              </div>
              <div className="text-xs font-semibold text-white/90 truncate mt-0.5">
                {stat.value || "—"}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Focus Tags */}
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {tags.slice(0, 4).map((tag, i) => (
            <span
              key={i}
              className="text-[10px] px-2.5 py-1 rounded-full bg-white/[0.04] text-white/70 border border-white/10 font-normal"
            >
              {tag}
            </span>
          ))}
          {tags.length > 4 && (
            <span className="text-[10px] px-2 py-1 rounded-full bg-white/[0.02] text-white/40 border border-white/5">
              +{tags.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Match metadata explanation */}
      {relevantBecause && (
        <div className="text-[11px] text-white/60 leading-relaxed pt-2 border-t border-white/5 italic">
          {relevantBecause}
        </div>
      )}

      {/* Bottom Action */}
      <div className="pt-2 flex items-center justify-end gap-2">
        {onViewDetails && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails();
            }}
            className="flex-1 glass-pill py-2 px-3 text-xs font-medium text-white/80 hover:text-white flex items-center justify-center gap-1.5"
          >
            <span>Details</span>
          </button>
        )}
        {primaryActionUrl ? (
          <a
            href={primaryActionUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex-1 glass-pill py-2 px-3 text-xs font-medium text-white flex items-center justify-center gap-1.5 hover:bg-white/20"
          >
            <span>{primaryActionLabel}</span>
            <ExternalLink className="size-3" />
          </a>
        ) : !onViewDetails ? (
          <button
            type="button"
            className="w-full glass-pill py-2 px-3 text-xs font-medium text-white/90 flex items-center justify-center gap-1.5 hover:text-white"
          >
            <span>{primaryActionLabel}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
