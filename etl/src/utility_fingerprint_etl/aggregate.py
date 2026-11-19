"""Aggregate Parquet tables into small JSON files for the web app (web/public/data, git-ignored).

Only aggregates are written: counts, rates, heat-grid cells with count >= HEAT_MIN_COUNT and cluster summaries
with >= CLUSTER_MIN_SAMPLES members. No per-event rows or raw points.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl
from sklearn.cluster import DBSCAN

from .config import data_dir
from .constants import (
    CLUSTER_EPS_UV,
    CLUSTER_MAX_PER_GROUP,
    CLUSTER_MIN_SAMPLES,
    CLUSTER_MIN_SHARE,
    FORCE_INCLUDE_TEAM_NAMES,
    HEAT_GRID_SIZE,
    HEAT_MIN_COUNT,
    MID_END_MS,
    MIN_TEAM_GAMES,
    OP_HEAT_GRID_SIZE,
    OP_KILLED_BY_TOP,
    OP_LOW_SAMPLE_ROUNDS,
    OP_TEAM_LOW_SAMPLE_ROUNDS,
    OPENING_END_MS,
    PARQUET_DIR,
    PHASE_MID,
    PHASE_OPENING,
    PHASES,
    SIDES,
    WEB_DATA_DIR,
)
from .geometry import load_calibs, to_uv


def _r(x: float, nd: int = 4) -> float:
    return round(float(x), nd)


def heat_grid(
    u: np.ndarray,
    v: np.ndarray,
    size: int = HEAT_GRID_SIZE,
    min_count: int = HEAT_MIN_COUNT,
) -> list[list[int]]:
    """Sparse heat grid: [[col, row, count], …] for cells with count >= min_count."""
    if len(u) == 0:
        return []
    ok = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
    ci = np.clip((u[ok] * size).astype(int), 0, size - 1)
    ri = np.clip((v[ok] * size).astype(int), 0, size - 1)
    counts = np.bincount(ri * size + ci, minlength=size * size)
    cells = np.nonzero(counts >= min_count)[0]
    return [[int(c % size), int(c // size), int(counts[c])] for c in cells]


def clusters(
    u: np.ndarray,
    v: np.ndarray,
    view_u: np.ndarray | None = None,
    view_v: np.ndarray | None = None,
    t_round: np.ndarray | None = None,
) -> list[dict[str, Any]]:
    """DBSCAN on (u, v); returns up to CLUSTER_MAX_PER_GROUP summaries of clusters with >= min_samples members."""
    n = len(u)
    if n < CLUSTER_MIN_SAMPLES:
        return []
    pts = np.column_stack([u, v])
    min_samples = max(CLUSTER_MIN_SAMPLES, math.ceil(CLUSTER_MIN_SHARE * n))
    labels = DBSCAN(eps=CLUSTER_EPS_UV, min_samples=min_samples).fit_predict(pts)
    out = []
    for label in set(labels) - {-1}:
        m = labels == label
        size = int(m.sum())
        if size < CLUSTER_MIN_SAMPLES:
            continue
        c = pts[m].mean(axis=0)
        dist = np.hypot(pts[m, 0] - c[0], pts[m, 1] - c[1])
        item: dict[str, Any] = {
            "u": _r(c[0]),
            "v": _r(c[1]),
            "radius": _r(np.percentile(dist, 90)),
            "count": size,
            "share": _r(size / n, 3),
        }
        if view_u is not None and view_v is not None:
            vu, vv = view_u[m], view_v[m]
            ok = ~(np.isnan(vu) | np.isnan(vv))
            if ok.any():
                mu, mv = vu[ok].mean(), vv[ok].mean()
                norm = math.hypot(mu, mv)
                if norm > 0:
                    item["view"] = [_r(mu / norm, 3), _r(mv / norm, 3)]
                    item["view_consistency"] = _r(
                        norm, 3
                    )  # 1 = everyone aims the same way
        if t_round is not None:
            tr = t_round[m]
            tr = tr[~np.isnan(tr)]
            if len(tr):
                item["mean_t_round_ms"] = int(tr.mean())
        out.append(item)
    out.sort(key=lambda x: -x["count"])
    return out[:CLUSTER_MAX_PER_GROUP]


def _on_minimap(u_col: str, v_col: str) -> pl.Expr:
    """Non-null u/v inside the minimap (0..1); null u/v evaluates to null → filtered out."""
    return pl.col(u_col).is_between(0, 1) & pl.col(v_col).is_between(0, 1)


def _np(df: pl.DataFrame, col: str) -> np.ndarray:
    return df[col].cast(pl.Float64).fill_null(float("nan")).to_numpy()


def _team_payload(
    team: dict[str, Any],
    t_games: pl.DataFrame,
    t_rounds: pl.DataFrame,
    t_casts: pl.DataFrame,
    t_kills: pl.DataFrame,
    t_rosters: pl.DataFrame,
    t_op: pl.DataFrame | None = None,
    t_pos: pl.DataFrame | None = None,
) -> dict[str, Any]:
    tid = team["id"]
    maps: dict[str, Any] = {}
    for (map_name,), g in sorted(t_games.partition_by("map", as_dict=True).items()):
        rr = t_rounds.filter(pl.col("map") == map_name)
        rounds_side = {
            "attacker": rr.filter(pl.col("attacker_team_id") == tid).height,
            "defender": rr.filter(pl.col("defender_team_id") == tid).height,
        }
        won_side = {
            "attacker": rr.filter(
                (pl.col("attacker_team_id") == tid) & (pl.col("winner_team_id") == tid)
            ).height,
            "defender": rr.filter(
                (pl.col("defender_team_id") == tid) & (pl.col("winner_team_id") == tid)
            ).height,
        }
        plants = rr.filter(
            (pl.col("plant_team_id") == tid) & pl.col("plant_site").is_not_null()
        )
        site_counts = {
            k: v for k, v in sorted(Counter(plants["plant_site"].to_list()).items())
        }
        n_plants = sum(site_counts.values())
        utility: dict[str, Any] = {}
        # only casts with an on-minimap position: `count` then equals the denominator of cluster `share`
        mc = t_casts.filter((pl.col("map") == map_name) & _on_minimap("u", "v"))
        # agent/slot once per ability (not per side/phase entry) to keep the JSON small
        abilities = {
            row["ability"]: {"agent": row["agent"], "slot": row["slot"]}
            for row in mc.group_by("ability")
            .agg(
                pl.col("agent").drop_nulls().mode().first(),
                pl.col("slot").drop_nulls().mode().first(),
            )
            .sort("ability")
            .iter_rows(named=True)
        }
        for (side, phase, ability), grp in mc.partition_by(
            ["side", "phase", "ability"], as_dict=True
        ).items():
            rp = rounds_side.get(side, 0)
            u, v = _np(grp, "u"), _np(grp, "v")
            ok = ~(np.isnan(u) | np.isnan(v))
            entry: dict[str, Any] = {
                "count": grp.height,
                "rounds_played": rp,
                "rate_per_round": _r(grp.height / rp, 3) if rp else None,
            }
            heat = heat_grid(u[ok], v[ok])
            if heat:  # empty heat/clusters are omitted
                entry["heat"] = heat
            cl = clusters(
                u[ok],
                v[ok],
                _np(grp, "view_u")[ok],
                _np(grp, "view_v")[ok],
                _np(grp, "t_round_ms")[ok],
            )
            if cl:
                entry["clusters"] = cl
            utility.setdefault(side, {}).setdefault(phase, {})[ability] = entry
        maps[map_name] = {
            "games": g.height,
            "wins": g.filter(pl.col("winner_team_id") == tid).height,
            "rounds": rounds_side,
            "round_wins": won_side,
            "round_win_rate": {
                s: (_r(won_side[s] / rounds_side[s], 3) if rounds_side[s] else None)
                for s in SIDES
            },
            "plant_sites": site_counts,
            "plant_site_share": {k: _r(c / n_plants, 3) for k, c in site_counts.items()}
            if n_plants
            else {},
            "abilities": abilities,
            "utility": utility,
        }
    return {
        "team": team,
        "maps": maps,
        "operator": _operator(tid, t_rounds, t_kills, t_rosters, t_op, t_pos),
    }


OP_ROUNDS_COLUMNS = {
    "game_id": pl.Utf8,
    "round_number": pl.Int32,
    "map": pl.Utf8,
    "player_id": pl.Utf8,
    "player_name": pl.Utf8,
    "team_id": pl.Utf8,
    "side": pl.Utf8,
    "op_kills": pl.Int32,
    "died": pl.Boolean,
    "killed_by_weapon": pl.Utf8,
    "lost_to_enemy": pl.Boolean,
}


def _pos_aggregates(
    df: pl.DataFrame, u_col: str, v_col: str, with_clusters: bool
) -> dict[str, Any]:
    """Heat (count >= 2) and optional clusters of on-minimap positions; empty parts are omitted."""
    on = df.filter(_on_minimap(u_col, v_col))
    u, v = _np(on, u_col), _np(on, v_col)
    out: dict[str, Any] = {}
    heat = heat_grid(u, v)
    if heat:
        out["heat"] = heat
    if with_clusters:
        cl = clusters(u, v, t_round=_np(on, "t_round_ms"))
        if cl:
            out["clusters"] = cl
    return out


def _op_heat24(op: pl.DataFrame, prefix: str = "") -> dict[str, Any]:
    """Coarse (OP_HEAT_GRID_SIZE) killer/victim heat of OP kills; keys `{prefix}heat24` /
    `{prefix}victim_heat24`, omitted when no cell reaches HEAT_MIN_COUNT."""
    out: dict[str, Any] = {}
    for key, (u_col, v_col) in (
        (f"{prefix}heat24", ("killer_u", "killer_v")),
        (f"{prefix}victim_heat24", ("victim_u", "victim_v")),
    ):
        on = op.filter(_on_minimap(u_col, v_col))
        heat = heat_grid(_np(on, u_col), _np(on, v_col), size=OP_HEAT_GRID_SIZE)
        if heat:
            out[key] = heat
    return out


OP_POS_CELL_KEYS = ["game_id", "round_number", "col", "row"]


def op_position_cells(op_positions: pl.DataFrame) -> pl.DataFrame:
    """OP holder position samples → one row per (round, player, phase, 24x24 cell) with mean u/v/t.

    Points outside the minimap are dropped; repeated samples in the same cell of the same round collapse to
    one row, so a long hold in one spot counts once per round."""
    g = OP_HEAT_GRID_SIZE
    return (
        op_positions.filter(
            _on_minimap("u", "v")
            & pl.col("team_id").is_not_null()
            & pl.col("side").is_not_null()
        )
        .with_columns(
            col=(pl.col("u") * g).floor().clip(0, g - 1).cast(pl.Int32),
            row=(pl.col("v") * g).floor().clip(0, g - 1).cast(pl.Int32),
        )
        .group_by(
            "game_id",
            "round_number",
            "map",
            "player_id",
            "team_id",
            "side",
            "phase",
            "col",
            "row",
        )
        .agg(pl.col("u").mean(), pl.col("v").mean(), pl.col("t_round_ms").mean())
    )


def _round_cell_heat(cells: pl.DataFrame) -> list[list[int]]:
    """[[col, row, rounds]]: rounds in which a holder stood in the cell (deduped per round), rounds >= 2."""
    if cells.height == 0:
        return []
    c = (
        cells.unique(OP_POS_CELL_KEYS)
        .group_by("col", "row")
        .agg(n=pl.len())
        .filter(pl.col("n") >= HEAT_MIN_COUNT)
        .sort("row", "col")
    )
    return [
        [int(a), int(b), int(n)] for a, b, n in c.select("col", "row", "n").iter_rows()
    ]


def _op_position_part(
    cells: pl.DataFrame, op_rounds: int, heat_key: str, cluster_key: str | None
) -> dict[str, Any]:
    """Round-deduped holder position heat (+ phase split, optional clusters) and the `op_rounds` denominator."""
    out: dict[str, Any] = {"op_rounds": op_rounds}
    heat = _round_cell_heat(cells)
    if heat:
        out[heat_key] = heat
    by_phase = {}
    for phase in (PHASE_OPENING, PHASE_MID):
        ph = _round_cell_heat(cells.filter(pl.col("phase") == phase))
        if ph:
            by_phase[phase] = ph
    if by_phase:
        out[f"{heat_key}_by_phase"] = by_phase
    if cluster_key and cells.height:
        pts = cells.group_by(OP_POS_CELL_KEYS).agg(
            pl.col("u").mean(), pl.col("v").mean(), pl.col("t_round_ms").mean()
        )
        cl = clusters(_np(pts, "u"), _np(pts, "v"), t_round=_np(pts, "t_round_ms"))
        if cl:
            out[cluster_key] = cl
    return out


def _op_team_positions(op: pl.DataFrame) -> dict[str, Any]:
    """Team-wide OP kill positions (all players) on the coarse grid: `op_kill_heat`, `op_victim_heat`,
    `op_kill_clusters` (killer positions); empty parts omitted."""
    coarse = _op_heat24(op)
    out: dict[str, Any] = {}
    if "heat24" in coarse:
        out["op_kill_heat"] = coarse["heat24"]
    if "victim_heat24" in coarse:
        out["op_victim_heat"] = coarse["victim_heat24"]
    on = op.filter(_on_minimap("killer_u", "killer_v"))
    cl = clusters(
        _np(on, "killer_u"), _np(on, "killer_v"), t_round=_np(on, "t_round_ms")
    )
    if cl:
        out["op_kill_clusters"] = cl
    return out


def _holder_stats(stints: pl.DataFrame, op_kills: int) -> dict[str, Any]:
    """OP holder metrics for one group of stints (player or team, any slice)."""
    rounds_with_op = stints.select("game_id", "round_number").unique().height
    died_rounds = (
        stints.filter(pl.col("died")).select("game_id", "round_number").unique().height
    )
    return {
        "rounds_with_op": rounds_with_op,
        "op_kills_per_op_round": _r(op_kills / rounds_with_op, 3)
        if rounds_with_op
        else None,
        "op_deaths": died_rounds,
        "op_survival_rate": _r(1 - died_rounds / rounds_with_op, 3)
        if rounds_with_op
        else None,
        "op_lost_to_enemy": stints.filter(pl.col("lost_to_enemy")).height,
    }


def _killed_by(stints: pl.DataFrame) -> dict[str, int]:
    w = Counter(
        stints.filter(pl.col("died"))["killed_by_weapon"]
        .fill_null("ability/other")
        .to_list()
    )
    return dict(w.most_common(OP_KILLED_BY_TOP))


def _phases(op: pl.DataFrame) -> dict[str, int]:
    c = Counter(op["phase"].drop_nulls().to_list())
    return {p: c[p] for p in PHASES if c.get(p)}


def _first_kill_part(pk: pl.DataFrame) -> dict[str, Any]:
    firsts = pk.filter(pl.col("is_first_kill_of_round"))
    with_op = firsts.filter(pl.col("weapon") == "operator").height
    return {
        "first_kills": firsts.height,
        "first_kills_with_op": with_op,
        "first_kill_op_share": _r(with_op / firsts.height, 3)
        if firsts.height
        else None,
    }


def _round_sides(tid: str, t_rounds: pl.DataFrame) -> pl.DataFrame:
    return t_rounds.select(
        "game_id",
        "round_number",
        "map",
        side=pl.when(pl.col("attacker_team_id") == tid)
        .then(pl.lit("attacker"))
        .when(pl.col("defender_team_id") == tid)
        .then(pl.lit("defender")),
    ).filter(pl.col("side").is_not_null())


def _operator(
    tid: str,
    t_rounds: pl.DataFrame,
    t_kills: pl.DataFrame,
    t_rosters: pl.DataFrame,
    t_op: pl.DataFrame | None = None,
    t_pos: pl.DataFrame | None = None,
) -> dict[str, Any]:
    """`t_pos` = op_position_cells(...) rows; when given, holder position heat is added (additive fields)."""
    kills = t_kills.filter(pl.col("killer_team_id") == tid)
    rounds_per_game = t_rounds.group_by("game_id").agg(n=pl.len())
    stints_all = (
        t_op if t_op is not None else pl.DataFrame(schema=OP_ROUNDS_COLUMNS)
    ).filter(pl.col("team_id") == tid)
    round_sides = _round_sides(tid, t_rounds)
    holder_ids = set(stints_all["player_id"].to_list())
    players = []
    for (pid,), pk in kills.partition_by("killer_id", as_dict=True).items():
        op = pk.filter(pl.col("weapon") == "operator")
        if op.height == 0 and pid not in holder_ids:
            continue
        holder_ids.discard(pid)
        players.append(
            _op_player(pid, pk, op, stints_all, round_sides, t_rosters, rounds_per_game)
        )
    for pid in sorted(holder_ids):  # held an OP but never got a kill with anything
        empty = kills.clear()
        players.append(
            _op_player(
                pid, empty, empty, stints_all, round_sides, t_rosters, rounds_per_game
            )
        )
    players.sort(key=lambda p: (-p["op_kills"], -p["rounds_with_op"]))
    firsts = kills.filter(pl.col("is_first_kill_of_round"))
    by_map = _op_team_by_map(kills, stints_all, round_sides, players)
    if t_pos is not None:
        _add_op_positions(players, by_map, t_pos.filter(pl.col("team_id") == tid))
    return {
        "team_kills": kills.height,
        "team_op_kills": kills.filter(pl.col("weapon") == "operator").height,
        "team_first_kills": firsts.height,
        "team_first_kills_with_op": firsts.filter(
            pl.col("weapon") == "operator"
        ).height,
        "players": players,
        "holder_source": "freezetime_inventory" if stints_all.height else "none",
        "by_map": by_map,
    }


def _add_op_positions(
    players: list[dict[str, Any]], by_map: dict[str, Any], pos: pl.DataFrame
) -> None:
    """Add holder position heat to player map/side entries and team by_map/side entries (in place)."""
    for p in players:
        pp = pos.filter(pl.col("player_id") == p["player_id"])
        for map_name, entry in p["maps"].items():
            for side, se in entry["sides"].items():
                cells = pp.filter(
                    (pl.col("map") == map_name) & (pl.col("side") == side)
                )
                se.update(
                    _op_position_part(
                        cells, se["rounds_with_op"], "position_heat", None
                    )
                )
    for map_name, sides in by_map.items():
        for side, se in sides.items():
            cells = pos.filter((pl.col("map") == map_name) & (pl.col("side") == side))
            se.update(
                _op_position_part(
                    cells,
                    se["rounds_with_op"],
                    "op_position_heat",
                    "op_position_clusters",
                )
            )


def _op_player(
    pid: str,
    pk: pl.DataFrame,
    op: pl.DataFrame,
    stints_all: pl.DataFrame,
    round_sides: pl.DataFrame,
    t_rosters: pl.DataFrame,
    rounds_per_game: pl.DataFrame,
) -> dict[str, Any]:
    games = t_rosters.filter(pl.col("player_id") == pid)["game_id"].unique()
    rounds_played = int(
        rounds_per_game.filter(pl.col("game_id").is_in(games.implode()))["n"].sum()
    )
    op_rounds = op.select("game_id", "round_number").unique().height
    firsts = pk.filter(pl.col("is_first_kill_of_round"))
    stints = stints_all.filter(pl.col("player_id") == pid)
    player_rounds = round_sides.filter(pl.col("game_id").is_in(games.implode()))
    maps = sorted(set(op["map"].to_list()) | set(stints["map"].to_list()))
    per_map = {}
    for map_name in maps:
        om = op.filter(pl.col("map") == map_name)
        u, v = _np(om, "killer_u"), _np(om, "killer_v")
        # NaN compares False, so this also drops missing positions
        ok = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
        ms = stints.filter(pl.col("map") == map_name)
        entry: dict[str, Any] = {
            "op_kills": om.height,
            "heat": heat_grid(u[ok], v[ok]),
            "clusters": clusters(u[ok], v[ok], t_round=_np(om, "t_round_ms")[ok]),
            "rounds_with_op": ms.select("game_id", "round_number").unique().height,
            "phases": _phases(om),
            **{
                f"victim_{k}": val
                for k, val in _pos_aggregates(om, "victim_u", "victim_v", False).items()
            },
            **_op_heat24(om),
            "sides": {},
        }
        for side in SIDES:
            sk = pk.filter(
                (pl.col("map") == map_name) & (pl.col("killer_side") == side)
            )
            so = sk.filter(pl.col("weapon") == "operator")
            ss = ms.filter(pl.col("side") == side)
            rp = player_rounds.filter(
                (pl.col("map") == map_name) & (pl.col("side") == side)
            ).height
            if so.height == 0 and ss.height == 0:
                continue
            hs = _holder_stats(ss, so.height)
            side_entry: dict[str, Any] = {
                "rounds_played": rp,
                "op_kills": so.height,
                **hs,
                "op_round_rate": _r(hs["rounds_with_op"] / rp, 3) if rp else None,
                "rounds_with_op_kill": so.select("game_id", "round_number")
                .unique()
                .height,
                **_first_kill_part(sk),
                "phases": _phases(so),
                "killed_by": _killed_by(ss),
                **_pos_aggregates(so, "killer_u", "killer_v", True),
                **{
                    f"victim_{k}": val
                    for k, val in _pos_aggregates(
                        so, "victim_u", "victim_v", False
                    ).items()
                },
                **_op_heat24(so),
                "low_sample": hs["rounds_with_op"] < OP_LOW_SAMPLE_ROUNDS,
            }
            entry["sides"][side] = side_entry
        per_map[map_name] = entry
    hs_all = _holder_stats(stints, op.height)
    return {
        "player_id": pid,
        "name": _player_name(pk, stints),
        "kills": pk.height,
        "op_kills": op.height,
        "op_kill_share": _r(op.height / pk.height, 3) if pk.height else 0.0,
        "first_kills": firsts.height,
        "first_kills_with_op": firsts.filter(pl.col("weapon") == "operator").height,
        "rounds_played": rounds_played,
        "rounds_with_op_kill": op_rounds,
        "rounds_with_op_kill_rate": _r(op_rounds / rounds_played, 3)
        if rounds_played
        else None,
        "maps": per_map,
        **hs_all,
        "op_round_rate": _r(hs_all["rounds_with_op"] / rounds_played, 3)
        if rounds_played
        else None,
        "first_kill_op_share": _first_kill_part(pk)["first_kill_op_share"],
        "low_sample": hs_all["rounds_with_op"] < OP_LOW_SAMPLE_ROUNDS,
    }


def _player_name(pk: pl.DataFrame, stints: pl.DataFrame) -> str | None:
    for col in (pk["killer_name"], stints["player_name"]):
        names = col.drop_nulls()
        if names.len():
            return names.last()
    return None


def _op_team_by_map(
    kills: pl.DataFrame,
    stints: pl.DataFrame,
    round_sides: pl.DataFrame,
    players: list[dict[str, Any]],
) -> dict[str, Any]:
    names = {p["player_id"]: p["name"] for p in players}
    out: dict[str, Any] = {}
    for (map_name,), mr in sorted(
        round_sides.partition_by("map", as_dict=True).items()
    ):
        per_side = {}
        for side in SIDES:
            rounds = mr.filter(pl.col("side") == side).height
            if rounds == 0:
                continue
            sk = kills.filter(
                (pl.col("map") == map_name) & (pl.col("killer_side") == side)
            )
            so = sk.filter(pl.col("weapon") == "operator")
            ss = stints.filter((pl.col("map") == map_name) & (pl.col("side") == side))
            op_round_n = ss.select("game_id", "round_number").unique().height
            op_kill_rounds = so.select("game_id", "round_number").unique().height
            top = None
            by_player = Counter(so["killer_id"].to_list())
            held = Counter(
                ss.select("game_id", "round_number", "player_id")
                .unique()["player_id"]
                .to_list()
            )
            ranked = sorted(
                set(by_player) | set(held), key=lambda p: (-by_player[p], -held[p], p)
            )
            if ranked:
                p = ranked[0]
                top = {
                    "player_id": p,
                    "name": names.get(p),
                    "op_kills": by_player[p],
                    "rounds_with_op": held[p],
                }
            per_side[side] = {
                "rounds": rounds,
                "rounds_with_op": op_round_n,
                "op_round_pct": _r(op_round_n / rounds, 3),
                "rounds_with_op_kill": op_kill_rounds,
                "op_kill_round_pct": _r(op_kill_rounds / rounds, 3),
                "op_kills": so.height,
                **_first_kill_part(sk),
                "top_op_player": top,
                "low_sample": rounds < OP_TEAM_LOW_SAMPLE_ROUNDS,
                **_op_team_positions(so),
            }
        if per_side:
            out[map_name] = per_side
    return out


def _work(
    args: tuple[dict[str, Any], bytes, bytes, bytes, bytes, bytes, bytes, bytes, str],
) -> tuple[str, int]:
    team, g, r, c, k, ro, op, pos, out = args
    payload = _team_payload(
        team,
        pl.DataFrame.deserialize(_buf(g)),
        pl.DataFrame.deserialize(_buf(r)),
        pl.DataFrame.deserialize(_buf(c)),
        pl.DataFrame.deserialize(_buf(k)),
        pl.DataFrame.deserialize(_buf(ro)),
        pl.DataFrame.deserialize(_buf(op)),
        pl.DataFrame.deserialize(_buf(pos)),
    )
    payload["generated_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    payload["definitions"] = DEFINITIONS
    text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    Path(out).write_text(text, encoding="utf-8")
    return team["id"], len(text.encode())


def _buf(b: bytes) -> Any:
    import io

    return io.BytesIO(b)


def _ser(df: pl.DataFrame) -> bytes:
    return df.serialize()


DEFINITIONS = {
    "phases_ms_from_freezetime_end": {
        "buy": "< 0",
        "opening": f"0–{OPENING_END_MS}",
        "mid": f"{OPENING_END_MS}–{MID_END_MS}",
        "late": f"> {MID_END_MS}, before plant",
        "post_plant": "at/after plant",
    },
    "uv": "normalized minimap coords (0..1, origin top-left) on the map's displayIcon",
    "heat": f"[col, row, count] on a {HEAT_GRID_SIZE}x{HEAT_GRID_SIZE} grid; only cells with count >= {HEAT_MIN_COUNT}",
    "clusters": f"DBSCAN eps={CLUSTER_EPS_UV} uv, min_samples=max({CLUSTER_MIN_SAMPLES}, {CLUSTER_MIN_SHARE:.0%} of group); "
    f"radius = p90 distance to centroid; top {CLUSTER_MAX_PER_GROUP}",
    "rate_per_round": "casts / rounds the team played on that map and side",
    "operator_heat24": f"heat24/victim_heat24 (players) and op_kill_heat/op_victim_heat (team by_map): "
    f"[col, row, count] on a {OP_HEAT_GRID_SIZE}x{OP_HEAT_GRID_SIZE} grid; only cells with count >= {HEAT_MIN_COUNT}",
    "operator_position_heat": "op_position_heat (team) / position_heat (player): where OP holders stood while alive "
    f"and holding, opening+mid (0-{MID_END_MS} ms after freezetime end, pre-plant), from feed snapshots; "
    f"[col, row, rounds] on a {OP_HEAT_GRID_SIZE}x{OP_HEAT_GRID_SIZE} grid, each round counted once per cell, "
    f"only cells with rounds >= {HEAT_MIN_COUNT}; divide by op_rounds for a share. *_by_phase = same per phase; "
    "op_position_clusters = DBSCAN on one point per (round, cell)",
    "operator_holder": "player whose inventory holds an Operator at freezetime end (seriesState), "
    "plus later Operator pickups; op_deaths = OP rounds in which the holder died; "
    "op_lost_to_enemy = an enemy picked up an Operator after the holder died",
    "operator_low_sample": f"player entries: rounds_with_op < {OP_LOW_SAMPLE_ROUNDS}; "
    f"team map/side entries: rounds < {OP_TEAM_LOW_SAMPLE_ROUNDS}",
    "data_notice": "Aggregates derived from GRID match data (Sky's The Limit 2026 hackathon license). Not for redistribution.",
}


def run(workers: int | None = None) -> dict[str, Any]:
    t0 = time.monotonic()
    root = data_dir()
    games = pl.read_parquet(PARQUET_DIR / "games.parquet")
    rounds = pl.read_parquet(PARQUET_DIR / "rounds.parquet")
    casts = pl.read_parquet(PARQUET_DIR / "casts.parquet").filter(
        pl.col("team_id").is_not_null()
        & pl.col("side").is_not_null()
        & pl.col("phase").is_not_null()
        & pl.col("ability").is_not_null()
    )
    kills = pl.read_parquet(PARQUET_DIR / "kills.parquet")
    op_rounds = pl.read_parquet(PARQUET_DIR / "op_rounds.parquet").select(
        list(OP_ROUNDS_COLUMNS)
    )
    op_pos = op_position_cells(pl.read_parquet(PARQUET_DIR / "op_positions.parquet"))
    rosters = pl.read_csv(root / "meta" / "rosters.csv", infer_schema=False).filter(
        pl.col("title") == "val"
    )
    teams_meta = pl.read_csv(root / "meta" / "teams.csv", infer_schema=False).filter(
        pl.col("title") == "val"
    )
    calibs = load_calibs()

    played = games.filter(pl.col("game_id").is_in(rounds["game_id"].unique().implode()))
    long = pl.concat(
        [
            played.select(
                "game_id",
                "map",
                "started_at",
                "tournament",
                "winner_team_id",
                team_id=pl.col("team1_id"),
            ),
            played.select(
                "game_id",
                "map",
                "started_at",
                "tournament",
                "winner_team_id",
                team_id=pl.col("team2_id"),
            ),
        ]
    )
    team_games = long.group_by("team_id").agg(n=pl.len())
    forced = set(
        teams_meta.filter(pl.col("name").is_in(list(FORCE_INCLUDE_TEAM_NAMES)))[
            "team_id"
        ].to_list()
    )
    eligible = team_games.filter(
        (pl.col("n") >= MIN_TEAM_GAMES) | pl.col("team_id").is_in(list(forced))
    )
    skipped_small = team_games.height - eligible.height
    names = dict(
        zip(teams_meta["team_id"].to_list(), teams_meta["name"].to_list(), strict=True)
    )

    if WEB_DATA_DIR.exists():
        shutil.rmtree(WEB_DATA_DIR)
    (WEB_DATA_DIR / "teams").mkdir(parents=True)

    jobs = []
    index_teams = []
    for tid in eligible["team_id"].to_list():
        tg = long.filter(pl.col("team_id") == tid).sort("started_at")
        team = {
            "id": tid,
            "name": names.get(tid, tid),
            "last_tournament": tg["tournament"].drop_nulls().last()
            if tg["tournament"].drop_nulls().len()
            else None,
            "games": tg.height,
            "games_per_map": dict(sorted(Counter(tg["map"].to_list()).items())),
        }
        index_teams.append(team)
        gids = tg["game_id"].implode()
        jobs.append(
            (
                team,
                _ser(tg),
                _ser(
                    rounds.filter(
                        pl.col("game_id").is_in(gids)
                        & (
                            (pl.col("attacker_team_id") == tid)
                            | (pl.col("defender_team_id") == tid)
                            | (pl.col("plant_team_id") == tid)
                        )
                    )
                ),
                _ser(casts.filter(pl.col("team_id") == tid)),
                _ser(kills.filter(pl.col("killer_team_id") == tid)),
                _ser(
                    rosters.filter(
                        (pl.col("team_id") == tid) & pl.col("game_id").is_in(gids)
                    ).select("game_id", "player_id")
                ),
                _ser(op_rounds.filter(pl.col("team_id") == tid)),
                _ser(op_pos.filter(pl.col("team_id") == tid)),
                str(WEB_DATA_DIR / "teams" / f"{tid}.json"),
            )
        )
    print(
        f"[aggregate] {len(jobs)} teams (skipped {skipped_small} with < {MIN_TEAM_GAMES} games)",
        flush=True,
    )
    sizes: dict[str, int] = {}
    with ProcessPoolExecutor(
        max_workers=workers or max(1, (os.cpu_count() or 2) - 1)
    ) as pool:
        for i, (tid, size) in enumerate(pool.map(_work, jobs), 1):
            sizes[tid] = size
            if i % 25 == 0 or i == len(jobs):
                print(f"[aggregate] {i}/{len(jobs)} teams", flush=True)

    map_games = Counter(played["map"].to_list())
    maps_index = []
    for name in sorted(map_games):
        c = calibs.get(name)
        if c is None:
            continue
        maps_index.append(
            {
                "name": name,
                "display_name": c.display_name,
                "display_icon": c.display_icon,
                "games": map_games[name],
                "coefficients": {
                    "xMultiplier": c.x_mult,
                    "yMultiplier": c.y_mult,
                    "xScalarToAdd": c.x_add,
                    "yScalarToAdd": c.y_add,
                },
                "formula": "u = y*xMultiplier + xScalarToAdd; v = x*yMultiplier + yScalarToAdd",
                "sites": [
                    {"site": s, "u": _r(to_uv(c, x, y)[0]), "v": _r(to_uv(c, x, y)[1])}
                    for s, x, y in c.sites
                ],
            }
        )
    index_teams.sort(key=lambda t: -t["games"])
    index = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "teams": index_teams,
        "maps": maps_index,
        "definitions": DEFINITIONS,
    }
    index_text = json.dumps(index, separators=(",", ":"))
    (WEB_DATA_DIR / "index.json").write_text(index_text, encoding="utf-8")
    total = sum(sizes.values()) + len(index_text.encode())
    report = {
        "teams_written": len(jobs),
        "teams_skipped_lt_min_games": skipped_small,
        "forced_teams": sorted(forced),
        "forced_teams_written": sorted(t for t in forced if t in sizes),
        "total_bytes": total,
        "largest_team_bytes": max(sizes.values()) if sizes else 0,
        "seconds": round(time.monotonic() - t0, 1),
    }
    print(
        f"[aggregate] wrote {len(jobs)} team files + index.json, total {total / 1e6:.1f} MB",
        flush=True,
    )
    return report
