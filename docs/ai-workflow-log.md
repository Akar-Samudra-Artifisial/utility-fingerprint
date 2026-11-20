# AI-powered workflow log

Running log for the **Best AI-Powered Workflow Story** bonus. Eligible tools for the bonus: JetBrains IDEs,
Junie, JetBrains Air. Record every AI-assisted task honestly, including which tool was actually used (entries
made with other tools are kept for completeness but do not count toward the bonus).

## Entries

| # | Date | Tool | Task | Prompt (short) | Result | Manual corrections | Time saved (est.) |
|---|---|---|---|---|---|---|---|
| 1 | 2026-11-19 | AI coding agent (Claude via OpenCode; **not** Junie / JetBrains) | Week 1 scaffold: monorepo (uv ETL + Next.js), data-guard hook, schema inspection, minimap calibration PoC | "Scaffold utility-fingerprint, document the verified GRID schema, prove game→minimap calibration on the 2 most-played maps" | Repo skeleton, `docs/data-schema.md`, `docs/calibration.md`, overlay PNGs; `pnpm build` passes | Agent first assumed `seriesState` is only a full snapshot; corrected after inspecting non-full events (trimmed snapshot with all player positions) | ~1 day (est.) |
| 2 | 2026-11-19 | AI coding agent (Claude via OpenCode; **not** Junie / JetBrains) | Week 2 full ETL: parallel resumable extraction to Parquet, aggregated JSON (heat grids, DBSCAN clusters, operator stats), pytest | "Process all VALORANT series into Parquet + small aggregate JSON for the frontend; no raw points in JSON" | `build` command, 4 Parquet tables, per-team JSON, 23 tests | Side switching verified from data (round 13 + every OT round) instead of assumed; kill reversals (`!killed`) handled after inspecting event types | ~1–2 days (est.) |
| 3 | 2026-11-19 | AI coding agent (Claude via OpenCode; **not** Junie / JetBrains) | Week 4a Operator profiler data: OP holder per round from freezetime inventory, `op_rounds` table, side/phase/victim-position aggregates, team OP summary | "Find who holds the Operator each round if the data allows; split OP stats by side/phase; aggregates only" | `resolve_op`, `op_rounds` Parquet, additive `operator` JSON fields, 4 new tests | Agent checked the data first (no purchase events, no inventory on kill events) and validated the freezetime-inventory signal against OP kills before building on it | ~1 day (est.) |
| 4 | 2026-11-19 | AI coding agent (Claude via OpenCode; **not** Junie / JetBrains) + Claude API at runtime | Week 5 scouting reports: deterministic fact sheet, Claude-written report with cited `fact_ids`, number validator with one retry, cache | "Generate per-team scouting reports from the aggregate JSON only; reject any number not in the data" | `report` command, `reports/<id>.json`, 7 tests with a fake provider; Cloud9 25/25 and Cloud9 GC 24/24 claims kept | First real call returned malformed JSON → switched to structured output (JSON schema); fact sheet was dominated by buy-phase agent-pick gaps and repeated abilities → excluded buy from gaps, one phase per ability | ~1 day (est.) |
| 5 | 2026-11-21 | Junie in JetBrains WebStorm 2026.3 (model: Claude Fable 5.2) | Export scouting report to PDF: "Export PDF" button on the Report tab using the existing print layout (`window.print()`) | Task spec `docs/junie-task-pdf-export.md` §1 pasted verbatim, single run | New `export-pdf-button.tsx` (sets a report-specific document title, restores it on `afterprint`), wired into `report-view.tsx` next to Copy link and shown only when report data loaded; Junie ran `pnpm lint` + `pnpm build` itself (both pass, re-checked by us); no new dependencies, `etl/` and data untouched | No code edits needed. Junie did not exercise the print dialog, so the PDF output (sidebar/tabs hidden, file name) was verified manually in the browser | ~1 h (est.; Junie run ~4 min) |

## Summary

- **Tools used so far:** _(fill in)_
- **Where AI helped most:** _(fill in)_
- **Where AI was wrong and how we caught it:** _(fill in — e.g. schema assumptions checked against real data)_
- **Total estimated time saved:** _(fill in)_
- **Lessons for next time:** _(fill in)_
