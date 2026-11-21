"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface LowSampleBadgeProps {
  /** Why the sample is low, including the threshold (e.g. "Only 1 game on this map (fewer than 3)"). */
  reason: string;
  label?: string;
  className?: string;
}

/**
 * The one "low sample" signal used across tabs. Text (not colour) carries the meaning; the reason is
 * in the tooltip for sighted users and in visually hidden text for screen readers and keyboard users.
 */
export function LowSampleBadge({ reason, label = "Low sample", className }: LowSampleBadgeProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            className={cn(
              "cursor-help border-warning/50 text-warning outline-none print:border-current print:text-current",
              className,
            )}
          >
            {label}
            <span className="sr-only">: {reason}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-64 text-pretty">
          {reason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
