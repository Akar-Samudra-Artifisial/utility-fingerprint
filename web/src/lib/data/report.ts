import { PHASE_LABEL, rate, roundClock, SIDE_LABEL } from "@/lib/format";
import type { FilterState } from "@/lib/url-state";
import { PHASES, type MapMeta, type Phase, type ReportClaim, type ReportFact, type ReportSide, type Side, type TeamReport } from "./types";

/** Report sides are attack/defense; the URL uses attacker/defender. */
export const REPORT_SIDE: Record<Exclude<ReportSide, Side>, Side> = { attack: "attacker", defense: "defender" };

/** Accepts the documented attack/defense and the attacker/defender the ETL actually writes. */
export function reportSide(side: string | null | undefined): Side | null {
  if (side === "attack" || side === "defense") return REPORT_SIDE[side];
  return side === "attacker" || side === "defender" ? side : null;
}

export function reportPhase(phase: string | null | undefined): Phase | null {
  return (PHASES as readonly string[]).includes(phase ?? "") ? (phase as Phase) : null;
}

function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function formatFactValue(fact: ReportFact): string {
  const v = fact.value;
  if (!Number.isFinite(v)) return "—";
  switch (fact.unit) {
    case "pct":
      // Whole percent with Python's round-half-even, like the ETL's display(), so "5%" in the
      // claim text matches the chip.
      return `${roundHalfEven(v * 100)}%`;
    case "seconds":
      return roundClock(v * 1000);
    case "rate":
      return rate(v);
    case "count":
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
}

/** "Haven · Defense · Opening" for whichever of map/side/phase is set. */
export function scopeText(
  scope: { map?: string | null; side?: string | null; phase?: string | null },
  maps: readonly MapMeta[],
): string {
  const side = reportSide(scope.side);
  const phase = reportPhase(scope.phase);
  return [
    scope.map ? maps.find((m) => m.name === scope.map)?.display_name ?? scope.map : null,
    side ? SIDE_LABEL[side] : null,
    phase ? PHASE_LABEL[phase] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const REPORT_TAB_LABEL: Record<ReportClaim["tab"], string> = {
  map: "Utility map",
  operator: "Operator",
  compare: "Compare",
};

/** Filters that open the claim's evidence; unset claim fields keep the current filter. */
export function claimPatch(claim: ReportClaim, report: TeamReport): Partial<FilterState> {
  const tab = claim.tab === "operator" || claim.tab === "compare" ? claim.tab : "map";
  const patch: Partial<FilterState> = { tab, abilities: null, focus: null, player: null };
  if (claim.map) patch.map = claim.map;
  const side = reportSide(claim.side);
  if (side) patch.side = side;
  const phase = reportPhase(claim.phase);
  if (phase) patch.phases = [phase];
  if (tab === "compare") {
    const ref = report.reference_team_id == null ? null : String(report.reference_team_id);
    // resolveTeamB falls back to the default opponent when the reference is the team itself.
    patch.teamB = ref && ref !== String(report.team_id) ? ref : null;
    patch.mode = "side";
  }
  return patch;
}

export function factsOf(claim: ReportClaim, report: TeamReport): [string, ReportFact][] {
  return claim.fact_ids.flatMap((id) => (report.facts[id] ? [[id, report.facts[id]] as [string, ReportFact]] : []));
}

export const REPORT_CLI = (teamId: string) => `uv run python -m utility_fingerprint_etl report --teams ${teamId}`;
