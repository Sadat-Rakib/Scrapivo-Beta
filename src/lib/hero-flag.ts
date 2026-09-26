/**
 * Hero-takeover kill-switch (Memory + Watches interactive heroes).
 *
 * `VITE_HERO_TAKEOVER_ENABLED=false` forces the legacy panels everywhere —
 * instant global rollback without touching code. Any other value (including
 * unset) keeps the new heroes. The per-page `?legacy=1` query param works
 * independently of this flag (either one forces legacy).
 */
export function isHeroTakeoverEnabled(): boolean {
  try {
    const raw = import.meta.env?.VITE_HERO_TAKEOVER_ENABLED;
    if (typeof raw === "string" && raw.trim().toLowerCase() === "false") return false;
  } catch {
    // Non-Vite runtime — safest is legacy behavior.
    return false;
  }
  return true;
}
