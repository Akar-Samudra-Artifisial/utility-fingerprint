"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { AgentGroup } from "@/lib/data/select";
import { abilityName, agentName } from "@/lib/format";

interface AbilityPickerProps {
  groups: AgentGroup[];
  /** null = all abilities. */
  selected: ReadonlySet<string> | null;
  colors: Map<string, string>;
  onChange: (next: string[] | null) => void;
  /** Optional trailing marker per ability (e.g. "only Team A" in compare mode). */
  marker?: (ability: string) => React.ReactNode;
}

const SLOT_KEY: Record<string, string> = { GRENADE: "C", ABILITY_1: "Q", ABILITY_2: "E", ULTIMATE: "X" };

export function AbilityPicker({ groups, selected, colors, onChange, marker }: AbilityPickerProps) {
  const all = groups.flatMap((g) => g.abilities.map((a) => a.ability));
  const isOn = (ability: string) => selected === null || selected.has(ability);

  const commit = (next: Set<string>) => {
    // Normalise "everything ticked" back to null so the URL stays short.
    onChange(all.every((a) => next.has(a)) ? null : [...next]);
  };

  const toggle = (ability: string, on: boolean) => {
    const next = new Set(selected ?? all);
    if (on) next.add(ability);
    else next.delete(ability);
    commit(next);
  };

  const toggleAgent = (g: AgentGroup, on: boolean) => {
    const next = new Set(selected ?? all);
    for (const a of g.abilities) {
      if (on) next.add(a.ability);
      else next.delete(a.ability);
    }
    commit(next);
  };

  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground">No utility recorded for this side and phase.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <Button variant="ghost" size="xs" onClick={() => onChange(null)} disabled={selected === null}>
          Select all
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onChange([])} disabled={selected?.size === 0}>
          Clear
        </Button>
      </div>
      <ul className="space-y-3">
        {groups.map((g) => {
          const onCount = g.abilities.filter((a) => isOn(a.ability)).length;
          const state = onCount === 0 ? false : onCount === g.abilities.length ? true : "indeterminate";
          const groupId = `agent-${g.agent}`;
          return (
            <li key={g.agent}>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={groupId}
                  checked={state}
                  onCheckedChange={(v) => toggleAgent(g, v === true)}
                />
                <label htmlFor={groupId} className="flex flex-1 cursor-pointer items-center gap-2 text-sm font-medium">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: colors.get(g.agent) }} />
                  {agentName(g.agent)}
                </label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{g.count}</span>
              </div>
              <ul className="mt-1.5 space-y-1 border-l border-border pl-3 ml-2">
                {g.abilities.map((a) => {
                  const cid = `ab-${a.ability}`;
                  return (
                    <li key={a.ability} className="flex items-center gap-2">
                      <Checkbox
                        id={cid}
                        checked={isOn(a.ability)}
                        onCheckedChange={(v) => toggle(a.ability, v === true)}
                      />
                      <label
                        htmlFor={cid}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-sm text-foreground/90"
                      >
                        <span className="w-3 font-mono text-[10px] text-muted-foreground" aria-hidden>
                          {SLOT_KEY[a.slot] ?? ""}
                        </span>
                        <span className="truncate">{abilityName(a.ability)}</span>
                        {marker?.(a.ability)}
                      </label>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{a.count}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
