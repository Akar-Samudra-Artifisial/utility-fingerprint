"use client";

import { useCallback, useMemo } from "react";
import { FileTextIcon, RotateCwIcon } from "lucide-react";

import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { TeamPicker } from "@/components/filters/team-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/ui/section-header";
import { useReport, useReportIndex, type Load } from "@/lib/data/hooks";
import { REPORT_CLI } from "@/lib/data/report";
import type { DataIndex, ReportIndexEntry, TeamFile } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/lib/url-state";
import { ExportPdfButton } from "./export-pdf-button";
import { ReportArticle } from "./report-article";
import { ReportKpis, reportKpis, ReportToc } from "./report-glance";

interface ReportViewProps {
  index: DataIndex;
  /** Same team load as the other tabs (feeds the KPI rail). */
  team: Load<TeamFile>;
  filters: FilterState;
  update: (patch: Partial<FilterState>) => void;
}

function ReportTeamList({
  entries,
  current,
  onPick,
}: {
  entries: ReportIndexEntry[];
  current: string;
  onPick: (teamId: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-1">
      {entries.map((e) => {
        const id = String(e.team_id);
        const active = id === current;
        return (
          <li key={id} className="min-w-0">
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onPick(id)}
              title={`${e.team_name} · ${e.claims_kept} claims`}
              className={cn(
                "w-full truncate rounded-md border border-border px-2 py-1 text-left text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                active && "border-primary bg-primary/15 font-medium",
              )}
            >
              {e.team_name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportView({ index, team, filters, update: rawUpdate }: ReportViewProps) {
  const update = useCallback((patch: Partial<FilterState>) => rawUpdate({ tab: "report", ...patch }), [rawUpdate]);
  const pickTeam = useCallback(
    (teamId: string) => update({ team: teamId, map: null, player: null, abilities: null, focus: null }),
    [update],
  );
  // Claims navigate to other tabs, so their patches must not be forced back to "report".
  const navigate = rawUpdate;

  const reports = useReportIndex();
  const report = useReport(filters.team);
  const entries = useMemo(
    () => [...(reports.data ?? [])].sort((a, b) => a.team_name.localeCompare(b.team_name)),
    [reports.data],
  );
  const marked = useMemo(() => new Set(entries.map((e) => String(e.team_id))), [entries]);
  const teamName = index.teams.find((t) => t.id === filters.team)?.name ?? `Team ${filters.team}`;
  const loading = report.data === undefined && !report.error;
  const kpis = useMemo(
    () => (team.data && team.data.team.id === filters.team ? reportKpis(team.data, index.maps) : null),
    [team.data, filters.team, index.maps],
  );

  return (
    <>
      <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[18.5rem_minmax(0,1fr)] print:block print:h-auto">
        <aside
          aria-label="Report filters"
          className="min-h-0 border-t border-border lg:overflow-y-auto lg:border-t-0 lg:border-r print:hidden"
        >
          <div className="space-y-6 p-4">
            <div className="space-y-2">
              <label htmlFor="report-team-picker" className="block text-xs font-medium text-muted-foreground">
                Team <span className="font-normal">· <FileTextIcon aria-hidden className="inline size-3 align-[-1px]" /> has a report</span>
              </label>
              <TeamPicker id="report-team-picker" teams={index.teams} value={filters.team} onChange={pickTeam} marked={marked} />
            </div>

            <div role="group" aria-labelledby="report-list-label" className="space-y-2">
              <p id="report-list-label" className="text-xs font-medium text-muted-foreground">
                Teams with a report{reports.data ? ` · ${entries.length}` : ""}
              </p>
              {reports.error ? (
                <div className="space-y-2 text-xs">
                  <p className="text-destructive">Could not load the report list.</p>
                  <Button size="xs" variant="outline" onClick={reports.retry}>
                    <RotateCwIcon /> Retry
                  </Button>
                </div>
              ) : !reports.data ? (
                <div className="space-y-1.5" aria-busy="true">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : entries.length === 0 ? (
                <p className="text-xs text-muted-foreground">No reports generated yet.</p>
              ) : (
                <ReportTeamList entries={entries} current={filters.team} onPick={pickTeam} />
              )}
            </div>
          </div>
        </aside>

        <main className="order-first min-w-0 lg:order-none lg:overflow-y-auto print:overflow-visible">
          {/* With a report the actions sit next to its title (ReportArticle); otherwise keep Copy link here. */}
          {!(report.data && !report.error) && (
            <div className="flex justify-end gap-2 px-4 pt-4 lg:px-8 print:hidden">
              <CopyLinkButton />
            </div>
          )}
          <div className={cn("px-4 pb-10 lg:px-8", report.data && !report.error ? "pt-6 print:pt-0" : "pt-2")}>
            {report.error ? (
              <div className="mx-auto max-w-md space-y-3 py-16 text-center">
                <p className="text-sm text-destructive">Could not load the report ({report.error}).</p>
                <Button size="sm" variant="outline" onClick={report.retry}>
                  <RotateCwIcon /> Retry
                </Button>
              </div>
            ) : loading ? (
              <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
                <span className="sr-only">Loading report…</span>
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : report.data ? (
              // xl: article + sticky rail. Below xl and in print: one column, KPIs inside the article header.
              <div className="mx-auto max-w-3xl xl:grid xl:max-w-[76rem] xl:grid-cols-[minmax(0,48rem)_20rem] xl:justify-center xl:gap-10 print:block print:max-w-none">
                <ReportArticle
                  report={report.data}
                  maps={index.maps}
                  teams={index.teams}
                  update={navigate}
                  actions={
                    <>
                      <ExportPdfButton title={`${teamName} scouting report`} />
                      <CopyLinkButton />
                    </>
                  }
                  kpis={<ReportKpis data={kpis} className="sm:grid-cols-3 print:grid-cols-3" />}
                />
                <aside aria-labelledby="report-glance-title" className="hidden min-w-0 xl:block print:hidden!">
                  <div className="sticky top-6 space-y-6">
                    <div className="space-y-2.5">
                      <SectionHeader id="report-glance-title" title="At a glance" />
                      <ReportKpis data={kpis} />
                    </div>
                    <ReportToc report={report.data} />
                  </div>
                </aside>
              </div>
            ) : (
              <div className="mx-auto max-w-xl space-y-5 py-12">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold">No scouting report for {teamName} yet</h2>
                  <p className="text-sm text-muted-foreground">
                    Reports are written by Claude from this team&apos;s aggregates and checked number by number. Only
                    some teams have one so far.
                  </p>
                </div>
                {entries.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Open a team that has a report</p>
                    <div className="flex flex-wrap gap-2">
                      {entries.map((e) => (
                        <Button key={String(e.team_id)} size="sm" variant="outline" onClick={() => pickTeam(String(e.team_id))}>
                          {e.team_name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Generate one (from the repo&apos;s etl/ folder)</p>
                  <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
                    <code>{REPORT_CLI(filters.team)}</code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
