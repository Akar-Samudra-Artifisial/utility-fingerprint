import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * Inline copy of `src/app/icon.svg` (fingerprint + crosshair). Colours come from tokens so the
 * print stylesheet turns it into a black-on-white mark for the exported PDF.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const glow = useId();
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("size-7 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <rect
        x="8"
        y="8"
        width="496"
        height="496"
        rx="112"
        strokeWidth="8"
        className="fill-map-surface stroke-border print:fill-white print:stroke-black"
      />
      <defs>
        <radialGradient id={glow} cx="256" cy="276" r="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--primary)" stopOpacity=".45" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="256" cy="276" r="120" fill={`url(#${glow})`} className="print:hidden" />
      <g fill="none" strokeWidth="22" strokeLinecap="round" className="stroke-muted-foreground print:stroke-black">
        <path d="M198 340V276A58 58 0 0 1 314 276V340" />
        <path d="M158 380V276A98 98 0 0 1 354 276V346" opacity=".85" />
        <path d="M118 388V276A138 138 0 0 1 171 167.3" opacity=".7" />
        <path d="M213.4 144.8A138 138 0 0 1 394 276V372" opacity=".7" />
        <path d="M84.9 226.9A178 178 0 0 1 345 121.8" opacity=".5" />
        <path d="M388.3 156.9A178 178 0 0 1 430.1 313" opacity=".5" />
      </g>
      <g strokeWidth="6" strokeLinecap="round" className="stroke-primary">
        <path d="M256 250v-10M256 302v10M230 276h-10M282 276h10" />
      </g>
      <circle cx="256" cy="276" r="16" className="fill-primary" />
    </svg>
  );
}

/** Logo mark + wordmark + one-line subtitle, used in the app header (and printed on the PDF). */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <LogoMark />
      <div className="min-w-0 leading-tight">
        <h1 className="truncate text-base font-semibold tracking-tight">Utility Fingerprint</h1>
        <p className="truncate text-xs text-muted-foreground">VALORANT tactical scouting</p>
      </div>
    </div>
  );
}
