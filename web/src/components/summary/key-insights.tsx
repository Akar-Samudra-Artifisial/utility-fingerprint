"use client";

import { LocateFixedIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type InsightTone = "default" | "attack" | "defense" | "warning";

/** Left accent, same "inset 3px" stripe as Compare's "Biggest differences" cards, but from tokens. */
const TONE_CLASS: Record<InsightTone, string> = {
  default: "shadow-[inset_3px_0_0_var(--muted-foreground)]",
  attack: "shadow-[inset_3px_0_0_var(--attack)]",
  defense: "shadow-[inset_3px_0_0_var(--defense)]",
  warning: "shadow-[inset_3px_0_0_var(--warning)]",
};

export interface Insight {
  key: string;
  /** What kind of insight ("Signature setup"); small line above the headline. */
  label: string;
  /** The "so what" in a few words. */
  title: React.ReactNode;
  detail?: React.ReactNode;
  tone?: InsightTone;
  /** Literal colour for data-driven accents (agent colour); wins over `tone`. */
  accent?: string;
  /** Extra element next to the label (e.g. LowSampleBadge); stays focusable on its own. */
  badge?: React.ReactNode;
  /** Makes the card a toggle (focus a cluster, select a player). */
  onSelect?: () => void;
  pressed?: boolean;
  /** Accessible name of the toggle, e.g. "Highlight Poison Cloud cluster on the map". */
  actionLabel?: string;
  /** Muted "not enough data" look. */
  empty?: boolean;
}

function InsightCard({ insight }: { insight: Insight }) {
  const { label, title, detail, tone = "default", accent, badge, onSelect, pressed, actionLabel, empty } = insight;
  const interactive = !!onSelect;
  return (
    <li
      className={cn(
        "relative min-w-0 rounded-md border border-border bg-card px-3 py-2 transition-colors",
        !accent && TONE_CLASS[tone],
        interactive && "hover:bg-accent has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
        pressed && "border-primary bg-accent",
      )}
      style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{label}</p>
        {badge && <span className="relative z-10 shrink-0">{badge}</span>}
        {interactive && <LocateFixedIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      </div>
      <p className={cn("truncate text-sm font-semibold", empty && "text-muted-foreground")}>
        {interactive ? (
          // Stretched toggle: the whole card is the hit area, the badge above stays separately focusable.
          <button
            type="button"
            aria-pressed={pressed}
            aria-label={actionLabel}
            onClick={onSelect}
            className="text-left outline-none after:absolute after:inset-0 after:rounded-md after:content-['']"
          >
            {title}
          </button>
        ) : (
          title
        )}
      </p>
      {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
    </li>
  );
}

/** Three "so what" cards above the map (Utility map, Operator), built from data already on screen. */
export function KeyInsights({ id, insights, className }: { id: string; insights: Insight[]; className?: string }) {
  if (insights.length === 0) return null;
  return (
    <section aria-labelledby={id} className={className}>
      <h3 id={id} className="sr-only">
        Key insights
      </h3>
      <ul className={`grid gap-2 sm:grid-cols-3${insights.length === 4 ? " lg:grid-cols-4" : ""}`}>
        {insights.map((i) => (
          <InsightCard key={i.key} insight={i} />
        ))}
      </ul>
    </section>
  );
}
