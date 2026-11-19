# Data pipeline (Week 2 ETL)

```bash
cd etl
export STL_DATA_DIR=/path/to/stl-hackathon-2026-grid-starter
uv run python -m utility_fingerprint_etl build            # full run (resumable)
uv run python -m utility_fingerprint_etl build --limit 10 # dev: first 10 series of val/series.csv
uv run python -m utility_fingerprint_etl build --force    # re-extract everything
uv run python -m utility_fingerprint_etl build --aggregate-only  # recombine + re-aggregate only
uv run pytest
```

## Flow

```
val/series.csv ─┐
meta/*.csv ─────┤   per series, in parallel (ProcessPoolExecutor, CPU-1 workers)
val/events_*.zst ┼─► extract.py ──► data/parquet/series/<id>/{rounds,kills,casts,op_rounds,op_positions}.parquet + _SUCCESS
supplement *.zst ┘        │              (resume: series with _SUCCESS are skipped unless --force)
                          ▼
                 build.combine ──► data/parquet/{games,rounds,kills,casts,op_rounds,op_positions}.parquet, _build_report.json
                          ▼
                 aggregate.py ───► web/public/data/index.json, web/public/data/teams/<team_id>.json
```

- Feeds are streamed line by line with `zstandard`; only lines containing the needed event types are
  JSON-decoded (`extract.NEEDLES`), which skips the bulk (`player-damaged-player`, `player-used-ability`, …).
- Only games listed in `meta/games.csv` are kept, which drops rolled-back/abandoned games
  (`series-!started-game`). Other reversals (`action` starting with `!`) are applied: `!killed` removes the
  last matching kill, `team-!won-round` clears the winner, `player-!completed-plantBomb` clears the plant,
  `game-!started-round` drops the round. All reversal counts land in `_build_report.json`.
- A series that throws is logged, recorded under `errors` in the report and skipped; the build continues.
- Map calibration: valorant-api.com coefficients (cached in `etl/.cache/`), formula in `calibration.md`.

## Tables (`data/parquet/`, git-ignored)

| Table | Grain | Key columns |
|---|---|---|
| `games` | game (map) | series_id, game_id, game_number, map, patch, started_at, tournament, stage, team1/2 id+name+side+score, winner_team_id |
| `rounds` | round | game_id, round_number, started/freezetime_end/ended `_at_ms`, winner_team_id, winner_side, attacker/defender_team_id, side_source, outcome, plant_at_ms, plant_t_round_ms, plant_site, plant_site_dist_cm, plant x/y/u/v, planter_id, plant_team_id |
| `kills` | kill | game_id, round_number, occurred_at_ms, t_round_ms, phase, killer/victim id+name+team+agent, killer_side, weapon, is_first_kill_of_round, grid_first_kill, killer/victim x/y/u/v, killer_had_op, victim_had_op |
| `op_rounds` | Operator holder stint (round × player) | game_id, round_number, player_id/name, team_id, side, source, start_t_round_ms, op_kills, died, died_t_round_ms, died_phase, killed_by_weapon, lost_to_enemy, recovered_by_team |
| `op_positions` | OP holder position sample (local only, never published raw) | game_id, round_number, player_id, team_id, side, t_round_ms, phase (opening/mid), x, y, u, v — from the `seriesState` snapshot of every feed event, holder alive + holding, 0 ≤ t_round_ms < 45 000 and pre-plant; consecutive duplicate positions dropped |
| `casts` | ability cast (supplement) | series_id, game_id, round_number, team_id, player_id, player_name, agent, ability, slot, side, map, t_round_ms, phase, x/y/z, view x/y/z, u/v, view_u/view_v, quality, sample_hz, in_grid, charges_consumed |

Times are epoch milliseconds (UTC). `u, v` are normalized minimap coordinates (0..1, origin top-left).

### Definitions

- **t_round_ms** = event time − `round-ended-freezetime` time of that round. No fallback: in rounds without that
  event, `t_round_ms`, `phase` and `plant_t_round_ms` stay null (counted as `round_/kill_/cast_no_freezetime`
  in `_build_report.json`).
- **Phase** (`constants.py`): `buy` < 0 (pre-round setups during the buy phase), `opening` 0–15 s,
  `mid` 15–45 s, `late` > 45 s before the plant, `post_plant` at/after `plant_t_round_ms`.
- **Side**: per round, from the winner's `actor.state.side` on `team-won-round` (the other team gets the other
  side); fallback = team sides in the `game-started-round` full snapshot. Verified on the data rather than
  assumed — see "Verification" below.
- **Weapon**: the key present in `actor.stateDelta.game.weaponKills` of the kill event (no dedicated field).
  Null when the kill was not credited to a weapon (e.g. abilities).
- **First kill**: exactly one per round (`is_first_kill_of_round`): earliest `occurredAt`; ties (several kills in
  one envelope / same millisecond) are broken by envelope `sequenceNumber`, then event order in the envelope, then
  event id. GRID's own `round.firstKill` flag is kept as `grid_first_kill`.
- **Build report**: `data/parquet/_build_report.json`; `--aggregate-only` keeps the extraction stats of the last
  extraction run and only refreshes row counts, side check and aggregate stats.
- **Plant site**: nearest valorant-api site callout to the planter's position (GRID has no site field).
- **Cast position**: supplement `interpolated` (quality `ok`/`missing_*`), or the closer frame for
  `gap_exceeded`; `sample_hz` = 1 when the game's median frame spacing > 600 ms (VCT Americas 2025), else 5.
- **Round assignment of casts**: last round whose start ≤ cast time ≤ round end + 2 s.

## Aggregates (`web/public/data/`, git-ignored until organizers allow publishing)

- `index.json`: teams with ≥ 5 games (Cloud9 and Cloud9 GC always included): id, name, last tournament, games
  per map; maps with minimap URL, coefficients, formula and site positions in u/v.
- `teams/<team_id>.json`:
  - `maps.<map>`: games, wins, rounds and round wins per side, round win rate, plant site counts/shares,
    `abilities.<ability>` = {agent, slot}, `utility.<side>.<phase>.<ability>` = {count, rounds_played,
    rate_per_round, heat?, clusters?}; only casts with u/v inside 0..1 are counted, so `count` is the
    denominator of every cluster `share` (`heat`/`clusters` omitted when empty, to stay under the 30 MB budget).
  - `heat`: sparse `[col, row, count]` on a 48×48 grid, only cells with count ≥ 2.
  - `clusters`: DBSCAN on u/v (eps 0.025, min_samples = max(3, 5 % of the group)), top 5: centroid u/v,
    p90 radius, count, share, mean aim direction on the minimap + consistency, mean t_round_ms.
  - `operator`: team totals and, per player with ≥ 1 Operator kill: kills, op_kills, op_kill_share,
    first_kills(_with_op), rounds_played, rounds_with_op_kill(_rate) and per-map heat/clusters of OP kill
    positions (same rules). Week 4 additions (additive, see "Operator profiler" below).
- No per-event rows or raw coordinates are written to JSON (enforced by `tests/test_extract_aggregate.py` and
  `tests/test_operator.py`).

### Operator profiler (week 4, additive fields)

**OP holder** = player whose `seriesState.games[<current game>].teams[].players[].inventory.items[]` contains
`id: "operator"` (quantity > 0) at `round-ended-freezetime`, plus later `player-pickedUp-item` events with target
`operator`. Evidence: kill events carry no inventory, there are no purchase events, but in a 7-series sample 43
of 44 OP kills came from the freezetime-end holder. Each round is replayed (`extract.resolve_op`): a holder who
dies drops the OP; the next OP pickup in that round is attributed to that drop (enemy → `lost_to_enemy`,
teammate → `recovered_by_team`). An Operator kill by a player who is not a known holder starts a
`source = "kill_inferred"` stint at the kill time (the kill proves they hold it; a pending drop is attributed
the same way as a pickup), so that round counts as an OP round and the kill gets `killer_had_op = true`
(stats `op_kill_by_nonholder`, `op_stint_kill_inferred`). Stint team/side: event team id, roster team as
fallback; stints whose side still cannot be resolved are counted in `op_stint_side_unknown` and skipped by the
side aggregates. Holder positions (`op_positions`) are sampled from the stint start: freezetime end for
inventory holders, the pickup / OP kill event for `pickup` / `kill_inferred` stints (also in rounds without a
freezetime holder). New Parquet table `op_rounds` (one row per holder stint: player, team, side,
source, start/died `t_round_ms`, op_kills, died, died_phase, killed_by_weapon, lost_to_enemy,
recovered_by_team) and new `kills` columns `killer_had_op`, `victim_had_op` (null when the round has no
freezetime snapshot).

New JSON paths in `teams/<team_id>.json` (players now also include OP holders without an OP kill):

| Path | Meaning |
|---|---|
| `operator.holder_source` | `freezetime_inventory` (or `none` when the team has no holder rows) |
| `operator.players[].rounds_with_op` | rounds holding an OP (all maps/sides) |
| `operator.players[].op_round_rate` | rounds_with_op / rounds_played |
| `operator.players[].op_kills_per_op_round` | op_kills / rounds_with_op |
| `operator.players[].op_deaths`, `op_survival_rate` | OP rounds in which the holder died; 1 − op_deaths / rounds_with_op |
| `operator.players[].op_lost_to_enemy` | holder died and an enemy picked an OP up afterwards |
| `operator.players[].first_kill_op_share` | first_kills_with_op / first_kills |
| `operator.players[].low_sample` | rounds_with_op < 10 |
| `operator.players[].maps.<map>.rounds_with_op`, `.phases`, `.victim_heat?` | per map: OP rounds, OP kills per phase (`buy/opening/mid/late/post_plant`, only non-zero), heat of OP-kill **victim** positions |
| `operator.players[].maps.<map>.sides.<side>` | `rounds_played, op_kills, rounds_with_op, op_round_rate, op_kills_per_op_round, op_deaths, op_survival_rate, op_lost_to_enemy, rounds_with_op_kill, first_kills, first_kills_with_op, first_kill_op_share, phases, killed_by, heat?, clusters?, victim_heat?, low_sample` (side omitted when no OP round and no OP kill) |
| `…sides.<side>.killed_by` | top 3 weapons that killed this player while holding the OP (`ability/other` = no weapon credited) |
| `operator.by_map.<map>.<side>` | team: `rounds, rounds_with_op, op_round_pct, rounds_with_op_kill, op_kill_round_pct (proxy), op_kills, first_kills, first_kills_with_op, first_kill_op_share, top_op_player {player_id, name, op_kills, rounds_with_op}, low_sample` (rounds < 24) |
| `operator.by_map.<map>.<side>.op_kill_heat?`, `.op_victim_heat?`, `.op_kill_clusters?` | team-wide (all players) OP kill killer / victim positions on the coarse **24×24** grid (count ≥ 2); clusters of killer positions (same DBSCAN rules, max 5) |
| `operator.players[].maps.<map>.heat24?`, `.victim_heat24?` and `…sides.<side>.heat24?`, `.victim_heat24?` | per player, same positions on the 24×24 grid (count ≥ 2) |
| `operator.by_map.<map>.<side>.op_rounds`, `.op_position_heat?`, `.op_position_heat_by_phase?.{opening,mid}`, `.op_position_clusters?` | team-wide **holder positions** (where OP holders stood, opening + mid, from `op_positions`): `[col, row, rounds]` on 24×24, each (round, player) counted once per cell, only cells with ≥ 2 rounds; `op_rounds` (= rounds_with_op) is the denominator for a share; clusters = DBSCAN on one point per (round, cell), max 5 |
| `operator.players[].maps.<map>.sides.<side>.op_rounds`, `.position_heat?`, `.position_heat_by_phase?` | same per player |

`heat`/`clusters` keep the rules above (killer position; cells count ≥ 2, clusters ≥ 3 members); `victim_heat`
uses victim positions with the same heat rule and no clusters. `?` = omitted when empty. Thresholds live in
`constants.py` (`OP_LOW_SAMPLE_ROUNDS`, `OP_TEAM_LOW_SAMPLE_ROUNDS`, `OP_KILLED_BY_TOP`, `OP_HEAT_GRID_SIZE`).
Coarse-grid cells are `[col, row, count]` with col/row in 0..23 (cell size 1/24 uv). Even at 24×24, low-volume
teams stay sparse: Cloud9 (`79`) defender has 11 OP kills on Haven → 0 killer / 1 victim cell, 17 on Pearl →
1 killer / 0 victim cell; a 12×12 grid would give only 1–3 cells, so the limit is sample size, not resolution.

## Scouting reports (week 5, `report` command)

`report.py` turns the published aggregates into a pre-generated scouting report per team. The model never sees
Parquet or GRID rows, only a fact sheet built from `web/public/data/teams/<id>.json`.

1. **Fact sheet** (deterministic, ≤ 150 facts, `fact_id → {label, value, unit, map, side, phase}`). Units:
   `pct` (fraction, 3 decimals like the team JSON, shown as a whole %), `rate` (2 decimals), `count`, `seconds`
   (round clock; 0 = barrier drop, negative = buy phase). Contents: games and map pool (games, wins and round
   win rate only for maps with ≥ 3 games); Operator profile (team OP kill share and first-kill share, top 2 non-low-
   sample OP players with their top 3 map/side splits, top 4 team map/side splits); the 6 largest utility gaps
   versus the reference team (Cloud9; Cloud9 GC for Cloud9), using the Compare tab normalisation (casts /
   `rounds_played`, maps with ≥ 3 games for both teams, gap ≥ 0.05, ≥ 5 casts, buy phase excluded because it
   mostly reflects agent picks); utility signatures for the 3 most-played maps (top 3 abilities per side by casts
   per round, each at its highest-rate phase, with the share and mean clock of the most-used caster spot when
   that spot has ≥ 5 casts).
   Map/side/phase keys match the team JSON and dashboard URL (`attacker`/`defender`, `opening`, …). Low-sample
   entries are left out, and `op_lost_to_enemy` (always 0) is never used. Spots are caster positions, not where
   the utility landed; the prompt says so.
2. **Model call:** one request per team with structured output (JSON schema), English, analyst tone. Every
   claim and counter must cite `fact_ids` and may only use the displayed fact values (no derived sums, ratios
   or "x times").
3. **Validator** (`VALIDATOR_VERSION` 2): extracts the numbers written in a claim (percent incl. `N percent`,
   decimal, integer, `m:ss`). Each must match a cited fact: pct ±0.5 points, rate ±0.01, seconds ±0.5, counts
   exact. Always rejected: multipliers (`3x`, `3×`, `x3`, `×3`) and number words (`one`…`twenty`, tens,
   `hundred`, `thousand`, `twice`, `thrice`, `half`, `third(s)`, `quarter(s)`, `double`, `triple`, `dozen`,
   `percent` without a digit) — conservative, they cannot be checked. Allowed: ordinals (`1st`), digits inside
   names, `round 1`/`round 13`, `top 1–3`, the phase windows (`0–15 s`, `15–45 s`, `45 s+`) and the non-numeric
   phrases `one-way`, `no one`, `one another`. Unknown `fact_ids` reject the claim. The headline cites no facts,
   so it must contain no number at all (the team's own name is ignored). Failing claims and a failing headline
   get one retry with their error list; claims still failing are dropped and listed in `validation.dropped`; a
   headline still failing is replaced by a fixed number-free sentence and also listed there (reason
   `headline: …`; `claims_dropped` counts claims only). Section titles are fixed (`Utility signature`, …), not
   taken from the model.
   **Limits:** the validator checks *numbers*, not meaning. Directional or qualitative statements without a
   number ("more aggressive than", "rarely", "prefers B") and the link between a number and its wording (e.g.
   attributing a Defense fact to Attack, or "high" for a low value) are not verified; they are only constrained
   by the cited `fact_ids` (embedded in the report with their values, for manual review).
4. **Output:** `web/public/data/reports/<team_id>.json` (`version, team_id, team_name, generated_at, model,
   provider, games, headline, sections[{id, title, claims[{text, fact_ids, map, side, phase, tab}]}], counters,
   reference_team_id, facts, validation`) and `reports/index.json` (`[{team_id, team_name, generated_at,
   claims_kept}]`). Git-ignored with the rest of `web/public/data/`.
5. **Cache:** `data/reports/<id>.cache.json` keyed by sha256(fact sheet + `PROMPT_VERSION` + hash of
   `SYSTEM_PROMPT`, `OUTPUT_SPEC` and the JSON schemas + `VALIDATOR_VERSION` + model + team name and last
   tournament). An unchanged key skips the LLM call (`--force` overrides) only if the cached report still passes
   `check_report` and its facts equal the rebuilt fact sheet; otherwise it is regenerated. `--dry-run` writes
   `<id>.facts.json` and `<id>.prompt.txt` there without calling any model. `--check` re-runs the validator on
   written reports, rebuilds the fact sheet from the current aggregates and reports `stale facts` if it differs,
   and exits 1 on any problem.
6. **Failures:** each team runs in its own try/except (CLI timeout, API errors, anything else): the error is
   printed (type + message, never the key), the batch continues, `reports/index.json` is written in `finally`,
   and the command exits non-zero naming the failed teams.

**Providers:** `ANTHROPIC_API_KEY` set → Anthropic API via the `anthropic` SDK (`anthropic-api`). Otherwise the
Claude Code CLI (`claude -p --output-format json --json-schema … --tools "" --strict-mcp-config
--disable-slash-commands --no-session-persistence`, prompt on stdin, run from an empty temp directory so no
project `CLAUDE.md`/settings are picked up; `--bare` is not used because it disables the OAuth login; `claude-cli`).
Neither → error. Model `claude-sonnet-5-5`, override with `UF_REPORT_MODEL`. `MAX_TOKENS` 8000 per call.

**Cost (after the review fixes, 2 teams, API):** Cloud9 11,019 input / 5,749 output tokens (1 call), Cloud9 GC
20,593 / 6,102 (2 calls: one retry, all claims fixed). **First run:** Cloud9 10,798 input / 5,622 output tokens, Cloud9 GC 10,645 / 5,950; one
call each, no retries (≈ 11 k in / 6 k out per team; multiply by the current Sonnet price for $). 20 teams ≈
215 k input / 120 k output tokens, plus retries.

## Licensing

GRID data and every derived file (Parquet, JSON aggregates, PoC images) stay local: `data/`, `web/public/data/`
and `docs/poc/` are in `.gitignore`, and `.githooks/pre-commit` rejects staged `*.zst|*.jsonl|*.parquet`,
the repo-root `data/` and `web/public/data/` (both anchored, so source folders like `web/src/lib/data/` stay
committable). Publishing the aggregates (hosted demo) waits for the organizers' answer
(`organizer-question.md`).

## Verification (last full build)

Full build 2026-11-19, 8 CPUs (7 workers): extraction 242 s, total 363 s (aggregation alone ~65 s).

- Series: 857 in `val/series.csv`; 856 extracted (6 in an earlier `--limit` run), 1 skipped (no games in
  `meta/games.csv`), 0 errors. All maps in the data have valorant-api calibration.
- Rows: games 2,078 · rounds 42,529 · kills 297,113 · casts 1,509,904 (904 casts outside any round → no
  side/phase; 1 round lacks `round-ended-freezetime` → its 21 casts and 0 kills have no phase; 16 casts fall
  outside the minimap; all of these are dropped from aggregates).
- Sides (from data): majority switch at round 13 (98.99 %) and every overtime round 25+ (92.65 %); rounds 2–12
  and 14–24 switch in < 0.2 %. Side source: winner 42,490, snapshot fallback 39; the snapshot agrees with the
  winner side in 100 % of rounds where both exist.
- Aggregates: 143 teams (17 with < 5 games skipped; Cloud9 `79` and Cloud9 GC `3429` included), 31.1 MB total
  (28.0 MB before the week 4 Operator fields, 29.8 MB before the 24×24 Operator heat, 30.0 MB before holder
  position heat).
- OP holder positions: `op_positions` 165,131 samples (164,932 before `kill_inferred`). Cloud9 (`79`) defender
  holder position heat: Haven 30 OP rounds → 44 cells (max 9 rounds/cell), 4 clusters; Pearl 27 OP rounds →
  46 cells, 4 clusters.
- Operator holders (week 4 review fix): `op_rounds` 12,745 stints = 12,322 `freezetime_inventory` + 423
  `kill_inferred` (0 `pickup`: no Operator pickup event in the data); `op_stint_side_unknown` 0. Before the fix
  505 OP kills had `killer_had_op = false` (`op_kill_by_nonholder` 505); after it all 8,667 OP kills have
  `killer_had_op = true` (423 kill_inferred stints; later OP kills by the same player in that round count as
  holder kills). All kills: `killer_had_op` true 11,069 / false 286,044 / null 0 (before 10,514 / 286,599 / 0).
- Cloud9 (`79`) top OP player: OXY, 49 OP kills, 97 rounds with OP, 46.4 % survival, 8.5 % of their first
  kills with the OP; Haven defense 10 OP kills / 30 OP rounds (rate 0.37), 44 position cells. mitch Haven
  defense: 1 OP kill / 1 OP round (was 0 rounds before `kill_inferred`), no position cell (< 2 rounds).
- First kills: 42,455 = one per round with at least one kill (74 rounds have no kill), max 1 per round, and all
  of them carry GRID's `round.firstKill` flag (re-extracted with `--force` after the tie-break fix).
- Sanity: 17.7 casts per round per team; 6.4 % of first kills (3.0 % of all kills) are Operator kills; weapon is
  null for 3.7 % of kills; Haven plants A 41.7 % / B 15.4 % / C 42.9 % (PoC sample: 42.9 / 18.6 / 38.5),
  median plant → site 286 cm (PoC 301 cm).
