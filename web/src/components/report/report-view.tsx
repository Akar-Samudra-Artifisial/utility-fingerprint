"use client";

import { useCallback, useMemo } from "react";
import { FileTextIcon, RotateCwIcon } from "lucide-react";

import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { TeamPicker } from "@/components/filters/team-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useReport, useReportIndex } from "@/lib/data/hooks";
import { REPORT_CLI } from "@/lib/data/report";
import type { DataIndex, ReportIndexEntry } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/lib/url-state";
import { ReportArticle } from "./report-article";

interface ReportViewProps {
  index: DataIndex;
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
    <ul className="space-y-1">
      {entries.map((e) => {
        const id = String(e.team_id);
        const active = id === current;
        return (
          <li key={id}>
            <button
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onPick(id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                active && "border-primary bg-primary/15",
              )}
            >
              <span className="truncate">{e.team_name}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{e.claims_kept} claims</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportView({ index, filters, update: rawUpdate }: ReportViewProps) {
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
          <div className="flex justify-end px-4 pt-4 lg:px-8 print:hidden">
            <CopyLinkButton />
          </div>
          <div className="px-4 pt-2 pb-10 lg:px-8">
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
              <ReportArticle report={report.data} maps={index.maps} teams={index.teams} update={navigate} />
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
