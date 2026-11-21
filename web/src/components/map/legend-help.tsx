"use client";

import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

interface LegendHelpProps {
  title?: string;
  children: ReactNode;
}

/**
 * Method text of a map legend: an Info trigger that opens it in a popover on screen, plus a
 * print-only copy (popover content is not in the DOM while closed).
 */
export function LegendHelp({ title = "How to read this map", children }: LegendHelpProps) {
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground print:hidden"
          >
            <InfoIcon aria-hidden className="size-3.5" />
            {title}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={title} className="w-80 max-w-[calc(100vw-2rem)]">
          <PopoverHeader>
            <PopoverTitle>{title}</PopoverTitle>
          </PopoverHeader>
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">{children}</div>
        </PopoverContent>
      </Popover>
      <div className="hidden basis-full space-y-1 text-xs leading-snug print:block">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </>
  );
}
