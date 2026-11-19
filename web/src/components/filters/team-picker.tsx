"use client";

import { useState } from "react";
import { ChevronsUpDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TeamSummary } from "@/lib/data/types";

/** Teams pinned at the top of the list (this project scouts for/against them first). */
export const FEATURED_TEAM_IDS = ["79", "3429"];

interface TeamPickerProps {
  teams: TeamSummary[];
  value: string;
  onChange: (teamId: string) => void;
  id?: string;
  /** Team hidden from the list (e.g. the other side of a comparison). */
  exclude?: string;
}

function TeamItem({ team, selected, onSelect }: { team: TeamSummary; selected: boolean; onSelect: () => void }) {
  return (
    <CommandItem
      value={`${team.name} ${team.id}`}
      data-checked={selected}
      onSelect={onSelect}
      className="gap-2"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{team.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{team.last_tournament}</span>
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{team.games}</span>
    </CommandItem>
  );
}

export function TeamPicker({ teams, value, onChange, id, exclude }: TeamPickerProps) {
  const [open, setOpen] = useState(false);
  const current = teams.find((t) => t.id === value);
  const featured = FEATURED_TEAM_IDS.map((fid) => teams.find((t) => t.id === fid)).filter(
    (t): t is TeamSummary => Boolean(t) && t?.id !== exclude,
  );
  const rest = teams
    .filter((t) => !FEATURED_TEAM_IDS.includes(t.id) && t.id !== exclude)
    .sort((a, b) => a.name.localeCompare(b.name));

  const pick = (teamId: string) => {
    onChange(teamId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-auto w-full justify-between py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{current?.name ?? "Select team"}</span>
            {current && (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {current.games} games · {current.last_tournament}
              </span>
            )}
          </span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${teams.length} teams…`} />
          <CommandList className="max-h-80">
            <CommandEmpty>No team found.</CommandEmpty>
            <CommandGroup heading="Featured">
              {featured.map((t) => (
                <TeamItem key={t.id} team={t} selected={t.id === value} onSelect={() => pick(t.id)} />
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="All teams (≥ 5 games)">
              {rest.map((t) => (
                <TeamItem key={t.id} team={t} selected={t.id === value} onSelect={() => pick(t.id)} />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
