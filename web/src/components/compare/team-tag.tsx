import { LowSampleBadge } from "@/components/ui/low-sample-badge";
import { TEAM_COLOR } from "@/lib/colors";
import { LOW_SAMPLE_GAMES, type TeamKey } from "@/lib/data/compare";
import { cn } from "@/lib/utils";

export { LOW_SAMPLE_GAMES };

export function TeamDot({ team, className }: { team: TeamKey; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: TEAM_COLOR[team] }} />
  );
}

/** Shared low-sample badge, shown only when a team has fewer than LOW_SAMPLE_GAMES games on the map. */
export function GamesLowSampleBadge({ games }: { games: number }) {
  if (games >= LOW_SAMPLE_GAMES) return null;
  return (
    <LowSampleBadge
      reason={`Only ${games} game${games === 1 ? "" : "s"} on this map (fewer than ${LOW_SAMPLE_GAMES}); treat differences as anecdotal.`}
    />
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
      {games !== undefined && <GamesLowSampleBadge games={games} />}
    </span>
  );
}
