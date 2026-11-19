"use client";

import type { ClusterView } from "@/lib/data/select";
import type { MapMeta, Side, TeamMapStats } from "@/lib/data/types";
import { SIDE_COLOR } from "@/lib/colors";
import { abilityName, agentName, PHASE_LABEL, pct, roundClock, SIDE_LABEL } from "@/lib/format";
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
function avgLabel(ms: number): string {
  const t = roundClock(ms);
  return t.includes(":") ? `avg ${t}` : t;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function WinRateRow({ side, stats, active }: { side: Side; stats: TeamMapStats; active: boolean }) {
  const wr = stats.round_win_rate[side] ?? 0;
  return (
    <div className={cn("space-y-1", !active && "opacity-70")}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{SIDE_LABEL[side]}</span>
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
  const siteLetters = map.sites.map((s) => s.site);
  const plants = siteLetters.map((s) => ({ site: s, n: stats.plant_sites[s] ?? 0, share: stats.plant_site_share[s] ?? 0 }));
  const totalPlants = plants.reduce((a, p) => a + p.n, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border bg-card px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Games on {map.display_name}</p>
          <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums">{stats.games}</p>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Map record</p>
          <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums">
            {stats.wins}–{stats.games - stats.wins}
          </p>
        </div>
      </div>

      <Section title="Round win rate">
        <div className="space-y-3">
          <WinRateRow side="attacker" stats={stats} active={side === "attacker"} />
          <WinRateRow side="defender" stats={stats} active={side === "defender"} />
        </div>
      </Section>

      <Section title={`Plant sites (${totalPlants} plants)`}>
        {totalPlants === 0 ? (
          <p className="text-xs text-muted-foreground">No plants recorded.</p>
        ) : (
          <>
            <div className="flex h-6 overflow-hidden rounded-md" role="img" aria-label={plants.map((p) => `${p.site} ${pct(p.share)}`).join(", ")}>
              {plants.map((p, i) =>
                p.share > 0 ? (
                  <div
                    key={p.site}
                    className="grid place-items-center text-[11px] font-semibold text-background"
                    style={{ width: pct(p.share, 2), background: ["#e9edf2", "#9aa6b5", "#5f6b7a", "#3d4652"][i % 4] }}
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

      <Section title="Signature utility">
        {signatures.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No repeatable cluster (≥ 5 casts) for this filter. Try more phases or abilities.
          </p>
        ) : (
          <ol className="space-y-2">
            {signatures.map((s, i) => {
              const active = s.id === focusId;
              const color = colors.get(s.agent) ?? "#fff";
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onFocus(active ? null : s.id)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active && "border-primary bg-accent",
                    )}
                    style={{ boxShadow: `inset 3px 0 0 ${color}` }}
                  >
                    <span className="w-4 font-mono text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{abilityName(s.ability)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {agentName(s.agent)} · {PHASE_LABEL[s.phase]} · {avgLabel(s.cluster.mean_t_round_ms)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-sm font-semibold tabular-nums">{pct(s.cluster.share)}</span>
                      <span className="block font-mono text-[11px] text-muted-foreground tabular-nums">
                        {s.cluster.count} casts
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          Share = fraction of that ability&apos;s casts (same side and phase) made from inside the cluster.
          Positions are where the caster stood, not where the utility landed.
        </p>
      </Section>
    </div>
  );
}
