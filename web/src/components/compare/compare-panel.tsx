"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section-header";
import { StatCard, type StatTone } from "@/components/ui/stat-card";
import { SITE_SHADES, TEAM_COLOR } from "@/lib/colors";
import {
  LOW_SAMPLE_GAMES,
  MIN_CASTS,
  MIN_GAP,
  type AbilityRow,
  type Difference,
  type TeamKey,
} from "@/lib/data/compare";
import { SIDES, type MapMeta, type OpTeamSide, type Side, type TeamMapStats } from "@/lib/data/types";
import { abilityName, agentName, pct, SIDE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TeamDot } from "./team-tag";

const TEAM_TONE: Record<TeamKey, StatTone> = { a: "teamA", b: "teamB" };

interface ComparePanelProps {
  map: MapMeta;
  side: Side;
  names: Record<TeamKey, string>;
  stats: Record<TeamKey, TeamMapStats>;
  rows: AbilityRow[];
  differences: Difference[];
  colors: Map<string, string>;
  /** Operator team summary on this map and side (`operator.by_map`), per team. */
  operator?: Record<TeamKey, OpTeamSide | undefined>;
}

function OperatorCompare({ op, names, side }: { op: Record<TeamKey, OpTeamSide | undefined>; names: Record<TeamKey, string>; side: Side }) {
  const metric = (label: string, get: (s: OpTeamSide) => number | null, digits: number) => {
    const a = op.a ? get(op.a) : null;
    const b = op.b ? get(op.b) : null;
    return (
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span>{label}</span>
          <span className="font-mono text-xs tabular-nums">
            <span style={{ color: TEAM_COLOR.a }}>{a === null ? "—" : pct(a, digits)}</span>
            <span className="text-muted-foreground"> vs </span>
            <span style={{ color: TEAM_COLOR.b }}>{b === null ? "—" : pct(b, digits)}</span>
          </span>
        </div>
        <PairedBars
          max={Math.max(a ?? 0, b ?? 0, 0.01)}
          values={{ a: a ?? 0, b: b ?? 0 }}
          label={`${label}, ${SIDE_LABEL[side]}: ${names.a} ${a === null ? "no data" : pct(a, digits)}, ${names.b} ${b === null ? "no data" : pct(b, digits)}`}
        />
      </div>
    );
  };
  return (
    <div className="space-y-3">
      {metric("Rounds with an OP", (s) => s.op_round_pct, 0)}
      {metric("First kills with OP", (s) => s.first_kill_op_share, 1)}
      <div className="grid grid-cols-2 gap-3">
        {KEYS.map((k) => {
          const s = op[k];
          const top = s?.top_op_player;
          return (
            <StatCard
              key={k}
              tone={TEAM_TONE[k]}
              valueKind="text"
              label={`Top OP · ${names[k]}`}
              value={top && (top.op_kills > 0 || top.rounds_with_op > 0) ? top.name : null}
              sub={top ? `${top.op_kills} kills · ${top.rounds_with_op} OP rds` : "no holder"}
              lowSample={s?.low_sample && `Only ${s.rounds} rounds on this side (fewer than 24).`}
            />
          );
        })}
      </div>
    </div>
  );
}

const KEYS: TeamKey[] = ["a", "b"];
const ROW_LIMIT = 10;

/** Two thin bars, one per team, on a shared scale. */
function PairedBars({ values, max, label }: { values: Record<TeamKey, number>; max: number; label: string }) {
  return (
    <div className="space-y-0.5" role="img" aria-label={label}>
      {KEYS.map((k) => (
        <div key={k} className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={{ width: `${max > 0 ? Math.max(values[k] > 0 ? 1.5 : 0, (values[k] / max) * 100) : 0}%`, background: TEAM_COLOR[k] }}
          />
        </div>
      ))}
    </div>
  );
}

export function ComparePanel({ map, side, names, stats, rows, differences, colors, operator }: ComparePanelProps) {
  const [showAll, setShowAll] = useState(false);
  const sites = map.sites.map((s) => s.site);
  const maxRate = rows.reduce((m, r) => Math.max(m, r.rate.a, r.rate.b), 0);
  const visible = showAll ? rows : rows.slice(0, ROW_LIMIT);
  const lowSample = KEYS.find((k) => stats[k].games < LOW_SAMPLE_GAMES);

  return (
    <div className="space-y-6">
      <Section
        title="Biggest differences"
        note={`Generated from casts per round; skips gaps under ${MIN_GAP}/round, phases where the higher team has fewer than ${MIN_CASTS} casts, and teams with fewer than ${LOW_SAMPLE_GAMES} games here.`}
      >
        {lowSample ? (
          <p className="text-xs text-muted-foreground">
            Not generated: {names[lowSample]} has {stats[lowSample].games} game{stats[lowSample].games === 1 ? "" : "s"} on
            this map (low sample). The table below still lists every cast.
          </p>
        ) : differences.length === 0 ? (
          <p className="text-xs text-muted-foreground">No clear gap for this filter. Try more phases or both sides.</p>
        ) : (
          <ol className="space-y-2">
            {differences.map((d) => (
              <li
                key={d.key}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm leading-snug"
                style={{ boxShadow: `inset 3px 0 0 ${TEAM_COLOR[d.higher]}` }}
              >
                {d.text}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={`Games on ${map.display_name}`}>
        <div className="grid grid-cols-2 gap-3">
          {KEYS.map((k) => (
            <StatCard
              key={k}
              tone={TEAM_TONE[k]}
              label={names[k]}
              value={stats[k].games}
              sub={`record ${stats[k].wins}–${stats[k].games - stats[k].wins}`}
              lowSample={
                stats[k].games < LOW_SAMPLE_GAMES &&
                `Only ${stats[k].games} game${stats[k].games === 1 ? "" : "s"} on this map (fewer than ${LOW_SAMPLE_GAMES}); treat differences as anecdotal.`
              }
            />
          ))}
        </div>
      </Section>

      <Section title="Round win rate">
        <div className="space-y-3">
          {SIDES.map((s) => (
            <div key={s} className={cn("space-y-1", s !== side && "opacity-70")}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{SIDE_LABEL[s]}</span>
                <span className="font-mono text-xs tabular-nums">
                  <span style={{ color: TEAM_COLOR.a }}>{pct(stats.a.round_win_rate[s] ?? 0)}</span>
                  <span className="text-muted-foreground"> vs </span>
                  <span style={{ color: TEAM_COLOR.b }}>{pct(stats.b.round_win_rate[s] ?? 0)}</span>
                </span>
              </div>
              <PairedBars
                max={1}
                values={{ a: stats.a.round_win_rate[s] ?? 0, b: stats.b.round_win_rate[s] ?? 0 }}
                label={`${SIDE_LABEL[s]} round win rate: ${names.a} ${pct(stats.a.round_win_rate[s] ?? 0)} of ${stats.a.rounds[s]} rounds, ${names.b} ${pct(stats.b.round_win_rate[s] ?? 0)} of ${stats.b.rounds[s]} rounds`}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Plant sites (share of plants)">
        <div className="space-y-2">
          {KEYS.map((k) => {
            const total = sites.reduce((n, s) => n + (stats[k].plant_sites[s] ?? 0), 0);
            return (
              <div key={k} className="flex items-center gap-2">
                <TeamDot team={k} className="size-2" />
                {total === 0 ? (
                  <span className="text-xs text-muted-foreground">No plants recorded.</span>
                ) : (
                  <div
                    className="flex h-5 flex-1 overflow-hidden rounded-sm"
                    role="img"
                    aria-label={`${names[k]} plants: ${sites.map((s) => `${s} ${pct(stats[k].plant_site_share[s] ?? 0)}`).join(", ")} (${total} plants)`}
                  >
                    {sites.map((s, i) => {
                      const share = stats[k].plant_site_share[s] ?? 0;
                      return share > 0 ? (
                        <div
                          key={s}
                          className="grid place-items-center text-2xs font-semibold text-background"
                          style={{ width: pct(share, 2), background: SITE_SHADES[i % SITE_SHADES.length] }}
                        >
                          {share >= 0.14 ? `${s} ${pct(share)}` : ""}
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
                <span className="w-8 text-right font-mono text-xs tabular-nums text-muted-foreground">{total}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {operator && (
        <Section
          title={`Operator · ${SIDE_LABEL[side]}`}
          note="OP holder = had an Operator when the round's buy phase ended (or picked one up). Low sample = fewer than 24 rounds on this side."
        >
          <OperatorCompare op={operator} names={names} side={side} />
        </Section>
      )}

      <Section
        title={`Casts per round · ${SIDE_LABEL[side]}`}
        note="Casts ÷ rounds the team played on this side, summed over the selected phases. Sorted by the biggest gap."
      >
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No utility for this filter.</p>
        ) : (
          <>
            <ul className="space-y-2.5">
              {visible.map((r) => (
                <li key={r.ability} className="space-y-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span aria-hidden className="size-2 shrink-0 self-center rounded-full" style={{ background: colors.get(r.agent) }} />
                    <span className="min-w-0 flex-1 truncate">
                      {abilityName(r.ability)} <span className="text-xs text-muted-foreground">{agentName(r.agent)}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      <span style={{ color: TEAM_COLOR.a }}>{r.rate.a.toFixed(2)}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span style={{ color: TEAM_COLOR.b }}>{r.rate.b.toFixed(2)}</span>
                    </span>
                  </div>
                  <PairedBars
                    max={maxRate}
                    values={r.rate}
                    label={`${abilityName(r.ability)}: ${names.a} ${r.rate.a.toFixed(2)} per round, ${names.b} ${r.rate.b.toFixed(2)} per round${r.only ? `, only ${names[r.only]} used it` : ""}`}
                  />
                </li>
              ))}
            </ul>
            {rows.length > ROW_LIMIT && (
              <Button variant="ghost" size="xs" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                {showAll ? "Show top 10" : `Show all ${rows.length}`}
              </Button>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
