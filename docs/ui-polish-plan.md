# UI polish plan — Utility Fingerprint web app

Status: **Day 1 partially implemented** — P1-1, P1-2, P1-3, P1-5 done (see "Done (Day 1)" below); P1-6/P1-7 assigned separately. **Day 2:** P1-4, P2-1, P2-2, P2-4 done (insight strip `summary/key-insights.tsx` + `map-insights.tsx` / `operator/op-insights.tsx`; report rail `report/report-glance.tsx`; scope chips in `report-article.tsx`; `text-2xs` token in `globals.css`). P2-3, P2-5, P2-6, P3 open. Goal (user request): make the app look *better, more informative, more modern and more consistent* for the Cloud9 x JetBrains judging (live demo + ≤3 min video). Audience: VALORANT pro coaches/analysts.

Audit inputs
- Screenshots of the live site (`https://utility-fingerprint.vercel.app/?tab=<tab>&team=79`, Cloud9) at 1440×900 and 1920×1080, headless Chrome, saved outside the repo in `/tmp/uf-ui-audit/{map,report,operator,compare}-{1440x900,1920x1080}.png`.
- Code read: `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/components/dashboard/dashboard.tsx`, `summary/summary-panel.tsx`, `map/map-legend.tsx`, `report/report-view.tsx`, `report/report-article.tsx`, `operator/op-bits.tsx`, `operator/operator-panel.tsx`, `compare/team-tag.tsx`, `web/src/lib/colors.ts`, plus grep of headings/labels across `operator-view.tsx`, `compare-*.tsx`, `filter-sidebar.tsx`.
- Not checked: mobile/tablet widths in a browser (only code-level reasoning), keyboard walkthrough in a real browser, print preview.

---

## 1. What already works (keep)

- Coherent dark theme with a single amber accent defined as tokens (`globals.css:86-119`), print override to light (`globals.css:143-165`).
- Three-column layout (filters · map · summary) is the right mental model for analysts; the URL holds all state.
- Loading skeletons, error + retry and empty-filter overlays exist on every tab (`dashboard.tsx:89-104`, `:194-235`, `:269-305`; `report-view.tsx:97-171`).
- Good a11y basics: `aria-pressed` on cluster cards (`summary-panel.tsx:125`), `role="img"` + `aria-label` on bars (`summary-panel.tsx:86`, `op-bits.tsx:45`), `fieldset/legend` for layer switches (`dashboard.tsx:166-167`), `prefers-reduced-motion` (`globals.css:135-140`).
- Signature utility cards and Compare "Biggest differences" are already the most informative elements on screen — the plan builds on them.

## 2. Findings

### 2.1 Cross-tab

| # | Finding | Evidence |
|---|---|---|
| X1 | **No brand.** Header is two lines of plain text; the new fingerprint icon (`web/src/app/icon.svg`) is not used in the UI. Tabs are a small, low-contrast segmented control in the top-right corner — the main navigation reads as secondary. | `dashboard.tsx:112-123` |
| X2 | **Section headers are re-implemented 3×** with the same classes (`text-xs font-medium text-muted-foreground`), and differ from the Report tab (`text-base font-semibold` with rule). Sidebar labels are a 4th variant (`<p>` with same classes). | `summary-panel.tsx:25-32`, `operator-panel.tsx:24-34`, `compare-panel.tsx:87-89`, `report-article.tsx:172`, `filter-sidebar.tsx:46,77,125,157` |
| X3 | **KPI cards are re-implemented 3×** with different value sizes: `text-2xl` inline (Utility map), `Tile` with `text-xl` (Operator), custom `dl` (Compare). Label is `text-xs muted`, value is mono — hierarchy OK but no delta/context, no icon, no semantic colour. | `summary-panel.tsx:61-72`, `operator-panel.tsx:36-44`, `compare-panel.tsx:~60-72` |
| X4 | **Page title pattern differs per tab.** Map/Operator/Compare: `h2 text-xl` "Team on Map" + `text-xs` filter line; Report: uppercase eyebrow + `h2 text-2xl`. Copy-link sits inline on map tabs but top-right of the report. | `dashboard.tsx:156-164`, `operator-view.tsx:267-273`, `compare-view.tsx:155-166`, `report-article.tsx:104-110`, `report-view.tsx:120-123` |
| X5 | **"Low sample" is two components with two copies** and three thresholds (OP player <10 OP rounds, team <24 rounds, compare <3 games). Utility map tab and Report have no low-sample signal at all (e.g. Cloud9 on Split = 1 game). Colours are raw `amber-200/300/400`, not tokens. | `op-bits.tsx:29-35`, `team-tag.tsx:14-25`, `operator-panel.tsx:60,167`, `compare-panel.tsx:226`; `summary-panel.tsx` has none |
| X6 | **Long explanatory legends in 11 px under the map** (3 near-identical paragraphs). They compete with the map and are hard to read on a projector/video. | `map-legend.tsx:30-34`, `operator-view.tsx:~400-410`, `compare-view.tsx:311` |
| X7 | **Magic colours outside tokens:** map frame `bg-[#0b0f15]` (3 copies), plant-site greys inline array, raw `text-amber-*`, phase palette in `op-bits.tsx` where *Opening* `#ffc46b` ≈ primary amber (reads as "selected"). | `dashboard.tsx:184,212`, `operator-view.tsx:290,324`, `compare-view.tsx:203,260`, `summary-panel.tsx:92`, `op-bits.tsx:17-23` |
| X8 | **Semantic side colours are good but used inconsistently.** Attack `#ff6b5a` / Defense `#4fd1c5` (`colors.ts:135-138`) appear in the side toggle dots and win-rate bars, but not in titles/filter line ("Attack · Opening" is plain grey text), the Operator per-map table, or the Report evidence chips ("Lotus · Attack · Opening"). | `dashboard.tsx:87,161-164`, `report-article.tsx` evidence row |
| X9 | **Map canvas wastes space.** The map sits as a ~450 px square in a ~650×540 frame at 1440 and stays small at 1920; ~40 % of the centre column is empty dark frame. | screenshots `map-*.png`, `operator-*.png` |
| X10 | **Type scale has many ad-hoc sizes:** `text-[10px]`, `text-[11px]`, `text-[0.95rem]`, `text-xs`… 10–11 px muted text on `#161b22`-ish backgrounds is below comfortable reading size on video and borderline for AA at that size. | grep `text-\[1[01]px\]` (≈20 hits), `report-article.tsx:72` |
| X11 | **Empty/loading states are functional but plain** (grey skeleton blocks; empty state text-only, no icon, no illustration of what will appear). | `dashboard.tsx:194-198,211-234`, `operator-view.tsx:324-340` |
| X12 | **Responsive:** body is `lg:h-dvh lg:overflow-hidden` with three fixed columns (`18.5rem / 1fr / 21rem`); below `lg` columns stack with map first (good). Header `flex-wrap` will wrap tabs under the title on narrow screens; tab labels don't shorten. Not browser-verified below 1440. | `layout.tsx:23`, `dashboard.tsx:112,126` |

### 2.2 Utility map tab (`/tmp/uf-ui-audit/map-*.png`)
- M1 No "so what" at the top: the analyst must read the right column to learn the key pattern. The title line says "Attack · Opening · 923 casts · 55 clusters" — counts, not insights (`dashboard.tsx:161-164`).
- M2 KPI pair "Games on Lotus 13 / Map record 6-7" is the only number block; round win rate and plant share are good but visually flat (`summary-panel.tsx:61-109`).
- M3 Cluster % labels on the map overlap in dense areas (canvas, `map-canvas.tsx`); acceptable, low priority.
- M4 Abilities list in the left sidebar is long; checkbox rows are fine but the agent header row lacks the agent colour weight seen on the map (only a dot).

### 2.3 Scouting report tab (`/tmp/uf-ui-audit/report-*.png`)
- R1 **Layout imbalance:** left sidebar (18.5 rem) holds a picker + a plain list of 20 teams with "25 claims" each (low information); article is `max-w-3xl` centred, so at 1920 there is ~500 px empty on each side (`report-view.tsx:80`, `report-article.tsx:101`).
- R2 Report has **no visual summary**: no KPI strip (games, record, best/worst map, attack/defense WR), no mini-map. It's a wall of claims — strong content, weak first impression for judges.
- R3 Export PDF / Copy link float top-right, far from the title they act on (`report-view.tsx:120-123`).
- R4 Evidence chips (`1.06`, `165`, `28%`) are tiny mono boxes; context ("Lotus · Attack · Opening") is grey text with no side colour (X8).
- R5 Trust box (model, generated, claims kept) is good but dense small text (`report-article.tsx:113-162`).

### 2.4 Operator tab (`/tmp/uf-ui-audit/operator-*.png`)
- O1 **Default map is the team's most played map, not the map with OP data.** Cloud9 opens on Lotus with 4 OP rounds → KPI shows "1% / 0.0% / 0 / OXY 0 kills" and an almost empty map. Worst possible first impression in a demo; Haven has 30 OP rounds (`dashboard.tsx:45-50` resolves `mapName` shared by all tabs).
- O2 KPI tiles: `0.0%`/`0` values look like errors; there is no "low sample" or "no data" treatment on the tile itself (`operator-panel.tsx:36-44`).
- O3 Per-map table uses `*` for low sample without an on-screen key near the table; `Lotus` row highlight is subtle (`operator-panel.tsx:103-150`).
- O4 Legend under map is the longest of all tabs (X6).

### 2.5 Compare tab (`/tmp/uf-ui-audit/compare-*.png`)
- C1 Best tab visually. "Biggest differences" cards with team-colour left border are exactly the insight pattern the other tabs lack — reuse it.
- C2 Two maps side by side are small (~260 px each at 1440); lots of frame padding (X9).
- C3 Blue/orange team colours (`colors.ts:104-107`) overlap in hue with agent palette sky/orange (`colors.ts:6,12`) used on the same canvases — team identity vs agent identity can be confused in the per-map headers.

---

## 3. Proposed changes

Effort: S ≤ 2 h, M ≈ half day, L ≥ 1 day (agent time). Risk is against: URL state (`url-state.ts`), print/Export PDF (`print:*` classes, `globals.css:143-165`), static export (no server code, no new runtime deps).

### P1 — high impact, low risk

| ID | What | Why | Files | Effort | Risk |
|---|---|---|---|---|---|
| **P1-1** Done (Day 1) | **Brand header:** render `icon.svg` (inline SVG component, 28 px) + wordmark "Utility Fingerprint" + subtitle; move tabs to a larger, left-aligned primary nav (underline/pill style, icons from `lucide-react`: Map, FileText, Crosshair, GitCompare), keep current team/map as a context chip in the header ("Cloud9 · Lotus"). | First 3 s of the video; makes the product feel finished (modern) and the nav primary (consistent). | `dashboard.tsx:112-123`, new `components/brand/logo.tsx` | S | Low. Header already `print:hidden` on tabs; give the logo `print:` variant (black fill) so the PDF gets a branded header for free. No URL change. |
| **P1-2** Done (Day 1) | **Shared primitives:** `SectionHeader` (one size: `text-xs font-semibold uppercase tracking-wide` + optional note/action), `StatCard` (label, value `text-2xl` mono, optional sub, `tone` = default/attack/defense/teamA/teamB/warning, optional `lowSample`), `PageTitle` (title, subtitle filter line with side colour chip, actions slot). Replace the 3 `Section`s, 3 KPI variants, 4 title blocks. | Single biggest consistency win; removes duplicated code. | new `components/ui/section-header.tsx`, `stat-card.tsx`, `page-title.tsx`; `summary-panel.tsx:25-72`, `operator-panel.tsx:24-44`, `compare-panel.tsx:~60-90`, `dashboard.tsx:155-165`, `operator-view.tsx:266-275`, `compare-view.tsx:154-167`, `report-article.tsx:102-110,172,189` | M | Low–medium: pure presentational swap; check print styles on report headers and that `aria-labelledby` ids are preserved (`operator-panel.tsx:26`). |
| **P1-3** Done (Day 1) | **Semantic tokens in CSS:** add `--attack`, `--defense`, `--team-a`, `--team-b`, `--warning`, `--map-surface` to `.dark` + print block and expose via `@theme inline` (`text-attack`, `bg-map-surface`…). `colors.ts` keeps the hex values for canvas but imports/mirrors the same constants (one source, comment-linked). Replace `bg-[#0b0f15]`, raw `amber-*`, inline plant greys. Change *Opening* phase colour away from primary amber. | Consistency; colour now carries meaning (attack red / defense teal) everywhere, incl. filter lines and report evidence. | `globals.css:7-49,86-119,143-154`, `colors.ts:95-138`, `op-bits.tsx:17-35`, `team-tag.tsx:14-25`, `summary-panel.tsx:92`, the 6 `#0b0f15` sites | S | Low. Print block must map the new tokens to dark-on-white. Canvas untouched. |
| **P1-4** Done (Day 2) | **"Key insights" strip above the map** on Utility map (and Operator): 3 compact insight cards generated from data already computed — e.g. top signature ("Viper Poison Cloud — 95 % from one spot, barrier drop"), side imbalance ("Attack WR 50 % vs Defense 47 %"), plant tendency ("A site 46 % of plants"). Same visual as Compare "Biggest differences" (left border in semantic colour), clickable → focuses the cluster (`update({focus})`). | Answers "so what" in 2 s; the judge and a coach see value without reading the sidebar (informative). Reuses the strongest existing pattern (consistent). | new `components/summary/key-insights.tsx`; selectors in `lib/data/select.ts` (`signatureClusters` already exists, `dashboard.tsx:75`); mount in `dashboard.tsx:154-183`; Operator in `operator-view.tsx:~266` | M | Low: read-only derived data; focus via existing URL param. Must handle empty/low-sample (show "Not enough data" card). |
| **P1-5** Done (Day 1) | **Unified `LowSampleBadge` + sample-size context everywhere:** one component with `reason` prop and token colour; add to Utility map KPI (games < 3) and Report header (games), and render tile values as muted "—" + badge instead of bare `0.0%` when sample is tiny. Keep thresholds as is, show them in the tooltip. | Honesty signal is a selling point for analysts; currently only 2 tabs show it (consistent, informative). | `op-bits.tsx:29-35`, `team-tag.tsx:14-25` → `components/ui/low-sample-badge.tsx`; `summary-panel.tsx:61-72`, `operator-panel.tsx:36-60,167`, `report-article.tsx:108` | S | Low. Badge is text, prints fine. |
| **P1-6** | **Operator default map = map with most OP rounds** when the URL has no `map` and tab is `operator`. | Removes the near-empty first impression (O1); demo-critical. | `operator-view.tsx` (local map resolution; do not change `dashboard.tsx:45-50` shared default) | S | Medium-low: must not override an explicit `?map=`; copied links already pin the map (`dashboard.tsx:54-55`). |
| **P1-7** | **Legend: short + expandable.** Keep a one-line legend (gradient, agent dots, "Circle = cluster · dashed = < 5 casts"); move the method paragraph into an "How to read this map" `Popover`/`details` with an Info icon. Raise legend text to `text-xs`. | Less clutter, more readable on video; same component on all three map tabs. | `map-legend.tsx:14-35`, `operator-view.tsx:~395-410`, `compare-view.tsx:~300-315` | S | Low. In print, force-open (`print:block`) so the PDF still explains the method. |

### P2 — medium impact / medium effort

| ID | What | Why | Files | Effort | Risk |
|---|---|---|---|---|---|
| P2-1 Done (Day 2) | **Report layout:** collapse the team list into the picker (or a compact 2-col grid), widen content to a 2-column layout at `xl`: article (`max-w-3xl`) + sticky right rail with KPI `StatCard`s (games, record, best/worst map WR, attack vs defense WR) and a "Jump to section" TOC. Move Export PDF/Copy link next to the report title. | Fills the empty space at 1920 (R1), adds a visual summary (R2), actions next to the subject (R3). | `report-view.tsx:80-123`, `report-article.tsx:101-166` | M | **Print:** rail must be `print:hidden` or render as a KPI row on the first page; re-test Export PDF (see `docs/junie-task-pdf-export.md`). |
| P2-2 Done (Day 2) | **Evidence chips with semantic context:** side-coloured chip for Attack/Defense, map name as a neutral chip, "Show on map" as a proper `Button variant="link"`. | Informative + consistent with X8. | `report-article.tsx:60-90` | S | Low; print colours map to black via tokens. |
| P2-3 | **Bigger map:** let the canvas fill the frame (reduce frame padding, `aspect-square` with `max-h`), and in Compare stack maps vertically below `2xl` or allow a "focus one map" toggle. | Map is the hero; currently ~40 % empty frame (X9, C2). | `dashboard.tsx:184`, `operator-view.tsx:290`, `compare-view.tsx:203-260`, `map-canvas.tsx` sizing logic | M | Medium: canvas DPR/resize code; check hit-testing for cluster clicks after resize. |
| P2-4 Done (Day 2) | **Type scale cleanup:** ban `text-[10px]/[11px]` → `text-xs` min for content, `text-[11px]` only for chart ticks; define `--text-2xs` token if needed. | Readability on projector/video, AA at small sizes. | ~20 sites (grep `text-\[1[01]px\]`) | S | Low; may lengthen a few rows (truncate already in place). |
| P2-5 | **Designed empty/loading states:** shared `EmptyState` (icon, title, one-line cause, actions) used by map/operator/compare overlays and report "no report"; map skeleton shows the minimap outline with shimmer instead of a grey square. | Modern feel, consistent. | `dashboard.tsx:194-235`, `operator-view.tsx:290-340`, `compare-view.tsx:203-265,345-350`, `report-view.tsx:144-170` | M | Low. |
| P2-6 | **Operator table:** visible key "* fewer than 24 rounds" under the table, stronger current-map row (left border amber), side-coloured Atk/Def column headers. | O3. | `operator-panel.tsx:103-150` | S | Low. |

### P3 — nice to have

| ID | What | Effort | Risk |
|---|---|---|---|
| P3-1 | Keyboard shortcuts `1–4` switch tabs, `A/D` side, `Esc` clear focus; shortcut hint in a `?` popover. | S | Low; must not fire inside inputs/command palette. |
| P3-2 | Subtle motion: cross-fade on tab switch, insight cards stagger-in (respecting `prefers-reduced-motion`, already global). | S | Low. |
| P3-3 | Team colour vs agent palette clash (C3): drop sky/orange from `AGENT_PALETTE` when in Compare, or outline team headers with a stripe instead of a dot. | S | Low; canvas only. |
| P3-4 | Cluster label collision avoidance on canvas (M3). | M | Medium (canvas code). |
| P3-5 | Mobile pass: shorten tab labels ("Map / Report / OP / Compare") below `sm`, sticky filter drawer instead of stacked sidebar. | M | Medium; verify at 390 px. |

### Accessibility checklist to apply with P1/P2
- Tabs: Radix `Tabs` already gives roving focus; keep labels visible when adding icons (`aria-hidden` icons).
- Insight cards and StatCards that are clickable must be `<button>` with `aria-pressed`, like `summary-panel.tsx:123-132`.
- Contrast: verify `--muted-foreground` (`oklch(0.72 0.015 255)`) on `--card` at `text-xs` ≥ 4.5:1; side colours as **text** on card (`#ff6b5a` likely OK, `#4fd1c5` OK) — check with a contrast tool during implementation.
- Never rely on colour alone: keep "Attack/Defense" text next to colour chips; low sample = text badge.

---

## 4. Impact on other assets

- **README screenshots** (`docs/screenshots/week3-*.png`, `week4-*.png`, `week5-report.png`, `week3-mobile.png`): all become outdated after P1-1/P1-2/P1-4. Re-capture after the P1 package with the same URLs; keep filenames or add `final-*.png` and update `README.md` links.
- **Video (Remotion)**: footage of the app must be re-recorded after P1 (header, insight strip and Operator default visibly change). Update `docs/video-script.md` beats: open on the brand header + key insights strip (strongest 5 s), Operator now opens on a populated map. Do the re-record once, after the P1+chosen P2 work is frozen.
- **Print / Export PDF**: P1-1 (logo in print), P1-3 (new tokens need print values), P1-7 (legend details force-open) and P2-1 (right rail) touch print. Re-test Export PDF on the Report tab for 2 teams after changes.
- **Devpost submission text** (`docs/devpost-submission.md`): screenshots/gallery images to refresh; feature list can mention "key insights" if P1-4 ships.
- **Static export**: none of the items add server code or dynamic routes; no new dependencies needed (lucide-react, Radix popover already present).

## 5. Recommended scope (1–2 agent-days)

**Day 1 (ship-ready by itself):** P1-3 tokens → P1-2 primitives (`SectionHeader`, `StatCard`, `PageTitle`) → P1-1 brand header → P1-5 low-sample badge → P1-6 Operator default map → P1-7 compact legend. Then `pnpm lint && pnpm build`, Export PDF check.

**Day 2:** P1-4 key insights strip (Utility map + Operator) → P2-1 report layout + P2-2 evidence chips → P2-4 type scale. Then re-capture README screenshots and hand off for video re-record.

Defer P2-3 (canvas sizing), P2-5, P2-6 and all P3 unless time remains; P2-3 has the highest regression risk (canvas hit-testing).

Verification per step: `cd web && pnpm lint && pnpm build`; manual check of the four tabs at 1440×900 and 1920×1080; copy a link from each tab and reopen it (URL state); Export PDF from Report; keyboard tab-through header → filters → map → summary.
