import { abilityGroups, type AgentGroup, type HeatField } from "./select";
import { HEAT_GRID, type Phase, type Side, type TeamMapStats } from "./types";
import { abilityName, agentName, PHASE_LABEL } from "../format";

export type TeamKey = "a" | "b";

function included(ability: string, selected: ReadonlySet<string> | null): boolean {
  return selected === null || selected.has(ability);
}

/**
 * Heat normalised per round: each ability/phase grid is divided by its `rounds_played`
 * (rounds the team played on this map and side), so teams with different sample sizes compare fairly.
 * Cell value = casts per round started from that cell.
 */
export function rateField(
  stats: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
  selected: ReadonlySet<string> | null,
): HeatField {
  const cells = new Float32Array(HEAT_GRID * HEAT_GRID);
  let total = 0;
  const bySide = stats.utility[side];
  for (const phase of phases) {
    for (const [ability, s] of Object.entries(bySide?.[phase] ?? {})) {
      if (!s.heat || s.rounds_played <= 0 || !included(ability, selected)) continue;
      for (const [col, row, count] of s.heat) {
        if (col < 0 || row < 0 || col >= HEAT_GRID || row >= HEAT_GRID) continue;
        const v = count / s.rounds_played;
        cells[row * HEAT_GRID + col] += v;
        total += v;
      }
    }
  }
  let max = 0;
  for (const v of cells) if (v > max) max = v;
  return { cells, max, total };
}

export interface DiffField {
  /** Row-major A − B, in casts per round per cell. */
  cells: Float32Array;
  maxAbs: number;
}

export function diffField(a: HeatField, b: HeatField): DiffField {
  const cells = new Float32Array(HEAT_GRID * HEAT_GRID);
  let maxAbs = 0;
  for (let i = 0; i < cells.length; i++) {
    const d = a.cells[i] - b.cells[i];
    cells[i] = d;
    if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
  }
  return { cells, maxAbs };
}

/** Same scale for both maps in side-by-side mode, so equal colour = equal casts per round. */
export function withSharedMax(a: HeatField, b: HeatField): [HeatField, HeatField] {
  const max = Math.max(a.max, b.max);
  return [
    { ...a, max },
    { ...b, max },
  ];
}

export interface AbilityRow {
  ability: string;
  agent: string;
  slot: string;
  rate: Record<TeamKey, number>;
  count: Record<TeamKey, number>;
  /** Set when only one team cast it in this side/phase filter. */
  only: TeamKey | null;
}

interface AbilityRate {
  rate: number;
  count: number;
  /** Casts per round in each selected phase. */
  byPhase: Map<Phase, number>;
  /** Raw casts in each selected phase. */
  countByPhase: Map<Phase, number>;
}

function abilityRates(
  stats: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
): Map<string, AbilityRate> {
  const out = new Map<string, AbilityRate>();
  const bySide = stats.utility[side];
  for (const phase of phases) {
    for (const [ability, s] of Object.entries(bySide?.[phase] ?? {})) {
      let row = out.get(ability);
      if (!row) {
        row = { rate: 0, count: 0, byPhase: new Map(), countByPhase: new Map() };
        out.set(ability, row);
      }
      const r = s.rounds_played > 0 ? s.count / s.rounds_played : 0;
      row.rate += r;
      row.count += s.count;
      row.byPhase.set(phase, r);
      row.countByPhase.set(phase, s.count);
    }
  }
  return out;
}

function meta(ability: string, a: TeamMapStats, b: TeamMapStats) {
  const m = a.abilities[ability] ?? b.abilities[ability];
  return { agent: m?.agent ?? "unknown", slot: m?.slot ?? "" };
}

/** Per-ability casts per round for both teams, biggest gap first. */
export function compareAbilities(
  a: TeamMapStats,
  b: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
  selected: ReadonlySet<string> | null,
): AbilityRow[] {
  const ra = abilityRates(a, side, phases);
  const rb = abilityRates(b, side, phases);
  const names = new Set([...ra.keys(), ...rb.keys()]);
  const rows: AbilityRow[] = [];
  for (const ability of names) {
    if (!included(ability, selected)) continue;
    const ca = ra.get(ability)?.count ?? 0;
    const cb = rb.get(ability)?.count ?? 0;
    if (ca + cb === 0) continue;
    rows.push({
      ability,
      ...meta(ability, a, b),
      rate: { a: ra.get(ability)?.rate ?? 0, b: rb.get(ability)?.rate ?? 0 },
      count: { a: ca, b: cb },
      only: ca > 0 && cb === 0 ? "a" : cb > 0 && ca === 0 ? "b" : null,
    });
  }
  return rows.sort(
    (x, y) => Math.abs(y.rate.a - y.rate.b) - Math.abs(x.rate.a - x.rate.b) || x.ability.localeCompare(y.ability),
  );
}

/** Union of both teams' abilities for the picker, plus which ones only one team used. */
export function unionGroups(
  a: TeamMapStats,
  b: TeamMapStats,
  side: Side,
  phases: readonly Phase[],
): { groups: AgentGroup[]; only: Map<string, TeamKey> } {
  const ga = abilityGroups(a, side, phases);
  const gb = abilityGroups(b, side, phases);
  const inA = new Set(ga.flatMap((g) => g.abilities.map((x) => x.ability)));
  const inB = new Set(gb.flatMap((g) => g.abilities.map((x) => x.ability)));
  const merged = new Map<string, AgentGroup>();
  for (const g of [...ga, ...gb]) {
    let m = merged.get(g.agent);
    if (!m) {
      m = { agent: g.agent, count: 0, abilities: [] };
      merged.set(g.agent, m);
    }
    m.count += g.count;
    for (const x of g.abilities) {
      const existing = m.abilities.find((y) => y.ability === x.ability);
      if (existing) existing.count += x.count;
      else m.abilities.push({ ...x });
    }
  }
  const slotOrder: Record<string, number> = { GRENADE: 0, ABILITY_1: 1, ABILITY_2: 2, ULTIMATE: 3 };
  for (const g of merged.values()) g.abilities.sort((x, y) => (slotOrder[x.slot] ?? 9) - (slotOrder[y.slot] ?? 9));
  const only = new Map<string, TeamKey>();
  for (const ab of inA) if (!inB.has(ab)) only.set(ab, "a");
  for (const ab of inB) if (!inA.has(ab)) only.set(ab, "b");
  return { groups: [...merged.values()].sort((x, y) => y.count - x.count), only };
}

export interface Difference {
  key: string;
  text: string;
  ability: string;
  agent: string;
  phase: Phase;
  higher: TeamKey;
}

/** Fewer games than this on a map → low sample: no generated difference sentences. */
export const LOW_SAMPLE_GAMES = 3;
/** Ignore gaps below this (casts per round). */
export const MIN_GAP = 0.05;
/** The team with the higher rate needs at least this many casts of the ability in that phase. */
export const MIN_CASTS = 5;

function fmtRate(r: number): string {
  return r.toFixed(2);
}

/**
 * The three largest per-phase gaps in casts per round, one per ability, as plain sentences.
 * Deterministic: built only from the numbers, ties broken by name. Gated per team and per phase: the
 * team claimed to use it more needs ≥ MIN_CASTS casts in that phase. Empty when either team has fewer
 * than LOW_SAMPLE_GAMES games on the map.
 */
export function biggestDifferences(
  a: TeamMapStats,
  b: TeamMapStats,
  names: Record<TeamKey, string>,
  side: Side,
  phases: readonly Phase[],
  selected: ReadonlySet<string> | null,
  n = 3,
): Difference[] {
  if (a.games < LOW_SAMPLE_GAMES || b.games < LOW_SAMPLE_GAMES) return [];
  const ra = abilityRates(a, side, phases);
  const rb = abilityRates(b, side, phases);
  const candidates: { ability: string; phase: Phase; ra: number; rb: number; gap: number }[] = [];
  for (const ability of new Set([...ra.keys(), ...rb.keys()])) {
    if (!included(ability, selected)) continue;
    for (const phase of phases) {
      const x = ra.get(ability)?.byPhase.get(phase) ?? 0;
      const y = rb.get(ability)?.byPhase.get(phase) ?? 0;
      const gap = Math.abs(x - y);
      if (gap < MIN_GAP) continue;
      const leader = x >= y ? ra : rb;
      if ((leader.get(ability)?.countByPhase.get(phase) ?? 0) < MIN_CASTS) continue;
      candidates.push({ ability, phase, ra: x, rb: y, gap });
    }
  }
  candidates.sort((p, q) => q.gap - p.gap || p.ability.localeCompare(q.ability) || p.phase.localeCompare(q.phase));
  const out: Difference[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.ability)) continue;
    seen.add(c.ability);
    const higher: TeamKey = c.ra >= c.rb ? "a" : "b";
    const lower: TeamKey = higher === "a" ? "b" : "a";
    const hi = higher === "a" ? c.ra : c.rb;
    const lo = higher === "a" ? c.rb : c.ra;
    const { agent } = meta(c.ability, a, b);
    const what = `${agentName(agent)} ${abilityName(c.ability)}`;
    const ratio = lo > 0 && hi / lo >= 1.5 ? ` (${(hi / lo).toFixed(1)}×)` : "";
    const tail = lo > 0 ? `${names[lower]} ${fmtRate(lo)}${ratio}.` : `${names[lower]}: no recorded casts.`;
    out.push({
      key: `${c.ability}|${c.phase}`,
      text: `${names[higher]} uses ${what} ${fmtRate(hi)}/round in ${PHASE_LABEL[c.phase].toLowerCase()}; ${tail}`,
      ability: c.ability,
      agent,
      phase: c.phase,
      higher,
    });
    if (out.length >= n) break;
  }
  return out;
}
