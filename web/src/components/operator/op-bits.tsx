import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OP_COLOR } from "@/lib/colors";
import type { OpClusterKind } from "@/lib/data/operator";
import type { ClusterView } from "@/lib/data/select";
import { SIGNATURE_MIN_COUNT } from "@/lib/data/select";
import { PHASES, type PhaseCounts } from "@/lib/data/types";
import { PHASE_LABEL, pct, roundClock, SIDE_LABEL } from "@/lib/format";

/** Honest definition of an OP holder, shown wherever OP numbers appear. */
export const OP_HOLDER_NOTE =
  "OP holder = had an Operator when the round's buy phase ended (or picked one up).";

/** Phase colours for the OP-kill distribution bars (quiet, distinct on the dark card). */
export const PHASE_COLOR: Record<string, string> = {
  buy: "#9aa6b5",
  opening: "#ffc46b",
  mid: "#ff8f5a",
  late: "#b48cff",
  post_plant: "#5ee6e6",
};

export function fmtPct(x: number | null | undefined, digits = 0): string {
  return x === null || x === undefined ? "—" : pct(x, digits);
}

export function OpLowSample({ title }: { title: string }) {
  return (
    <Badge variant="outline" className="border-amber-400/50 text-amber-200" title={title}>
      Low sample
    </Badge>
  );
}

/** Stacked bar of OP kills per phase. */
export function PhaseBar({ phases, label }: { phases: PhaseCounts; label: string }) {
  const total = PHASES.reduce((n, p) => n + (phases[p] ?? 0), 0);
  if (total === 0) return <p className="text-[11px] text-muted-foreground">No OP kills.</p>;
  const desc = PHASES.filter((p) => phases[p])
    .map((p) => `${PHASE_LABEL[p]} ${phases[p]}`)
    .join(", ");
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${desc}`}>
      {PHASES.map((p) =>
        phases[p] ? (
          <div key={p} style={{ width: `${((phases[p] ?? 0) / total) * 100}%`, background: PHASE_COLOR[p] }} />
        ) : null,
      )}
    </div>
  );
}

export function PhaseKey() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Phase colours">
      {PHASES.map((p) => (
        <li key={p} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: PHASE_COLOR[p] }} />
          {PHASE_LABEL[p]}
        </li>
      ))}
    </ul>
  );
}

const KIND_TEXT = {
  // Position clusters are DBSCAN on one point per (round, cell), so counts are samples, not rounds.
  position: { title: "Angle held", share: "Share of position samples", count: "Samples (round × cell)", unit: "samples" },
  kill: { title: "OP kill spot", share: "Share of OP kills", count: "Kills from here", unit: "kills" },
} as const;

function kindOf(view: ClusterView): OpClusterKind {
  return view.ability === "kill" ? "kill" : "position";
}

export function opClusterLabel(c: ClusterView, who: string): string {
  const t = KIND_TEXT[kindOf(c)];
  const time = Number.isFinite(c.cluster.mean_t_round_ms) ? `, average time ${roundClock(c.cluster.mean_t_round_ms)}` : "";
  return `${t.title}, ${who}, ${SIDE_LABEL[c.side]}: ${pct(c.cluster.share)} ${t.share.replace("Share ", "")}, ${c.cluster.count} ${t.unit}${time}`;
}

export function OpClusterDetail({ view, who, onClose }: { view: ClusterView; who: string; onClose?: () => void }) {
  const { cluster } = view;
  const kind = kindOf(view);
  const t = KIND_TEXT[kind];
  return (
    <div className="rounded-md border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{t.title}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: OP_COLOR[kind] }} />
            {who} · {SIDE_LABEL[view.side]}
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Clear highlighted cluster">
            <XIcon />
          </Button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{t.share}</dt>
        <dd className="text-right font-mono tabular-nums">{pct(cluster.share)}</dd>
        <dt className="text-muted-foreground">{t.count}</dt>
        <dd className="text-right font-mono tabular-nums">
          {cluster.count}
          {kind === "kill" && ` / ${view.abilityCount}`}
        </dd>
        {Number.isFinite(cluster.mean_t_round_ms) && (
          <>
            <dt className="text-muted-foreground">Avg. time</dt>
            <dd className="text-right font-mono tabular-nums">{roundClock(cluster.mean_t_round_ms)}</dd>
          </>
        )}
      </dl>
      <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
        {kind === "kill"
          ? "Position of the OP holder at the moment of the kill."
          : "Where the OP holder stood during the first 45 s of OP rounds."}
        {cluster.count < SIGNATURE_MIN_COUNT && (
          <span className="text-amber-300">
            {" "}
            Estimate: only {cluster.count} {t.unit} in this cluster.
          </span>
        )}
      </p>
    </div>
  );
}
