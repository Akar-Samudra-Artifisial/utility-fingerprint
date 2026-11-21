"use client";

import { useId } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AgentGroup } from "@/lib/data/select";
import { PHASES, SIDES, type DataIndex, type Phase, type Side, type TeamSummary } from "@/lib/data/types";
import { SIDE_COLOR } from "@/lib/colors";
import { PHASE_HINT, PHASE_LABEL, SIDE_LABEL } from "@/lib/format";
import type { FilterState } from "@/lib/url-state";
import { AbilityPicker } from "./ability-picker";
import { TeamPicker } from "./team-picker";

interface FilterSidebarProps {
  index: DataIndex;
  team: TeamSummary | undefined;
  players?: Record<string, string>;
  player: string | null;
  filters: FilterState;
  mapName: string | null;
  groups: AgentGroup[];
  selected: ReadonlySet<string> | null;
  colors: Map<string, string>;
  update: (patch: Partial<FilterState>) => void;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  const Tag = htmlFor ? "label" : "p";
  return (
    <div className="space-y-2">
      <Tag {...(htmlFor ? { htmlFor } : {})} className="block text-xs font-medium text-muted-foreground">
        {label}
      </Tag>
      {children}
    </div>
  );
}

interface FieldProps {
  filters: FilterState;
  update: (patch: Partial<FilterState>) => void;
}

export function SideField({ filters, update }: FieldProps) {
  const labelId = useId();
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-xs font-medium text-muted-foreground">
        Side
      </p>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={filters.side}
        onValueChange={(v) => v && update({ side: v as Side, focus: null })}
        className="grid w-full grid-cols-2"
        aria-labelledby={labelId}
      >
        {SIDES.map((s) => (
          <ToggleGroupItem
            key={s}
            value={s}
            className="gap-2 data-[state=on]:bg-accent data-[state=on]:text-foreground"
          >
            <span aria-hidden className="size-2 rounded-full" style={{ background: SIDE_COLOR[s] }} />
            {SIDE_LABEL[s]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

export function PhaseField({ filters, update }: FieldProps) {
  const labelId = useId();
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-xs font-medium text-muted-foreground">
        Round phase <span className="font-normal">· pick one or more</span>
      </p>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        spacing={1}
        value={filters.phases}
        onValueChange={(v) => v.length > 0 && update({ phases: PHASES.filter((p) => v.includes(p)) as Phase[], focus: null })}
        className="flex w-full flex-wrap"
        aria-labelledby={labelId}
      >
        {PHASES.map((p) => (
          <ToggleGroupItem
            key={p}
            value={p}
            title={PHASE_HINT[p]}
            className="data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
          >
            {PHASE_LABEL[p]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">
        {filters.phases.map((p) => `${PHASE_LABEL[p]} ${PHASE_HINT[p]}`).join(" · ")}
      </p>
    </div>
  );
}

export function FilterSidebar({
  index,
  team,
  players,
  player,
  filters,
  mapName,
  groups,
  selected,
  colors,
  update,
}: FilterSidebarProps) {
  const playedMaps = index.maps
    .filter((m) => (team?.games_per_map[m.name] ?? 0) > 0)
    .sort((a, b) => (team?.games_per_map[b.name] ?? 0) - (team?.games_per_map[a.name] ?? 0));
  const playerLabelId = useId();
  const playerOptions = Object.entries(players ?? {}).sort(
    ([idA, nameA], [idB, nameB]) => nameA.localeCompare(nameB) || idA.localeCompare(idB),
  );

  return (
    <div className="space-y-6">
      <Field label="Team" htmlFor="team-picker">
        <TeamPicker
          id="team-picker"
          teams={index.teams}
          value={filters.team}
          onChange={(teamId) => update({ team: teamId, map: null, player: null, abilities: null, focus: null })}
        />
      </Field>

      <div role="group" aria-labelledby="map-label" className="space-y-2">
        <p id="map-label" className="text-xs font-medium text-muted-foreground">
          Map <span className="font-normal">· games played</span>
        </p>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          value={mapName ?? ""}
          onValueChange={(v) => v && update({ map: v, abilities: null, focus: null })}
          className="grid w-full grid-cols-2"
          aria-labelledby="map-label"
        >
          {playedMaps.map((m) => (
            <ToggleGroupItem
              key={m.name}
              value={m.name}
              className="justify-between px-2.5 data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
            >
              <span>{m.display_name}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {team?.games_per_map[m.name]}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <SideField filters={filters} update={update} />
      <PhaseField filters={filters} update={update} />

      {playerOptions.length > 0 && (
        <div className="space-y-2">
          <p id={playerLabelId} className="text-xs font-medium text-muted-foreground">
            Player
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={1}
            value={player ? `player:${player}` : "all"}
            onValueChange={(value) => {
              if (!value) return;
              update({ player: value === "all" ? null : value.slice("player:".length), focus: null });
            }}
            className="grid w-full grid-cols-2"
            aria-labelledby={playerLabelId}
          >
            <ToggleGroupItem
              value="all"
              className="justify-start data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
            >
              All players
            </ToggleGroupItem>
            {playerOptions.map(([id, name]) => (
              <ToggleGroupItem
                key={id}
                value={`player:${id}`}
                className="min-w-0 justify-start data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
              >
                <span className="truncate">{name}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Abilities <span className="font-normal">· casts in filter</span>
        </p>
        <AbilityPicker
          groups={groups}
          selected={selected}
          colors={colors}
          onChange={(abilities) => update({ abilities, focus: null })}
        />
      </div>
    </div>
  );
}
