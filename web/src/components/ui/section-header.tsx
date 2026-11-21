import { cn } from "@/lib/utils";

type HeadingTag = "h2" | "h3" | "h4";

interface SectionHeaderProps {
  title: React.ReactNode;
  id?: string;
  as?: HeadingTag;
  /** `panel` = side-panel label; `document` = report section (larger, with a rule). */
  variant?: "panel" | "document";
  /** Right-aligned slot (badge, button). */
  action?: React.ReactNode;
  className?: string;
}

const HEADING_CLASS = {
  panel: "text-xs font-semibold tracking-wide text-muted-foreground uppercase",
  document: "text-sm font-semibold tracking-wide uppercase",
} as const;

/** Shared heading for panel and report sections: one style per variant across tabs. */
export function SectionHeader({ title, id, as: Tag = "h3", variant = "panel", action, className }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2",
        variant === "document" && "border-b border-border pb-1.5",
        className,
      )}
    >
      <Tag id={id} className={cn("min-w-0 flex-1", HEADING_CLASS[variant])}>
        {title}
      </Tag>
      {action}
    </div>
  );
}

interface SectionProps extends Omit<SectionHeaderProps, "className"> {
  children: React.ReactNode;
  /** Small explanatory line under the content. */
  note?: React.ReactNode;
  className?: string;
}

/** `<section>` labelled by its header (pass `id` to wire `aria-labelledby`). */
export function Section({ children, note, className, ...header }: SectionProps) {
  return (
    <section className={cn("space-y-2.5", className)} aria-labelledby={header.id}>
      <SectionHeader {...header} />
      {children}
      {note && <p className="text-xs leading-snug text-muted-foreground">{note}</p>}
    </section>
  );
}
