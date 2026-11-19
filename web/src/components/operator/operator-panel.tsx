"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { byMapRows, UNTRACKED_OP_LABEL, type OpScope, type PlayerLine } from "@/lib/data/operator";
import { type MapMeta, type OperatorBlock, type OpTeamSide, type Side } from "@/lib/data/types";
import { SIDE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtPct, OP_HOLDER_NOTE, OpLowSample, PhaseBar, PhaseKey } from "./op-bits";

interface OperatorPanelProps {
  op: OperatorBlock;
  maps: MapMeta[];
  map: MapMeta;
  side: Side;
  team: OpTeamSide | undefined;
  players: PlayerLine[];
  scope: OpScope;
  onScope: (scope: OpScope) => void;
  player: string | null;
  onPlayer: (id: string | null) => void;
  onMap: (map: string) => void;
}

function Section({ title, children, note, id }: { title: React.ReactNode; children: React.ReactNode; note?: string; id?: string }) {
  return (
    <section className="space-y-2.5" aria-labelledby={id}>
      <h3 id={id} className="text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
      {note && <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 space-y-0.5 rounded-md border border-border bg-card px-3 py-2.5">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">{sub}</p>}
    </div>
  );
}

function PlayerCard({ line, active, onSelect }: { line: PlayerLine; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "w-full space-y-2 rounded-md border bg-card px-3 py-2.5 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring",
        active ? "border-primary bg-primary/10" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{line.name}</span>
        {line.lowSample && !line.untracked && (
          <OpLowSample title="Fewer than 10 rounds with an Operator; treat rates as anecdotal." />
        )}
      </div>
      {line.untracked && <p className="text-[11px] leading-snug text-amber-300">{UNTRACKED_OP_LABEL}</p>}
      <dl className="grid grid-cols-4 gap-x-2 text-xs">
        <div className="min-w-0">
          <dt className="truncate text-muted-foreground">OP rounds</dt>
          <dd className="font-mono tabular-nums">{line.roundsWithOp}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-muted-foreground" title="OP kills per round holding the OP">
            Kills/rd
          </dt>
          <dd className="font-mono tabular-nums">
            {line.killsPerOpRound === null ? "—" : line.killsPerOpRound.toFixed(2)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-muted-foreground" title="Share of OP rounds the holder survived">
            Survival
          </dt>
          <dd className="font-mono tabular-nums">{fmtPct(line.survival, 1)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-muted-foreground" title="Share of this player's first kills made with the OP">
            FK w/ OP
          </dt>
          <dd className="font-mono tabular-nums">{fmtPct(line.firstKillShare, 1)}</dd>
        </div>
      </dl>
      <div className="space-y-1">
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {line.opKills} OP kills · {line.firstKillsWithOp}/{line.firstKills} first kills with OP
        </p>
        <PhaseBar phases={line.phases} label={`${line.name} OP kills by phase`} />
      </div>
    </button>
  );
}

function ByMapTable({ op, maps, current, onMap }: { op: OperatorBlock; maps: MapMeta[]; current: string; onMap: (m: string) => void }) {
  const rows = byMapRows(op);
  const name = (m: string) => maps.find((x) => x.name === m)?.display_name ?? m;
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No per-map Operator data.</p>;
  const cell = (s: OpTeamSide | undefined) =>
    s ? (
      <span className={cn(s.low_sample && "text-muted-foreground")} title={s.low_sample ? `Only ${s.rounds} rounds` : undefined}>
        {fmtPct(s.op_round_pct)}
        {s.low_sample && "*"}
      </span>
    ) : (
      "—"
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Operator use per map: share of rounds with an OP on each side, OP kills, top OP player</caption>
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="py-1.5 pr-2 text-left font-medium">Map</th>
            <th scope="col" className="px-1 py-1.5 text-right font-medium">Atk</th>
            <th scope="col" className="px-1 py-1.5 text-right font-medium">Def</th>
            <th scope="col" className="px-1 py-1.5 text-right font-medium">Kills</th>
            <th scope="col" className="py-1.5 pl-2 text-left font-medium">Top</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const kills = (r.attacker?.op_kills ?? 0) + (r.defender?.op_kills ?? 0);
            const top = [r.defender?.top_op_player, r.attacker?.top_op_player]
              .filter((t) => t && (t.op_kills > 0 || t.rounds_with_op > 0))
              .sort((a, b) => (b?.op_kills ?? 0) - (a?.op_kills ?? 0))[0];
            const active = r.map === current;
            return (
              <tr key={r.map} className={cn("border-b border-border/60", active && "bg-primary/10")}>
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => onMap(r.map)}
                    aria-current={active ? "true" : undefined}
                    className="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
                  >
                    {name(r.map)}
                  </button>
                </th>
                <td className="px-1 py-1 text-right font-mono tabular-nums">{cell(r.attacker)}</td>
                <td className="px-1 py-1 text-right font-mono tabular-nums">{cell(r.defender)}</td>
                <td className="px-1 py-1 text-right font-mono tabular-nums">{kills}</td>
                <td className="max-w-[6rem] truncate py-1 pl-2">{top?.name ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function OperatorPanel({ op, maps, map, side, team, players, scope, onScope, player, onPlayer, onMap }: OperatorPanelProps) {
  const where = `${map.display_name} ${SIDE_LABEL[side]}`;
  return (
    <div className="space-y-6">
      <Section
        id="op-team"
        title={
          <span className="flex items-center gap-2">
            Team on {where}
            {team?.low_sample && <OpLowSample title={`Only ${team.rounds} rounds on this map and side.`} />}
          </span>
        }
      >
        {team ? (
          <div className="grid grid-cols-2 gap-3">
            <Tile label="Rounds with an OP" value={fmtPct(team.op_round_pct)} sub={`${team.rounds_with_op} of ${team.rounds} rounds`} />
            <Tile
              label="First kills with OP"
              value={fmtPct(team.first_kill_op_share, 1)}
              sub={`${team.first_kills_with_op} of ${team.first_kills}`}
            />
            <Tile label="OP kills" value={String(team.op_kills)} sub={`${team.rounds_with_op_kill} rounds with one`} />
            <Tile
              label="Top OP player"
              value={team.top_op_player?.name ?? "—"}
              sub={team.top_op_player ? `${team.top_op_player.op_kills} kills · ${team.top_op_player.rounds_with_op} rds` : "no holder"}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No Operator summary for this map and side.</p>
        )}
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          All maps: {op.team_op_kills} OP kills · {fmtPct(op.team_first_kills ? op.team_first_kills_with_op / op.team_first_kills : null, 1)} of
          first kills with OP
        </p>
      </Section>

      <Section id="op-players" title="OP players" note={OP_HOLDER_NOTE}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={scope}
          onValueChange={(v) => v && onScope(v as OpScope)}
          aria-label="Player stats scope"
          className="w-full"
        >
          <ToggleGroupItem value="map" className="flex-1 data-[state=on]:bg-accent data-[state=on]:text-foreground">
            {where}
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="flex-1 data-[state=on]:bg-accent data-[state=on]:text-foreground">
            All maps
          </ToggleGroupItem>
        </ToggleGroup>
        {players.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody on this team held an Operator on {where}.</p>
        ) : (
          <ul className="space-y-2" aria-label="OP players, most OP rounds first. Select one to filter the map.">
            {players.map((l) => (
              <li key={l.id}>
                <PlayerCard line={l} active={player === l.id} onSelect={() => onPlayer(player === l.id ? null : l.id)} />
              </li>
            ))}
          </ul>
        )}
        <PhaseKey />
      </Section>

      <Section id="op-bymap" title="Per map · share of rounds with an OP" note="* fewer than 24 rounds on that side.">
        <ByMapTable op={op} maps={maps} current={map.name} onMap={onMap} />
      </Section>
    </div>
  );
}
