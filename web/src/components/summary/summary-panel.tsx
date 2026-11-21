"use client";

import { plantTendency, type ClusterView } from "@/lib/data/select";
import type { MapMeta, Side, TeamMapStats } from "@/lib/data/types";
import { Section } from "@/components/ui/section-header";
import { StatCard } from "@/components/ui/stat-card";
import { LowSampleBadge } from "@/components/ui/low-sample-badge";
import { SIDE_COLOR, SIDE_TEXT_CLASS, SITE_SHADES } from "@/lib/colors";
import { LOW_SAMPLE_GAMES } from "@/lib/data/compare";
import { viewWinRate } from "@/lib/data/select";
import { abilityName, agentName, PHASE_LABEL, pct, roundClock, SIDE_LABEL } from "@/lib/format";
import { formatDeltaPp } from "@/lib/stats";
import { cn } from "@/lib/utils";

interface SummaryPanelProps {
  stats: TeamMapStats;
  map: MapMeta;
  side: Side;
  signatures: ClusterView[];
  colors: Map<string, string>;
  focusId: string | null;
  onFocus: (id: string | null) => void;
}

/** "avg 0:07", or just "barrier drop" (already self-explanatory, and keeps the card on one line). */
export function avgLabel(ms: number): string {
  const t = roundClock(ms);
  return t.includes(":") ? `avg ${t}` : t;
}

function WinRateRow({ side, stats, active }: { side: Side; stats: TeamMapStats; active: boolean }) {
  const wr = stats.round_win_rate[side] ?? 0;
  return (
    <div className={cn("space-y-1", !active && "opacity-70")}>
      <div className="flex items-baseline justify-between text-sm">
        <span className={cn("font-medium", SIDE_TEXT_CLASS[side])}>{SIDE_LABEL[side]}</span>
        <span className="font-mono tabular-nums">
          {pct(wr)}{" "}
          <span className="text-xs text-muted-foreground">
            {stats.round_wins[side]}/{stats.rounds[side]}
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full" style={{ width: pct(wr, 1), background: SIDE_COLOR[side] }} />
      </div>
    </div>
  );
}

export function SummaryPanel({ stats, map, side, signatures, colors, focusId, onFocus }: SummaryPanelProps) {
  const { sites: plants, total: totalPlants } = plantTendency(
    stats,
    map.sites.map((s) => s.site),
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label={`Games on ${map.display_name}`}
          value={stats.games}
          lowSample={
            stats.games < LOW_SAMPLE_GAMES &&
            `Only ${stats.games} game${stats.games === 1 ? "" : "s"} on ${map.display_name} (fewer than ${LOW_SAMPLE_GAMES}); treat patterns as anecdotal.`
          }
        />
        <StatCard label="Map record" value={`${stats.wins}–${stats.games - stats.wins}`} />
      </div>

      <Section id="sum-winrate" title="Round win rate">
        <div className="space-y-3">
          <WinRateRow side="attacker" stats={stats} active={side === "attacker"} />
          <WinRateRow side="defender" stats={stats} active={side === "defender"} />
        </div>
      </Section>

      <Section id="sum-plants" title={`Plant sites (${totalPlants} plants)`}>
        {totalPlants === 0 ? (
          <p className="text-xs text-muted-foreground">No plants recorded.</p>
        ) : (
          <>
            <div className="flex h-6 overflow-hidden rounded-md" role="img" aria-label={plants.map((p) => `${p.site} ${pct(p.share)}`).join(", ")}>
              {plants.map((p, i) =>
                p.share > 0 ? (
                  <div
                    key={p.site}
                    className="grid place-items-center text-2xs font-semibold text-background"
                    style={{ width: pct(p.share, 2), background: SITE_SHADES[i % SITE_SHADES.length] }}
                  >
                    {p.share >= 0.12 ? p.site : ""}
                  </div>
                ) : null,
              )}
            </div>
            <ul className="flex gap-4 text-xs">
              {plants.map((p) => (
                <li key={p.site} className="font-mono tabular-nums">
                  <span className="font-sans font-semibold">{p.site}</span> {pct(p.share)}{" "}
                  <span className="text-muted-foreground">({p.n})</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section id="sum-signatures" title="Signature utility">
        {signatures.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No repeatable cluster (≥ 5 casts) for this filter. Try more phases or abilities.
          </p>
        ) : (
          <ol className="space-y-2">
            {signatures.map((s, i) => {
              const active = s.id === focusId;
              const color = colors.get(s.agent) ?? "#fff";
              const winRate = viewWinRate(stats, s);
              return (
                <li key={s.id}>
                  <div
                    className={cn(
                      "relative flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-accent",
                      active && "border-primary bg-accent",
                    )}
                    style={{ boxShadow: `inset 3px 0 0 ${color}` }}
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-label={`${active ? "Clear highlight of" : "Highlight"} ${abilityName(s.ability)} cluster`}
                      onClick={() => onFocus(active ? null : s.id)}
                      className="absolute inset-0 z-0 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    <span className="pointer-events-none relative z-10 w-4 font-mono text-xs text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <span className="pointer-events-none relative z-10 min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{abilityName(s.ability)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {agentName(s.agent)} · {PHASE_LABEL[s.phase]} · {avgLabel(s.cluster.mean_t_round_ms)}
                      </span>
                      {winRate.kind === "count" && (
                        <span className="block truncate text-xs text-muted-foreground">{winRate.rounds} rounds</span>
                      )}
                      {winRate.kind === "low" && (
                        <span className="block truncate text-xs text-muted-foreground">
                          Win {pct(winRate.rate)} · {winRate.rounds} rounds
                          {winRate.baselineUnavailable && " · baseline unavailable"}
                        </span>
                      )}
                      {winRate.kind === "full" && (
                        <span className="block truncate text-xs text-muted-foreground">
                          Win {pct(winRate.rate)} in {winRate.rounds} rounds ·{" "}
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
                    </span>
                    <span className="pointer-events-none relative z-10 text-right">
                      <span className="block font-mono text-sm font-semibold tabular-nums">{pct(s.cluster.share)}</span>
                      <span className="block font-mono text-xs text-muted-foreground tabular-nums">
                        {s.cluster.count} casts
                      </span>
                    </span>
                    {winRate.kind === "low" && !winRate.baselineUnavailable && (
                      <span className="relative z-10 shrink-0">
                        <LowSampleBadge
                          reason={`Only ${winRate.rounds} rounds with this cluster (fewer than 20); interval is wide.`}
                          className="text-[0.65rem]"
                        />
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-xs leading-snug text-muted-foreground">
          Share = fraction of that ability&apos;s casts (same side and phase) made from inside the cluster.
          Positions are where the caster stood, not where the utility landed. Win rate in rounds when used = rounds
          won when the cluster was used; baseline = all rounds with utility on this side and phase. Correlation, not
          cause.
        </p>
      </Section>
    </div>
  );
}
