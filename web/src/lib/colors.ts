/**
 * Canvas colours. Kept here (not in CSS) because the 2D canvas needs literal values.
 * Agent palette: 10 hues spaced for dark backgrounds, all ≥ 4.5:1 against #0d1117.
 */
export const AGENT_PALETTE = [
  "#5ec8ff", // sky
  "#ffb454", // amber
  "#b48cff", // violet
  "#4fe3a3", // mint
  "#ff7a9c", // rose
  "#e6e15a", // lime-yellow
  "#ff8f5a", // orange
  "#7aa2ff", // periwinkle
  "#5ee6e6", // cyan
  "#f29be0", // orchid
] as const;

export function agentColorMap(agents: readonly string[]): Map<string, string> {
  const sorted = [...new Set(agents)].sort();
  return new Map(sorted.map((a, i) => [a, AGENT_PALETTE[i % AGENT_PALETTE.length]]));
}

/**
 * Heat colormap (low → high): transparent indigo → magenta → orange → pale yellow.
 * Low end is transparent so the grey minimap stays readable; high end is bright.
 * Stops: [t, r, g, b, a].
 */
const HEAT_STOPS: [number, number, number, number, number][] = [
  [0.0, 40, 20, 110, 0],
  [0.12, 70, 30, 160, 90],
  [0.35, 190, 40, 140, 160],
  [0.6, 245, 105, 50, 200],
  [0.85, 255, 190, 60, 225],
  [1.0, 255, 245, 190, 240],
];

type Stop = [t: number, r: number, g: number, b: number, a: number];

/** 256-entry RGBA lookup table interpolated from colour stops. */
function makeLut(stops: Stop[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, ...c0] = stops[k];
    const [t1, ...c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let ch = 0; ch < 4; ch++) lut[i * 4 + ch] = c0[ch] + (c1[ch] - c0[ch]) * f;
  }
  return lut;
}

function legendGradient(stops: Stop[]): string {
  return `linear-gradient(90deg, ${stops
    .map(([t, r, g, b, a]) => `rgba(${r},${g},${b},${Math.max(a, 60) / 255}) ${t * 100}%`)
    .join(", ")})`;
}

export const HEAT_LUT: Uint8ClampedArray = makeLut(HEAT_STOPS);

/** CSS gradient that mirrors the heat colormap (for the legend). */
export const HEAT_LEGEND_GRADIENT = legendGradient(HEAT_STOPS);

/**
 * Operator victims: a cool ramp (transparent navy → cyan → near-white) so it never reads as the warm
 * "where the OP player stood" heat, even where the two overlap.
 */
const VICTIM_STOPS: Stop[] = [
  [0.0, 10, 40, 90, 0],
  [0.15, 20, 80, 160, 100],
  [0.45, 40, 170, 220, 175],
  [0.75, 120, 230, 245, 215],
  [1.0, 225, 255, 255, 240],
];

export const VICTIM_LUT: Uint8ClampedArray = makeLut(VICTIM_STOPS);
export const VICTIM_LEGEND_GRADIENT = legendGradient(VICTIM_STOPS);

/**
 * Operator kill spots: a green ramp, distinct from the warm "positions" heat and the cool victims.
 */
const KILL_STOPS: Stop[] = [
  [0.0, 20, 70, 30, 0],
  [0.15, 40, 130, 60, 110],
  [0.45, 110, 205, 80, 180],
  [0.75, 190, 240, 120, 220],
  [1.0, 240, 255, 210, 240],
];

export const KILL_LUT: Uint8ClampedArray = makeLut(KILL_STOPS);
export const KILL_LEGEND_GRADIENT = legendGradient(KILL_STOPS);

/** Cluster colours: angles held (warm, matches the positions heat) and kill spots (green). */
export const OP_COLOR = {
  position: "#ffc46b",
  kill: "#9be27a",
} as const;

/**
 * Compare colours: blue vs orange (a diverging pair that stays distinct for red-green colour blindness),
 * both ≥ 4.5:1 against the dark background.
 */
export const TEAM_COLOR = {
  a: "#5aaeff",
  b: "#ff9f45",
} as const;

/**
 * Semantic colours, single source for code that needs literal values (canvas, inline gradients).
 * Mirrors the `.dark` tokens in `src/app/globals.css` (`--attack`, `--defense`, `--team-a`, `--team-b`,
 * `--warning`, `--map-surface`); CSS uses the tokens (`text-attack`, `bg-map-surface`…), so change both together.
 */
export const SEMANTIC = {
  attack: "#ff6b5a",
  defense: "#4fd1c5",
  teamA: TEAM_COLOR.a,
  teamB: TEAM_COLOR.b,
  warning: "#f2cf5b",
  mapSurface: "#0b0f15",
} as const;

/** Plant-site bar shades (light → dark grey), one per site letter in map order. */
export const SITE_SHADES = ["#e9edf2", "#9aa6b5", "#5f6b7a", "#3d4652"] as const;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Diverging LUT for the diff heatmap: index 0 = strongly Team B, 128 ≈ zero (transparent),
 * 255 = strongly Team A. Colour lightens toward white at the extremes so peaks read on the grey map.
 */
export const DIFF_LUT: Uint8ClampedArray = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  const a = hexRgb(TEAM_COLOR.a);
  const b = hexRgb(TEAM_COLOR.b);
  for (let i = 0; i < 256; i++) {
    const t = (i - 127.5) / 127.5; // -1..1
    const m = Math.abs(t);
    const base = t >= 0 ? a : b;
    const lift = Math.max(0, m - 0.65) * 0.9; // mix toward white for the strongest cells
    for (let ch = 0; ch < 3; ch++) lut[i * 4 + ch] = base[ch] + (255 - base[ch]) * lift;
    lut[i * 4 + 3] = m < 0.02 ? 0 : Math.min(235, 40 + m * 230);
  }
  return lut;
})();

export const DIFF_LEGEND_GRADIENT = `linear-gradient(90deg, ${TEAM_COLOR.b} 0%, rgba(255,159,69,0.35) 30%, transparent 50%, rgba(90,174,255,0.35) 70%, ${TEAM_COLOR.a} 100%)`;

/** Attack red / Defense teal (= `--attack` / `--defense`). */
export const SIDE_COLOR = {
  attacker: SEMANTIC.attack,
  defender: SEMANTIC.defense,
} as const;

/** Tailwind text classes for the side tokens (prints dark-on-white via the print block). */
export const SIDE_TEXT_CLASS = {
  attacker: "text-attack",
  defender: "text-defense",
} as const;
