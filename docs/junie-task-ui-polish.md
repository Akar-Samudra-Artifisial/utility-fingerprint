# Junie tasks: Operator default map (P1-6) and compact map legend (P1-7)

Task specs for the **Best AI-Powered Workflow Story** bonus. Both items come from
`docs/ui-polish-plan.md` (§ P1) and must be implemented by **Junie in WebStorm**, not by another agent.
Run them as **two separate Junie sessions** (Task A, then Task B) so each run is logged on its own
(rows #6 and #7 of `docs/ai-workflow-log.md`).

> **Run these only after "Day 1" polish has landed.** Another agent is changing the same files
> (design tokens in `globals.css`, new primitives `SectionHeader` / `StatCard` / `PageTitle`, brand header
> in `dashboard.tsx`). Line numbers below were taken **before** that work and are approximate (`~`).
> Before pasting: pull/refresh, run `cd web && pnpm lint && pnpm build` to confirm a green baseline, and
> make sure the working tree has no unrelated uncommitted changes, so Junie's diff is easy to review.

---

## 1A. Task A prompt (P1-6 — Operator default map)

```text
Goal
On the Operator tab, when the URL has no `map` parameter, open the map where the team has the most
Operator (OP) rounds instead of the team's most played map. Today Cloud9 lands on Lotus (most games,
only 4 OP rounds), which shows a near-empty Operator map; Haven has 30 OP rounds.

Relevant files (read them first)
- web/src/components/dashboard/dashboard.tsx
  - lines ~44-50: shared `mapName` fallback = most played map (by `games`) when `filters.map` is null
    or not played. DO NOT change this; the Utility map, Report and Compare tabs depend on it.
  - lines ~52-60: `update()` pins the resolved map into the URL (`{ ...filters, map: mapName, ...patch }`)
    so copied links always name the map.
  - lines ~279-292: `<OperatorView ... mapName={mapName} update={update} />`.
- web/src/components/operator/operator-view.tsx
  - `OperatorView` (line ~91); `update` wrapper at ~92 (`rawUpdate({ tab: "operator", ...patch })`).
  - `mapName` prop is used everywhere below (layers ~104, teamSide ~105, playerLines ~106, mapMeta ~98,
    sidePlayers ~159-166, map ToggleGroup value ~197, OperatorPanel ~418-431).
  - `playedMaps` (~150-152) and `opRoundsOn(m)` (~153-157 = attacker + defender `rounds_with_op`).
- web/src/lib/data/operator.ts — `teamSide(op, map, side)` (line ~18).
- web/src/lib/url-state.ts — `FilterState.map` is `string | null`; `parseFilters` sets `map` to null when
  the param is absent (line ~89).
- If they exist after the Day 1 polish: shared primitives (`SectionHeader`, `StatCard`, `PageTitle`) and
  design tokens in `web/src/app/globals.css`. Reuse them instead of new ad-hoc classes.
- web/AGENTS.md — this Next.js version differs from older ones; check `web/node_modules/next/dist/docs/`
  before using any Next.js API.

Scope
1. Inside OperatorView, compute an operator-local map:
   - if `filters.map` is set and the team played it → use `filters.map` (explicit URL map always wins);
   - else, once operator data is loaded, pick the played map with the highest `opRoundsOn(m)`;
     tie-break by games played (desc), then map name;
   - if operator data is missing or every played map has 0 OP rounds → fall back to the `mapName` prop.
   Use this local map everywhere OperatorView currently uses `mapName`.
2. Make the URL consistent: the local `update` wrapper must pin the operator-local map, i.e. a patch
   without `map` should write the operator-local map, not the shared one (e.g. pass
   `{ tab: "operator", map: localMap, ...patch }`). Patches that set `map` explicitly keep their value.
   Result: after any interaction on the Operator tab, "Copy link" reproduces exactly what is on screen.
3. Keep the change small and local; a small pure helper (e.g. in `web/src/lib/data/operator.ts`) for
   "map with most OP rounds" is fine.

Constraints
- Never override an explicit `?map=` in the URL.
- Do not change the shared default map logic in `dashboard.tsx` (lines ~44-60) or other tabs' behaviour.
- Do not touch `etl/` or anything under `web/public/data/`.
- No new npm dependencies. Use pnpm (no package-lock.json / yarn.lock).
- TypeScript strict: no `any`, no `console.log`. Static export (`output: "export"`) must keep working.
- Do not commit; leave changes in the working tree for review.

Acceptance criteria (run from `web/`, dev server on any port)
- `pnpm lint` passes with no new errors; `pnpm build` passes.
- `/?tab=operator&team=79` opens on **Haven** (Cloud9: 30 OP rounds, the most of any map) with the
  Haven toggle selected; the map and OP panel are populated.
- `/?tab=operator&team=79&map=lotus` still opens on **Lotus**.
- `/?team=79` (Utility map tab) still opens on **Lotus** (shared default unchanged).
- On `/?tab=operator&team=79`, toggling a side or layer updates the URL with `map=haven`; copying the
  link and opening it in a new tab shows the same view.
- Picking another team in the Operator team picker (which clears `map`) lands on that team's
  most-OP map.
- A team with no OP rounds anywhere falls back to its most played map without errors.
- `git status` shows changes only under `web/src/`.

When done, list the files you changed and the commands you ran with their results.
```

Note for the reviewer (not part of the prompt): switching tabs inside the app goes through
`dashboard.tsx` `update()`, which pins the *shared* map before the tab changes. So going
Utility map → Operator keeps the map you were looking at; the most-OP default applies when the Operator
URL has no `map` (direct link, new team picked). That matches the plan's scope (P1-6: "when the URL has no
`map`"). If Junie changes this tab-switch behaviour, review it explicitly.

---

## 1B. Task B prompt (P1-7 — compact legend + "How to read this map")

```text
Goal
Make the map legends shorter and easier to read on video. Keep a one-line legend under each map
(colour gradient, agent/marker dots, short cluster key), and move the long method paragraph into a
"How to read this map" disclosure opened from an Info icon. Use one shared component for that disclosure
on all three map tabs (Utility map, Operator, Compare). The printed/PDF version must still show the
method text.

Relevant files (read them first)
- web/src/components/map/map-legend.tsx (Utility map tab legend)
  - lines ~14-29: gradient "Cast density … max N/cell" + agent colour list (already `text-xs`).
  - lines ~30-34: method paragraph in `text-[11px]` → move into the disclosure.
  - Rendered from web/src/components/dashboard/dashboard.tsx line ~239.
- web/src/components/operator/operator-view.tsx
  - `LegendRow` (~67-89) and the legend block (~368-411): `<ul aria-label="Map legend">` with rows for
    positions/killers/victims/clusters, then a method paragraph in `text-[11px]` at ~406-410.
- web/src/components/compare/compare-view.tsx
  - legend block ~279-327: diff legend (~282-291) or casts-per-round gradient + agents (~293-309), then a
    method paragraph in `text-[11px]` at ~311-318 (includes a dynamic low-sample sentence at ~315-317).
- web/src/components/ui/popover.tsx — existing Radix popover (`Popover`, `PopoverTrigger`,
  `PopoverContent`, `PopoverHeader`, `PopoverTitle`, `PopoverDescription`).
- web/src/components/report/report-article.tsx ~143 — existing `<details>`/`<summary>` styling example.
- web/src/app/globals.css ~142-165 — `@media print` block (light page, black text).
- If they exist after the Day 1 polish: design tokens and primitives (`SectionHeader`, `StatCard`,
  `PageTitle`). Reuse tokens for colours/sizes instead of hard-coded values.
- web/AGENTS.md — check `web/node_modules/next/dist/docs/` before using any Next.js API.

Scope
1. New shared client component, e.g. `web/src/components/map/legend-help.tsx`
   (`<LegendHelp title="How to read this map">{children}</LegendHelp>`), that renders:
   - a small trigger (lucide `InfoIcon` + visible label "How to read this map", `text-xs`) opening the
     method text in the existing Popover (or a `<details>` disclosure if simpler); the trigger is
     `print:hidden`;
   - a print-only copy of the same text (`hidden print:block`), so the PDF always contains it even
     though Popover content is not in the DOM when closed.
2. Use it on all three tabs: move each method paragraph (Utility map, Operator, Compare) into
   `LegendHelp`. Keep the content of each tab's text; Compare keeps its dynamic low-sample sentence. If
   the low-sample warning is important, it may also stay visible in the one-line legend.
3. Compact one-line legends: keep gradient + max value, agent / marker dots, and add the short key
   "Circle = cluster · dashed = < 5 casts" where clusters are drawn (Utility map and Compare side-by-side).
   Legend text is at least `text-xs`; remove `text-[11px]` from the three legends.
4. Do not change what the legend values mean or how they are computed.

Constraints
- One shared disclosure component used by all three map tabs (no copy-pasted variants).
- Print: method text must appear in the PDF / print preview; the Info trigger must not.
- No new npm dependencies: use the existing Radix popover (`@/components/ui/popover`) or native
  `<details>`, and `lucide-react` icons.
- Accessible: trigger is a real button (keyboard focus, Enter/Space opens, Esc closes for popover),
  has a visible label, and the popover content has a title.
- Do not touch `etl/` or anything under `web/public/data/`. Use pnpm.
- TypeScript strict: no `any`, no `console.log`. Static export must keep working.
- Do not commit; leave changes in the working tree for review.

Acceptance criteria (run from `web/`)
- `pnpm lint` passes with no new errors; `pnpm build` passes.
- `/?team=79` (Utility map), `/?tab=operator&team=79&map=haven` and `/?tab=compare&team=79` each show a
  one-line legend plus a "How to read this map" trigger; the long paragraph is no longer always visible.
- Clicking the trigger (or Tab + Enter) shows that tab's method text; Esc / clicking outside closes it.
- `/?tab=compare&team=79&mode=diff` shows the diff method text in the disclosure.
- `grep -n "text-\[11px\]"` finds no matches in map-legend.tsx, nor in the legend blocks of
  operator-view.tsx and compare-view.tsx.
- Print preview (Cmd+P) of each of the three tabs shows the method text and no Info trigger.
- `git status` shows changes only under `web/src/`.

When done, list the files you changed and the commands you ran with their results.
```

---

## 2. Manual verification (user)

From `utility-fingerprint/web`, after **each** task:

1. `pnpm lint` → no errors. `pnpm build` → succeeds.
2. `pnpm dev --port 3311`, open <http://localhost:3311>.

Task A:

3. Open `/?tab=operator&team=79` → map toggle shows **Haven** selected, OP heat/clusters visible.
4. Open `/?tab=operator&team=79&map=lotus` → **Lotus** selected (explicit map respected).
5. Open `/?team=79` → Utility map still on **Lotus**.
6. On the Operator tab toggle Defense → URL contains `map=haven`; Copy link → open in a new tab → same view.
7. Pick another team in the Operator team picker → lands on its map with the most OP rounds (number shown
   on the map toggle).

Task B:

8. Check the three map tabs (Utility map, Operator, Compare in both "Side by side" and "Difference")
   at 1440×900 and 1920×1080: one-line legend, readable `text-xs`, "How to read this map" trigger.
9. Keyboard: Tab to the trigger, Enter opens, Esc closes.
10. Cmd+P on each map tab → method text visible, trigger hidden. Re-test **Export PDF** on the Report tab
    (Cloud9) to make sure nothing regressed.

Both:

11. `git status` → changes only under `web/src/`; nothing in `etl/` or `web/public/data/`.

---

## 3. Record after Junie finishes (rows #6 and #7 of `docs/ai-workflow-log.md`)

For **each** task (A → row #6, B → row #7):

- [ ] Date and Junie / WebStorm version + model used
- [ ] Exact prompt pasted (section 1A / 1B as-is, or note any edits, e.g. updated line numbers after Day 1)
- [ ] Follow-up prompts sent to Junie, if any
- [ ] What Junie produced: files changed, whether `pnpm lint` / `pnpm build` passed on its own
- [ ] Manual corrections you made (what was wrong, how you noticed)
- [ ] Wall-clock time from prompt to verified change, and your estimate without AI
- [ ] Screenshots: Junie's plan/diff in WebStorm; Task A: Operator tab opening on Haven; Task B: legend +
      opened "How to read this map", and a print preview
- [ ] Copy the outcome into the row, replacing every `TODO(user)`
