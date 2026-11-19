"use client";

import { useCallback, useMemo, useState } from "react";
import { RotateCwIcon } from "lucide-react";

import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { MapCanvas } from "@/components/map/map-canvas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { agentColorMap, DIFF_LEGEND_GRADIENT, HEAT_LEGEND_GRADIENT } from "@/lib/colors";
import {
  biggestDifferences,
  compareAbilities,
  diffField,
  rateField,
  unionGroups,
  withSharedMax,
  type TeamKey,
} from "@/lib/data/compare";
import { useTeam, type Load } from "@/lib/data/hooks";
import { teamSide } from "@/lib/data/operator";
import { clusterViews, type ClusterView } from "@/lib/data/select";
import type { DataIndex, MapMeta, TeamFile } from "@/lib/data/types";
import { agentName, PHASE_LABEL, SIDE_LABEL } from "@/lib/format";
import { DEFAULT_TEAM, LAYERS, resolveTeamB, type CompareMode, type FilterState, type Layer } from "@/lib/url-state";
import { ComparePanel } from "./compare-panel";
import { CompareSidebar } from "./compare-sidebar";
import { LOW_SAMPLE_GAMES, TeamTag } from "./team-tag";

interface CompareViewProps {
  index: DataIndex;
  filters: FilterState;
  update: (patch: Partial<FilterState>) => void;
  lastViewed: string | null;
}

const LAYER_LABEL: Record<Layer, string> = { heat: "Heatmap", clusters: "Clusters", arrows: "Aim arrows" };
const MODE_LABEL: Record<CompareMode, string> = { side: "Side by side", diff: "Difference" };
const KEYS: TeamKey[] = ["a", "b"];
// Stable references for the difference map, so MapCanvas memos are not invalidated every render.
const NO_CLUSTERS: ClusterView[] = [];
const DIFF_LAYERS: Layer[] = ["heat"];
const noop = () => {};

function LoadError({ name, load }: { name: string; load: Load<TeamFile> }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <p className="font-medium">Could not load {name}</p>
        <p className="text-sm text-muted-foreground">
          The data files may be regenerating. ({load.error})
        </p>
        <Button size="sm" variant="outline" onClick={load.retry}>
          <RotateCwIcon /> Retry
        </Button>
      </div>
    </div>
  );
}

export function CompareView({ index, filters, update: rawUpdate, lastViewed }: CompareViewProps) {
  const knownIds = useMemo(() => index.teams.map((t) => t.id), [index.teams]);
  // Validated against the index first, so a stale or self-referencing `b` never triggers a 404 fetch.
  const teamBId = resolveTeamB(filters.team, filters.teamB, lastViewed, knownIds);
  const loadA = useTeam(filters.team);
  const loadB = useTeam(teamBId);
  const summary = {
    a: index.teams.find((t) => t.id === filters.team),
    b: index.teams.find((t) => t.id === teamBId),
  };
  const nameA = summary.a?.name ?? "Team A";
  const nameB = summary.b?.name ?? "Team B";
  const names = useMemo<Record<TeamKey, string>>(() => ({ a: nameA, b: nameB }), [nameA, nameB]);

  // Shared maps only: keep the URL map if both teams played it, otherwise the one with the most games for both.
  const mapName = useMemo(() => {
    const ga = summary.a?.games_per_map ?? {};
    const gb = summary.b?.games_per_map ?? {};
    const shared = index.maps.filter((m) => (ga[m.name] ?? 0) > 0 && (gb[m.name] ?? 0) > 0);
    if (filters.map && shared.some((m) => m.name === filters.map)) return filters.map;
    return (
      shared.sort((x, y) => Math.min(gb[y.name], ga[y.name]) - Math.min(gb[x.name], ga[x.name]))[0]?.name ?? null
    );
  }, [index.maps, summary.a, summary.b, filters.map]);

  const update = useCallback(
    (patch: Partial<FilterState>) =>
      // Pin both teams and the resolved map so a copied link reproduces the view exactly.
      rawUpdate({ tab: "compare", teamB: teamBId, map: mapName, ...patch }),
    [rawUpdate, teamBId, mapName],
  );

  const mapMeta: MapMeta | undefined = index.maps.find((m) => m.name === mapName);
  const statsA = mapName ? loadA.data?.maps[mapName] : undefined;
  const statsB = mapName ? loadB.data?.maps[mapName] : undefined;
  const selected = useMemo(() => (filters.abilities === null ? null : new Set(filters.abilities)), [filters.abilities]);
  const [focus, setFocus] = useState<Record<TeamKey, string | null>>({ a: null, b: null });

  const { side, phases } = filters;
  const derived = useMemo(() => {
    if (!statsA || !statsB) return null;
    const [heatA, heatB] = withSharedMax(rateField(statsA, side, phases, selected), rateField(statsB, side, phases, selected));
    const { groups, only } = unionGroups(statsA, statsB, side, phases);
    return {
      groups,
      only,
      colors: agentColorMap([...Object.values(statsA.abilities), ...Object.values(statsB.abilities)].map((x) => x.agent)),
      heat: { a: heatA, b: heatB },
      diff: diffField(heatA, heatB),
      clusters: { a: clusterViews(statsA, side, phases, selected), b: clusterViews(statsB, side, phases, selected) },
      rows: compareAbilities(statsA, statsB, side, phases, selected),
      differences: biggestDifferences(statsA, statsB, names, side, phases, selected),
    };
  }, [statsA, statsB, side, phases, selected, names]);

  const filterText = `${SIDE_LABEL[filters.side]} · ${filters.phases.map((p) => PHASE_LABEL[p]).join(", ")}`;
  const loading = (!loadA.data && !loadA.error) || (!loadB.data && !loadB.error);
  const failed = loadA.error ? { name: names.a, load: loadA } : loadB.error ? { name: names.b, load: loadB } : null;
  const noShared = !loading && !failed && mapName === null;
  const emptyFilter = derived !== null && derived.rows.length === 0;
  const agents = derived ? [...new Set([...derived.clusters.a, ...derived.clusters.b].map((c) => c.agent))].sort() : [];

  const focusFor = (k: TeamKey) =>
    derived?.clusters[k].some((c) => c.id === focus[k]) ? focus[k] : null;

  return (
    <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[18.5rem_minmax(0,1fr)_22rem]">
      <aside aria-label="Compare filters" className="min-h-0 border-t border-border lg:border-t-0 lg:border-r">
        <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
          <div className="p-4">
            <CompareSidebar
              index={index}
              teamA={summary.a}
              teamB={summary.b}
              teamBId={teamBId}
              filters={filters}
              mapName={mapName}
              groups={derived?.groups ?? []}
              only={derived?.only ?? new Map()}
              selected={selected}
              colors={derived?.colors ?? new Map()}
              update={update}
            />
          </div>
        </ScrollArea>
      </aside>

      <main className="order-first flex min-h-[30rem] min-w-0 flex-col gap-3 p-4 lg:order-none lg:min-h-0">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="mr-auto min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">
              {names.a}
              <span className="text-muted-foreground"> vs </span>
              {names.b}
              {mapMeta && (
                <>
                  <span className="text-muted-foreground"> on </span>
                  {mapMeta.display_name}
                </>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">{filterText} · heat in casts per round, same scale for both teams</p>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={filters.mode}
            onValueChange={(v) => v && update({ mode: v as CompareMode })}
            aria-label="Compare view"
          >
            {(Object.keys(MODE_LABEL) as CompareMode[]).map((m) => (
              <ToggleGroupItem key={m} value={m} className="px-3 data-[state=on]:bg-accent data-[state=on]:text-foreground">
                {MODE_LABEL[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {filters.mode === "side" && (
            <fieldset className="flex flex-wrap items-center gap-4">
              <legend className="sr-only">Map layers</legend>
              {LAYERS.map((l) => (
                <div key={l} className="flex items-center gap-2">
                  <Switch
                    id={`cmp-layer-${l}`}
                    checked={filters.layers.includes(l)}
                    onCheckedChange={(on) => update({ layers: LAYERS.filter((x) => (x === l ? on : filters.layers.includes(x))) })}
                  />
                  <Label htmlFor={`cmp-layer-${l}`} className="text-sm">
                    {LAYER_LABEL[l]}
                  </Label>
                </div>
              ))}
            </fieldset>
          )}
          <CopyLinkButton />
        </div>

        <div className="relative flex min-h-[22rem] flex-1 flex-col rounded-lg border border-border bg-[#0b0f15] p-2">
          {failed ? (
            <LoadError name={failed.name} load={failed.load} />
          ) : noShared ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div className="max-w-sm space-y-3">
                <p className="font-medium">No map in common</p>
                <p className="text-sm text-muted-foreground">
                  {names.a} and {names.b} have no map that both played in this dataset, so there is nothing to compare
                  like for like.
                </p>
                {teamBId !== DEFAULT_TEAM && filters.team !== DEFAULT_TEAM && (
                  <Button size="sm" variant="outline" onClick={() => update({ teamB: DEFAULT_TEAM, map: null })}>
                    Compare with Cloud9
                  </Button>
                )}
              </div>
            </div>
          ) : loading || !mapMeta || !derived ? (
            <div className="flex flex-1 items-center justify-center" aria-busy="true">
              <Skeleton className="aspect-square h-full max-h-full max-w-full" />
              <span className="sr-only">Loading both teams…</span>
            </div>
          ) : filters.mode === "diff" ? (
            <MapCanvas
              map={mapMeta}
              heat={null}
              diff={derived.diff}
              clusters={NO_CLUSTERS}
              colors={derived.colors}
              layers={DIFF_LAYERS}
              focusId={null}
              onFocus={noop}
              description={`${mapMeta.display_name} difference heatmap, ${filterText}: blue areas are used more often per round by ${names.a}, orange areas by ${names.b}.`}
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              {KEYS.map((k) => (
                <section key={k} aria-label={names[k]} className="flex min-h-[18rem] min-w-0 flex-col gap-1.5">
                  <h3 className="px-1 text-sm">
                    <TeamTag team={k} name={names[k]} games={(k === "a" ? statsA : statsB)?.games} />
                  </h3>
                  <MapCanvas
                    map={mapMeta}
                    heat={derived.heat[k]}
                    clusters={derived.clusters[k]}
                    colors={derived.colors}
                    layers={filters.layers}
                    focusId={focusFor(k)}
                    onFocus={(id) => setFocus((f) => ({ ...f, [k]: id }))}
                    description={`${mapMeta.display_name} minimap for ${names[k]}, ${filterText}, ${derived.clusters[k].length} utility clusters.`}
                  />
                </section>
              ))}
            </div>
          )}
          {emptyFilter && !failed && (
            <div className="absolute inset-0 grid place-items-center bg-[#0b0f15]/80 p-6 text-center">
              <div className="max-w-sm space-y-3">
                <p className="font-medium">No utility for this filter</p>
                <p className="text-sm text-muted-foreground">Neither team has recorded casts for {filterText}.</p>
                <div className="flex justify-center gap-2">
                  {filters.abilities !== null && (
                    <Button size="sm" variant="outline" onClick={() => update({ abilities: null })}>
                      All abilities
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => update({ phases: ["opening", "mid", "late", "post_plant"] })}>
                    All live phases
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {derived && (
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {filters.mode === "diff" ? (
              <div className="flex flex-wrap items-center gap-2" aria-label="Difference legend">
                <span className="flex items-center gap-1.5">
                  More often <TeamTag team="b" name={names.b} />
                </span>
                <span aria-hidden className="h-2 w-32 rounded-full" style={{ background: DIFF_LEGEND_GRADIENT }} />
                <span className="flex items-center gap-1.5">
                  More often <TeamTag team="a" name={names.a} />
                </span>
                <span className="font-mono tabular-nums">±{derived.diff.maxAbs.toFixed(2)} casts/round per cell at full colour</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span>Casts per round</span>
                  <span aria-hidden className="h-2 w-24 rounded-full" style={{ background: HEAT_LEGEND_GRADIENT }} />
                  <span className="font-mono tabular-nums">max {derived.heat.a.max.toFixed(2)}/cell</span>
                </div>
                {agents.length > 0 && (
                  <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Agent colours">
                    {agents.map((a) => (
                      <li key={a} className="flex items-center gap-1.5">
                        <span aria-hidden className="size-2 rounded-full" style={{ background: derived.colors.get(a) }} />
                        {agentName(a)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <p className="basis-full text-[11px] leading-snug">
              {filters.mode === "diff"
                ? "Each 48×48 cell: Team A casts ÷ Team A rounds on this side minus the same for Team B. Cells with a single cast are hidden in the data (a cell needs 2+), so a team with one stray cast there counts as 0 and a small gap can look larger than it is. Transparent = no difference."
                : "Both maps share one heat scale, normalised per round, so equal colour means equal use. Positions are where the caster stood."}
              {(statsA && statsA.games < LOW_SAMPLE_GAMES) || (statsB && statsB.games < LOW_SAMPLE_GAMES)
                ? ` One team has fewer than ${LOW_SAMPLE_GAMES} games here: low sample.`
                : ""}
            </p>
            {filters.mode === "diff" && (
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {KEYS.map((k) => (
                  <TeamTag key={k} team={k} name={names[k]} games={(k === "a" ? statsA : statsB)?.games} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <aside aria-label="Comparison" className="min-h-0 border-t border-border lg:border-t-0 lg:border-l">
        <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
          <div className="p-4">
            {statsA && statsB && mapMeta && derived ? (
              <ComparePanel
                map={mapMeta}
                side={filters.side}
                names={names}
                stats={{ a: statsA, b: statsB }}
                rows={derived.rows}
                differences={derived.differences}
                colors={derived.colors}
                operator={{
                  a: teamSide(loadA.data?.operator, mapName, filters.side),
                  b: teamSide(loadB.data?.operator, mapName, filters.side),
                }}
              />
            ) : noShared ? (
              <p className="text-sm text-muted-foreground">Pick two teams that share a map.</p>
            ) : (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
