import { LowSampleBadge } from "@/components/ui/low-sample-badge";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "attack" | "defense" | "teamA" | "teamB" | "warning";

const TONE_CLASS: Record<StatTone, string> = {
  default: "",
  attack: "border-l-attack",
  defense: "border-l-defense",
  teamA: "border-l-team-a",
  teamB: "border-l-team-b",
  warning: "border-l-warning",
};

interface StatCardProps {
  label: React.ReactNode;
  /** `null` renders a muted "—" (no data, or too few samples to show a number). */
  value: React.ReactNode | null;
  sub?: React.ReactNode;
  tone?: StatTone;
  /** Reason text (with threshold) when the sample is too small; shows the shared badge and mutes the value. */
  lowSample?: string | false | null;
  /** `mono` for numbers, `text` for names. */
  valueKind?: "mono" | "text";
  className?: string;
}

/** One KPI tile used by every tab: label, big value, optional context line. */
export function StatCard({ label, value, sub, tone = "default", lowSample, valueKind = "mono", className }: StatCardProps) {
  const empty = value === null || value === undefined;
  return (
    <div
      className={cn(
        "min-w-0 space-y-0.5 rounded-md border border-border bg-card px-3 py-2.5",
        tone !== "default" && "border-l-[3px]",
        TONE_CLASS[tone],
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
      <p
        className={cn(
          "truncate text-2xl font-semibold",
          valueKind === "mono" && "font-mono tabular-nums",
          (empty || lowSample) && "text-muted-foreground",
        )}
      >
        {empty ? "—" : value}
      </p>
      {sub && <p className="truncate font-mono text-xs tabular-nums text-muted-foreground">{sub}</p>}
      {lowSample && <LowSampleBadge reason={lowSample} className="mt-1" />}
    </div>
  );
}
