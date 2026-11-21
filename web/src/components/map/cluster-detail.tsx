import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ClusterView } from "@/lib/data/select";
import { SIGNATURE_MIN_COUNT } from "@/lib/data/select";
import { abilityName, agentName, PHASE_LABEL, pct, rate, roundClock } from "@/lib/format";

interface ClusterDetailProps {
  view: ClusterView;
  color: string;
  onClose?: () => void;
}

export function ClusterDetail({ view, color, onClose }: ClusterDetailProps) {
  const { cluster } = view;
  const lowSample = cluster.count < SIGNATURE_MIN_COUNT;
  const consistency = cluster.view_consistency;
  return (
    <div className="rounded-md border border-border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{abilityName(view.ability)}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
            {agentName(view.agent)} · {PHASE_LABEL[view.phase]}
          </p>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Clear highlighted cluster"
          >
            <XIcon />
          </Button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Share of casts</dt>
        <dd className="text-right font-mono tabular-nums">{pct(cluster.share)}</dd>
        <dt className="text-muted-foreground">Cast from here</dt>
        <dd className="text-right font-mono tabular-nums">
          {cluster.count} / {view.abilityCount}
        </dd>
        <dt className="text-muted-foreground">Ability / round</dt>
        <dd className="text-right font-mono tabular-nums">{rate(view.ratePerRound)}</dd>
        <dt className="text-muted-foreground">Avg. time</dt>
        <dd className="text-right font-mono tabular-nums">{roundClock(cluster.mean_t_round_ms)}</dd>
        {consistency !== undefined && (
          <>
            <dt className="text-muted-foreground">Aim agreement</dt>
            <dd className="text-right font-mono tabular-nums">{pct(consistency)}</dd>
          </>
        )}
      </dl>
      {(lowSample || (consistency !== undefined && consistency < 0.5)) && (
        <p className="mt-2 border-t border-border pt-2 text-xs leading-snug text-warning">
          {lowSample
            ? `Estimate: only ${cluster.count} casts in this cluster.`
            : "Estimate: aim direction varies a lot between casts."}
        </p>
      )}
    </div>
  );
}
