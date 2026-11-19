"""Inspect a few VALORANT GRID series and write docs/data-schema.md.

Only field names, counts and tiny example values are written to the docs; no raw events are copied.
"""

from __future__ import annotations

import json
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import polars as pl

from .config import DOCS_DIR, data_dir
from .grid_io import iter_jsonl_zst, series_feed, series_supplement

DETAIL_TYPES = (
    "player-killed-player",
    "player-damaged-player",
    "player-completed-plantBomb",
    "game-started-round",
    "round-started-freezetime",
    "round-ended-freezetime",
    "team-won-round",
    "game-ended-round",
    "player-used-ability",
)
# Keys whose children are noisy/large; only the key itself is documented.
NO_DESCEND = {
    "statePath",
    "killAssistsReceivedFromPlayer",
    "teamkillAssistsReceivedFromPlayer",
    "inventory",
    "abilities",
    "multikills",
    "unitKills",
    "segments",
    "teams",
    "players",
    "draftActions",
    "weaponTeamkills",
    "damageDealtSources",
    "damageDealtTargets",
    "damageTakenSources",
    "damageTakenTargets",
    "structures",
    "nonPlayerCharacters",
    "games",
    "objectives",
}
MASK_KEYS = {"id", "name", "teamId", "playerId"}
MAX_PATHS_PER_TYPE = 160


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _example(path: str, key: str, value: Any) -> str:
    if isinstance(value, str):
        if key in MASK_KEYS and ".map." not in path:
            return "<str>"
        return json.dumps(value[:32])
    if isinstance(value, bool | int | float) or value is None:
        return json.dumps(value)
    if isinstance(value, list):
        return f"list[{len(value)}]"
    return "{…}"


def _walk(obj: Any, path: str, out: dict[str, str], depth: int = 0) -> None:
    if depth > 6 or not isinstance(obj, dict):
        return
    for key, value in obj.items():
        if key in ("seriesState", "seriesStateDelta"):
            continue
        child = f"{path}.{key}" if path else key
        if key in ("weaponKills",) and isinstance(value, dict):
            sample = next(iter(value.items()), None)
            out.setdefault(
                f"{child}.<weapon>", json.dumps(dict([sample])) if sample else "{}"
            )
            continue
        out.setdefault(child, _example(child, key, value))
        if isinstance(value, dict) and key not in NO_DESCEND:
            _walk(value, child, out, depth + 1)
        elif (
            isinstance(value, list)
            and value
            and isinstance(value[0], dict)
            and key not in NO_DESCEND
        ):
            _walk(value[0], f"{child}[]", out, depth + 1)


def _current_game(series_state: dict[str, Any], full: bool) -> dict[str, Any] | None:
    games = series_state.get("games") or []
    if not full:
        # Non-full events carry a trimmed snapshot: only the current game (no started/finished flags).
        return games[-1] if games else None
    live = [g for g in games if g.get("started") and not g.get("finished")]
    return live[-1] if live else None


def _positions(game: dict[str, Any]) -> dict[str, tuple[float, float] | None]:
    out: dict[str, tuple[float, float] | None] = {}
    for team in game.get("teams", []):
        for player in team.get("players", []):
            pos = player.get("position")
            out[player["id"]] = (pos["x"], pos["y"]) if pos else None
    return out


def _game_id_of(event: dict[str, Any]) -> str | None:
    games = (event.get("seriesStateDelta") or {}).get("games") or []
    return games[0]["id"] if games else None


@dataclass
class SeriesStats:
    series_id: str
    event_name: str
    types: Counter[str] = field(default_factory=Counter)
    paths: dict[str, dict[str, str]] = field(default_factory=lambda: defaultdict(dict))
    kills: int = 0
    kills_actor_pos: int = 0
    kills_target_pos: int = 0
    kill_weapon_keys: Counter[str] = field(default_factory=Counter)
    kills_with_headshot_field: int = 0
    kill_envelope_cotypes: Counter[str] = field(default_factory=Counter)
    damage_targets: Counter[str] = field(default_factory=Counter)
    plants: int = 0
    plants_pos: int = 0
    plant_site_keys: set[str] = field(default_factory=set)
    win_types: Counter[str] = field(default_factory=Counter)
    win_sides: Counter[str] = field(default_factory=Counter)
    maps: dict[str, dict[str, Any]] = field(default_factory=dict)
    full_state_events: Counter[str] = field(default_factory=Counter)
    events_total: int = 0
    events_with_snapshot: int = 0
    full_snapshot_events: int = 0
    partial_snapshot_keys: set[str] = field(default_factory=set)
    snapshot_events_live: int = 0
    snapshot_pos_changed: int = 0
    pos_change_types: Counter[str] = field(default_factory=Counter)
    pos_change_gaps: list[float] = field(default_factory=list)
    players_with_pos: Counter[int] = field(default_factory=Counter)
    ability_event_pos: dict[str, tuple[float, float]] = field(default_factory=dict)
    ability_event_ts: dict[str, str] = field(default_factory=dict)


def scan_feed(path: Path, series_id: str, event_name: str) -> SeriesStats:
    st = SeriesStats(series_id, event_name)
    prev_positions: dict[str, tuple[float, float] | None] | None = None
    prev_change_ts: datetime | None = None
    for env in iter_jsonl_zst(path):
        env_types = [e["type"] for e in env["events"]]
        for ev in env["events"]:
            etype = ev["type"]
            st.types[etype] += 1
            st.events_total += 1
            if ev.get("includesFullState"):
                st.full_state_events[etype] += 1
            if etype in DETAIL_TYPES and len(st.paths[etype]) < MAX_PATHS_PER_TYPE:
                _walk(
                    {
                        k: v
                        for k, v in ev.items()
                        if k not in ("seriesState", "seriesStateDelta")
                    },
                    "",
                    st.paths[etype],
                )
            actor, target = ev.get("actor") or {}, ev.get("target") or {}
            a_game = (actor.get("state") or {}).get("game") or {}
            if etype == "player-killed-player":
                st.kills += 1
                st.kills_actor_pos += bool(a_game.get("position"))
                st.kills_target_pos += bool(
                    ((target.get("state") or {}).get("game") or {}).get("position")
                )
                wk = ((actor.get("stateDelta") or {}).get("game") or {}).get(
                    "weaponKills"
                ) or {}
                st.kill_weapon_keys.update(wk.keys())
                blob = json.dumps(
                    {"a": actor.get("stateDelta"), "t": target.get("stateDelta")}
                )
                st.kills_with_headshot_field += "headshot" in blob.lower()
                st.kill_envelope_cotypes.update(t for t in env_types if t != etype)
            elif etype == "player-damaged-player":
                for tgt in ((actor.get("stateDelta") or {}).get("game") or {}).get(
                    "damageDealtTargets"
                ) or []:
                    st.damage_targets[tgt["target"]["name"]] += 1
            elif etype == "player-completed-plantBomb":
                st.plants += 1
                st.plants_pos += bool(a_game.get("position"))
                light = json.dumps(
                    {k: v for k, v in ev.items() if k != "seriesState"}
                ).lower()
                st.plant_site_keys.update(
                    set(re.findall(r'"([a-z]*site[a-z]*)"\s*:', light))
                )
            elif etype == "team-won-round":
                rd = (actor.get("stateDelta") or {}).get("round") or {}
                st.win_types[rd.get("winType", "?")] += 1
                st.win_sides[(actor.get("state") or {}).get("side", "?")] += 1
            elif etype == "player-used-ability" and a_game.get("position"):
                pos = a_game["position"]
                st.ability_event_pos[ev["id"]] = (pos["x"], pos["y"])
                st.ability_event_ts[ev["id"]] = env["occurredAt"]

            ss = ev.get("seriesState")
            if not ss:
                continue
            st.events_with_snapshot += 1
            full = bool(ev.get("includesFullState"))
            if full:
                st.full_snapshot_events += 1
            else:
                st.partial_snapshot_keys.update(
                    f"games[].{k}" for g in ss.get("games") or [] for k in g
                )
            for g in ss.get("games") or []:
                m = g.get("map") or {}
                if m.get("name") and g["id"] not in st.maps:
                    st.maps[g["id"]] = m
            game = _current_game(ss, full)
            if game is None:
                prev_positions = None
                continue
            st.snapshot_events_live += 1
            positions = _positions(game)
            st.players_with_pos[sum(p is not None for p in positions.values())] += 1
            if prev_positions is not None and positions != prev_positions:
                st.snapshot_pos_changed += 1
                st.pos_change_types[etype] += 1
                now = _ts(env["occurredAt"])
                if prev_change_ts is not None:
                    st.pos_change_gaps.append((now - prev_change_ts).total_seconds())
                prev_change_ts = now
            prev_positions = positions
    return st


@dataclass
class SupplementStats:
    casts: int = 0
    in_grid: int = 0
    joined: int = 0
    same_ts: int = 0
    roster_hit: int = 0
    quality: Counter[str] = field(default_factory=Counter)
    frame_spacing_ms: list[int] = field(default_factory=list)
    grid_vs_interp_cm: list[float] = field(default_factory=list)
    keys: set[str] = field(default_factory=set)


def scan_supplement(
    path: Path, feed: SeriesStats, roster_keys: set[tuple[str, str]]
) -> SupplementStats:
    sp = SupplementStats()
    for cast in iter_jsonl_zst(path):
        sp.casts += 1
        sp.keys.update(cast.keys())
        sp.quality[cast.get("quality", "?")] += 1
        if cast.get("in_grid"):
            sp.in_grid += 1
        gid = cast.get("grid_event_id")
        if gid and gid in feed.ability_event_pos:
            sp.joined += 1
            sp.same_ts += feed.ability_event_ts[gid] == cast["occurred_at"]
            interp = cast.get("interpolated") or {}
            if cast.get("quality") == "ok" and interp.get("position"):
                gx, gy = feed.ability_event_pos[gid]
                p = interp["position"]
                sp.grid_vs_interp_cm.append(
                    ((gx - p["x"]) ** 2 + (gy - p["y"]) ** 2) ** 0.5
                )
        sp.roster_hit += (cast["game_id"], cast["player_id"]) in roster_keys
        fb, fa = cast.get("frame_before"), cast.get("frame_after")
        if fb and fa and len(sp.frame_spacing_ms) < 5000:
            sp.frame_spacing_ms.append(fa["offset_ms"] - fb["offset_ms"])
    return sp


def _pick_series(root: Path) -> list[tuple[str, str]]:
    series = pl.read_csv(root / "val" / "series.csv", infer_schema=False).filter(
        pl.col("ability_supplement").is_not_null()
        & (pl.col("ability_supplement") != "")
    )
    picks: list[tuple[str, str]] = []
    for pattern in (
        "VCT Americas",
        "Masters Toronto",
        "Game Changers NA - Split 1 2026",
    ):
        row = series.filter(pl.col("event").str.contains(pattern, literal=True)).head(1)
        if row.height:
            picks.append((row["series_id"][0], row["event"][0]))
    return picks


def _pct(a: int, b: int) -> str:
    return f"{a}/{b} ({100 * a / b:.0f}%)" if b else "0/0"


def _render(results: list[tuple[SeriesStats, SupplementStats]]) -> str:
    total = Counter[str]()
    for st, _ in results:
        total.update(st.types)
    ids = [st.series_id for st, _ in results]
    lines: list[str] = [
        "# GRID VALORANT data schema (verified)",
        "",
        "> Generated by `uv run python -m utility_fingerprint_etl inspect` (etl/src/utility_fingerprint_etl/inspect_schema.py).",
        "> Only field names, counts and tiny example values are shown; no raw data is copied.",
        "> Identifier/name strings are masked as `<str>`.",
        "",
        "Sampled series: "
        + ", ".join(f"`{st.series_id}` ({st.event_name})" for st, _ in results),
        "",
        "## 1. Event types and frequency",
        "",
        "| Event type | " + " | ".join(ids) + " | Total |",
        "|---|" + "---:|" * (len(ids) + 1),
    ]
    for etype, n in total.most_common():
        lines.append(
            f"| `{etype}` | "
            + " | ".join(str(st.types.get(etype, 0)) for st, _ in results)
            + f" | {n} |"
        )

    kills = sum(st.kills for st, _ in results)
    weapons = Counter[str]()
    damage_targets = Counter[str]()
    cotypes = Counter[str]()
    for st, _ in results:
        weapons.update(st.kill_weapon_keys)
        damage_targets.update(st.damage_targets)
        cotypes.update(st.kill_envelope_cotypes)
    lines += [
        "",
        "## 2. `player-killed-player`",
        "",
        f"- Killer position `actor.state.game.position` present: {_pct(sum(s.kills_actor_pos for s, _ in results), kills)}.",
        f"- Victim position `target.state.game.position` present: {_pct(sum(s.kills_target_pos for s, _ in results), kills)}.",
        "- Positions are 2D `{x, y}` (cm). No `z` on GRID events.",
        "- **Weapon**: not a dedicated field. It is the key incremented in "
        '`actor.stateDelta.game.weaponKills` (e.g. `{"phantom": 1}`); same under `.round`/`.series`. '
        f"Weapon keys seen ({sum(weapons.values())} over {kills} kills): "
        + ", ".join(f"`{w}` {n}" for w, n in weapons.most_common(12))
        + f". `operator` kills: {weapons.get('operator', 0)}.",
        f"- **Headshot**: kill deltas mention headshot in {_pct(sum(s.kills_with_headshot_field for s, _ in results), kills)}. "
        "Hit location is only on `player-damaged-player`: "
        "`actor.stateDelta.game.damageDealtTargets[].target.name` → "
        + ", ".join(f"`{k}` {v}" for k, v in damage_targets.most_common())
        + ". A headshot kill must be inferred from the preceding damage event(s) of the same killer→victim pair.",
        "- Other event types in the same envelope as a kill: "
        + (", ".join(f"`{k}` {v}" for k, v in cotypes.most_common(5)) or "none")
        + ".",
        "- Assists: `actor.stateDelta.game.killAssistsReceivedFromPlayer[].playerId`.",
        "",
    ]
    lines += _paths_block(results, "player-killed-player")
    lines += _paths_block(results, "player-damaged-player")

    plants = sum(st.plants for st, _ in results)
    site_keys = set().union(*(st.plant_site_keys for st, _ in results))
    lines += [
        "## 3. `player-completed-plantBomb`",
        "",
        f"- Planter position `actor.state.game.position` present: {_pct(sum(s.plants_pos for s, _ in results), plants)}.",
        f"- Site field: {'keys found: ' + ', '.join(sorted(site_keys)) if site_keys else '**none**'} — "
        "the site (A/B/C) must be derived from the position (nearest site callout; see calibration.md).",
        "- Game id: `seriesStateDelta.games[0].id`; round: `seriesStateDelta.games[0].segments[0].id` (`round-N`).",
        "- Related: `player-completed-beginDefuseBomb`, `…-stopDefuseBomb`, `…-defuseBomb`, `…-explodeBomb`.",
        "",
    ]
    lines += _paths_block(results, "player-completed-plantBomb")

    win_types, win_sides = Counter[str](), Counter[str]()
    for st, _ in results:
        win_types.update(st.win_types)
        win_sides.update(st.win_sides)
    lines += [
        "## 4. Rounds: start/end, winner, side",
        "",
        "- Order per round: `game-started-round` → `round-started-freezetime` → `round-ended-freezetime` → "
        "(play) → `team-won-round` → `game-ended-round`.",
        "- Winner: `team-won-round` → `actor.id` (team id), `actor.state.side` (`attacker`/`defender`), "
        "`actor.stateDelta.round.winType`.",
        "- Round number: `target.id` = `round-N` / `target.state.sequenceNumber`.",
        "- winType seen: "
        + ", ".join(f"`{k}` {v}" for k, v in win_types.most_common())
        + ".",
        "- Winner side seen: "
        + ", ".join(f"`{k}` {v}" for k, v in win_sides.most_common())
        + ".",
        "- Sides per team for any moment: `seriesState.games[].teams[].side` (flips at half/overtime).",
        "",
    ]
    lines += _paths_block(results, "team-won-round")
    lines += _paths_block(results, "game-started-round", limit=40)

    lines += [
        "## 5. Map name and bounds",
        "",
        "- `seriesState.games[].map` = `{id, name, bounds: {min: {x, y}, max: {x, y}}}`; also `actor.state.map` on `game-*` events.",
        "- `map.name` is lowercase (e.g. `split`), matching `meta/games.csv` `map`.",
        "",
        "| Series | Game # | map.name | bounds.min | bounds.max |",
        "|---|---:|---|---|---|",
    ]
    for st, _ in results:
        for n, m in enumerate(st.maps.values(), 1):
            b = m.get("bounds") or {}
            lines.append(
                f"| {st.series_id} | {n} | `{m.get('name')}` | {b.get('min')} | {b.get('max')} |"
            )

    lines += [
        "",
        "## 6. Player positions over time",
        "",
        "- There is **no dedicated movement/tick event** in the GRID feed.",
        "- Almost every event carries `seriesState`. With `includesFullState=true` it is the full snapshot; otherwise "
        "it is **trimmed** to the current game only, with keys: "
        + ", ".join(
            f"`{k}`"
            for k in sorted(set().union(*(s.partial_snapshot_keys for s, _ in results)))
        )
        + ". Both forms include `games[].teams[].players[].position` = `{x, y}` for all players.",
        "- `includesFullState=true` only on: "
        + ", ".join(
            f"`{k}`"
            for k in sorted(set().union(*(s.full_state_events for s, _ in results)))
        )
        + ".",
        "- Acting players also carry their own position: `actor.state.game.position` (and `target.state.game.position` "
        "for player→player events).",
        "",
        "| Series | events | with seriesState (full) | in a live game | positions changed vs previous event "
        "| median / p90 gap between position changes (s) | players with position (mode) |",
        "|---|---:|---:|---:|---:|---|---:|",
    ]
    change_types = Counter[str]()
    for st, _ in results:
        change_types.update(st.pos_change_types)
        gaps = sorted(st.pos_change_gaps)
        med = statistics.median(gaps) if gaps else float("nan")
        p90 = gaps[int(0.9 * (len(gaps) - 1))] if gaps else float("nan")
        mode = st.players_with_pos.most_common(1)[0][0] if st.players_with_pos else 0
        lines.append(
            f"| {st.series_id} | {st.events_total} | {st.events_with_snapshot} ({st.full_snapshot_events}) "
            f"| {st.snapshot_events_live} | {_pct(st.snapshot_pos_changed, st.snapshot_events_live)} "
            f"| {med:.2f} / {p90:.2f} | {mode} |"
        )
    lines += [
        "",
        "- Event types on which snapshot positions changed: "
        + ", ".join(f"`{k}` {v}" for k, v in change_types.most_common(8))
        + ".",
        "- Conclusion: all 10 positions are available **per event, not per fixed tick**: they refresh whenever an "
        "event is emitted (gap above), so quiet periods have no samples. For precise caster position/aim use the "
        "supplement (5 Hz frames around each cast; 1 Hz for VCT Americas 2025).",
        "",
        "## 7. Ability supplement join",
        "",
        "| Series | casts | in_grid | joined to feed `player-used-ability` by `grid_event_id` = `events[].id` | `occurred_at` == envelope `occurredAt` | (game_id, player_id) in meta/rosters.csv | median frame spacing (ms) | median GRID-vs-interpolated distance (cm, quality ok) |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for st, sp in results:
        spacing = (
            statistics.median(sp.frame_spacing_ms)
            if sp.frame_spacing_ms
            else float("nan")
        )
        dist = (
            statistics.median(sp.grid_vs_interp_cm)
            if sp.grid_vs_interp_cm
            else float("nan")
        )
        lines.append(
            f"| {st.series_id} | {sp.casts} | {sp.in_grid} | {_pct(sp.joined, sp.in_grid)} | {_pct(sp.same_ts, sp.joined)} "
            f"| {_pct(sp.roster_hit, sp.casts)} | {spacing:.0f} | {dist:.0f} |"
        )
    quality = Counter[str]()
    for _, sp in results:
        quality.update(sp.quality)
    lines += [
        "",
        "- Quality: " + ", ".join(f"`{k}` {v}" for k, v in quality.most_common()) + ".",
        "- Supplement keys: "
        + ", ".join(
            f"`{k}`" for k in sorted(set().union(*(sp.keys for _, sp in results)))
        )
        + ".",
        "- Join recipe: `supplement.grid_event_id` → feed `events[].id` (type `player-used-ability`); "
        "`(supplement.game_id, supplement.player_id)` → `meta/rosters.csv (game_id, player_id)` → `team_id`, `side`, "
        "`character_name`; `game_id` → `meta/games.csv` → `map`. In the feed, `actor.state.teamId` and `actor.state.side` "
        "give the caster's team/side directly. All IDs are strings.",
        "",
    ]
    lines += _paths_block(results, "player-used-ability", limit=30)
    lines += _paths_block(results, "round-started-freezetime", limit=20)
    return "\n".join(lines) + "\n"


def _paths_block(
    results: list[tuple[SeriesStats, SupplementStats]],
    etype: str,
    limit: int = MAX_PATHS_PER_TYPE,
) -> list[str]:
    merged: dict[str, str] = {}
    for st, _ in results:
        for k, v in st.paths.get(etype, {}).items():
            merged.setdefault(k, v)
    if not merged:
        return []
    out = [
        f"<details><summary>Field paths of <code>{etype}</code> (excluding seriesState/seriesStateDelta)</summary>",
        "",
        "| Path | Example |",
        "|---|---|",
    ]
    for k, v in list(merged.items())[:limit]:
        out.append(f"| `{k}` | `{v}` |")
    out += ["", "</details>", ""]
    return out


def run(series_ids: list[str] | None = None) -> Path:
    root = data_dir()
    if series_ids:
        index = pl.read_csv(root / "val" / "series.csv", infer_schema=False)
        picks = [
            (sid, index.filter(pl.col("series_id") == sid)["event"].first() or "?")
            for sid in series_ids
        ]
    else:
        picks = _pick_series(root)
    rosters = pl.read_csv(root / "meta" / "rosters.csv", infer_schema=False).filter(
        pl.col("title") == "val"
    )
    results: list[tuple[SeriesStats, SupplementStats]] = []
    for sid, event_name in picks:
        print(f"[inspect] scanning series {sid} ({event_name})")
        st = scan_feed(series_feed(root, sid), sid, event_name)
        sub = rosters.filter(pl.col("series_id") == sid)
        keys = set(
            zip(sub["game_id"].to_list(), sub["player_id"].to_list(), strict=True)
        )
        sp = scan_supplement(series_supplement(root, sid), st, keys)
        results.append((st, sp))
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    out = DOCS_DIR / "data-schema.md"
    out.write_text(_render(results), encoding="utf-8")
    print(f"[inspect] wrote {out}")
    return out
