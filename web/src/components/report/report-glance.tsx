"use client";

import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { LOW_SAMPLE_GAMES } from "@/lib/data/compare";
import type { MapMeta, TeamFile, TeamReport } from "@/lib/data/types";
import { pct, SIDE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MapRecord {
  name: string;
  games: number;
  wins: number;
  rate: number;
}

export interface ReportKpiData {
  games: number;
  wins: number;
  rounds: { attacker: number; defender: number };
  roundWins: { attacker: number; defender: number };
  best: MapRecord | null;
  worst: MapRecord | null;
}

/** Totals over the team's maps; best/worst only among maps with ≥ LOW_SAMPLE_GAMES games. */
export function reportKpis(team: TeamFile, maps: readonly MapMeta[]): ReportKpiData {
  const rows = Object.entries(team.maps);
  const sum = (f: (s: TeamFile["maps"][string]) => number) => rows.reduce((n, [, s]) => n + f(s), 0);
  const display = (m: string) => maps.find((x) => x.name === m)?.display_name ?? m;
  const ranked = rows
    .filter(([, s]) => s.games >= LOW_SAMPLE_GAMES)
    .map(([m, s]) => ({ name: display(m), games: s.games, wins: s.wins, rate: s.wins / s.games }))
    .sort((a, b) => b.rate - a.rate || b.games - a.games);
  return {
    games: sum((s) => s.games),
    wins: sum((s) => s.wins),
    rounds: { attacker: sum((s) => s.rounds.attacker), defender: sum((s) => s.rounds.defender) },
    roundWins: { attacker: sum((s) => s.round_wins.attacker), defender: sum((s) => s.round_wins.defender) },
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
  };
}

const rateOf = (w: number, n: number) => (n > 0 ? pct(w / n) : null);
const mapSub = (m: MapRecord) => `${m.wins}–${m.games - m.wins} · ${pct(m.rate)} won`;

/** KPI tiles: in the header below xl (and in print), in the right rail at xl. */
export function ReportKpis({ data, className }: { data: ReportKpiData | null; className?: string }) {
  if (!data) {
    return (
      <div className={cn("grid grid-cols-2 gap-3", className)} aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full" />
        ))}
        <span className="sr-only">Loading team stats…</span>
      </div>
    );
  }
  const lowNote = `Maps with fewer than ${LOW_SAMPLE_GAMES} games are left out.`;
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <StatCard label="Games" value={data.games} sub="in the dataset" />
      <StatCard label="Record" value={`${data.wins}–${data.games - data.wins}`} sub={rateOf(data.wins, data.games) ? `${rateOf(data.wins, data.games)} won` : undefined} />
      <StatCard
        tone="attack"
        label={`${SIDE_LABEL.attacker} round WR`}
        value={rateOf(data.roundWins.attacker, data.rounds.attacker)}
        sub={`${data.roundWins.attacker}/${data.rounds.attacker} rounds`}
      />
      <StatCard
        tone="defense"
        label={`${SIDE_LABEL.defender} round WR`}
        value={rateOf(data.roundWins.defender, data.rounds.defender)}
        sub={`${data.roundWins.defender}/${data.rounds.defender} rounds`}
      />
      <StatCard label="Best map" valueKind="text" value={data.best?.name ?? null} sub={data.best ? mapSub(data.best) : lowNote} />
      <StatCard label="Worst map" valueKind="text" value={data.worst?.name ?? null} sub={data.worst ? mapSub(data.worst) : lowNote} />
    </div>
  );
}

/** "Jump to section": buttons (not #hash links) so the URL, and Copy link, stay unchanged. */
export function ReportToc({ report }: { report: TeamReport }) {
  const items = [
    ...report.sections.filter((s) => s.claims.length > 0).map((s) => ({ id: `report-${s.id}`, title: s.title, n: s.claims.length })),
    ...(report.counters.length > 0 ? [{ id: "report-counters", title: "How to counter", n: report.counters.length }] : []),
  ];
  if (items.length === 0) return null;
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  };
  return (
    <nav aria-labelledby="report-toc-title" className="space-y-2">
      <SectionHeader id="report-toc-title" title="Jump to section" />
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => jump(i.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate">{i.title}</span>
              <span className="font-mono text-xs tabular-nums">{i.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
