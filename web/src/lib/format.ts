const SPECIAL_AGENT_NAMES: Record<string, string> = {
  kayo: "KAY/O",
  "kay/o": "KAY/O",
};

function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function agentName(slug: string): string {
  return SPECIAL_AGENT_NAMES[slug.toLowerCase()] ?? titleCase(slug);
}

export function abilityName(slug: string): string {
  return titleCase(slug);
}

/**
 * Milliseconds since freezetime end → "0:12"; negative values (buy phase) → "−0:05".
 * The first second reads as "barrier drop": opening utility genuinely piles up there,
 * and "0:00" looked like missing data.
 */
export function roundClock(ms: number): string {
  if (ms >= 0 && ms < 1000) return "barrier drop";
  const sign = ms < 0 ? "−" : "";
  const total = Math.round(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function rate(x: number): string {
  return x >= 10 ? x.toFixed(0) : x.toFixed(2);
}

export const PHASE_LABEL: Record<string, string> = {
  buy: "Buy",
  opening: "Opening",
  mid: "Mid-round",
  late: "Late",
  post_plant: "Post-plant",
};

export const PHASE_HINT: Record<string, string> = {
  buy: "Before the barrier drops",
  opening: "0–15 s",
  mid: "15–45 s",
  late: "45 s+, before plant",
  post_plant: "After the spike plant",
};

export const SIDE_LABEL: Record<string, string> = {
  attacker: "Attack",
  defender: "Defense",
};
