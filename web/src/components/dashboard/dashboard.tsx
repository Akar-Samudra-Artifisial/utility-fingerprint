"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  CrosshairIcon,
  FileTextIcon,
  GitCompareIcon,
  MapIcon,
  RotateCwIcon,
  type LucideIcon,
} from "lucide-react";

import { BrandLockup } from "@/components/brand/logo";
import { CompareView } from "@/components/compare/compare-view";
import { FilterSidebar } from "@/components/filters/filter-sidebar";
import { OperatorView } from "@/components/operator/operator-view";
import { ReportView } from "@/components/report/report-view";
import { MapCanvas } from "@/components/map/map-canvas";
import { MapLegend } from "@/components/map/map-legend";
import { KeyInsights } from "@/components/summary/key-insights";
import { mapInsights } from "@/components/summary/map-insights";
import { SummaryPanel } from "@/components/summary/summary-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageTitle } from "@/components/ui/page-title";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agentColorMap } from "@/lib/colors";
import { dataUrl } from "@/lib/data/fetch";
import { rememberTeam, useIndex, useLastViewedTeam, useTeam } from "@/lib/data/hooks";
import { abilityGroups, clusterViews, heatField, signatureClusters, totalCasts } from "@/lib/data/select";
import { PHASE_LABEL, SIDE_LABEL } from "@/lib/format";
import { DEFAULT_TEAM, LAYERS, parseFilters, serializeFilters, TABS, type FilterState, type Layer, type Tab } from "@/lib/url-state";
import { CopyLinkButton } from "./copy-link-button";

const LAYER_LABEL: Record<Layer, string> = { heat: "Heatmap", clusters: "Clusters", arrows: "Aim arrows" };

const NAV: { tab: Tab; label: string; Icon: LucideIcon }[] = [
  { tab: "map", label: "Utility map", Icon: MapIcon },
  { tab: "report", label: "Scouting report", Icon: FileTextIcon },
  { tab: "operator", label: "Operator", Icon: CrosshairIcon },
  { tab: "compare", label: "Compare", Icon: GitCompareIcon },
];

export function Dashboard() {
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  const index = useIndex();
  const team = useTeam(filters.team);
  const lastViewed = useLastViewedTeam();

  // Remember the last non-Cloud9 team so "Compare" can default to it when Team A is Cloud9.
  useEffect(() => {
    if (filters.team !== DEFAULT_TEAM) rememberTeam(filters.team);
  }, [filters.team]);
  const teamSummary = index.data?.teams.find((t) => t.id === filters.team);

  // Fall back to the team's most played map when the URL has none (or one they never played).
  const mapName = useMemo(() => {
    const maps = team.data?.maps;
    if (!maps) return filters.map;
    if (filters.map && maps[filters.map]) return filters.map;
    return Object.entries(maps).sort((a, b) => b[1].games - a[1].games)[0]?.[0] ?? null;
  }, [team.data, filters.map]);

  const update = useCallback(
    (patch: Partial<FilterState>) => {
      // Pin the resolved map so a copied link always names it explicitly.
      const next = { ...filters, map: mapName, ...patch };
      // Next.js syncs native history calls with useSearchParams.
      window.history.replaceState(null, "", `?${serializeFilters(next)}`);
    },
    [filters, mapName],
  );

  const mapMeta = index.data?.maps.find((m) => m.name === mapName);
  const stats = mapName ? team.data?.maps[mapName] : undefined;
  const selected = useMemo(() => (filters.abilities === null ? null : new Set(filters.abilities)), [filters.abilities]);

  const derived = useMemo(() => {
    if (!stats) return null;
    const groups = abilityGroups(stats, filters.side, filters.phases);
    const clusters = clusterViews(stats, filters.side, filters.phases, selected);
    return {
      groups,
      colors: agentColorMap(Object.values(stats.abilities).map((a) => a.agent)),
      heat: heatField(stats, filters.side, filters.phases, selected),
      clusters,
      signatures: signatureClusters(clusters),
      casts: totalCasts(stats, filters.side, filters.phases, selected),
    };
  }, [stats, filters.side, filters.phases, selected]);

  const focusId = derived?.clusters.some((c) => c.id === filters.focus) ? filters.focus : null;
  const setFocus = useCallback((id: string | null) => update({ focus: id }), [update]);
  const toggleLayer = (layer: Layer, on: boolean) =>
    update({ layers: LAYERS.filter((l) => (l === layer ? on : filters.layers.includes(l))) });

  const loadingTeam = !team.data && !team.error;
  const isEmpty = derived !== null && derived.casts === 0;
  const filterText = `${SIDE_LABEL[filters.side]} · ${filters.phases.map((p) => PHASE_LABEL[p]).join(", ")}`;

  if (index.error) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div className="max-w-md space-y-2">
          <h2 className="text-lg font-semibold">Data not found</h2>
          <p className="text-sm text-muted-foreground">
            Could not load <code className="font-mono">{dataUrl("index.json")}</code>. Run the ETL build to generate the
            aggregates into <code className="font-mono">web/public/data/</code>.
          </p>
          <Button size="sm" variant="outline" onClick={index.retry}>
            <RotateCwIcon /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Tabs
      value={filters.tab}
      onValueChange={(v) => (TABS as readonly string[]).includes(v) && update({ tab: v as Tab })}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <header className="flex flex-wrap items-center gap-x-8 gap-y-1 border-b border-border px-4 lg:px-6 print:border-black/20 print:px-0 print:pb-3">
        <BrandLockup className="py-2.5" />
        <nav aria-label="Views" className="order-last -mb-px w-full overflow-x-auto md:order-none md:w-auto print:hidden">
          <TabsList variant="line" className="h-auto! gap-1 p-0">
            {NAV.map(({ tab, label, Icon }) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-12 flex-none rounded-none border-0 border-b-2 border-transparent px-3 text-sm after:hidden data-active:border-primary! data-active:text-foreground"
              >
                <Icon aria-hidden />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>
        {/* Compare names two teams and Operator resolves its own map, so the chip only claims what is shared. */}
        {teamSummary && filters.tab !== "compare" && (
          <p className="ml-auto inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs print:hidden">
            <span className="sr-only">Current context: </span>
            <span className="truncate font-medium">{teamSummary.name}</span>
            {filters.tab === "map" && mapMeta && (
              <>
                <span aria-hidden className="text-muted-foreground">·</span>
                <span className="truncate text-muted-foreground">{mapMeta.display_name}</span>
              </>
            )}
          </p>
        )}
      </header>

      <TabsContent value="map" className="min-h-0 flex-1">
        <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[18.5rem_minmax(0,1fr)_21rem]">
          <aside aria-label="Filters" className="min-h-0 border-t border-border lg:border-t-0 lg:border-r">
            <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
              <div className="p-4">
                {index.data ? (
                  <FilterSidebar
                    index={index.data}
                    team={teamSummary}
                    filters={filters}
                    mapName={mapName}
                    groups={derived?.groups ?? []}
                    selected={selected}
                    colors={derived?.colors ?? new Map()}
                    update={update}
                  />
                ) : (
                  <div className="space-y-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-60 w-full" />
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>

          <main className="order-first flex min-h-[28rem] min-w-0 flex-col gap-3 p-4 lg:order-none lg:min-h-0">
            <PageTitle
              title={
                <>
                  {teamSummary?.name ?? "…"}
                  <span className="text-muted-foreground"> on </span>
                  {mapMeta?.display_name ?? "…"}
                </>
              }
              side={filters.side}
              meta={
                <span>
                  {filters.phases.map((p) => PHASE_LABEL[p]).join(", ")}
                  {derived && ` · ${derived.casts.toLocaleString("en-US")} casts · ${derived.clusters.length} clusters`}
                </span>
              }
            >
              <fieldset className="flex flex-wrap items-center gap-4">
                <legend className="sr-only">Map layers</legend>
                {LAYERS.map((l) => (
                  <div key={l} className="flex items-center gap-2">
                    <Switch
                      id={`layer-${l}`}
                      checked={filters.layers.includes(l)}
                      onCheckedChange={(on) => toggleLayer(l, on)}
                    />
                    <Label htmlFor={`layer-${l}`} className="text-sm">
                      {LAYER_LABEL[l]}
                    </Label>
                  </div>
                ))}
              </fieldset>
              <CopyLinkButton />
            </PageTitle>

            {stats && mapMeta && derived && !isEmpty && (
              <KeyInsights
                id="map-insights-title"
                insights={mapInsights({
                  stats,
                  map: mapMeta,
                  signatures: derived.signatures,
                  colors: derived.colors,
                  focusId,
                  onFocus: setFocus,
                })}
              />
            )}

            <div className="relative flex min-h-[20rem] flex-1 flex-col rounded-lg border border-border bg-map-surface p-2">
              {team.error ? (
                <div className="grid flex-1 place-items-center p-6 text-center">
                  <div className="space-y-3">
                    <p className="text-sm text-destructive">Could not load team data ({team.error}).</p>
                    <Button size="sm" variant="outline" onClick={team.retry}>
                      <RotateCwIcon /> Retry
                    </Button>
                  </div>
                </div>
              ) : loadingTeam || !mapMeta || !derived ? (
                <div className="flex flex-1 items-center justify-center" aria-busy="true">
                  <Skeleton className="aspect-square h-full max-h-full max-w-full" />
                  <span className="sr-only">Loading team data…</span>
                </div>
              ) : (
                <>
                  <MapCanvas
                    map={mapMeta}
                    heat={derived.heat}
                    clusters={derived.clusters}
                    colors={derived.colors}
                    layers={filters.layers}
                    focusId={focusId}
                    onFocus={setFocus}
                    description={`${mapMeta.display_name} minimap with ${derived.clusters.length} utility clusters for ${teamSummary?.name ?? "team"}, ${filterText}. Signature setups are listed in the summary panel.`}
                  />
                  {isEmpty && (
                    <div className="absolute inset-0 grid place-items-center bg-map-surface/80 p-6 text-center">
                      <div className="max-w-sm space-y-3">
                        <p className="font-medium">No utility for this filter</p>
                        <p className="text-sm text-muted-foreground">
                          {teamSummary?.name} has no recorded casts for {filterText}
                          {filters.abilities ? " with the selected abilities" : ""}.
                        </p>
                        <div className="flex justify-center gap-2">
                          {filters.abilities !== null && (
                            <Button size="sm" variant="outline" onClick={() => update({ abilities: null })}>
                              All abilities
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => update({ phases: ["opening", "mid", "late", "post_plant"] })}
                          >
                            All live phases
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {derived && <MapLegend colors={derived.colors} clusters={derived.clusters} heatMax={derived.heat.max} />}
          </main>

          <aside aria-label="Summary" className="min-h-0 border-t border-border lg:border-t-0 lg:border-l">
            <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
              <div className="p-4">
                {stats && mapMeta && derived ? (
                  <SummaryPanel
                    stats={stats}
                    map={mapMeta}
                    side={filters.side}
                    signatures={derived.signatures}
                    colors={derived.colors}
                    focusId={focusId}
                    onFocus={setFocus}
                  />
                ) : (
                  <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>
        </div>
      </TabsContent>

      <TabsContent value="report" className="min-h-0 flex-1 print:block">
        {index.data ? (
          <ReportView index={index.data} team={team} filters={filters} update={update} />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4 p-6" aria-busy="true">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </TabsContent>
      <TabsContent value="operator" className="min-h-0 flex-1">
        {index.data ? (
          <OperatorView
            index={index.data}
            team={team}
            teamSummary={teamSummary}
            filters={filters}
            mapName={mapName}
            update={update}
          />
        ) : (
          <div className="grid gap-4 p-6 lg:grid-cols-[18.5rem_1fr]" aria-busy="true">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-[28rem] w-full" />
          </div>
        )}
      </TabsContent>
      <TabsContent value="compare" className="min-h-0 flex-1">
        {index.data ? (
          <CompareView index={index.data} filters={filters} update={update} lastViewed={lastViewed} />
        ) : (
          <div className="grid gap-4 p-6 lg:grid-cols-[18.5rem_1fr]" aria-busy="true">
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-[28rem] w-full" />
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
