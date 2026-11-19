"""Operator holder extraction and profiler aggregates. Synthetic, hand-made fixtures only (no GRID data)."""

import json

import polars as pl
from test_extract_aggregate import GID, _ctx, _env, _ev

from utility_fingerprint_etl.aggregate import (
    _op_position_part,
    _operator,
    op_position_cells,
)
from utility_fingerprint_etl.extract import (
    build_kills,
    build_op_positions,
    build_op_rounds,
    build_rounds,
    op_holders_from_state,
    parse_feed,
    resolve_op,
)


def _player(pid, *items):
    return {
        "id": pid,
        "inventory": {"items": [{"id": i, "quantity": 1} for i in items]},
    }


def _state():
    return {
        "games": [
            {
                "id": "g0",
                "teams": [{"id": "T1", "players": [_player("p9", "operator")]}],
            },
            {
                "id": GID,
                "teams": [
                    {
                        "id": "T1",
                        "players": [
                            _player("p1", "operator", "classic"),
                            _player("p3", "vandal"),
                        ],
                    },
                    {
                        "id": "T2",
                        "players": [_player("p2", "vandal"), _player("p5", "phantom")],
                    },
                ],
            },
        ]
    }


def _kill(t, killer, k_team, victim, v_team, weapon):
    return _env(
        f"2026-01-01T00:10:{t:02d}.000Z",
        _ev(
            "player-killed-player",
            {
                "id": killer,
                "state": {"teamId": k_team},
                "stateDelta": {"game": {"weaponKills": {weapon: 1}}},
            },
            {"id": victim, "state": {"teamId": v_team}},
        ),
    )


def _op_round():
    return [
        _env(
            "2026-01-01T00:10:00.000Z",
            _ev("game-started-round", {"id": GID}, {"id": "round-1"}),
        ),
        _env(
            "2026-01-01T00:10:30.000Z",
            _ev(
                "round-ended-freezetime",
                {"id": GID},
                {"id": "freezetime-1"},
                seriesState=_state(),
            ),
        ),
        _kill(40, "p1", "T1", "p2", "T2", "operator"),  # holder kills
        _kill(45, "p5", "T2", "p1", "T1", "vandal"),  # holder dies
        _env(
            "2026-01-01T00:10:47.000Z",
            _ev(
                "player-pickedUp-item",
                {"id": "p5", "state": {"teamId": "T2"}},
                {"id": "operator"},
            ),
        ),
        _kill(48, "p5", "T2", "p3", "T1", "operator"),  # enemy uses the stolen OP
        _env(
            "2026-01-01T00:11:10.000Z",
            _ev(
                "team-won-round",
                {"id": "T2", "state": {"side": "defender"}},
                {"id": "round-1"},
            ),
        ),
    ]


def test_op_holders_only_from_current_game():
    assert op_holders_from_state(_state(), GID) == {"p1": "T1"}
    assert op_holders_from_state(None, GID) == {}


def test_resolve_op_tracks_holder_death_and_enemy_pickup(tmp_path):
    ctx = _ctx(tmp_path, _op_round())
    rounds, kills, stats = parse_feed(ctx)
    assert stats["op_pickups"] == 1
    _, index = build_rounds(ctx, rounds)
    had, stints, op_stats = resolve_op(rounds, kills)
    rows = build_kills(ctx, kills, index, had)
    assert [(r["killer_had_op"], r["victim_had_op"]) for r in rows] == [
        (True, False),
        (False, True),
        (True, False),
    ]
    assert op_stats["op_kill_by_nonholder"] == 0
    op_rows = {r["player_id"]: r for r in build_op_rounds(ctx, stints, index)}
    p1, p5 = op_rows["p1"], op_rows["p5"]
    assert p1["source"] == "freezetime_inventory" and p1["side"] == "attacker"
    assert p1["op_kills"] == 1 and p1["died"] and p1["died_t_round_ms"] == 15_000
    assert (
        p1["killed_by_weapon"] == "vandal"
        and p1["lost_to_enemy"]
        and not p1["recovered_by_team"]
    )
    assert p5["source"] == "pickup" and p5["side"] == "defender" and p5["op_kills"] == 1


def test_kill_had_op_is_null_without_freezetime(tmp_path):
    envs = [
        e for e in _op_round() if e["events"][0]["type"] != "round-ended-freezetime"
    ]
    ctx = _ctx(tmp_path, envs)
    rounds, kills, _ = parse_feed(ctx)
    _, index = build_rounds(ctx, rounds)
    had, stints, _ = resolve_op(rounds, kills)
    assert stints == {} and {
        r["killer_had_op"] for r in build_kills(ctx, kills, index, had)
    } == {None}


def _pos_env(ts, **positions):
    players = [
        {"id": pid, "position": {"x": x, "y": y}} for pid, (x, y) in positions.items()
    ]
    state = {"games": [{"id": GID, "teams": [{"id": "T1", "players": players}]}]}
    return _env(
        f"2026-01-01T00:{ts}.000Z",
        _ev("player-damaged-player", {"id": "p9"}, {"id": "p8"}, seriesState=state),
    )


def test_op_positions_only_while_alive_holding_and_in_opening_mid(tmp_path):
    envs = _op_round() + [
        _pos_env("10:31", p1=(100.0, 100.0), p3=(5.0, 5.0)),  # p3 never holds the OP
        _pos_env("10:32", p1=(100.0, 100.0)),  # unchanged position → dropped
        _pos_env("10:35", p1=(200.0, 200.0)),
        _pos_env("10:46", p1=(300.0, 300.0)),  # p1 died at 10:45
        _pos_env(
            "10:50", p5=(900.0, 900.0)
        ),  # p5 picked the OP up at 10:47 (t_round 20 s → mid)
        _pos_env("11:20", p5=(950.0, 950.0)),  # t_round 50 s → outside opening+mid
    ]
    envs.sort(key=lambda e: e["occurredAt"])
    ctx = _ctx(tmp_path, envs)
    rounds, kills, _ = parse_feed(ctx)
    _, index = build_rounds(ctx, rounds)
    _, stints, _ = resolve_op(rounds, kills)
    rows = build_op_positions(ctx, rounds, stints, index)
    got = [(r["player_id"], r["x"], r["phase"], r["side"]) for r in rows]
    assert got == [
        ("p1", 100.0, "opening", "attacker"),
        ("p1", 200.0, "opening", "attacker"),
        ("p5", 900.0, "mid", "defender"),
    ]


def _round_without_holder(keep):
    """_op_round() with no Operator in the freezetime inventory; keep only event types in `keep`."""
    envs = []
    for e in _op_round():
        ev = e["events"][0]
        if ev["type"] == "round-ended-freezetime":
            state = ev["seriesState"]["games"][1]["teams"][0]["players"]
            state[0]["inventory"]["items"] = [{"id": "classic", "quantity": 1}]
        elif ev["type"] not in keep:
            continue
        envs.append(e)
    return envs


def _extract(tmp_path, envs):
    envs.sort(key=lambda e: e["occurredAt"])
    ctx = _ctx(tmp_path, envs)
    rounds, kills, stats = parse_feed(ctx)
    _, index = build_rounds(ctx, rounds)
    had, stints, op_stats = resolve_op(rounds, kills)
    return ctx, rounds, kills, index, had, stints, op_stats


def test_op_kill_by_nonholder_infers_stint_with_side_and_positions(tmp_path):
    envs = _round_without_holder(
        {"game-started-round", "player-killed-player", "team-won-round"}
    ) + [
        _pos_env("10:35", p1=(100.0, 100.0)),  # before p1's OP kill → not yet a holder
        _pos_env("10:41", p1=(150.0, 150.0)),
        _pos_env("10:46", p1=(300.0, 300.0)),  # p1 died at 10:45
        _pos_env("10:50", p5=(900.0, 900.0)),  # p5 OP kill at 10:48, no pickup event
    ]
    ctx, rounds, kills, index, had, stints, op_stats = _extract(tmp_path, envs)
    assert (
        op_stats["op_kill_by_nonholder"] == 2
        and op_stats["op_stint_kill_inferred"] == 2
    )
    rows = build_kills(ctx, kills, index, had)
    assert [(r["weapon"], r["killer_had_op"]) for r in rows] == [
        ("operator", True),
        ("vandal", False),
        ("operator", True),
    ]
    op_rows = {r["player_id"]: r for r in build_op_rounds(ctx, stints, index)}
    p1, p5 = op_rows["p1"], op_rows["p5"]
    assert (p1["source"], p1["side"], p1["op_kills"], p1["start_t_round_ms"]) == (
        "kill_inferred",
        "attacker",
        1,
        10_000,
    )
    assert p1["died"] and p1["lost_to_enemy"]
    assert (p5["source"], p5["side"], p5["op_kills"]) == (
        "kill_inferred",
        "defender",
        1,
    )
    got = [
        (r["player_id"], r["x"]) for r in build_op_positions(ctx, rounds, stints, index)
    ]
    assert got == [("p1", 150.0), ("p5", 900.0)]


def test_pickup_only_round_samples_positions_from_pickup(tmp_path):
    envs = _round_without_holder(
        {"game-started-round", "player-pickedUp-item", "team-won-round"}
    ) + [
        _pos_env("10:40", p5=(800.0, 800.0)),  # before the pickup at 10:47
        _pos_env("10:50", p5=(900.0, 900.0)),
    ]
    ctx, rounds, _, index, _, stints, _ = _extract(tmp_path, envs)
    (row,) = build_op_rounds(ctx, stints, index)
    assert (row["player_id"], row["source"], row["side"]) == (
        "p5",
        "pickup",
        "defender",
    )
    got = [
        (r["player_id"], r["x"], r["phase"])
        for r in build_op_positions(ctx, rounds, stints, index)
    ]
    assert got == [("p5", 900.0, "mid")]


def test_op_position_heat_dedupes_per_round_and_applies_threshold():
    def sample(rn, u, v, phase="opening", pid="p1"):
        return {
            "game_id": "g1",
            "round_number": rn,
            "map": "testmap",
            "player_id": pid,
            "team_id": "T1",
            "side": "defender",
            "phase": phase,
            "t_round_ms": 5000,
            "u": u,
            "v": v,
        }

    # 24-grid cell of u/v 0.43..0.45 = (10, 10); round 1 stands there 3 times (counts once), round 2 once
    # (other player, same round-count rule), round 3 once in a lone cell → not published
    pos = pl.DataFrame(
        [
            sample(1, 0.431, 0.431),
            sample(1, 0.432, 0.433),
            sample(1, 0.444, 0.441, "mid"),
            sample(2, 0.437, 0.436, "mid", pid="p2"),
            sample(3, 0.913, 0.113),
            sample(4, 1.5, 0.5),  # off the minimap → dropped
        ]
    )
    cells = op_position_cells(pos)
    out = _op_position_part(cells, 4, "op_position_heat", "op_position_clusters")
    assert out["op_rounds"] == 4
    assert out["op_position_heat"] == [[10, 10, 2]]
    assert out["op_position_heat_by_phase"] == {
        "mid": [[10, 10, 2]]
    }  # opening: only round 1 → < 2
    assert "op_position_clusters" not in out  # 3 round-cells, none 3 within eps
    text = json.dumps(out)
    for raw in ("0.431", "0.437", "0.913", "0.113", "1.5"):
        assert raw not in text


def _kills_df(rows):
    schema = {
        "killer_team_id": pl.Utf8,
        "killer_id": pl.Utf8,
        "killer_name": pl.Utf8,
        "weapon": pl.Utf8,
        "game_id": pl.Utf8,
        "round_number": pl.Int32,
        "map": pl.Utf8,
        "killer_side": pl.Utf8,
        "phase": pl.Utf8,
        "is_first_kill_of_round": pl.Boolean,
        "t_round_ms": pl.Int64,
        "killer_u": pl.Float64,
        "killer_v": pl.Float64,
        "victim_u": pl.Float64,
        "victim_v": pl.Float64,
    }
    return pl.DataFrame(rows, schema=schema, orient="row")


def test_operator_profile_side_split_low_sample_and_no_raw_points():
    rounds = pl.DataFrame(
        {
            "game_id": ["g1"] * 4,
            "round_number": [1, 2, 13, 14],
            "map": ["testmap"] * 4,
            "attacker_team_id": ["T1", "T1", "T2", "T2"],
            "defender_team_id": ["T2", "T2", "T1", "T1"],
        }
    )
    kills = _kills_df(
        [
            (
                "T1",
                "p1",
                "alpha",
                "operator",
                "g1",
                1,
                "testmap",
                "attacker",
                "opening",
                True,
                3000,
                0.301,
                0.601,
                0.401,
                0.501,
            ),
            (
                "T1",
                "p1",
                "alpha",
                "operator",
                "g1",
                2,
                "testmap",
                "attacker",
                "opening",
                False,
                9000,
                0.302,
                0.602,
                0.402,
                0.502,
            ),
            (
                "T1",
                "p1",
                "alpha",
                "operator",
                "g1",
                2,
                "testmap",
                "attacker",
                "mid",
                False,
                20000,
                0.303,
                0.603,
                0.403,
                0.503,
            ),
            (
                "T1",
                "p1",
                "alpha",
                "operator",
                "g1",
                13,
                "testmap",
                "defender",
                "late",
                True,
                50000,
                0.777,
                0.123,
                0.888,
                0.234,
            ),
            (
                "T1",
                "p3",
                "gamma",
                "vandal",
                "g1",
                14,
                "testmap",
                "defender",
                "opening",
                True,
                2000,
                0.5,
                0.5,
                0.6,
                0.6,
            ),
        ]
    )
    stints = pl.DataFrame(
        {
            "game_id": ["g1"] * 3,
            "round_number": [1, 2, 13],
            "map": ["testmap"] * 3,
            "player_id": ["p1"] * 3,
            "player_name": ["alpha"] * 3,
            "team_id": ["T1"] * 3,
            "side": ["attacker", "attacker", "defender"],
            "op_kills": [1, 2, 1],
            "died": [False, True, False],
            "killed_by_weapon": [None, "sheriff", None],
            "lost_to_enemy": [False, True, False],
        },
        schema_overrides={"op_kills": pl.Int32, "round_number": pl.Int32},
    )
    rosters = pl.DataFrame({"game_id": ["g1", "g1"], "player_id": ["p1", "p3"]})
    out = _operator("T1", rounds, kills, rosters, stints)

    (p1,) = [p for p in out["players"] if p["player_id"] == "p1"]
    # existing fields are unchanged
    assert (
        p1["op_kills"] == 4
        and p1["rounds_with_op_kill"] == 3
        and p1["first_kills_with_op"] == 2
    )
    assert (
        p1["rounds_with_op"] == 3
        and p1["op_deaths"] == 1
        and p1["op_lost_to_enemy"] == 1
    )
    assert p1["low_sample"] is True  # 3 OP rounds < OP_LOW_SAMPLE_ROUNDS
    m = p1["maps"]["testmap"]
    att, dfn = m["sides"]["attacker"], m["sides"]["defender"]
    assert (att["op_kills"], att["rounds_with_op"], att["rounds_played"]) == (3, 2, 2)
    assert att["op_survival_rate"] == 0.5 and att["killed_by"] == {"sheriff": 1}
    assert att["phases"] == {"opening": 2, "mid": 1}
    assert (dfn["op_kills"], dfn["first_kills"], dfn["first_kill_op_share"]) == (
        1,
        1,
        1.0,
    )
    # aggregates only: heat cells need >= 2 events, the lone defender kill/victim position is never published
    assert all(c[2] >= 2 for c in att["heat"] + att["victim_heat"])
    assert "heat" not in dfn and "victim_heat" not in dfn and "clusters" not in dfn
    text = json.dumps(out)
    for raw in ("0.777", "0.123", "0.888", "0.234", "0.301", "0.401"):
        assert raw not in text

    team = out["by_map"]["testmap"]
    assert (
        team["attacker"]["rounds_with_op"] == 2
        and team["attacker"]["op_round_pct"] == 1.0
    )
    assert (
        team["defender"]["first_kills"] == 2
        and team["defender"]["first_kill_op_share"] == 0.5
    )
    assert team["attacker"]["top_op_player"]["name"] == "alpha"
    assert team["attacker"]["low_sample"] is True


def test_operator_coarse_heat24_team_and_player():
    """Two OP kills by different players fall in different 48x48 cells but the same 24x24 cell."""
    rounds = pl.DataFrame(
        {
            "game_id": ["g1"] * 3,
            "round_number": [13, 14, 15],
            "map": ["testmap"] * 3,
            "attacker_team_id": ["T2"] * 3,
            "defender_team_id": ["T1"] * 3,
        }
    )

    def row(pid, name, rn, ku, kv, vu, vv):
        common = ("operator", "g1", rn, "testmap", "defender", "opening", False, 5000)
        return ("T1", pid, name, *common, ku, kv, vu, vv)

    rows = [
        # killer u/v 0.43 / 0.45 → 48-grid cells 20 / 21, both 24-grid cell 10;
        # victim u/v 0.76 / 0.78 → 48-grid cells 36 / 37, both 24-grid cell 18
        row("p1", "alpha", 13, 0.43, 0.43, 0.76, 0.76),
        row("p2", "beta", 14, 0.45, 0.45, 0.78, 0.78),
        row("p1", "alpha", 15, 0.91, 0.11, 0.21, 0.31),
    ]
    out = _operator(
        "T1",
        rounds,
        _kills_df(rows),
        pl.DataFrame({"game_id": ["g1"], "player_id": ["p1"]}),
    )

    dfn = out["by_map"]["testmap"]["defender"]
    assert dfn["op_kill_heat"] == [[10, 10, 2]]
    assert dfn["op_victim_heat"] == [[18, 18, 2]]
    assert "op_kill_clusters" not in dfn  # 3 kills, no 3 within eps
    # each player alone has < 2 kills per cell → no fine or coarse heat for them
    for p in out["players"]:
        side = p["maps"]["testmap"]["sides"]["defender"]
        assert (
            "heat" not in side and "heat24" not in side and "victim_heat24" not in side
        )
    text = json.dumps(out)
    for raw in ("0.43", "0.45", "0.91", "0.11", "0.76", "0.21"):
        assert raw not in text
