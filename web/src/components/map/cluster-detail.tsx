import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LowSampleBadge } from "@/components/ui/low-sample-badge";
import type { ClusterView } from "@/lib/data/select";
import { SIGNATURE_MIN_COUNT } from "@/lib/data/select";
import { abilityName, agentName, PHASE_LABEL, pct, rate, roundClock } from "@/lib/format";
import { formatDeltaPp, type ClusterWinRate } from "@/lib/stats";

interface ClusterDetailProps {
  view: ClusterView;
  color: string;
  onClose?: () => void;
  winRate?: ClusterWinRate;
  players?: Record<string, string>;
}

export function ClusterDetail({ view, color, onClose, winRate, players }: ClusterDetailProps) {
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
        {players && cluster.players && cluster.players.length > 0 && (
          <>
            <dt className="text-muted-foreground">Thrown by</dt>
            <dd className="text-right font-mono tabular-nums">
              {cluster.players.map(([playerId, share]) => `${players[playerId] ?? playerId} ${pct(share)}`).join(", ")}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Avg. time</dt>
        <dd className="text-right font-mono tabular-nums">{roundClock(cluster.mean_t_round_ms)}</dd>
        {consistency !== undefined && (
          <>
            <dt className="text-muted-foreground">Aim agreement</dt>
            <dd className="text-right font-mono tabular-nums">{pct(consistency)}</dd>
          </>
        )}
        {winRate && winRate.kind !== "none" && (
          <>
            <dt className="col-span-2 mt-1 border-t border-border pt-1.5 text-muted-foreground">
              Win rate in rounds when used
            </dt>
            <dd className="col-span-2 flex flex-wrap items-baseline justify-end gap-x-1.5 text-right font-mono tabular-nums">
              {winRate.kind === "count" ? (
                <span>{winRate.rounds} rounds (too few for a rate)</span>
              ) : (
                <>
                  <span>
                    {pct(winRate.rate)} (95% CI {pct(winRate.low)}–{pct(winRate.high)}) · {winRate.rounds} rounds
                  </span>
                  {winRate.kind === "low" && !winRate.baselineUnavailable && (
                    <LowSampleBadge
                      reason={`Only ${winRate.rounds} rounds with this cluster (fewer than ${20}); interval is wide.`}
                      className="font-sans"
                    />
                  )}
                  {winRate.kind === "low" && winRate.baselineUnavailable && (
                    <span className="font-sans text-muted-foreground">· baseline unavailable</span>
                  )}
                  {winRate.kind === "full" && (
                    <span className="font-sans text-muted-foreground">
                      · vs baseline {pct(winRate.baseline)} →{" "}
                      <span
                        className={
                          winRate.significant
                            ? winRate.deltaPp > 0
                              ? "text-attack"
                              : "text-defense"
                            : "text-muted-foreground"
                        }
                      >
                        {formatDeltaPp(winRate.deltaPp)}
                      </span>
                      {!winRate.significant && " · within noise"}
                    </span>
                  )}
                </>
              )}
            </dd>
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
