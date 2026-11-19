import { Badge } from "@/components/ui/badge";
import { TEAM_COLOR } from "@/lib/colors";
import { LOW_SAMPLE_GAMES, type TeamKey } from "@/lib/data/compare";
import { cn } from "@/lib/utils";

export { LOW_SAMPLE_GAMES };

export function TeamDot({ team, className }: { team: TeamKey; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: TEAM_COLOR[team] }} />
  );
}

export function LowSampleBadge({ games }: { games: number }) {
  if (games >= LOW_SAMPLE_GAMES) return null;
  return (
    <Badge
      variant="outline"
      className="border-amber-400/50 text-amber-200"
      title={`Only ${games} game${games === 1 ? "" : "s"} on this map; treat differences as anecdotal.`}
    >
      Low sample
    </Badge>
  );
}

export function TeamTag({ team, name, games }: { team: TeamKey; name: string; games?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <TeamDot team={team} />
      <span className="truncate font-semibold">{name}</span>
      {games !== undefined && (
        <span className="shrink-0 font-mono text-xs font-normal tabular-nums text-muted-foreground">
          {games} {games === 1 ? "game" : "games"}
        </span>
      )}
      {games !== undefined && <LowSampleBadge games={games} />}
    </span>
  );
}
