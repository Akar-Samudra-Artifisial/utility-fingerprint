import { LowSampleBadge } from "@/components/ui/low-sample-badge";
import { LOW_SAMPLE_GAMES } from "@/lib/data/compare";
import { plantTendency, SIGNATURE_MIN_COUNT, sideBalance, viewWinRate, type ClusterView } from "@/lib/data/select";
import type { MapMeta, TeamMapStats } from "@/lib/data/types";
import { abilityName, agentName, PHASE_LABEL, pct, SIDE_LABEL } from "@/lib/format";
import { formatDeltaPp, type ClusterWinRate } from "@/lib/stats";
import type { Insight } from "./key-insights";
import { avgLabel } from "./summary-panel";

interface MapInsightsInput {
  stats: TeamMapStats;
  map: MapMeta;
  signatures: ClusterView[];
  clusters: ClusterView[];
  colors: Map<string, string>;
  focusId: string | null;
  onFocus: (id: string | null) => void;
}

/** Utility map: top signature setup (focuses it), side balance, plant tendency. */
export function mapInsights({ stats, map, signatures, clusters, colors, focusId, onFocus }: MapInsightsInput): Insight[] {
  const low =
    stats.games < LOW_SAMPLE_GAMES
      ? `Only ${stats.games} game${stats.games === 1 ? "" : "s"} on ${map.display_name} (fewer than ${LOW_SAMPLE_GAMES}); treat patterns as anecdotal.`
      : null;
  const badge = low ? <LowSampleBadge reason={low} /> : undefined;
  const out: Insight[] = [];

  const top = signatures[0];
  if (top) {
    const active = top.id === focusId;
    out.push({
      key: "signature",
      label: "Signature setup",
      title: `${abilityName(top.ability)} · ${pct(top.cluster.share)} from one spot`,
      detail: `${agentName(top.agent)} · ${PHASE_LABEL[top.phase]} · ${avgLabel(top.cluster.mean_t_round_ms)} · ${top.cluster.count} casts`,
      accent: colors.get(top.agent),
      badge,
      onSelect: () => onFocus(active ? null : top.id),
      pressed: active,
      actionLabel: `${active ? "Clear highlight of" : "Highlight"} ${abilityName(top.ability)} cluster on the map: ${pct(top.cluster.share)} of ${agentName(top.agent)}'s casts from one spot, ${top.cluster.count} casts`,
    });
  } else {
    out.push({
      key: "signature",
      label: "Signature setup",
      title: "Not enough data",
      detail: `No repeatable cluster (≥ ${SIGNATURE_MIN_COUNT} casts) for this filter`,
      empty: true,
      badge,
    });
  }

  let bestWinRate: { view: ClusterView; result: Extract<ClusterWinRate, { kind: "full" }> } | null = null;
  for (const view of clusters) {
    const result = viewWinRate(stats, view);
    if (result.kind !== "full" || !result.significant) continue;
    if (
      !bestWinRate ||
      Math.abs(result.deltaPp) > Math.abs(bestWinRate.result.deltaPp) ||
      (Math.abs(result.deltaPp) === Math.abs(bestWinRate.result.deltaPp) && result.rounds > bestWinRate.result.rounds)
    ) {
      bestWinRate = { view, result };
    }
  }
  if (bestWinRate) {
    const { view, result } = bestWinRate;
    const active = view.id === focusId;
    out.push({
      key: "win-rate-when-used",
      label: "Win rate when used",
      title: `${abilityName(view.ability)} · ${pct(result.rate)} vs ${pct(result.baseline)} baseline`,
      detail: `${formatDeltaPp(result.deltaPp)} · ${result.rounds} rounds · 95% CI ${pct(result.low)}–${pct(result.high)} · ${PHASE_LABEL[view.phase]}`,
      tone: result.deltaPp > 0 ? "attack" : "defense",
      onSelect: () => onFocus(active ? null : view.id),
      pressed: active,
      actionLabel: `${active ? "Clear highlight of" : "Highlight"} ${abilityName(view.ability)} cluster; win rate in rounds when used ${pct(result.rate)}, baseline ${pct(result.baseline)}`,
    });
  }

  const sides = sideBalance(stats);
  if (sides) {
    const wr = `${SIDE_LABEL.attacker} ${pct(sides.attacker)} · ${SIDE_LABEL.defender} ${pct(sides.defender)}`;
    out.push({
      key: "sides",
      label: "Round win rate",
      title: sides.stronger
        ? `Stronger on ${SIDE_LABEL[sides.stronger]} (+${Math.round(sides.gap * 100)} pts)`
        : "Even on both sides",
      detail: wr,
      tone: sides.stronger === "attacker" ? "attack" : sides.stronger === "defender" ? "defense" : "default",
      badge,
    });
  }

  const plants = plantTendency(
    stats,
    map.sites.map((s) => s.site),
  );
  out.push(
    plants.top
      ? {
          key: "plants",
          label: "Plant tendency",
          title: `${plants.top.site} site · ${pct(plants.top.share)} of plants`,
          detail: `${plants.total} plants · ${plants.sites
            .filter((p) => p.site !== plants.top?.site)
            .map((p) => `${p.site} ${pct(p.share)}`)
            .join(" · ")}`,
          badge,
        }
      : { key: "plants", label: "Plant tendency", title: "No plants recorded", empty: true, badge },
  );
  return out;
}
