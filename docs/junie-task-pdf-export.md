# Junie task: "Export PDF" button on the Report tab

Task spec for the **Best AI-Powered Workflow Story** bonus. The feature must be implemented by **Junie in
WebStorm**, not by another agent. Paste section 1 into Junie, follow section 2 to verify, and fill in
section 3 + row #5 of `docs/ai-workflow-log.md` afterwards.

---

## 1. Prompt to paste into Junie

```text
Goal
Add an "Export PDF" button to the Report tab of the Next.js app in `web/` so a coach can save the
current team's scouting report as a PDF.

Approach (keep it simple)
Use the browser's print dialog: the button calls `window.print()`, and the user picks
"Save as PDF". Do NOT add a PDF library (jsPDF, html2canvas, react-pdf, puppeteer, etc.).
Reasons: a print stylesheet already exists and hides the app chrome; `window.print()` keeps the text
selectable and the layout identical to what the user sees; it adds zero dependencies and works in a
static export (`output: "export"`), where there is no server to render PDFs.

Relevant files (read them first)
- web/src/components/report/report-view.tsx
  - `ReportView` (line ~58). The toolbar above the report is at lines ~119-121:
    `<div className="flex justify-end px-4 pt-4 lg:px-8 print:hidden"><CopyLinkButton /></div>`.
    Put the new button in this same toolbar, next to `CopyLinkButton`.
  - The report itself renders at line ~140 only when `report.data` is set; loading (~130),
    error (~123) and "no report yet" (~141) states also exist.
- web/src/components/dashboard/copy-link-button.tsx — follow this component's style for the new button
  (client component, `Button` from `@/components/ui/button`, `variant="outline" size="sm"`,
  a lucide-react icon + label).
- web/src/components/report/report-article.tsx — the printed content (`ReportArticle`); already has
  `print:` Tailwind variants (e.g. `print:max-w-none` at line ~101, `print:hidden` on per-claim links at ~82).
- web/src/app/globals.css lines ~142-165 — existing `@media print` block (light page, black text,
  no overflow clipping).
- web/src/components/dashboard/dashboard.tsx — tab list is `print:hidden` (line ~117); `ReportView`
  is mounted at line ~270.
- web/AGENTS.md — this Next.js version differs from older ones; check `web/node_modules/next/dist/docs/`
  before using any Next.js API.

Scope
1. New client component, e.g. `web/src/components/report/export-pdf-button.tsx`, that renders an
   outline `Button` (lucide icon such as `PrinterIcon` or `FileDownIcon`, label "Export PDF") and calls
   `window.print()` on click.
2. Render it in the `ReportView` toolbar next to `CopyLinkButton`, only when a report is loaded
   (`report.data` is truthy). The toolbar already has `print:hidden`, so the button will not appear
   in the PDF.
3. Optional, only if small: while printing, set `document.title` to something like
   "<team name> scouting report" so the browser proposes a sensible PDF file name, and restore the
   previous title afterwards (`afterprint` event). Skip this if it complicates the code.
4. Only touch print styles if the PDF is visibly broken (e.g. content cut off). Prefer Tailwind
   `print:` variants on the existing elements over new global CSS.

Constraints
- Do not touch anything in `etl/`.
- Do not add, modify or commit data: nothing under `web/public/data/`, no GRID data files.
- No new npm dependencies.
- Use pnpm (the repo uses pnpm; do not create package-lock.json or yarn.lock).
- TypeScript strict: no `any`, no `console.log`.
- Static export must keep working (`output: "export"` in `web/next.config.ts`): no API routes,
  no server-only code.
- Do not commit; leave the changes in the working tree for review.

Acceptance criteria (run from `web/`)
- `pnpm lint` passes with no new errors.
- `pnpm build` passes.
- On the Report tab with a team that has a report, an "Export PDF" button appears next to "Copy link".
- The button is not shown while the report is loading, on error, or when the team has no report.
- Clicking it opens the browser print dialog; the preview shows only the report (no sidebar, tabs,
  or toolbar buttons), black text on a white page, and the full report across pages (nothing clipped).
- The button is keyboard accessible (Tab to focus, Enter/Space triggers print) and has a visible label.
- `git status` shows changes only under `web/src/` (and nothing under `etl/` or `web/public/data/`).

When done, list the files you changed and the commands you ran with their results.
```

---

## 2. Manual verification (user)

From `utility-fingerprint/web`:

1. `pnpm lint` → no errors.
2. `pnpm build` → succeeds.
3. `pnpm dev --port 3311`, open <http://localhost:3311>.
4. Open the **Report** tab and pick a team that has a report (e.g. Cloud9; the sidebar lists teams with a report).
5. Check the **Export PDF** button sits next to **Copy link**; pick a team without a report → button is hidden.
6. Click **Export PDF** → print dialog opens → destination "Save as PDF" → save.
7. Open the PDF and check: only the report content, white background / black text, no sidebar/tabs/buttons,
   all sections and counters present, no text cut off at page edges, numbers match the screen.
8. Keyboard: Tab to the button, press Enter → print dialog opens.
9. `git status` → changes only under `web/src/`; nothing in `etl/` or `web/public/data/`.

---

## 3. Record after Junie finishes (for `docs/ai-workflow-log.md` row #5)

- [ ] Date and Junie / WebStorm version used
- [ ] Exact prompt pasted (section 1 as-is, or note any edits)
- [ ] Follow-up prompts sent to Junie, if any
- [ ] What Junie produced: files changed, whether `pnpm lint` / `pnpm build` passed on its own
- [ ] Manual corrections you made (what was wrong, how you noticed)
- [ ] Wall-clock time from prompt to verified feature, and your estimate without AI
- [ ] Screenshots: Junie's plan/diff in WebStorm, the Report tab with the button, the saved PDF
- [ ] Copy the outcome into row #5 of `docs/ai-workflow-log.md`, replacing every `TODO(user)`
