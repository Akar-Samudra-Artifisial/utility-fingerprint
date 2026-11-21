"use client";

import { ArrowUpRightIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LowSampleBadge } from "@/components/ui/low-sample-badge";
import { PageTitle, SideChip } from "@/components/ui/page-title";
import { SectionHeader } from "@/components/ui/section-header";
import { LOW_SAMPLE_GAMES } from "@/lib/data/compare";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { claimPatch, factsOf, formatFactValue, REPORT_TAB_LABEL, reportPhase, reportSide, scopeText } from "@/lib/data/report";
import type { MapMeta, ReportClaim, ReportFact, TeamReport, TeamSummary } from "@/lib/data/types";
import { PHASE_LABEL } from "@/lib/format";
import type { FilterState } from "@/lib/url-state";
import { cn } from "@/lib/utils";

interface ReportArticleProps {
  report: TeamReport;
  maps: readonly MapMeta[];
  teams: readonly TeamSummary[];
  update: (patch: Partial<FilterState>) => void;
  /** Export PDF / Copy link, shown next to the title (hidden in print). */
  actions?: React.ReactNode;
  /** KPI tiles shown in the header below xl and in print (the rail shows them at xl). */
  kpis?: React.ReactNode;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

/** Click, tap or Enter opens the fact behind a number; Escape or a click outside closes it. */
function FactChip({ id, fact, maps }: { id: string; fact: ReportFact; maps: readonly MapMeta[] }) {
  const value = formatFactValue(fact);
  const scope = scopeText(fact, maps);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${value}, ${fact.label}. Show fact`}
          className="inline-flex h-7 items-center rounded-md border border-border bg-muted/50 px-2 font-mono text-xs tabular-nums text-foreground outline-none hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:border-primary data-[state=open]:bg-primary/15 print:h-auto print:border-0 print:bg-transparent print:px-0"
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-auto max-w-72 gap-1.5">
        <PopoverHeader>
          <PopoverTitle>{fact.label}</PopoverTitle>
          {scope && <PopoverDescription className="text-xs">{scope}</PopoverDescription>}
        </PopoverHeader>
        <p className="font-mono text-lg tabular-nums">{value}</p>
        <p className="font-mono text-xs text-muted-foreground">fact: {id}</p>
      </PopoverContent>
    </Popover>
  );
}

const OPEN_LABEL: Record<ReportClaim["tab"], string> = {
  map: "Show on map",
  operator: "Open Operator view",
  compare: "Open comparison",
};

const SCOPE_CHIP = "inline-flex h-6 items-center rounded-full border px-2 text-xs";
const SIDE_CHIP_BORDER = { attacker: "border-attack/40", defender: "border-defense/40" } as const;

/** Claim scope as chips: map neutral, side in its semantic colour (with the word), phase muted. */
function ScopeChips({ claim, maps }: { claim: ReportClaim; maps: readonly MapMeta[] }) {
  const side = reportSide(claim.side);
  const phase = reportPhase(claim.phase);
  const map = claim.map ? maps.find((m) => m.name === claim.map)?.display_name ?? claim.map : null;
  if (!map && !side && !phase) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="sr-only">Scope: </span>
      {map && <span className={cn(SCOPE_CHIP, "border-border bg-muted/50 font-medium text-foreground")}>{map}</span>}
      {side && <SideChip side={side} className={cn(SCOPE_CHIP, SIDE_CHIP_BORDER[side])} />}
      {phase && <span className={cn(SCOPE_CHIP, "border-border text-muted-foreground")}>{PHASE_LABEL[phase]}</span>}
    </span>
  );
}

function Claim({ claim, report, maps, update }: { claim: ReportClaim } & Pick<ReportArticleProps, "report" | "maps" | "update">) {
  const facts = factsOf(claim, report);
  const scope = scopeText(claim, maps);
  const tab = claim.tab in OPEN_LABEL ? claim.tab : "map";
  const label = OPEN_LABEL[tab];
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <p className="text-base leading-relaxed text-pretty">{claim.text}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {facts.length > 0 && <span className="text-xs text-muted-foreground">Evidence</span>}
        {facts.map(([id, fact]) => (
          <FactChip key={id} id={id} fact={fact} maps={maps} />
        ))}
        {scope && facts.length > 0 && <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />}
        <ScopeChips claim={claim} maps={maps} />
        <Button
          size="xs"
          variant="link"
          className="ml-auto px-1 print:hidden"
          onClick={() => update(claimPatch(claim, report))}
          aria-label={`${label} (${REPORT_TAB_LABEL[tab]} tab)${scope ? `: ${scope}` : ""}`}
        >
          {label}
          <ArrowUpRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </li>
  );
}

export function ReportArticle({ report, maps, teams, update, actions, kpis }: ReportArticleProps) {
  const v = report.validation;
  const refId = report.reference_team_id == null ? null : String(report.reference_team_id);
  const refName = refId && refId !== String(report.team_id) ? teams.find((t) => t.id === refId)?.name ?? `team ${refId}` : null;
  const dropped = v?.dropped ?? [];

  return (
    <article className="mx-auto max-w-3xl space-y-8 print:max-w-none" aria-labelledby="report-title">
      <header className="space-y-4">
        <PageTitle
          id="report-title"
          size="lg"
          eyebrow="Scouting report"
          title={report.team_name}
          meta={
            <>
              <span>
                {report.games} game{report.games === 1 ? "" : "s"}
                {refName ? ` · compared with ${refName}` : ""}
              </span>
              {report.games < LOW_SAMPLE_GAMES && (
                <LowSampleBadge
                  reason={`Only ${report.games} game${report.games === 1 ? "" : "s"} in the dataset (fewer than ${LOW_SAMPLE_GAMES}); read claims as anecdotal.`}
                />
              )}
            </>
          }
        >
          {actions && <div className="flex gap-2 self-start print:hidden">{actions}</div>}
        </PageTitle>

        {kpis && <div className="xl:hidden print:block!">{kpis}</div>}

        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <p className="flex items-start gap-2 font-medium">
            <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary print:text-current" />
            AI-written from aggregate stats · numbers in claims are checked against the cited facts
          </p>
          <p className="mt-1 pl-6 text-xs text-muted-foreground">
            Qualitative wording without a number (e.g. &ldquo;predictable&rdquo;, &ldquo;strong&rdquo;) cannot be
            checked automatically; read it as the model&apos;s interpretation.
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <div className="flex gap-1">
              <dt>Model</dt>
              <dd className="font-mono text-foreground">{report.model}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Generated</dt>
              <dd className="text-foreground">
                <time dateTime={report.generated_at}>{formatDate(report.generated_at)}</time>
              </dd>
            </div>
            {v && (
              <div className="flex gap-1">
                <dt>Claims kept</dt>
                <dd className="font-mono text-foreground tabular-nums">
                  {v.claims_kept}/{v.claims_total}
                </dd>
              </div>
            )}
          </dl>
          {v && (
            <details className="group mt-2 text-xs">
              <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                {dropped.length === 0
                  ? "No claims were dropped"
                  : `${dropped.length} claim${dropped.length === 1 ? "" : "s"} dropped by the checker`}
                {v.retries > 0 && ` · ${v.retries} ${v.retries === 1 ? "retry" : "retries"}`}
              </summary>
              {dropped.length > 0 ? (
                <ul className="mt-2 space-y-2 border-l border-border pl-3">
                  {dropped.map((d, i) => (
                    <li key={i}>
                      <p className="text-muted-foreground line-through decoration-muted-foreground/50">{d.text}</p>
                      <p className="text-warning print:text-current">{d.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">Every claim the model wrote matched the aggregates.</p>
              )}
            </details>
          )}
        </div>

        <p className="text-lg leading-relaxed font-medium text-pretty">{report.headline}</p>
      </header>

      {report.sections.map((s) =>
        s.claims.length === 0 ? null : (
          <section key={s.id} aria-labelledby={`report-${s.id}`} className="space-y-3 break-inside-avoid-page">
            <SectionHeader id={`report-${s.id}`} variant="document" title={s.title} />
            <ul className="divide-y divide-border">
              {s.claims.map((c, i) => (
                <Claim key={i} claim={c} report={report} maps={maps} update={update} />
              ))}
            </ul>
          </section>
        ),
      )}

      {report.counters.length > 0 && (
        <section
          aria-labelledby="report-counters"
          className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4 break-inside-avoid-page print:border-black/30 print:bg-transparent"
        >
          <SectionHeader id="report-counters" variant="document" title="How to counter" className="border-b-0 pb-0" />
          <ul className="divide-y divide-border">
            {report.counters.map((c, i) => (
              <Claim key={i} claim={c} report={report} maps={maps} update={update} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
