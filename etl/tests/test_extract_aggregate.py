"""Synthetic, hand-made fixtures only (no GRID data)."""

import json

import numpy as np
import polars as pl
import zstandard

from utility_fingerprint_etl.aggregate import (
    _team_payload,
    clusters,
    heat_grid,
    reset_web_data_dir,
)
from utility_fingerprint_etl.extract import (
    GameMeta,
    KillRec,
    SeriesContext,
    build_kills,
    build_rounds,
    first_kill_indices,
    missing_freezetime_stats,
    parse_feed,
)
from utility_fingerprint_etl.geometry import MapCalib

CALIB = MapCalib(
    "testmap",
    "Testmap",
    "",
    1e-4,
    -1e-4,
    0.5,
    0.5,
    (("A", 1000.0, 1000.0), ("B", -1000.0, -1000.0)),
)
GID = "g1"


def _ev(etype, actor, target, game_id=GID, **extra):
    a_type, action, t_type = etype.split("-")
    return {
        "id": f"e-{etype}-{actor.get('id')}",
        "type": etype,
        "action": action,
        "actor": {"type": a_type, **actor},
        "target": {"type": t_type, **target},
        "seriesStateDelta": {"games": [{"id": game_id}]},
        **extra,
    }


def _env(ts, *events):
    return {"occurredAt": ts, "events": list(events)}


def _round(rn, t0, attacker, defender, winner):
    snap = {
        "games": [
            {
                "id": GID,
                "teams": [
                    {"id": attacker, "side": "attacker"},
                    {"id": defender, "side": "defender"},
                ],
            }
        ]
    }
    return [
        _env(
            f"2026-01-01T00:{t0:02d}:00.000Z",
            _ev(
                "game-started-round",
                {"id": GID},
                {"id": f"round-{rn}"},
                seriesState=snap,
            ),
        ),
        _env(
            f"2026-01-01T00:{t0:02d}:30.000Z",
            _ev("round-ended-freezetime", {"id": GID}, {"id": f"freezetime-{rn}"}),
        ),
        _env(
            f"2026-01-01T00:{t0:02d}:40.000Z",
            _ev(
                "player-killed-player",
                {
                    "id": "p1",
                    "state": {
                        "teamId": "T1",
                        "game": {"position": {"x": 1000.0, "y": 1000.0}},
                    },
                    "stateDelta": {
                        "game": {"weaponKills": {"operator": 1}},
                        "round": {"firstKill": True},
                    },
                },
                {
                    "id": "p2",
                    "state": {
                        "teamId": "T2",
                        "game": {"position": {"x": 0.0, "y": 0.0}},
                    },
                },
            ),
        ),
        _env(
            f"2026-01-01T00:{t0:02d}:50.000Z",
            _ev(
                "player-completed-plantBomb",
                {
                    "id": "p3",
                    "state": {
                        "teamId": attacker,
                        "game": {"position": {"x": 950.0, "y": 1020.0}},
                    },
                },
                {"id": "plantBomb"},
            ),
        ),
        _env(
            f"2026-01-01T00:{t0 + 1:02d}:10.000Z",
            _ev(
                "team-won-round",
                {
                    "id": winner,
                    "state": {"side": "attacker" if winner == attacker else "defender"},
                    "stateDelta": {"round": {"winType": "bombExploded"}},
                },
                {"id": f"round-{rn}"},
            ),
        ),
        _env(
            f"2026-01-01T00:{t0 + 1:02d}:11.000Z",
            _ev("game-ended-round", {"id": GID}, {"id": f"round-{rn}"}),
        ),
    ]


def _ctx(tmp_path, envelopes):
    feed = tmp_path / "feed.jsonl.zst"
    with zstandard.open(feed, "wt", encoding="utf-8") as f:
        for env in envelopes:
            f.write(json.dumps(env, separators=(",", ":")) + "\n")
    return SeriesContext(
        series_id="s1",
        feed=feed,
        supplement=None,
        games={GID: GameMeta(GID, "testmap", "T1", "T2")},
        rosters={
            (GID, "p1"): ("T1", "alpha", "chamber"),
            (GID, "p2"): ("T2", "beta", "jett"),
        },
        calibs={"testmap": CALIB},
        out_dir=tmp_path / "out",
    )


def test_parse_feed_rounds_sides_weapon_phase(tmp_path):
    envs = _round(12, 10, "T1", "T2", "T1") + _round(13, 20, "T2", "T1", "T1")
    ctx = _ctx(tmp_path, envs)
    rounds, kills, _ = parse_feed(ctx)
    rows, index = build_rounds(ctx, rounds)
    by_rn = {r["round_number"]: r for r in rows}
    assert (
        by_rn[12]["attacker_team_id"] == "T1" and by_rn[13]["attacker_team_id"] == "T2"
    )  # side switch at 13
    assert (
        by_rn[13]["winner_side"] == "defender" and by_rn[13]["side_source"] == "winner"
    )
    assert by_rn[12]["outcome"] == "explode"
    assert by_rn[12]["plant_site"] == "A" and by_rn[12]["plant_t_round_ms"] == 20_000
    k = build_kills(ctx, kills, index)
    assert [x["weapon"] for x in k] == ["operator", "operator"]
    assert k[0]["t_round_ms"] == 10_000 and k[0]["phase"] == "opening"
    assert k[0]["is_first_kill_of_round"] and k[0]["killer_agent"] == "chamber"
    assert k[0]["killer_side"] == "attacker" and k[1]["killer_side"] == "defender"
    assert 0 <= k[0]["killer_u"] <= 1


def test_kill_reversal_removes_kill(tmp_path):
    envs = _round(1, 10, "T1", "T2", "T1")
    undo = _ev("player-!killed-player", {"id": "p1"}, {"id": "p2"})
    envs.insert(3, _env("2026-01-01T00:10:41.000Z", undo))
    _, kills, stats = parse_feed(_ctx(tmp_path, envs))
    assert kills == [] and stats["reversal:player-!killed-player"] == 1


def _kill(killer, victim, ev_id):
    return {
        **_ev(
            "player-killed-player",
            {
                "id": killer,
                "state": {"teamId": "T1"},
                "stateDelta": {"game": {"weaponKills": {"vandal": 1}}},
            },
            {"id": victim, "state": {"teamId": "T2"}},
        ),
        "id": ev_id,
    }


def test_first_kill_unique_when_timestamps_tie(tmp_path):
    envs = _round(1, 10, "T1", "T2", "T1")
    ts = "2026-01-01T00:10:35.000Z"  # earlier than the fixture's kill, all three share one timestamp
    # same envelope: event order decides; separate envelope with the same time but higher sequenceNumber loses
    envs.insert(
        2,
        {
            "occurredAt": ts,
            "sequenceNumber": 7,
            "events": [_kill("p1", "p2", "z"), _kill("p4", "p5", "a")],
        },
    )
    envs.insert(
        3, {"occurredAt": ts, "sequenceNumber": 8, "events": [_kill("p6", "p7", "0")]}
    )
    ctx = _ctx(tmp_path, envs)
    rounds, kills, _ = parse_feed(ctx)
    _, index = build_rounds(ctx, rounds)
    rows = build_kills(ctx, kills, index)
    firsts = [
        (r["killer_id"], r["victim_id"]) for r in rows if r["is_first_kill_of_round"]
    ]
    assert firsts == [("p1", "p2")]


def test_first_kill_indices_falls_back_to_event_id():
    base = dict(
        game_id="g",
        round_number=1,
        t=5,
        killer="k",
        killer_team=None,
        victim="v",
        victim_team=None,
        weapon=None,
        grid_first=False,
        killer_pos=None,
        victim_pos=None,
    )
    kills = [
        KillRec(**base, order=(3, 0, "b")),
        KillRec(**base, order=(3, 0, "a")),
        KillRec(**{**base, "round_number": None}, order=(0, 0, "")),
    ]
    assert first_kill_indices(kills) == {1}


def test_missing_freezetime_leaves_t_round_and_phase_null(tmp_path):
    envs = [
        e
        for e in _round(1, 10, "T1", "T2", "T1")
        if e["events"][0]["type"] != "round-ended-freezetime"
    ]
    ctx = _ctx(tmp_path, envs)
    rounds, kills, _ = parse_feed(ctx)
    rows, index = build_rounds(ctx, rounds)
    assert (
        rows[0]["freezetime_end_at_ms"] is None and rows[0]["plant_t_round_ms"] is None
    )
    k = build_kills(ctx, kills, index)
    assert (
        k[0]["round_number"] == 1
        and k[0]["t_round_ms"] is None
        and k[0]["phase"] is None
    )
    stats = missing_freezetime_stats(rows, k, [])
    assert stats == {"round_no_freezetime": 1, "kill_no_freezetime": 1}


def test_ability_count_excludes_off_minimap_casts_and_matches_share():
    games = pl.DataFrame(
        {"game_id": ["g1"], "map": ["testmap"], "winner_team_id": ["T1"]}
    )
    rounds = pl.DataFrame(
        {
            "game_id": ["g1"],
            "round_number": [1],
            "map": ["testmap"],
            "attacker_team_id": ["T1"],
            "defender_team_id": ["T2"],
            "winner_team_id": ["T1"],
            "plant_team_id": [None],
            "plant_site": [None],
        },
        schema_overrides={"plant_team_id": pl.Utf8, "plant_site": pl.Utf8},
    )
    on_map = [(0.30 + i * 0.001, 0.60) for i in range(5)]
    off_map = [(1.4, 0.5), (0.5, -0.2), (None, None)]
    uv = on_map + off_map
    n = len(uv)
    casts = pl.DataFrame(
        {
            "map": ["testmap"] * n,
            "side": ["attacker"] * n,
            "phase": ["opening"] * n,
            "ability": ["smoke"] * n,
            "agent": ["omen"] * n,
            "slot": ["ABILITY_1"] * n,
            "u": [p[0] for p in uv],
            "v": [p[1] for p in uv],
            "view_u": [1.0] * n,
            "view_v": [0.0] * n,
            "t_round_ms": [1000] * n,
        }
    )
    kills = pl.DataFrame(
        schema={
            "killer_team_id": pl.Utf8,
            "killer_id": pl.Utf8,
            "weapon": pl.Utf8,
            "game_id": pl.Utf8,
            "round_number": pl.Int32,
            "map": pl.Utf8,
            "is_first_kill_of_round": pl.Boolean,
            "killer_name": pl.Utf8,
            "killer_u": pl.Float64,
            "killer_v": pl.Float64,
            "t_round_ms": pl.Int64,
            "killer_side": pl.Utf8,
            "phase": pl.Utf8,
            "victim_u": pl.Float64,
            "victim_v": pl.Float64,
        }
    )
    rosters = pl.DataFrame({"game_id": ["g1"], "player_id": ["p1"]})
    payload = _team_payload(
        {"id": "T1", "name": "Team"}, games, rounds, casts, kills, rosters
    )
    entry = payload["maps"]["testmap"]["utility"]["attacker"]["opening"]["smoke"]
    assert entry["count"] == 5 and entry["rate_per_round"] == 5.0
    (cl,) = entry["clusters"]
    assert cl["count"] == 5 and cl["share"] == cl["count"] / entry["count"]


def test_heat_grid_drops_single_event_cells():
    u = np.array([0.501, 0.502, 0.9])
    v = np.array([0.501, 0.503, 0.1])
    cells = heat_grid(u, v, size=48, min_count=2)
    assert cells == [[24, 24, 2]]
    assert all(c[2] >= 2 for c in cells)


def test_clusters_need_min_members():
    assert clusters(np.array([0.1, 0.1]), np.array([0.1, 0.1])) == []
    rng = np.random.default_rng(0)
    u = np.concatenate([0.3 + rng.normal(0, 0.003, 10), [0.9]])
    v = np.concatenate([0.6 + rng.normal(0, 0.003, 10), [0.1]])
    out = clusters(u, v)
    assert len(out) == 1 and out[0]["count"] == 10
    assert abs(out[0]["u"] - 0.3) < 0.01


def test_team_payload_has_no_raw_points():
    games = pl.DataFrame(
        {"game_id": ["g1"], "map": ["testmap"], "winner_team_id": ["T1"]}
    )
    rounds = pl.DataFrame(
        {
            "game_id": ["g1", "g1"],
            "round_number": [1, 2],
            "map": ["testmap", "testmap"],
            "attacker_team_id": ["T1", "T1"],
            "defender_team_id": ["T2", "T2"],
            "winner_team_id": ["T1", "T2"],
            "plant_team_id": ["T1", None],
            "plant_site": ["A", None],
        }
    )
    n = 6
    casts = pl.DataFrame(
        {
            "map": ["testmap"] * n,
            "side": ["attacker"] * n,
            "phase": ["opening"] * n,
            "ability": ["smoke"] * n,
            "agent": ["omen"] * n,
            "slot": ["ABILITY_1"] * n,
            "u": [0.301, 0.302, 0.303, 0.301, 0.302, 0.777],
            "v": [0.601, 0.602, 0.603, 0.601, 0.602, 0.123],
            "view_u": [1.0] * n,
            "view_v": [0.0] * n,
            "t_round_ms": [1000] * n,
        }
    )
    kills = pl.DataFrame(
        schema={
            "killer_team_id": pl.Utf8,
            "killer_id": pl.Utf8,
            "weapon": pl.Utf8,
            "game_id": pl.Utf8,
            "round_number": pl.Int32,
            "map": pl.Utf8,
            "is_first_kill_of_round": pl.Boolean,
            "killer_name": pl.Utf8,
            "killer_u": pl.Float64,
            "killer_v": pl.Float64,
            "t_round_ms": pl.Int64,
            "killer_side": pl.Utf8,
            "phase": pl.Utf8,
            "victim_u": pl.Float64,
            "victim_v": pl.Float64,
        }
    )
    rosters = pl.DataFrame({"game_id": ["g1"], "player_id": ["p1"]})
    payload = _team_payload(
        {"id": "T1", "name": "Team"}, games, rounds, casts, kills, rosters
    )
    entry = payload["maps"]["testmap"]["utility"]["attacker"]["opening"]["smoke"]
    assert (
        entry["count"] == 6
        and entry["rounds_played"] == 2
        and entry["rate_per_round"] == 3.0
    )
    assert all(c[2] >= 2 for c in entry.get("heat", []))
    assert [37, 5] not in [
        c[:2] for c in entry.get("heat", [])
    ]  # the lone (0.777, 0.123) cast is not published
    assert all(c["count"] >= 3 for c in entry.get("clusters", []))
    text = json.dumps(payload)
    assert "0.777" not in text and "0.123" not in text
    assert payload["maps"]["testmap"]["plant_sites"] == {"A": 1}


def _outcome_fixture():
    """3 joined rounds (T1 wins 1 and 3) + casts in an unjoined round 9; one tight smoke spot."""
    games = pl.DataFrame(
        {"game_id": ["g1"], "map": ["testmap"], "winner_team_id": ["T1"]}
    )
    rounds = pl.DataFrame(
        {
            "game_id": ["g1"] * 3,
            "round_number": pl.Series([1, 2, 3], dtype=pl.Int32),
            "map": ["testmap"] * 3,
            "attacker_team_id": ["T1"] * 3,
            "defender_team_id": ["T2"] * 3,
            "winner_team_id": ["T1", "T2", "T1"],
            "plant_team_id": [None] * 3,
            "plant_site": [None] * 3,
        },
        schema_overrides={"plant_team_id": pl.Utf8, "plant_site": pl.Utf8},
    )
    # round 1: p1 x3, round 2: p1 + p2, round 3: p3, round 9 (unjoined): p1 x2; plus one mid-phase cast
    rn = [1, 1, 1, 2, 2, 3, 9, 9, 2]
    pid = ["p1", "p1", "p1", "p1", "p2", "p3", "p1", "p1", "p2"]
    phase = ["opening"] * 8 + ["mid"]
    n = len(rn)
    casts = pl.DataFrame(
        {
            "game_id": ["g1"] * n,
            "round_number": pl.Series(rn, dtype=pl.Int32),
            "player_id": pid,
            "player_name": [f"name-{p}" for p in pid],
            "map": ["testmap"] * n,
            "side": ["attacker"] * n,
            "phase": phase,
            "ability": ["smoke"] * n,
            "agent": ["omen"] * n,
            "slot": ["ABILITY_1"] * n,
            "u": [0.300 + i * 0.001 for i in range(n)],
            "v": [0.600] * n,
            "view_u": [1.0] * n,
            "view_v": [0.0] * n,
            "t_round_ms": [1000] * n,
        }
    )
    kills = pl.DataFrame(
        schema={
            "killer_team_id": pl.Utf8,
            "killer_id": pl.Utf8,
            "weapon": pl.Utf8,
            "game_id": pl.Utf8,
            "round_number": pl.Int32,
            "map": pl.Utf8,
            "is_first_kill_of_round": pl.Boolean,
            "killer_name": pl.Utf8,
            "killer_u": pl.Float64,
            "killer_v": pl.Float64,
            "t_round_ms": pl.Int64,
            "killer_side": pl.Utf8,
            "phase": pl.Utf8,
            "victim_u": pl.Float64,
            "victim_v": pl.Float64,
        }
    )
    rosters = pl.DataFrame({"game_id": ["g1"], "player_id": ["p1"]})
    return _team_payload(
        {"id": "T1", "name": "Team", "games": 1},
        games,
        rounds,
        casts,
        kills,
        rosters,
    )


def test_cluster_round_outcomes_exclude_unjoined_rounds():
    payload = _outcome_fixture()
    entry = payload["maps"]["testmap"]["utility"]["attacker"]["opening"]["smoke"]
    (cl,) = entry["clusters"]
    assert cl["count"] == 8  # positions still use every on-minimap cast, incl. round 9
    assert cl["rounds"] == 3 and cl["wins"] == 2  # round 9 has no rounds row → excluded
    assert cl["wins"] <= cl["rounds"]


def test_cluster_players_top3_sorted_shares():
    payload = _outcome_fixture()
    (cl,) = payload["maps"]["testmap"]["utility"]["attacker"]["opening"]["smoke"][
        "clusters"
    ]
    players = cl["players"]
    assert [p[0] for p in players] == ["p1", "p2", "p3"]
    shares = [p[1] for p in players]
    assert all(0 < s <= 1 for s in shares) and shares == sorted(shares, reverse=True)
    assert shares[0] == round(6 / 8, 2)


def test_top_players_caps_at_three_and_drops_zero_shares():
    from utility_fingerprint_etl.aggregate import _top_players

    ids = np.array(
        ["a"] * 300 + ["b"] * 100 + ["c"] * 50 + ["d"] * 10 + ["e"], dtype=object
    )
    out = _top_players(ids)
    assert [p[0] for p in out] == ["a", "b", "c"]
    rare = _top_players(np.array(["a"] * 999 + ["z"], dtype=object))
    assert rare == [["a", 1.0]]  # z rounds to 0.0 → dropped


def test_phase_rounds_baseline_and_players_root():
    payload = _outcome_fixture()
    m = payload["maps"]["testmap"]
    pr = m["phase_rounds"]
    assert pr["attacker"]["opening"] == {"rounds": 3, "wins": 2}
    assert pr["attacker"]["mid"] == {"rounds": 1, "wins": 0}
    for side, phases in m["utility"].items():
        for phase, abilities in phases.items():
            base = pr[side][phase]
            assert base["wins"] <= base["rounds"]
            for entry in abilities.values():
                for cl in entry.get("clusters", []):
                    assert cl["rounds"] <= base["rounds"] and cl["wins"] <= base["wins"]
    assert payload["players"] == {"p1": "name-p1", "p2": "name-p2", "p3": "name-p3"}
    text = json.dumps(payload)
    assert "#" not in text and "_won" not in text  # helper columns never reach the JSON


def test_payload_without_round_columns_has_no_new_fields():
    """Old cast tables (no game_id/round_number/player_id) still aggregate; new fields are simply absent."""
    payload = _outcome_fixture()
    assert "players" in payload
    old = pl.DataFrame({"map": ["testmap"] * 3, "side": ["attacker"] * 3})
    from utility_fingerprint_etl.aggregate import _cast_outcomes, _phase_rounds

    assert _cast_outcomes("T1", old, pl.DataFrame()).columns == old.columns
    assert _phase_rounds(old) == {}


def test_report_facts_ignore_new_fields():
    """The report loader/fact sheet reads JSON with and without the new fields identically."""
    from utility_fingerprint_etl.report import build_facts

    new = _outcome_fixture()
    old = json.loads(json.dumps(new))
    old.pop("players")
    for m in old["maps"].values():
        m.pop("phase_rounds")
        for phases in m["utility"].values():
            for abilities in phases.values():
                for entry in abilities.values():
                    for cl in entry.get("clusters", []):
                        for k in ("rounds", "wins", "players"):
                            cl.pop(k)
    assert build_facts(new) == build_facts(old)


def test_reset_web_data_dir_keeps_reports_drops_stale_outputs(tmp_path):
    web = tmp_path / "data"
    (web / "reports").mkdir(parents=True)
    (web / "reports" / "x.json").write_text('{"team_id": "x"}')
    (web / "teams").mkdir()
    (web / "teams" / "stale.json").write_text("{}")
    (web / "maps").mkdir()
    (web / "maps" / "old.png").write_bytes(b"png")
    (web / "index.json").write_text("{}")

    reset_web_data_dir(web)

    assert (web / "reports" / "x.json").read_text() == '{"team_id": "x"}'
    assert (web / "teams").is_dir() and not any((web / "teams").iterdir())
    assert not (web / "maps").exists()
    assert not (web / "index.json").exists()


def test_reset_web_data_dir_creates_missing_dir(tmp_path):
    web = tmp_path / "nope" / "data"
    reset_web_data_dir(web)
    assert (web / "teams").is_dir()
