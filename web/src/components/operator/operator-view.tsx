"use client";

import { useCallback, useMemo, useState } from "react";
import { RotateCwIcon } from "lucide-react";

import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { SideField } from "@/components/filters/filter-sidebar";
import { TeamPicker } from "@/components/filters/team-picker";
import { MapCanvas, type HeatOverlay } from "@/components/map/map-canvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  HEAT_LEGEND_GRADIENT,
  HEAT_LUT,
  KILL_LEGEND_GRADIENT,
  KILL_LUT,
  OP_COLOR,
  VICTIM_LEGEND_GRADIENT,
  VICTIM_LUT,
} from "@/lib/colors";
import type { Load } from "@/lib/data/hooks";
import {
  OP_KIND,
  opClusterViews,
  opMapLayers,
  opSideListed,
  playerLines,
  playerSide,
  teamSide,
  UNTRACKED_OP_LABEL,
  type OpScope,
} from "@/lib/data/operator";
import type { HeatField } from "@/lib/data/select";
import type { DataIndex, OpPlayer, OpSideStats, TeamFile, TeamSummary } from "@/lib/data/types";
import { pct, SIDE_LABEL } from "@/lib/format";
import { OP_LAYERS, type FilterState, type OpLayer } from "@/lib/url-state";
import { OP_HOLDER_NOTE, OpClusterDetail, opClusterLabel } from "./op-bits";
import { OperatorPanel } from "./operator-panel";

interface OperatorViewProps {
  index: DataIndex;
  team: Load<TeamFile>;
  teamSummary: TeamSummary | undefined;
  filters: FilterState;
  mapName: string | null;
  update: (patch: Partial<FilterState>) => void;
}

const LAYER_LABEL: Record<OpLayer, string> = {
  positions: "OP positions (angles held)",
  killers: "Kill spots",
  victims: "Victims",
  clusters: "Clusters",
};

const CLUSTER_COLORS = new Map<string, string>([
  [OP_KIND.position, OP_COLOR.position],
  [OP_KIND.kill, OP_COLOR.kill],
]);

const EMPTY_FIELD_MSG = "Not enough OP kills to show positions";

function LegendRow({
  gradient,
  title,
  detail,
  empty,
}: {
  gradient: string;
  title: string;
  detail?: string;
  empty?: string | null;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span aria-hidden className="h-2 w-20 shrink-0 rounded-full" style={{ background: gradient }} />
      <span className="text-foreground">{title}</span>
      {empty ? (
        <span className="text-amber-300">· {empty}</span>
      ) : (
        detail && <span className="font-mono tabular-nums">· {detail}</span>
      )}
    </li>
  );
}

export function OperatorView({ index, team, teamSummary, filters, mapName, update: rawUpdate }: OperatorViewProps) {
  const update = useCallback((patch: Partial<FilterState>) => rawUpdate({ tab: "operator", ...patch }), [rawUpdate]);
  const [scope, setScope] = useState<OpScope>("map");
  const [focusId, setFocusId] = useState<string | null>(null);

  const op = team.data?.operator;
  const side = filters.side;
  const mapMeta = index.maps.find((m) => m.name === mapName);
  const player = op?.players.some((p) => p.player_id === filters.player) ? filters.player : null;
  const playerName = op?.players.find((p) => p.player_id === player)?.name;
  const who = playerName ?? "All OP players";
  const on = (l: OpLayer) => filters.opLayers.includes(l);

  const layers = useMemo(() => opMapLayers(op, mapName, side, player), [op, mapName, side, player]);
  const teamStats = teamSide(op, mapName, side);
  const lines = useMemo(() => playerLines(op, mapName, side, scope), [op, mapName, side, scope]);

  const overlays = useMemo<HeatOverlay[]>(() => {
    const out: HeatOverlay[] = [];
    if (filters.opLayers.includes("positions") && layers.positions) out.push({ field: layers.positions, lut: HEAT_LUT });
    if (filters.opLayers.includes("killers")) out.push({ field: layers.killers, lut: KILL_LUT });
    if (filters.opLayers.includes("victims")) out.push({ field: layers.victims, lut: VICTIM_LUT });
    return out;
  }, [filters.opLayers, layers]);

  const clusters = useMemo(() => {
    if (!filters.opLayers.includes("clusters")) return [];
    return [
      ...(filters.opLayers.includes("positions") ? opClusterViews(layers.positionClusters, side, layers.opRounds, "position") : []),
      ...(filters.opLayers.includes("killers") ? opClusterViews(layers.killClusters, side, layers.kills, "kill") : []),
    ];
  }, [filters.opLayers, layers, side]);

  const focused = clusters.some((c) => c.id === focusId) ? focusId : null;
  const toggle = (l: OpLayer, value: boolean) =>
    update({ opLayers: OP_LAYERS.filter((x) => (x === l ? value : filters.opLayers.includes(x))) });

  const isEmpty = (f: HeatField | null) => !f || f.max <= 0;
  const positionsMsg = !layers.positions
    ? "not in this data build yet"
    : layers.opRounds === 0
      ? "no OP rounds here"
      : isEmpty(layers.positions)
        ? "too few OP rounds to show positions"
        : null;
  const killersMsg = isEmpty(layers.killers) ? (layers.kills === 0 ? "no OP kills here" : EMPTY_FIELD_MSG.toLowerCase()) : null;
  const victimsMsg = isEmpty(layers.victims) ? (layers.kills === 0 ? "no OP kills here" : EMPTY_FIELD_MSG.toLowerCase()) : null;

  const activeHeat: [OpLayer, string | null][] = (
    [
      ["positions", positionsMsg],
      ["killers", killersMsg],
      ["victims", victimsMsg],
    ] as [OpLayer, string | null][]
  ).filter(([l]) => on(l));
  const nothingDrawn = clusters.length === 0 && activeHeat.every(([, msg]) => msg !== null);
  const noHolders = op !== undefined && (op.players.length === 0 || op.holder_source === "none");
  const playerHasSide = player === null || !!op?.players.find((p) => p.player_id === player && playerSide(p, mapName, side));

  const playedMaps = index.maps
    .filter((m) => (teamSummary?.games_per_map[m.name] ?? 0) > 0)
    .sort((a, b) => (teamSummary?.games_per_map[b.name] ?? 0) - (teamSummary?.games_per_map[a.name] ?? 0));
  const opRoundsOn = (m: string) => {
    const a = teamSide(op, m, "attacker")?.rounds_with_op ?? 0;
    const d = teamSide(op, m, "defender")?.rounds_with_op ?? 0;
    return a + d;
  };
  // Per-side list: tracked OP holders, plus players with OP kills but no tracked OP round (flagged).
  const sidePlayers = useMemo(
    () =>
      (op?.players ?? [])
        .map((p) => ({ p, s: playerSide(p, mapName, side) }))
        .filter((x): x is { p: OpPlayer; s: OpSideStats } => opSideListed(x.s))
        .sort((a, b) => b.s.rounds_with_op - a.s.rounds_with_op || b.s.op_kills - a.s.op_kills),
    [op, mapName, side],
  );

  const where = mapMeta ? `${mapMeta.display_name} ${SIDE_LABEL[side]}` : SIDE_LABEL[side];
  const loading = !team.data && !team.error;

  return (
    <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[18.5rem_minmax(0,1fr)_22rem]">
      <aside aria-label="Operator filters" className="min-h-0 border-t border-border lg:border-t-0 lg:border-r">
        <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
          <div className="space-y-6 p-4">
            <div className="space-y-2">
              <label htmlFor="op-team-picker" className="block text-xs font-medium text-muted-foreground">
                Team
              </label>
              <TeamPicker
                id="op-team-picker"
                teams={index.teams}
                value={filters.team}
                onChange={(teamId) => update({ team: teamId, map: null, player: null, abilities: null, focus: null })}
              />
            </div>

            <div role="group" aria-labelledby="op-map-label" className="space-y-2">
              <p id="op-map-label" className="text-xs font-medium text-muted-foreground">
                Map <span className="font-normal">· rounds with an OP</span>
              </p>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                value={mapName ?? ""}
                onValueChange={(v) => v && update({ map: v })}
                className="grid w-full grid-cols-2"
                aria-labelledby="op-map-label"
              >
                {playedMaps.map((m) => (
                  <ToggleGroupItem
                    key={m.name}
                    value={m.name}
                    className="justify-between px-2.5 data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
                  >
                    <span>{m.display_name}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{op ? opRoundsOn(m.name) : "…"}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <SideField filters={filters} update={update} />

            <div role="group" aria-labelledby="op-player-label" className="space-y-2">
              <p id="op-player-label" className="text-xs font-medium text-muted-foreground">
                Player <span className="font-normal">· OP rounds on {where}</span>
              </p>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                orientation="vertical"
                value={player ?? "all"}
                onValueChange={(v) => update({ player: !v || v === "all" ? null : v })}
                className="w-full"
                aria-labelledby="op-player-label"
              >
                <ToggleGroupItem
                  value="all"
                  className="justify-between px-2.5 data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
                >
                  All players
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{teamStats?.rounds_with_op ?? 0}</span>
                </ToggleGroupItem>
                {sidePlayers.map(({ p, s }) => {
                  const untracked = s.rounds_with_op === 0;
                  return (
                    <ToggleGroupItem
                      key={p.player_id}
                      value={p.player_id}
                      aria-label={untracked ? `${p.name}, ${s.op_kills} OP kills, ${UNTRACKED_OP_LABEL}` : undefined}
                      className="h-auto min-h-8 justify-between px-2.5 py-1 data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-foreground"
                    >
                      <span className="min-w-0 text-left">
                        <span className="block truncate">{p.name}</span>
                        {untracked && (
                          <span className="block truncate text-[11px] font-normal text-amber-300">{UNTRACKED_OP_LABEL}</span>
                        )}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{s.rounds_with_op}</span>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </div>
          </div>
        </ScrollArea>
      </aside>

      <main className="order-first flex min-h-[30rem] min-w-0 flex-col gap-3 p-4 lg:order-none lg:min-h-0">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="mr-auto min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">
              {playerName ?? teamSummary?.name ?? "…"}
              <span className="text-muted-foreground"> Operator on </span>
              {mapMeta?.display_name ?? "…"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {SIDE_LABEL[side]} · {OP_HOLDER_NOTE}
            </p>
          </div>
          <fieldset className="flex flex-wrap items-center gap-4">
            <legend className="sr-only">Operator map layers</legend>
            {OP_LAYERS.map((l) => (
              <div key={l} className="flex items-center gap-2">
                <Switch id={`op-layer-${l}`} checked={on(l)} onCheckedChange={(v) => toggle(l, v)} />
                <Label htmlFor={`op-layer-${l}`} className="text-sm">
                  {LAYER_LABEL[l]}
                </Label>
              </div>
            ))}
          </fieldset>
          <CopyLinkButton />
        </div>

        <div className="relative flex min-h-[22rem] flex-1 flex-col rounded-lg border border-border bg-[#0b0f15] p-2">
          {team.error ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div className="space-y-3">
                <p className="text-sm text-destructive">Could not load team data ({team.error}).</p>
                <Button size="sm" variant="outline" onClick={team.retry}>
                  <RotateCwIcon /> Retry
                </Button>
              </div>
            </div>
          ) : loading || !mapMeta || !op ? (
            <div className="flex flex-1 items-center justify-center" aria-busy="true">
              <Skeleton className="aspect-square h-full max-h-full max-w-full" />
              <span className="sr-only">Loading team data…</span>
            </div>
          ) : (
            <>
              <MapCanvas
                map={mapMeta}
                heat={null}
                overlays={overlays}
                clusters={clusters}
                colors={CLUSTER_COLORS}
                layers={["clusters"]}
                focusId={focused}
                onFocus={setFocusId}
                clusterLabel={(c) => opClusterLabel(c, who)}
                renderDetail={(c, onClose) => <OpClusterDetail view={c} who={who} onClose={onClose} />}
                clusterGroupLabel="Operator clusters"
                description={`${mapMeta.display_name} minimap, ${who} of ${teamSummary?.name ?? "team"} on ${SIDE_LABEL[side]}: ${activeHeat
                  .map(([l, msg]) => `${LAYER_LABEL[l]}${msg ? ` (${msg})` : ""}`)
                  .join(", ") || "no heat layer"}; ${clusters.length} clusters. Numbers are in the panel on the right.`}
              />
              {(noHolders || !playerHasSide || nothingDrawn) && (
                <div className="absolute inset-0 grid place-items-center bg-[#0b0f15]/80 p-6 text-center">
                  <div className="max-w-sm space-y-3">
                    <p className="font-medium">
                      {noHolders
                        ? "No Operator holders recorded"
                        : !playerHasSide
                          ? `${playerName} never held an OP on ${where}`
                          : activeHeat.length === 0
                            ? "All position layers are off"
                            : on("positions") && positionsMsg && activeHeat.length === 1
                              ? `OP positions: ${positionsMsg}`
                              : EMPTY_FIELD_MSG}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {noHolders
                        ? `${teamSummary?.name ?? "This team"} has no rounds with an Operator in this dataset.`
                        : !playerHasSide
                          ? "Pick another player or side."
                          : activeHeat.length === 0
                            ? "Turn on OP positions, Kill spots or Victims."
                            : `Heat cells need at least 2 rounds or kills in the same spot; ${who} on ${where} does not reach that. The numbers on the right still count every round.`}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {player !== null && (
                        <Button size="sm" variant="outline" onClick={() => update({ player: null })}>
                          All players
                        </Button>
                      )}
                      {!on("positions") && (
                        <Button size="sm" variant="outline" onClick={() => toggle("positions", true)}>
                          Show OP positions
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => update({ side: side === "attacker" ? "defender" : "attacker" })}>
                        Switch to {SIDE_LABEL[side === "attacker" ? "defender" : "attacker"]}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {op && mapMeta && (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <ul className="space-y-1" aria-label="Map legend">
              {on("positions") && (
                <LegendRow
                  gradient={HEAT_LEGEND_GRADIENT}
                  title="Where the OP player stood during the first 45 s of OP rounds (share of OP rounds)"
                  detail={layers.positions ? `max ${pct(layers.positions.max)} of ${layers.opRounds} OP rounds per cell` : undefined}
                  empty={positionsMsg}
                />
              )}
              {on("killers") && (
                <LegendRow
                  gradient={KILL_LEGEND_GRADIENT}
                  title="Where the OP player stood at each OP kill"
                  detail={`${layers.kills} OP kills · max ${layers.killers.max}/cell`}
                  empty={killersMsg}
                />
              )}
              {on("victims") && (
                <LegendRow
                  gradient={VICTIM_LEGEND_GRADIENT}
                  title="Where victims died (the far end of the OP's line of fire)"
                  detail={`${layers.kills} OP kills · max ${layers.victims.max}/cell`}
                  empty={victimsMsg}
                />
              )}
              {on("clusters") && (
                <li className="flex flex-wrap items-center gap-x-3">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: OP_COLOR.position }} /> Angle held
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: OP_COLOR.kill }} /> Kill spot (needs Kill spots on)
                  </span>
                </li>
              )}
            </ul>
            <p className="text-[11px] leading-snug">
              Heat cells need at least 2 rounds or kills in the same spot, so small samples can leave a layer blank.
              Victim heat marks where each OP victim died, i.e. the far end of the shot, not where the OP stood; read
              it with Kill spots to see the angle the shot crossed.
            </p>
          </div>
        )}
      </main>

      <aside aria-label="Operator summary" className="min-h-0 border-t border-border lg:border-t-0 lg:border-l">
        <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
          <div className="p-4">
            {op && mapMeta ? (
              <OperatorPanel
                op={op}
                maps={index.maps}
                map={mapMeta}
                side={side}
                team={teamStats}
                players={lines}
                scope={scope}
                onScope={setScope}
                player={player}
                onPlayer={(id) => update({ player: id })}
                onMap={(m) => update({ map: m })}
              />
            ) : (
              <div className="space-y-4">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
