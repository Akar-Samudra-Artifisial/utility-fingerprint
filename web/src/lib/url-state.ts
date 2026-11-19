import { PHASES, SIDES, type Phase, type Side } from "./data/types";

export const LAYERS = ["heat", "clusters", "arrows"] as const;
export type Layer = (typeof LAYERS)[number];

export const TABS = ["map", "report", "operator", "compare"] as const;
export type Tab = (typeof TABS)[number];

export const COMPARE_MODES = ["side", "diff"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/**
 * Operator map layers: OP holder positions in the first 45 s (default, "angles held"), position at
 * kill time, victim positions, and clusters of whichever position layers are on.
 */
export const OP_LAYERS = ["positions", "killers", "victims", "clusters"] as const;
export type OpLayer = (typeof OP_LAYERS)[number];
export const DEFAULT_OP_LAYERS: OpLayer[] = ["positions", "clusters"];

export interface FilterState {
  tab: Tab;
  /** Operator tab: selected OP player id; null = all players. */
  player: string | null;
  opLayers: OpLayer[];
  team: string;
  /** Compare tab: the second team; null = default opponent (see resolveTeamB). */
  teamB: string | null;
  mode: CompareMode;
  map: string | null;
  side: Side;
  phases: Phase[];
  /** null = every ability. */
  abilities: string[] | null;
  layers: Layer[];
  /** Highlighted cluster id (`ability|phase|index`). */
  focus: string | null;
}

export const DEFAULT_TEAM = "79"; // Cloud9
export const FALLBACK_OPPONENT = "3429"; // Cloud9 GC
export const LAST_TEAM_KEY = "uf:last-team";

/**
 * Team B, validated against the index before anything is fetched. A URL `b` that equals team A or is
 * not in the index falls back to the default: Cloud9 (when A is not Cloud9), else the last team viewed,
 * else Cloud9 GC, else the last team in the index that is not A.
 */
export function resolveTeamB(
  teamA: string,
  teamB: string | null,
  lastViewed: string | null,
  knownIds: readonly string[],
): string {
  const ok = (id: string | null): id is string => id !== null && id !== teamA && knownIds.includes(id);
  if (ok(teamB)) return teamB;
  for (const id of [DEFAULT_TEAM, lastViewed, FALLBACK_OPPONENT]) if (ok(id)) return id;
  for (let i = knownIds.length - 1; i >= 0; i--) if (knownIds[i] !== teamA) return knownIds[i];
  return FALLBACK_OPPONENT;
}

export const DEFAULT_PHASES: Phase[] = ["opening"];
export const DEFAULT_LAYERS: Layer[] = ["heat", "clusters", "arrows"];

/**
 * Comma list param. Absent → null (use default). Explicitly empty (`layers=`, every switch off) → [].
 * Values present but none valid (`phase=x`) → null, so a bad link lands on the default view.
 */
function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] | null {
  if (raw === null) return null;
  const tokens = raw.split(",").filter(Boolean);
  if (tokens.length === 0) return [];
  const set = new Set(tokens);
  const out = allowed.filter((x) => set.has(x));
  return out.length > 0 ? out : null;
}

export function parseFilters(params: URLSearchParams): FilterState {
  const sideRaw = params.get("side");
  const abRaw = params.get("ab");
  const tabRaw = params.get("tab") ?? "";
  const modeRaw = params.get("mode") ?? "";
  return {
    tab: (TABS as readonly string[]).includes(tabRaw) ? (tabRaw as Tab) : "map",
    player: params.get("op") || null,
    opLayers: list(params.get("oplayers"), OP_LAYERS) ?? DEFAULT_OP_LAYERS,
    team: params.get("team") || DEFAULT_TEAM,
    teamB: params.get("b") || null,
    mode: (COMPARE_MODES as readonly string[]).includes(modeRaw) ? (modeRaw as CompareMode) : "side",
    map: params.get("map") || null,
    side: (SIDES as readonly string[]).includes(sideRaw ?? "") ? (sideRaw as Side) : "attacker",
    phases: list(params.get("phase"), PHASES) ?? DEFAULT_PHASES,
    abilities: abRaw === null ? null : abRaw.split(",").filter(Boolean),
    layers: list(params.get("layers"), LAYERS) ?? DEFAULT_LAYERS,
    focus: params.get("focus") || null,
  };
}

export function serializeFilters(s: FilterState): string {
  const p = new URLSearchParams();
  if (s.tab !== "map") p.set("tab", s.tab);
  p.set("team", s.team);
  if (s.teamB) p.set("b", s.teamB);
  if (s.mode !== "side") p.set("mode", s.mode);
  if (s.map) p.set("map", s.map);
  p.set("side", s.side);
  p.set("phase", s.phases.join(","));
  if (s.abilities !== null) p.set("ab", s.abilities.join(","));
  if (s.layers.join(",") !== DEFAULT_LAYERS.join(",")) p.set("layers", s.layers.join(","));
  if (s.focus) p.set("focus", s.focus);
  if (s.player) p.set("op", s.player);
  if (s.opLayers.join(",") !== DEFAULT_OP_LAYERS.join(",")) p.set("oplayers", s.opLayers.join(","));
  return p.toString();
}
