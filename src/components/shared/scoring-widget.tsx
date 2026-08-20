/**
 * Scrapivo — Explainable Scoring Widget
 *
 * Displays an itemized evidence breakdown for why a lead or signal
 * received its current intent score.
 */

import { Info, Check, ShieldAlert, Zap } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

export interface ScoreEvidence {
  label: string;
  points: number;
  type: "positive" | "negative" | "neutral";
  detail?: string;
}

export interface ScoringWidgetProps {
  score: number;
  tier: "hot" | "warm" | "cold";
  evidence: ScoreEvidence[];
}

export function ScoringWidget({ score, tier, evidence }: ScoringWidgetProps) {
  const getTierColor = (t: string) => {
    switch (t) {
      case "hot":
        return "text-orange-500 bg-orange-500/10 border-orange-500/20";
      case "warm":
        return "text-amber-500 bg-amber-500/10 border-amber-500/20";
      case "cold":
      default:
        return "text-slate-400 bg-white/5 border-white/10";
    }
  };

  const getTierIcon = (t: string) => {
    switch (t) {
      case "hot":
        return <Zap className="size-3" />;
      case "warm":
        return <Zap className="size-3" />;
      case "cold":
      default:
        return <Info className="size-3" />;
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-medium cursor-help transition-colors ${getTierColor(tier)} hover:opacity-80`}
        >
          {getTierIcon(tier)}
          <span>{score}</span>
        </button>
      </Popover.Trigger>
      
      <Popover.Portal>
        <Popover.Content 
          className="z-50 w-64 rounded-xl border border-white/10 bg-[#1a1a1f] p-4 shadow-xl shadow-black/50 outline-none animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
          sideOffset={5}
          side="top"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h4 className="text-xs font-semibold text-white">Intent Score Breakdown</h4>
              <span className="text-xs font-mono text-white/50">Total: {score}</span>
            </div>
            
            <ul className="space-y-2">
              {evidence.map((item, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-xs">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-white/80">{item.label}</span>
                    {item.detail && <span className="text-white/40 text-[10px]">{item.detail}</span>}
                  </div>
                  <span className={`font-mono shrink-0 ${
                    item.type === "positive" ? "text-emerald-400" : 
                    item.type === "negative" ? "text-red-400" : "text-white/50"
                  }`}>
                    {item.points > 0 ? "+" : ""}{item.points}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <Popover.Arrow className="fill-[#1a1a1f]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
