/**
 * Types for the aggregated JSON written by `etl/.../aggregate.py`
 * (`web/public/data/index.json` and `web/public/data/teams/<team_id>.json`).
 * Schema: docs/data-pipeline.md → "Aggregates". Verified against the real files.
 */

export const SIDES = ["attacker", "defender"] as const;
export type Side = (typeof SIDES)[number];

export const PHASES = ["buy", "opening", "mid", "late", "post_plant"] as const;
export type Phase = (typeof PHASES)[number];

/** Normalized minimap coordinates, 0..1, origin top-left of the map's `displayIcon`. */
export interface UV {
  u: number;
  v: number;
}

export interface MapCoefficients {
  xMultiplier: number;
  yMultiplier: number;
  xScalarToAdd: number;
  yScalarToAdd: number;
}

export interface MapSite extends UV {
  site: string;
}

export interface MapMeta {
  name: string;
  display_name: string;
  display_icon: string;
  /** Locally hosted minimap image; falls back to `display_icon` when unavailable. */
  display_icon_local?: string;
  games: number;
  coefficients: MapCoefficients;
  formula: string;
  sites: MapSite[];
}

export interface TeamSummary {
  id: string;
  name: string;
  last_tournament: string;
  games: number;
  games_per_map: Record<string, number>;
}

export interface Definitions {
  phases_ms_from_freezetime_end: Record<Phase, string>;
  uv: string;
  heat: string;
  clusters: string;
  rate_per_round: string;
  data_notice: string;
}

export interface DataIndex {
  generated_at: string;
  teams: TeamSummary[];
  maps: MapMeta[];
  definitions: Definitions;
}

/** Sparse heat cell `[col, row, count]` on a 48×48 grid over u/v; only cells with count ≥ 2. */
export type HeatCell = [col: number, row: number, count: number];
export const HEAT_GRID = 48;

export interface Cluster extends UV {
  /** p90 distance of members to the centroid, in u/v units. */
  radius: number;
  count: number;
  /** Fraction of the ability's casts (in this side/phase) that fall in this cluster. */
  share: number;
  /** Distinct rounds with this cluster; the denominator for this cluster's win rate. */
  rounds?: number;
  /** Rounds won among `rounds` when this cluster was used. */
  wins?: number;
  /** Player IDs and their share of casts in this cluster (denominator: all cluster casts). */
  players?: [playerId: string, share: number][];
  /** Mean aim direction as a unit vector in minimap u/v space (already axis-swapped). */
  view?: [du: number, dv: number];
  /** Length of the mean aim vector, 0..1 (1 = everyone aims the same way). */
  view_consistency?: number;
  /** Mean time since freezetime end; negative = buy phase. */
  mean_t_round_ms: number;
}

export interface AbilityStats {
  count: number;
  rounds_played: number;
  rate_per_round: number;
  heat?: HeatCell[];
  clusters?: Cluster[];
}

export interface AbilityMeta {
  agent: string;
  slot: string;
}

export type UtilityByPhase = Partial<Record<Phase, Record<string, AbilityStats>>>;

/** Team round outcomes for a side and phase, among rounds where any utility was used. */
export interface RoundRecord {
  /** Rounds with any utility used on this side in this phase; denominator for the win rate. */
  rounds: number;
  /** Rounds won among `rounds` with any utility used on this side in this phase. */
  wins: number;
}

export interface TeamMapStats {
  games: number;
  wins: number;
  rounds: Record<Side, number>;
  round_wins: Record<Side, number>;
  round_win_rate: Record<Side, number>;
  plant_sites: Record<string, number>;
  plant_site_share: Record<string, number>;
  abilities: Record<string, AbilityMeta>;
  utility: Partial<Record<Side, UtilityByPhase>>;
  /** Baseline outcomes; denominator is rounds with any utility on the same side and phase. */
  phase_rounds?: Partial<Record<Side, Partial<Record<Phase, RoundRecord>>>>;
}

/** Team-level heat on a coarser 24×24 grid (Operator kills are too sparse for 48×48). */
export const OP_TEAM_GRID = 24;

/** OP kills per phase; only non-zero phases are present. */
export type PhaseCounts = Partial<Record<Phase, number>>;

/**
 * `operator.players[].maps.<map>.sides.<side>` (docs/data-pipeline.md → "Operator profiler").
 * Rates are null when their denominator is 0. `op_lost_to_enemy` exists but is always 0 (not
 * supported by the data) and is deliberately not typed so it cannot be shown.
 */
export interface OpSideStats {
  rounds_played: number;
  op_kills: number;
  rounds_with_op: number;
  op_round_rate: number | null;
  op_kills_per_op_round: number | null;
  op_deaths: number;
  op_survival_rate: number | null;
  rounds_with_op_kill: number;
  first_kills: number;
  first_kills_with_op: number;
  first_kill_op_share: number | null;
  phases: PhaseCounts;
  killed_by?: Record<string, number>;
  /** Killer (OP holder) positions, 48×48, count ≥ 2. */
  heat?: HeatCell[];
  clusters?: Cluster[];
  /** Victim positions of OP kills, 48×48, count ≥ 2. */
  victim_heat?: HeatCell[];
  /** Additive rebuild: same positions on the 24×24 grid. */
  heat24?: HeatCell[];
  victim_heat24?: HeatCell[];
  /**
   * Additive rebuild (24×24): OP holder positions during opening + mid of OP rounds;
   * cell value = distinct OP rounds that touched the cell. Denominator: `op_rounds`.
   */
  position_heat?: HeatCell[];
  position_clusters?: Cluster[];
  op_rounds?: number;
  /** rounds_with_op < 10. */
  low_sample: boolean;
}

export interface OpPlayerMap {
  op_kills: number;
  rounds_with_op: number;
  phases: PhaseCounts;
  heat?: HeatCell[];
  clusters?: Cluster[];
  victim_heat?: HeatCell[];
  heat24?: HeatCell[];
  victim_heat24?: HeatCell[];
  /** Side omitted when the player had no OP round and no OP kill there. */
  sides: Partial<Record<Side, OpSideStats>>;
}

export interface OpPlayer {
  player_id: string;
  name: string;
  kills: number;
  op_kills: number;
  op_kill_share: number | null;
  first_kills: number;
  first_kills_with_op: number;
  first_kill_op_share: number | null;
  rounds_played: number;
  rounds_with_op_kill: number;
  rounds_with_op_kill_rate: number | null;
  rounds_with_op: number;
  op_round_rate: number | null;
  op_kills_per_op_round: number | null;
  op_deaths: number;
  op_survival_rate: number | null;
  low_sample: boolean;
  maps: Record<string, OpPlayerMap>;
}

export interface OpTopPlayer {
  player_id: string;
  name: string;
  op_kills: number;
  rounds_with_op: number;
}

/** `operator.by_map.<map>.<side>` — team summary per map and side. */
export interface OpTeamSide {
  rounds: number;
  rounds_with_op: number;
  op_round_pct: number | null;
  rounds_with_op_kill: number;
  op_kill_round_pct: number | null;
  op_kills: number;
  first_kills: number;
  first_kills_with_op: number;
  first_kill_op_share: number | null;
  top_op_player: OpTopPlayer | null;
  /** rounds < 24. */
  low_sample: boolean;
  /** Additive rebuild (24×24): OP-holder positions at kill time, victim positions, clusters. */
  op_kill_heat?: HeatCell[];
  op_victim_heat?: HeatCell[];
  op_kill_clusters?: Cluster[];
  clusters?: Cluster[];
  /** Additive rebuild (24×24): OP holder positions in opening + mid, distinct rounds per cell. */
  op_position_heat?: HeatCell[];
  op_position_clusters?: Cluster[];
  /** Denominator of `op_position_heat`. */
  op_rounds?: number;
}

/** Sides directly under the map today; the additive rebuild may nest them under `sides`. */
export type OpTeamMap = Partial<Record<Side, OpTeamSide>> & { sides?: Partial<Record<Side, OpTeamSide>> };

export interface OperatorBlock {
  team_kills: number;
  team_op_kills: number;
  team_first_kills: number;
  team_first_kills_with_op: number;
  /** `freezetime_inventory`, or `none` when the team has no holder rows. */
  holder_source?: string;
  players: OpPlayer[];
  by_map?: Record<string, OpTeamMap>;
}

export interface TeamFile {
  team: TeamSummary;
  maps: Record<string, TeamMapStats>;
  operator: OperatorBlock;
  /** Optional lookup from player ID to display name for cluster player shares. */
  players?: Record<string, string>;
  generated_at: string;
  definitions: Definitions;
}

/*
 * Scouting reports written by `utility_fingerprint_etl report` (Claude; numbers in claims are validated against the cited facts):
 * `web/public/data/reports/<team_id>.json` and `reports/index.json`. Only some teams have one.
 */

export type ReportUnit = "pct" | "count" | "rate" | "seconds";
/**
 * The ETL writes attacker/defender (same as the URL and team files); the original spec said
 * attack/defense, so the parser (`reportSide`) accepts both.
 */
export type ReportSide = "attack" | "defense" | Side;
export type ReportTab = "map" | "operator" | "compare";

export interface ReportFact {
  label: string;
  value: number;
  unit: ReportUnit;
  map?: string | null;
  side?: ReportSide | null;
  phase?: string | null;
}

export interface ReportClaim {
  text: string;
  fact_ids: string[];
  map: string | null;
  side: ReportSide | null;
  phase: string | null;
  tab: ReportTab;
}

export interface ReportSection {
  id: string;
  title: string;
  claims: ReportClaim[];
}

export interface ReportValidation {
  claims_total: number;
  claims_kept: number;
  claims_dropped: number;
  retries: number;
  dropped: { text: string; reason: string }[];
}

export interface TeamReport {
  version: number;
  team_id: number | string;
  team_name: string;
  generated_at: string;
  model: string;
  provider: "anthropic-api" | "claude-cli" | string;
  games: number;
  headline: string;
  sections: ReportSection[];
  counters: ReportClaim[];
  reference_team_id: number | string | null;
  facts: Record<string, ReportFact>;
  validation: ReportValidation;
}

export interface ReportIndexEntry {
  team_id: number | string;
  team_name: string;
  generated_at: string;
  claims_kept: number;
}
