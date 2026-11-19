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
| 4 | | | | | | | |

## Summary

- **Tools used so far:** _(fill in)_
- **Where AI helped most:** _(fill in)_
- **Where AI was wrong and how we caught it:** _(fill in — e.g. schema assumptions checked against real data)_
- **Total estimated time saved:** _(fill in)_
- **Lessons for next time:** _(fill in)_
