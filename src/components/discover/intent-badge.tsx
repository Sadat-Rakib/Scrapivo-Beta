import type { SignalTier } from "@/lib/intent/strategy";
import { TIER_LABEL } from "@/lib/intent/evidence";

// Tier badge for verified intent only. Never rendered without an
// EvidenceObject behind it (no evidence -> hidden by the caller).
const STYLES: Record<SignalTier, string> = {
  explicit_request:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  evaluation: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  problem: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  trigger: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
};

export function IntentBadge({
  tier,
  confidence,
}: {
  tier: SignalTier;
  confidence?: number;
}) {
  return (
    <span
      title={
        confidence != null
          ? `Verified intent evidence (confidence ${Math.round(confidence * 100)}%)`
          : "Verified intent evidence"
      }
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${STYLES[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
