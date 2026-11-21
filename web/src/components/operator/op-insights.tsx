import type { Insight } from "@/components/summary/key-insights";
import { LowSampleBadge } from "@/components/ui/low-sample-badge";
import { opClusterViews } from "@/lib/data/operator";
import type { Cluster, OpPlayer, OpSideStats, OpTeamSide, Side } from "@/lib/data/types";
import { pct, roundClock, SIDE_LABEL } from "@/lib/format";
import { fmtPct } from "./op-bits";

/** Same cut-offs as the ETL (`low_sample`): team < 24 rounds, player < 10 OP rounds. */
const TEAM_ROUNDS_LOW = 24;
const OP_ROUNDS_LOW = 10;

interface OpInsightsInput {
  side: Side;
  /** "Haven Defense" */
  where: string;
  team: OpTeamSide | undefined;
  positionClusters: Cluster[];
  opRounds: number;
  /** Cluster ids currently drawn on the map (focus only works for those). */
  drawnIds: ReadonlySet<string>;
  focusId: string | null;
  onFocus: (id: string | null) => void;
  /** Players with OP rounds on this map/side, most OP rounds first. */
  players: { p: OpPlayer; s: OpSideStats }[];
  player: string | null;
  onPlayer: (id: string | null) => void;
}

/** Operator: how often the team buys an OP, the top angle held (focuses it), the main OP player (filters to them). */
export function opInsights({
  side,
  where,
  team,
  positionClusters,
  opRounds,
  drawnIds,
  focusId,
  onFocus,
  players,
  player,
  onPlayer,
}: OpInsightsInput): Insight[] {
  const tone = side === "attacker" ? "attack" : "defense";
  const teamLow = team?.low_sample
    ? `Only ${team.rounds} rounds on ${where} (fewer than ${TEAM_ROUNDS_LOW}); treat rates as anecdotal.`
    : null;
  const out: Insight[] = [];

  out.push(
    !team
      ? { key: "usage", label: "Operator usage", title: "No Operator data", detail: `Nothing recorded on ${where}`, empty: true }
      : teamLow || team.op_round_pct === null
        ? {
            key: "usage",
            label: "Operator usage",
            title: "Not enough rounds",
            detail: `${team.rounds_with_op} of ${team.rounds} ${SIDE_LABEL[side]} rounds with an OP`,
            empty: true,
            badge: teamLow ? <LowSampleBadge reason={teamLow} /> : undefined,
          }
        : {
            key: "usage",
            label: "Operator usage",
            title: `OP in ${fmtPct(team.op_round_pct)} of rounds`,
            detail: `${team.rounds_with_op} of ${team.rounds} ${SIDE_LABEL[side]} rounds · ${team.op_kills} OP kills`,
            tone,
          },
  );

  // Team position clusters are listed by share; the first one is the most repeated angle.
  const angle = opClusterViews(positionClusters, side, opRounds, "position").sort((a, b) => b.cluster.share - a.cluster.share)[0];
  if (angle) {
    const drawn = drawnIds.has(angle.id);
    const active = drawn && focusId === angle.id;
    const time = Number.isFinite(angle.cluster.mean_t_round_ms) ? ` · avg ${roundClock(angle.cluster.mean_t_round_ms)}` : "";
    out.push({
      key: "angle",
      label: player ? "Top angle held · selected player" : "Top angle held",
      title: `${pct(angle.cluster.share)} of position samples`,
      detail: drawn ? `${angle.cluster.count} samples${time}` : `${angle.cluster.count} samples${time} · turn on Clusters to locate`,
      tone,
      onSelect: drawn ? () => onFocus(active ? null : angle.id) : undefined,
      pressed: drawn ? active : undefined,
      actionLabel: `${active ? "Clear highlight of" : "Highlight"} the top angle held on the map: ${pct(angle.cluster.share)} of position samples, ${angle.cluster.count} samples`,
    });
  } else {
    out.push({
      key: "angle",
      label: "Top angle held",
      title: "No repeatable angle",
      detail: "Too few OP rounds in the same spot",
      empty: true,
    });
  }

  const top = players.find((x) => x.s.rounds_with_op > 0);
  if (top) {
    const active = player === top.p.player_id;
    const low = top.s.rounds_with_op < OP_ROUNDS_LOW;
    out.push({
      key: "player",
      label: "Main OP player",
      title: top.p.name,
      detail: `${top.s.rounds_with_op} OP rounds · ${top.s.op_kills} OP kills`,
      tone,
      badge: low ? (
        <LowSampleBadge
          reason={`${top.s.rounds_with_op} round${top.s.rounds_with_op === 1 ? "" : "s"} with an Operator (fewer than ${OP_ROUNDS_LOW}); treat rates as anecdotal.`}
        />
      ) : undefined,
      onSelect: () => onPlayer(active ? null : top.p.player_id),
      pressed: active,
      actionLabel: `${active ? "Show all players instead of" : "Show only"} ${top.p.name} on the map: ${top.s.rounds_with_op} OP rounds, ${top.s.op_kills} OP kills on ${where}`,
    });
  } else {
    out.push({ key: "player", label: "Main OP player", title: "No OP holder", detail: `Nobody held an OP on ${where}`, empty: true });
  }
  return out;
}
