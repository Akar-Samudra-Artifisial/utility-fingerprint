import { HEAT_LEGEND_GRADIENT } from "@/lib/colors";
import type { ClusterView } from "@/lib/data/select";
import { agentName } from "@/lib/format";

interface MapLegendProps {
  colors: Map<string, string>;
  clusters: ClusterView[];
  heatMax: number;
}

export function MapLegend({ colors, clusters, heatMax }: MapLegendProps) {
  const agents = [...new Set(clusters.map((c) => c.agent))].sort();
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Cast density</span>
        <span aria-hidden className="h-2 w-24 rounded-full" style={{ background: HEAT_LEGEND_GRADIENT }} />
        <span className="font-mono tabular-nums">max {heatMax}/cell</span>
      </div>
      {agents.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Agent colours">
          {agents.map((a) => (
            <li key={a} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: colors.get(a) }} />
              {agentName(a)}
            </li>
          ))}
        </ul>
      )}
      <p className="basis-full text-[11px] leading-snug">
        Positions are where the caster stood when using the ability. Circle = cluster (90 % of its casts
        inside), dashed = fewer than 5 casts. Arrow = average aim; dashed when
        aim varies. Positions between tracking frames are interpolated, so treat small clusters as estimates.
      </p>
    </div>
  );
}
