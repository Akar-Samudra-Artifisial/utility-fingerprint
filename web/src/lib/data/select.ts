import {
  HEAT_GRID,
  type AbilityStats,
  type Cluster,
  type Phase,
  type Side,
  type TeamMapStats,
} from "./types";

export interface AbilityOption {
  ability: string;
  slot: string;
  count: number;
}

export interface AgentGroup {
  agent: string;
  count: number;
  abilities: AbilityOption[];
}

export interface ClusterView {
  /** Stable id: `${ability}|${phase}|${index}` (index within the ability's top-5 list). */
  id: string;
  ability: string;
  agent: string;
  slot: string;
  phase: Phase;
  side: Side;
  cluster: Cluster;
  ratePerRound: number;
  abilityCount: number;
}

export interface HeatField {
  /** Row-major grid × grid counts. */
  cells: Float32Array;
  max: number;
  total: number;
  /** Cells per side; defaults to HEAT_GRID (48). */
  grid?: number;
}

const SLOT_ORDER: Record<string, number> = { GRENADE: 0, ABILITY_1: 1, ABILITY_2: 2, ULTIMATE: 3 };

function* entries(
  stats: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
): Generator<[Phase, string, AbilityStats]> {
  const bySide = stats.utility[side];
  if (!bySide) return;
  for (const phase of phases) {
    const byAbility = bySide[phase];
    if (!byAbility) continue;
    for (const [ability, s] of Object.entries(byAbility)) yield [phase, ability, s];
  }
}

/** Abilities used on this map/side/phases, grouped by agent, sorted by usage. */
export function abilityGroups(
  stats: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
): AgentGroup[] {
  const counts = new Map<string, number>();
  for (const [, ability, s] of entries(stats, side, phases)) {
    counts.set(ability, (counts.get(ability) ?? 0) + s.count);
  }
  const groups = new Map<string, AgentGroup>();
  for (const [ability, count] of counts) {
    const meta = stats.abilities[ability];
    const agent = meta?.agent ?? "unknown";
    let g = groups.get(agent);
    if (!g) {
      g = { agent, count: 0, abilities: [] };
      groups.set(agent, g);
    }
    g.count += count;
    g.abilities.push({ ability, slot: meta?.slot ?? "", count });
  }
  for (const g of groups.values()) {
    g.abilities.sort((a, b) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9));
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function included(ability: string, selected: ReadonlySet<string> | null): boolean {
  return selected === null || selected.has(ability);
}

export function heatField(
  stats: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
  selected: ReadonlySet<string> | null,
): HeatField {
  const cells = new Float32Array(HEAT_GRID * HEAT_GRID);
  let max = 0;
  let total = 0;
  for (const [, ability, s] of entries(stats, side, phases)) {
    if (!s.heat || !included(ability, selected)) continue;
    for (const [col, row, count] of s.heat) {
      if (col < 0 || row < 0 || col >= HEAT_GRID || row >= HEAT_GRID) continue;
      const i = row * HEAT_GRID + col;
      cells[i] += count;
      if (cells[i] > max) max = cells[i];
      total += count;
    }
  }
  return { cells, max, total };
}

export function clusterViews(
  stats: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
  selected: ReadonlySet<string> | null,
): ClusterView[] {
  const out: ClusterView[] = [];
  for (const [phase, ability, s] of entries(stats, side, phases)) {
    if (!s.clusters || !included(ability, selected)) continue;
    const meta = stats.abilities[ability];
    s.clusters.forEach((cluster, i) => {
      out.push({
        id: `${ability}|${phase}|${i}`,
        ability,
        agent: meta?.agent ?? "unknown",
        slot: meta?.slot ?? "",
        phase,
        side,
        cluster,
        ratePerRound: s.rate_per_round,
        abilityCount: s.count,
      });
    });
  }
  return out;
}

/** Minimum casts in a cluster before it can be called a "signature". */
export const SIGNATURE_MIN_COUNT = 5;

/** Repeatable setups: highest share of the ability's casts, ignoring tiny clusters. */
export function signatureClusters(views: readonly ClusterView[], n = 5): ClusterView[] {
  return views
    .filter((c) => c.cluster.count >= SIGNATURE_MIN_COUNT)
    .sort((a, b) => b.cluster.share - a.cluster.share || b.cluster.count - a.cluster.count)
    .slice(0, n);
}

export function totalCasts(
  stats: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
  selected: ReadonlySet<string> | null,
): number {
  let n = 0;
  for (const [, ability, s] of entries(stats, side, phases)) {
    if (included(ability, selected)) n += s.count;
  }
  return n;
}
