import type { Cluster, RoundRecord } from "@/lib/data/types";

export const WIN_RATE_MIN_ROUNDS = 10;
export const WIN_RATE_FULL_ROUNDS = 20;

export interface WilsonInterval {
  rate: number;
  low: number;
  high: number;
}

/** Wilson score interval for a binomial rate, or null when there are no observations. */
export function wilson(wins: number, n: number, z = 1.96): WilsonInterval | null {
  if (n === 0) return null;

  const rate = wins / n;
  const zSquared = z * z;
  const denominator = 1 + zSquared / n;
  const center = (rate + zSquared / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((rate * (1 - rate) + zSquared / (4 * n)) / n)) / denominator;
  return { rate, low: center - margin, high: center + margin };
}

export type ClusterWinRate =
  | { kind: "none" }
  | { kind: "count"; rounds: number }
  | { kind: "low"; rounds: number; rate: number; low: number; high: number; baselineUnavailable?: true }
  | {
      kind: "full";
      rounds: number;
      rate: number;
      low: number;
      high: number;
      baseline: number;
      deltaPp: number;
      significant: boolean;
    };

/** Format a rate difference in percentage points, retaining its direction after rounding. */
export function formatDeltaPp(deltaPp: number): string {
  const rounded = Math.round(deltaPp);
  if (rounded === 0) return "±0 pp";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} pp`;
}

/** Rate and Wilson interval for a cluster, compared with its side/phase baseline when available. */
export function clusterWinRate(cluster: Cluster, baseline?: RoundRecord): ClusterWinRate {
  const { rounds, wins } = cluster;
  if (rounds === undefined || wins === undefined) return { kind: "none" };
  if (rounds < WIN_RATE_MIN_ROUNDS) return { kind: "count", rounds };

  const interval = wilson(wins, rounds);
  if (!interval) return { kind: "count", rounds };
  if (rounds < WIN_RATE_FULL_ROUNDS) return { kind: "low", rounds, ...interval };

  if (!baseline || baseline.rounds === 0) {
    return { kind: "low", rounds, ...interval, baselineUnavailable: true };
  }

  const baselineRate = baseline.wins / baseline.rounds;
  return {
    kind: "full",
    rounds,
    ...interval,
    baseline: baselineRate,
    deltaPp: (interval.rate - baselineRate) * 100,
    significant: baselineRate < interval.low || baselineRate > interval.high,
  };
}
