"use client";

import { useId } from "react";
import { ArrowUpDownIcon } from "lucide-react";

import { AbilityPicker } from "@/components/filters/ability-picker";
import { PhaseField, SideField } from "@/components/filters/filter-sidebar";
import { TeamPicker } from "@/components/filters/team-picker";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TEAM_COLOR } from "@/lib/colors";
import type { TeamKey } from "@/lib/data/compare";
import type { AgentGroup } from "@/lib/data/select";
import type { DataIndex, TeamSummary } from "@/lib/data/types";
import type { FilterState } from "@/lib/url-state";
import { TeamDot } from "./team-tag";

interface CompareSidebarProps {
  index: DataIndex;
  teamA: TeamSummary | undefined;
  teamB: TeamSummary | undefined;
  teamBId: string;
  filters: FilterState;
  mapName: string | null;
  groups: AgentGroup[];
  only: Map<string, TeamKey>;
  selected: ReadonlySet<string> | null;
  colors: Map<string, string>;
  update: (patch: Partial<FilterState>) => void;
}

export function CompareSidebar({
  index,
  teamA,
  teamB,
  teamBId,
  filters,
  mapName,
  groups,
  only,
  selected,
  colors,
  update,
}: CompareSidebarProps) {
  const mapLabel = useId();
  const games = (t: TeamSummary | undefined, m: string) => t?.games_per_map[m] ?? 0;
  // Every map either team played; maps missing for one of them are shown but disabled.
  const maps = index.maps
    .filter((m) => games(teamA, m.name) > 0 || games(teamB, m.name) > 0)
    .map((m) => ({ ...m, a: games(teamA, m.name), b: games(teamB, m.name) }))
    .sort((x, y) => Number(y.a > 0 && y.b > 0) - Number(x.a > 0 && x.b > 0) || Math.min(y.a, y.b) - Math.min(x.a, x.b));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="compare-team-a" className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <TeamDot team="a" /> Team A
        </label>
        <TeamPicker
          id="compare-team-a"
          teams={index.teams}
          value={filters.team}
          exclude={teamBId}
          onChange={(id) => update({ team: id, abilities: null, focus: null })}
        />
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ team: teamBId, teamB: filters.team, focus: null })}
            aria-label="Swap Team A and Team B"
          >
            <ArrowUpDownIcon /> Swap
          </Button>
        </div>
        <label htmlFor="compare-team-b" className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <TeamDot team="b" /> Team B
        </label>
        <TeamPicker
          id="compare-team-b"
          teams={index.teams}
          value={teamBId}
          exclude={filters.team}
          onChange={(id) => update({ teamB: id, abilities: null, focus: null })}
        />
      </div>

      <div role="group" aria-labelledby={mapLabel} className="space-y-2">
        <p id={mapLabel} className="text-xs font-medium text-muted-foreground">
          Map <span className="font-normal">· games A / B, shared maps only</span>
        </p>
        {maps.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading maps…</p>
        ) : (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            value={mapName ?? ""}
            onValueChange={(v) => v && update({ map: v, abilities: null, focus: null })}
            className="grid w-full grid-cols-2"
            aria-labelledby={mapLabel}
          >
            {maps.map((m) => {
              const shared = m.a > 0 && m.b > 0;
              return (
                <ToggleGroupItem
                  key={m.name}
                  value={m.name}
                  disabled={!shared}
                  aria-label={`${m.display_name}: ${m.a} games Team A, ${m.b} games Team B${shared ? "" : ", not played by both"}`}
                  className="justify-between px-2.5 data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
                >
                  <span className={shared ? undefined : "line-through decoration-muted-foreground/60"}>{m.display_name}</span>
                  <span className="font-mono text-xs tabular-nums">
                    <span style={{ color: m.a > 0 ? TEAM_COLOR.a : undefined }}>{m.a}</span>
                    <span className="text-muted-foreground">/</span>
                    <span style={{ color: m.b > 0 ? TEAM_COLOR.b : undefined }}>{m.b}</span>
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        )}
      </div>

      <SideField filters={filters} update={update} />
      <PhaseField filters={filters} update={update} />

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Abilities <span className="font-normal">· casts by both teams</span>
        </p>
        <AbilityPicker
          groups={groups}
          selected={selected}
          colors={colors}
          onChange={(abilities) => update({ abilities, focus: null })}
          marker={(ability) => {
            const who = only.get(ability);
            if (!who) return null;
            return (
              <span
                className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1 text-[10px] text-muted-foreground"
                title={`Only Team ${who.toUpperCase()} used this in the current filter`}
              >
                <TeamDot team={who} className="size-1.5" />
                only {who.toUpperCase()}
              </span>
            );
          }}
        />
      </div>
    </div>
  );
}
