import type { ClusterView, HeatField } from "./select";
import {
  HEAT_GRID,
  OP_TEAM_GRID,
  PHASES,
  type Cluster,
  type HeatCell,
  type OperatorBlock,
  type OpPlayer,
  type OpSideStats,
  type OpTeamSide,
  type Phase,
  type PhaseCounts,
  type Side,
} from "./types";

/** OP team summary for one map/side, whichever nesting the file uses. */
export function teamSide(op: OperatorBlock | undefined, map: string | null, side: Side): OpTeamSide | undefined {
  if (!op?.by_map || !map) return undefined;
  const m = op.by_map[map];
  return m?.sides?.[side] ?? m?.[side];
}

export function opRoundsOnMap(op: OperatorBlock | undefined, map: string): number {
  return (teamSide(op, map, "attacker")?.rounds_with_op ?? 0) + (teamSide(op, map, "defender")?.rounds_with_op ?? 0);
}

/** Side with more OP rounds on a map; attacker on a tie or when there is no OP data. */
export function mostOpSide(op: OperatorBlock | undefined, map: string | null): Side {
  if (!map) return "attacker";
  const attack = teamSide(op, map, "attacker")?.rounds_with_op ?? 0;
  const defense = teamSide(op, map, "defender")?.rounds_with_op ?? 0;
  return defense > attack ? "defender" : "attacker";
}

export function mostOpMap(op: OperatorBlock | undefined, gamesPerMap: Record<string, number> | undefined): string | null {
  if (!op || !gamesPerMap) return null;
  return (
    Object.entries(gamesPerMap)
      .filter(([, games]) => games > 0)
      .map(([map, games]) => ({ map, games, rounds: opRoundsOnMap(op, map) }))
      .filter((candidate) => candidate.rounds > 0)
      .sort((a, b) => b.rounds - a.rounds || b.games - a.games || a.map.localeCompare(b.map))[0]?.map ?? null
  );
}

export function playerSide(p: OpPlayer, map: string | null, side: Side): OpSideStats | undefined {
  return map ? p.maps[map]?.sides[side] : undefined;
}

/** Scope of the player cards: this map + side, or the player's whole dataset. */
export type OpScope = "map" | "all";

export interface PlayerLine {
  id: string;
  name: string;
  roundsWithOp: number;
  opKills: number;
  killsPerOpRound: number | null;
  survival: number | null;
  firstKills: number;
  firstKillsWithOp: number;
  firstKillShare: number | null;
  phases: PhaseCounts;
  lowSample: boolean;
  /** OP kills without any tracked OP round (holder tracking gap); rates are meaningless. */
  untracked: boolean;
}

/** Label for players with OP kills but no tracked OP round. */
export const UNTRACKED_OP_LABEL = "OP kill without tracked OP round";

/**
 * Which players to list for one map/side: anyone with a tracked OP round, plus players with OP kills
 * but zero tracked OP rounds (flagged as untracked). Players with neither are hidden.
 */
export function opSideListed(s: OpSideStats | undefined): s is OpSideStats {
  return s !== undefined && (s.rounds_with_op > 0 || s.op_kills > 0);
}

function sumPhases(maps: OpPlayer["maps"]): PhaseCounts {
  const out: PhaseCounts = {};
  for (const m of Object.values(maps)) {
    for (const p of PHASES) if (m.phases[p]) out[p] = (out[p] ?? 0) + (m.phases[p] ?? 0);
  }
  return out;
}

/** Player cards, most OP rounds first; map scope only lists players with data on that side. */
export function playerLines(op: OperatorBlock | undefined, map: string | null, side: Side, scope: OpScope): PlayerLine[] {
  if (!op) return [];
  const lines: PlayerLine[] = [];
  for (const p of op.players) {
    if (scope === "all") {
      lines.push({
        id: p.player_id,
        name: p.name,
        roundsWithOp: p.rounds_with_op,
        opKills: p.op_kills,
        killsPerOpRound: p.op_kills_per_op_round,
        survival: p.op_survival_rate,
        firstKills: p.first_kills,
        firstKillsWithOp: p.first_kills_with_op,
        firstKillShare: p.first_kill_op_share,
        phases: sumPhases(p.maps),
        lowSample: p.low_sample,
        untracked: p.rounds_with_op === 0 && p.op_kills > 0,
      });
      continue;
    }
    const s = playerSide(p, map, side);
    if (!opSideListed(s)) continue;
    lines.push({
      id: p.player_id,
      name: p.name,
      roundsWithOp: s.rounds_with_op,
      opKills: s.op_kills,
      killsPerOpRound: s.op_kills_per_op_round,
      survival: s.op_survival_rate,
      firstKills: s.first_kills,
      firstKillsWithOp: s.first_kills_with_op,
      firstKillShare: s.first_kill_op_share,
      phases: s.phases,
      lowSample: s.low_sample,
      untracked: s.rounds_with_op === 0,
    });
  }
  return lines.sort((a, b) => b.roundsWithOp - a.roundsWithOp || b.opKills - a.opKills || a.name.localeCompare(b.name));
}

function toField(sources: (HeatCell[] | undefined)[], grid: number): HeatField {
  const cells = new Float32Array(grid * grid);
  let max = 0;
  let total = 0;
  for (const heat of sources) {
    if (!heat) continue;
    for (const [col, row, count] of heat) {
      if (col < 0 || row < 0 || col >= grid || row >= grid) continue;
      const i = row * grid + col;
      cells[i] += count;
      if (cells[i] > max) max = cells[i];
      total += count;
    }
  }
  return { cells, max, total, grid };
}

function scaled(field: HeatField, by: number): HeatField {
  if (by <= 0) return { ...field, cells: new Float32Array(field.cells.length), max: 0, total: 0 };
  const cells = field.cells.map((c) => c / by);
  return { cells, max: field.max / by, total: field.total / by, grid: field.grid };
}

export interface OpMapLayers {
  /**
   * OP holder positions in opening + mid as share of OP rounds per cell (0..1).
   * null = this data build has no position heat yet.
   */
  positions: HeatField | null;
  positionClusters: Cluster[];
  /** Denominator of `positions` (OP rounds in view). */
  opRounds: number;
  /** Positions of the OP holder at kill time (count of kills per cell). */
  killers: HeatField;
  /** Victim positions of OP kills. */
  victims: HeatField;
  killClusters: Cluster[];
  /** OP kills in view (denominator of kill-cluster shares). */
  kills: number;
}

function hasField(op: OperatorBlock, pick: (s: OpSideStats) => unknown): boolean {
  return op.players.some((p) => Object.values(p.maps).some((m) => Object.values(m.sides).some((s) => s && pick(s) !== undefined)));
}

/**
 * Layers for the Operator map.
 * - positions (default): team `op_position_heat` / player `position_heat` (24×24, distinct OP rounds per
 *   cell) ÷ `op_rounds` (fallback `rounds_with_op`).
 * - killers / victims: team 24×24 heat when present, else player `heat24`/`victim_heat24`, else the
 *   original 48×48 player heat (cells need ≥ 2 kills, so mostly empty). Grids never mix in one field.
 */
export function opMapLayers(
  op: OperatorBlock | undefined,
  map: string | null,
  side: Side,
  playerId: string | null,
): OpMapLayers {
  const none: OpMapLayers = {
    positions: null,
    positionClusters: [],
    opRounds: 0,
    killers: toField([], HEAT_GRID),
    victims: toField([], HEAT_GRID),
    killClusters: [],
    kills: 0,
  };
  if (!op || !map) return none;
  const players = op.players.filter((p) => playerId === null || p.player_id === playerId);
  const sides = players.map((p) => playerSide(p, map, side)).filter((s): s is OpSideStats => s !== undefined);
  const team = teamSide(op, map, side);
  const useTeam = playerId === null && team !== undefined;

  // OP positions (angles held).
  let positions: HeatField | null = null;
  let positionClusters: Cluster[] = [];
  let opRounds = 0;
  if (useTeam && (team.op_position_heat !== undefined || team.op_position_clusters !== undefined)) {
    opRounds = team.op_rounds ?? team.rounds_with_op;
    positions = scaled(toField([team.op_position_heat], OP_TEAM_GRID), opRounds);
    positionClusters = team.op_position_clusters ?? [];
  } else if (hasField(op, (s) => s.position_heat) || team?.op_position_heat !== undefined) {
    opRounds = sides.reduce((n, s) => n + (s.op_rounds ?? s.rounds_with_op), 0);
    positions = scaled(toField(sides.map((s) => s.position_heat), OP_TEAM_GRID), opRounds);
    positionClusters = sides.length === 1 ? sides[0].position_clusters ?? [] : [];
  }

  // Kill and victim positions.
  const kills = useTeam ? team.op_kills : sides.reduce((n, s) => n + s.op_kills, 0);
  // Per-player kill clusters would overlap when several players are in view.
  const playerKillClusters = sides.length === 1 ? sides[0].clusters ?? [] : [];
  let killers: HeatField;
  let victims: HeatField;
  let killClusters: Cluster[];
  if (useTeam && (team.op_kill_heat !== undefined || team.op_victim_heat !== undefined)) {
    killers = toField([team.op_kill_heat], OP_TEAM_GRID);
    victims = toField([team.op_victim_heat], OP_TEAM_GRID);
    killClusters = team.op_kill_clusters ?? playerKillClusters;
  } else if (hasField(op, (s) => s.heat24 ?? s.victim_heat24) || team?.op_kill_heat !== undefined) {
    killers = toField(sides.map((s) => s.heat24), OP_TEAM_GRID);
    victims = toField(sides.map((s) => s.victim_heat24), OP_TEAM_GRID);
    killClusters = playerKillClusters;
  } else {
    killers = toField(sides.map((s) => s.heat), HEAT_GRID);
    victims = toField(sides.map((s) => s.victim_heat), HEAT_GRID);
    killClusters = playerKillClusters;
  }
  return { positions, positionClusters, opRounds, killers, victims, killClusters, kills };
}

/** Approximate phase from the cluster's mean time (post-plant cannot be told apart from time alone). */
function phaseOf(ms: number): Phase {
  if (ms < 0) return "buy";
  if (ms < 15_000) return "opening";
  if (ms < 45_000) return "mid";
  return "late";
}

/** Colour keys (MapCanvas looks cluster colours up by `agent`). */
export const OP_KIND = { position: "op-position", kill: "op-kill" } as const;
export type OpClusterKind = keyof typeof OP_KIND;

/** `kind` decides the id prefix and colour; `denominator` = OP rounds (positions) or OP kills (kills). */
export function opClusterViews(clusters: Cluster[], side: Side, denominator: number, kind: OpClusterKind): ClusterView[] {
  return clusters.map((cluster, i) => ({
    id: `${kind}|${i}`,
    ability: kind,
    agent: OP_KIND[kind],
    slot: "",
    phase: phaseOf(cluster.mean_t_round_ms),
    side,
    cluster,
    ratePerRound: 0,
    abilityCount: denominator,
  }));
}

export interface OpByMapRow {
  map: string;
  attacker?: OpTeamSide;
  defender?: OpTeamSide;
  roundsWithOp: number;
}

export function byMapRows(op: OperatorBlock | undefined): OpByMapRow[] {
  if (!op?.by_map) return [];
  return Object.keys(op.by_map)
    .map((map) => {
      const attacker = teamSide(op, map, "attacker");
      const defender = teamSide(op, map, "defender");
      return { map, attacker, defender, roundsWithOp: (attacker?.rounds_with_op ?? 0) + (defender?.rounds_with_op ?? 0) };
    })
    .sort((a, b) => b.roundsWithOp - a.roundsWithOp || a.map.localeCompare(b.map));
}
