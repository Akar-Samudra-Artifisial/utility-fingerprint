# Methodology — Utility Fingerprint

Draft writeup for the judges (Sky's The Limit 2026, Category 1: VALORANT Tactical Scouting). Every number below
comes from `docs/data-pipeline.md`, `docs/calibration.md` or `README.md`; details and verification live there.

## The scouting problem

A coach preparing for an opponent wants to know *where and when* that team uses its utility (which smoke goes out
at barrier drop on Haven defense, from which spot, how often per round) and who holds the Operator on which side.
Box-score dashboards do not answer this. Utility Fingerprint turns GRID match feeds into a spatial, per-phase
profile of each team, plus a written report whose numbers are validated against cited facts.

## Data source and license

- GRID series feeds (`.jsonl.zst`) and the ability-cast supplement from the official hackathon data repo:
  857 series listed, 856 extracted, 0 errors → 2,078 games, 42,529 rounds, 297,113 kills, 1,509,904 casts.
- The data is licensed for the hackathon only, with no redistribution. Raw files, Parquet, aggregate JSON and
  the static export are git-ignored and blocked by a pre-commit hook. Published JSON holds aggregates only (heat
  cells with ≥ 2 events, clusters, rates), enforced by tests.

## Pipeline

**Extract (Python, Polars, zstandard).** Series are streamed line by line in parallel (resumable), keeping only
the needed event types. GRID reversals (`!killed`, `team-!won-round`, …) are applied and rolled-back games
dropped. Output: local Parquet tables for games, rounds, kills, casts and Operator stints/positions.

**Minimap calibration.** GRID positions are mapped to the valorant-api.com minimap with the published
coefficients, but with the axes swapped: `u = y·xMultiplier + xScalarToAdd`, `v = x·yMultiplier + yScalarToAdd`.
This was proven, not assumed: on Haven, 100.0 % of sampled plants land on the drawn map and 95.6 % on
site-highlight pixels, versus an 8.9 % baseline for utility casts; the non-swapped variant was evaluated as the
contrast case.

**Round clock and phases.** Time is measured from the round's freezetime end: `buy` < 0, `opening` 0–15 s,
`mid` 15–45 s, `late` after 45 s before the plant, `post_plant` after it. The first second is labelled
"barrier drop". There is no fallback: a round without a freezetime-end event keeps a null clock rather than a
guessed one.

**Sides and overtime.** Each round's side comes from the `team-won-round` winner's side, with the round-start
snapshot as fallback (39 of 42,529 rounds). We verified side switching on the data instead of hard-coding it:
the majority switch happens at round 13 (98.99 %) and on every overtime round (92.65 %).

**First kill.** Exactly one per round: earliest timestamp, ties broken by envelope sequence number, then event
order. All 42,455 first kills also carry GRID's own first-kill flag.

**Operator holder.** The feed has no purchase events and kill events carry no inventory, so a holder is a player
with an Operator in their freezetime-end inventory. Each round is replayed: a holder who dies drops the stint.
An Operator kill by a player not yet known as a holder starts a `kill_inferred` stint at the kill time. Result:
12,745 stints (12,322 from inventory + 423 inferred), and all 8,667 Operator kills are attributed to a holder.
Holder positions are sampled from every feed snapshot while the holder is alive, in the first 45 s and before
the plant (165,131 samples).

**Aggregation.** Per team, map, side, phase and ability: heat grids (48×48 for utility, 24×24 for the sparser
Operator layers) keeping only cells with ≥ 2 events. Holder positions are deduplicated so each (round, player)
counts once per cell. DBSCAN on minimap coordinates (eps 0.025, min_samples = max(3, 5 % of the group)) gives
the top 5 clusters with share, mean aim direction and mean timing. The output covers 143 teams with ≥ 5 games
(Cloud9 and Cloud9 GC always included), about 31 MB of JSON.

## Compare normalisation

Teams have very different sample sizes, so the Compare tab divides each ability/phase grid by `rounds_played` on
that map and side: a cell is "casts per round started from here". Side-by-side and diff modes both use this
rate, and low-sample maps are flagged.

## Claude scouting reports

1. **Fact sheet.** A deterministic list of at most 150 facts per team (map pool, utility signatures, Operator
   profile, largest per-round utility gaps versus Cloud9, or versus Cloud9 GC for Cloud9 itself). Low-sample
   entries are left out. The model never sees Parquet or GRID rows.
2. **Structured output.** One call per team to `claude-sonnet-5-5` with a JSON schema. Every claim and counter
   must cite `fact_ids`.
3. **Validator.** Extracts every number in a claim (percent, decimal, integer, `m:ss`) and requires a match with
   a cited fact (percent ±0.5 points, rate ±0.01, counts exact). Number words ("twice", "half") and multipliers
   ("3x") are rejected because they cannot be checked; unknown fact ids reject the claim; the headline must
   contain no number at all.
4. **Retry and drop.** Failing claims get one retry with their error list; claims that still fail are dropped
   and listed in the report's `validation` block.
5. **Cache.** Keyed by fact sheet, prompt, schema, validator version and model, so unchanged teams are not
   regenerated. `report --check` re-validates written reports and flags stale facts.

Reports exist for 20 teams, and `report --check` reports 0 problems for all 20. Token use is about
10–11 k input / 6 k output per call; the full 20-team run (most teams needed one retry) used ≈ 377 k input /
129 k output tokens with `claude-sonnet-5-5`, which cost **US$2.18** (Anthropic console).
The prompt requires player names instead of pronouns; one report (Sentinels) still used pronouns and was
regenerated once.

## Frontend

Next.js (App Router, TypeScript, Tailwind, shadcn/ui) built as a **static export**: no server and no API routes,
so the app plus data can be served from any static host or locally. The minimap and its layers (heat, clusters,
aim arrows, Operator positions) are drawn on a 2D `<canvas>`. All filters (tab, team, opponent, map, side,
phase, abilities, layers, Operator player) live in the URL, so every view is a shareable link, and each report
claim links to the view that shows its evidence. Clusters can be navigated with the keyboard (arrow keys,
Enter, Escape), and the report has a print layout (light page, no app chrome).

## Verification

- 53 pytest tests (extraction, aggregation, Operator logic, report validator with a fake LLM provider, no
  network).
- `pnpm lint` and `pnpm build` (static export) pass.
- Sanity checks against the data: Haven plants A 41.7 % / B 15.4 % / C 42.9 % (calibration sample:
  42.9 / 18.6 / 38.5); median plant-to-site distance 286 cm; 6.4 % of first kills are Operator kills.
- Spot check: Cloud9's OXY has 97 Operator rounds, 49 Operator kills, 46.4 % survival.
- Each milestone went through an independent code review round; findings (e.g. Operator kills by non-holders,
  number words passing the validator) were fixed with regression tests.

## Limitations

- **Caster position, not landing spot.** The supplement records where the player stood when casting.
- **Operator pickups are invisible.** No Operator pickup events exist in the data, so drops picked up by the
  enemy cannot be tracked.
- **The validator checks numbers, not meaning.** Directional or qualitative wording ("prefers B") is only
  constrained by the cited facts, which are embedded in each report for manual review.
- **Small samples.** Many teams have few games per map; low-sample data is flagged in the dashboard and left out
  of the reports.
- **Hosting** depends on the organizers' answer (`docs/organizer-question.md`).

## Tools used

- **JetBrains:** WebStorm 2026.3 with Junie (built the report's "Export PDF" feature; log entry #5).
- **Claude Code** (Anthropic) assisted with most of the code, tests and docs; tasks and manual corrections are
  logged in `docs/ai-workflow-log.md`.
- **Claude API** (`claude-sonnet-5-5`) writes the scouting reports at build time, behind the number validator.
- Python 3.12, uv, Polars, scikit-learn, zstandard; Next.js, TypeScript, Tailwind, shadcn/ui; valorant-api.com.

## What's next

Landing-spot estimation from caster position plus aim direction, matchup-specific reports, fingerprint trends
per tournament stage, and a semantic check on report wording on top of the number validator.
