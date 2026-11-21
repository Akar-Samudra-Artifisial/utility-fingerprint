import { SIDE_TEXT_CLASS } from "@/lib/colors";
import type { Side } from "@/lib/data/types";
import { SIDE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIDE_DOT = { attacker: "bg-attack", defender: "bg-defense" } as const;

/** "● Attack" chip: colour plus the word, never colour alone. */
export function SideChip({ side, className }: { side: Side; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", SIDE_TEXT_CLASS[side], className)}>
      <span aria-hidden className={cn("size-2 rounded-full", SIDE_DOT[side])} />
      {SIDE_LABEL[side]}
    </span>
  );
}

interface PageTitleProps {
  title: React.ReactNode;
  /** Filter line under the title; prefixed by the side chip when `side` is set. */
  meta?: React.ReactNode;
  side?: Side;
  /** Small uppercase line above the title (Report). */
  eyebrow?: React.ReactNode;
  id?: string;
  size?: "md" | "lg";
  /** Controls on the right (layer switches, copy link). */
  children?: React.ReactNode;
  className?: string;
}

/** Title block shared by all tabs: h2 + filter line + actions slot. */
export function PageTitle({ title, meta, side, eyebrow, id, size = "md", children, className }: PageTitleProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      <div className="mr-auto min-w-0 space-y-0.5">
        {eyebrow && <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{eyebrow}</p>}
        <h2 id={id} className={cn("truncate font-semibold tracking-tight", size === "lg" ? "text-2xl" : "text-xl")}>
          {title}
        </h2>
        {(side || meta) && (
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {side && <SideChip side={side} />}
            {side && meta && <span aria-hidden>·</span>}
            {meta}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
