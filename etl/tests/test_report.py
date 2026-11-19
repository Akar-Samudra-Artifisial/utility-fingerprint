"""Scouting report: fact sheet, number validator, retry/drop, cache — with a fake provider (no network)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from utility_fingerprint_etl import report as rp


def _util(count: int, rounds: int, t_ms: int = 500) -> dict:
    return {
        "count": count,
        "rounds_played": rounds,
        "clusters": [{"count": count, "share": 0.6, "mean_t_round_ms": t_ms}],
    }


def _team(tid: str, name: str, smokes: int, games: int = 8) -> dict:
    side = {
        "opening": {"dark-cover": _util(smokes, 80)},
        "mid": {"paranoia": _util(20, 80, 31000)},
    }
    op_split = {
        "rounds_with_op": 30,
        "op_round_rate": 0.37,
        "op_kills": 10,
        "low_sample": False,
    }
    return {
        "team": {"id": tid, "name": name, "games": games},
        "maps": {
            "haven": {
                "games": games,
                "wins": 5,
                "round_win_rate": {"attacker": 0.674, "defender": 0.407},
                "abilities": {
                    "dark-cover": {"agent": "omen"},
                    "paranoia": {"agent": "omen"},
                },
                "utility": {"attacker": side, "defender": side},
            },
            "bind": {"games": 1, "wins": 0, "utility": {}},
        },
        "operator": {
            "team_kills": 1000,
            "team_op_kills": 55,
            "team_first_kills": 400,
            "team_first_kills_with_op": 16,
            "players": [
                {
                    "player_id": "1",
                    "name": "OXY",
                    "rounds_with_op": 97,
                    "op_kills": 49,
                    "op_round_rate": 0.101,
                    "op_survival_rate": 0.464,
                    "op_kills_per_op_round": 0.505,
                    "first_kills": 189,
                    "first_kill_op_share": 0.085,
                    "op_lost_to_enemy": 0,
                    "low_sample": False,
                    "maps": {"haven": {"sides": {"defender": op_split}}},
                },
                {
                    "player_id": "2",
                    "name": "Tiny",
                    "rounds_with_op": 3,
                    "op_kills": 1,
                    "low_sample": True,
                },
            ],
            "by_map": {
                "haven": {
                    "defender": {
                        "rounds_with_op": 30,
                        "op_round_pct": 0.37,
                        "first_kills": 40,
                        "first_kill_op_share": 0.1,
                        "low_sample": False,
                    }
                }
            },
        },
    }


FACTS = {
    "a.pct": {
        "label": "x",
        "value": 0.674,
        "unit": "pct",
        "map": "haven",
        "side": "attacker",
        "phase": None,
    },
    "a.rate": {
        "label": "x",
        "value": 1.06,
        "unit": "rate",
        "map": None,
        "side": None,
        "phase": None,
    },
    "a.count": {
        "label": "x",
        "value": 45,
        "unit": "count",
        "map": None,
        "side": None,
        "phase": None,
    },
    "a.sec": {
        "label": "x",
        "value": 96,
        "unit": "seconds",
        "map": None,
        "side": None,
        "phase": None,
    },
}


def _claim(text: str, *ids: str) -> dict:
    return {"text": text, "fact_ids": list(ids)}


# ------------------------------------------------------------------ validator


def test_extract_numbers_kinds_and_whitelist():
    nums = rp.extract_numbers(
        "67% of rounds, 1.06 per round, 45 games, smoke at 1:36, 2x more; "
        "round 13 and the 0–15 s window, 1st blood, KAY/O on v1c"
    )
    assert [(n.kind, n.value) for n in nums] == [
        ("pct", 67.0),
        ("decimal", 1.06),
        ("int", 45.0),
        ("seconds", 96.0),
        ("ratio", 2.0),
    ]


def test_validate_accepts_rounded_values():
    assert rp.validate_claim(_claim("Attack round win 67%", "a.pct"), FACTS) == []
    assert rp.validate_claim(_claim("Attack round win 67.4%", "a.pct"), FACTS) == []
    assert rp.validate_claim(_claim("1.06 smokes per round", "a.rate"), FACTS) == []
    assert rp.validate_claim(_claim("1.07 smokes per round", "a.rate"), FACTS) == []
    assert (
        rp.validate_claim(_claim("45 games, smoke at 1:36", "a.count", "a.sec"), FACTS)
        == []
    )


def test_validate_rejects_bad_numbers_unknown_ids_and_ratios():
    assert rp.validate_claim(_claim("Attack round win 69%", "a.pct"), FACTS)
    assert rp.validate_claim(_claim("1.09 smokes per round", "a.rate"), FACTS)
    assert rp.validate_claim(_claim("46 games", "a.count"), FACTS)
    # a number backed by a fact the claim did not cite is not enough
    assert rp.validate_claim(_claim("45 games", "a.pct"), FACTS)
    assert "unknown fact_ids" in rp.validate_claim(_claim("45 games", "nope"), FACTS)[0]
    assert rp.validate_claim(_claim("No numbers at all"), FACTS) == [
        "no fact_ids cited"
    ]
    errs = rp.validate_claim(_claim("2x the smokes, 45 games", "a.count"), FACTS)
    assert len(errs) == 1 and "derived ratio" in errs[0]


# ------------------------------------------------------------------ fact sheet


def test_build_facts_skips_low_sample_and_lost_to_enemy():
    facts = rp.build_facts(_team("5", "Team", 85), _team("79", "Cloud9", 40))
    assert "op.player.1.rounds_with_op" in facts
    assert not any(k.startswith("op.player.2.") for k in facts)  # low_sample player
    assert not any("lost_to_enemy" in k for k in facts)
    # 1 game on Bind: below the low-sample gate, no pool fact at all
    assert not any(k.startswith("pool.bind.") for k in facts)
    assert facts["pool.haven.games"]["value"] == 8
    assert facts["pool.haven.attacker.round_win"]["value"] == 0.674
    rate = facts["util.haven.attacker.opening.dark-cover.rate"]
    assert rate["value"] == round(85 / 80, 2) and rate["side"] == "attacker"
    assert (
        facts["util.haven.attacker.opening.dark-cover.spot_time"]["value"] == 0
    )  # barrier drop
    gap = facts["vs.haven.attacker.opening.dark-cover.gap"]
    assert gap["value"] == round(45 / 80, 2)
    assert all(f["unit"] in rp.UNITS for f in facts.values())
    assert len(rp.build_facts(_team("5", "Team", 85), limit=10)) == 10


# ------------------------------------------------------------------ generation with a fake provider


class FakeProvider:
    name = "fake"
    model = "fake-model"

    def __init__(self, responses: list[dict]) -> None:
        self.responses = list(responses)
        self.prompts: list[str] = []

    def complete(
        self, system: str, user: str, schema: dict | None = None
    ) -> rp.LLMResult:
        assert schema in (rp.REPORT_SCHEMA, rp.RETRY_SCHEMA)
        self.prompts.append(user)
        return rp.LLMResult(
            json.dumps(self.responses.pop(0)), {"input_tokens": 10, "output_tokens": 5}
        )


GOOD = {
    "text": "OXY holds the Operator in 30 Haven defense rounds (37%).",
    "fact_ids": [
        "op.player.1.haven.defender.rounds_with_op",
        "op.player.1.haven.defender.op_round_rate",
    ],
    "map": "haven",
    "side": "defense",
    "phase": None,
    "tab": "operator",
}
FIRST = {
    "headline": "An Omen-smoke heavy team with a dedicated Operator.",
    "sections": [
        {
            "id": "operator",
            "title": "Operator",
            "claims": [
                GOOD,
                {
                    "text": "OXY gets 52 Operator kills.",
                    "fact_ids": ["op.player.1.op_kills"],
                    "tab": "operator",
                },
                {
                    "text": "Invented stat 12%.",
                    "fact_ids": ["made.up"],
                    "tab": "operator",
                },
            ],
        },
        {"id": "bogus", "title": "x", "claims": [GOOD]},
    ],
    "counters": [
        {
            "text": "Expect 1.06 opening smokes per round on Haven attack; punish late executes.",
            "fact_ids": ["util.haven.attacker.opening.dark-cover.rate"],
            "map": "haven",
            "side": "attacker",
            "phase": "opening",
            "tab": "map",
        },
        {
            "text": "They smoke twice as often, 3x the reference.",
            "fact_ids": ["games"],
            "tab": "compare",
        },
    ],
}
RETRY = {
    "fixes": [
        {
            "ref": "operator.1",
            "text": "OXY has 49 Operator kills.",
            "fact_ids": ["op.player.1.op_kills"],
        },
        {"ref": "counter.1", "text": "Still 4x more.", "fact_ids": ["games"]},
    ]
}


def test_generate_retries_once_then_drops():
    team, ref = _team("5", "Team", 85), _team("79", "Cloud9", 40)
    facts = rp.build_facts(team, ref)
    provider = FakeProvider([FIRST, RETRY])
    body, usage = rp.generate(team, ref, facts, provider)
    assert usage["calls"] == 2 and usage["input_tokens"] == 20
    assert "op.player.1.op_kills" in provider.prompts[1] and "52" in provider.prompts[1]
    v = body["validation"]
    assert (v["claims_total"], v["claims_kept"], v["claims_dropped"], v["retries"]) == (
        5,
        3,
        2,
        1,
    )
    reasons = " | ".join(d["reason"] for d in v["dropped"])
    assert "unknown fact_ids: made.up" in reasons and "derived ratio" in reasons
    op_claims = next(s for s in body["sections"] if s["id"] == "operator")["claims"]
    assert [c["text"] for c in op_claims][1] == "OXY has 49 Operator kills."
    assert (
        op_claims[0]["side"] == "defender"
    )  # "defense" normalised to the dashboard key
    assert body["counters"][0]["phase"] == "opening"


def test_run_writes_schema_index_cache_and_check(tmp_path):
    data = tmp_path / "data"
    (data / "teams").mkdir(parents=True)
    for tid, name, smokes in (
        ("79", "Cloud9", 40),
        ("3429", "Cloud9 GC", 60),
        ("5", "Team", 85),
    ):
        (data / "teams" / f"{tid}.json").write_text(
            json.dumps(_team(tid, name, smokes))
        )
    index = {
        "teams": [
            {"id": t, "name": n, "games": 8}
            for t, n in (("5", "Team"), ("79", "Cloud9"), ("3429", "Cloud9 GC"))
        ]
    }
    (data / "index.json").write_text(json.dumps(index))
    reports, cache = tmp_path / "reports", tmp_path / "cache"
    no_retry = {
        **FIRST,
        "sections": [{"id": "operator", "title": "Operator", "claims": [GOOD]}],
        "counters": [],
    }
    provider = FakeProvider([no_retry, no_retry])
    kw = dict(data_dir=data, reports_dir=reports, cache_dir=cache, provider=provider)

    rp.run(teams="5,79", **kw)
    assert len(provider.prompts) == 2
    r = json.loads((reports / "5.json").read_text())
    assert set(r) == {
        "version",
        "team_id",
        "team_name",
        "generated_at",
        "model",
        "provider",
        "games",
        "headline",
        "sections",
        "counters",
        "reference_team_id",
        "facts",
        "validation",
    }
    assert (r["team_id"], r["reference_team_id"], r["provider"]) == (5, 79, "fake")
    assert json.loads((reports / "79.json").read_text())["reference_team_id"] == 3429
    idx = json.loads((reports / "index.json").read_text())
    assert [row["team_id"] for row in idx] == [79, 5]
    assert set(idx[0]) == {"team_id", "team_name", "generated_at", "claims_kept"}
    assert rp.check_report(r) == []

    rp.run(teams="5", **kw)  # unchanged facts + model → cache hit, no LLM call
    assert len(provider.prompts) == 2
    assert rp.run(teams="5,79", check=True, **kw) == {"5": [], "79": []}

    tampered = {**r, "headline": "They won 99% of everything."}
    assert any("99%" in p for p in rp.check_report(tampered))


def _data_dir(tmp_path):
    data = tmp_path / "data"
    (data / "teams").mkdir(parents=True)
    teams = (("79", "Cloud9", 40), ("3429", "Cloud9 GC", 60), ("5", "Team", 85))
    for tid, name, smokes in teams:
        (data / "teams" / f"{tid}.json").write_text(
            json.dumps(_team(tid, name, smokes))
        )
    index = {"teams": [{"id": t, "name": n, "games": 8} for t, n, _ in teams]}
    (data / "index.json").write_text(json.dumps(index))
    return data


NO_RETRY = {
    "headline": "An Omen-smoke heavy team with a dedicated Operator.",
    "sections": [{"id": "operator", "title": "Operator", "claims": [GOOD]}],
    "counters": [],
}


# ------------------------------------------------------------------ review fixes (week 5)


def test_number_words_are_rejected_with_small_whitelist():
    for text in (
        "They smoke twice per round",
        "Half of their rounds",
        "Two smokes on A",
        "a third of their kills",
        "they double up on B",
        "a dozen smokes",
        "forty percent of rounds",
        "Thirty rounds with an OP",
        "one hundred casts",
        "a quarter of their rounds",
    ):
        errs = rp.validate_claim(_claim(text, "a.count"), FACTS)
        assert errs and "number word" in errs[0], text
    # non-numeric uses are allowed
    for text in (
        "A one-way smoke on mid",
        "No one holds B",
        "They trade one another",
        "a single Operator",
    ):
        assert rp.validate_claim(_claim(text, "a.count"), FACTS) == [], text
    # "percent" with a valid number is a percentage
    assert rp.validate_claim(_claim("67 percent of rounds", "a.pct"), FACTS) == []
    assert rp.validate_claim(_claim("69 percent of rounds", "a.pct"), FACTS)


def test_multipliers_before_or_after_the_number_are_rejected():
    for text in (
        "x3 the smokes",
        "×3 the smokes",
        "3× the smokes",
        "3x the smokes",
        "X2 more",
    ):
        nums = rp.extract_numbers(text)
        assert [n.kind for n in nums] == ["ratio"], text
        assert "derived ratio" in rp.validate_claim(_claim(text, "a.count"), FACTS)[0]


def test_headline_with_numbers_retries_then_falls_back():
    team, ref = _team("5", "Team", 85), _team("79", "Cloud9", 40)
    facts = rp.build_facts(team, ref)
    first = {**NO_RETRY, "headline": "They win 67% of Haven attack rounds."}
    retry = {
        "fixes": [
            {
                "ref": "headline",
                "text": "Twice as aggressive on attack.",
                "fact_ids": [],
            }
        ]
    }
    provider = FakeProvider([first, retry])
    body, _ = rp.generate(team, ref, facts, provider)
    assert body["headline"] == rp.fallback_headline("Team")
    assert rp.extract_numbers(body["headline"]) == []
    v = body["validation"]
    assert v["retries"] == 1 and (
        v["claims_total"],
        v["claims_kept"],
        v["claims_dropped"],
    ) == (1, 1, 0)
    assert v["dropped"][0]["reason"].startswith("headline: '67%'")
    assert "fallback" in v["dropped"][0]["reason"]
    # a fixed headline from the retry is kept
    retry_ok = {
        "fixes": [{"ref": "headline", "text": "Aggressive on attack.", "fact_ids": []}]
    }
    body, _ = rp.generate(team, ref, facts, FakeProvider([first, retry_ok]))
    assert (
        body["headline"] == "Aggressive on attack."
        and body["validation"]["dropped"] == []
    )
    # the team's own name is not a number
    assert rp.headline_errors("100 Thieves play a slow default.", "100 Thieves") == []


def test_section_titles_are_fixed_and_checked():
    team, ref = _team("5", "Team", 85), _team("79", "Cloud9", 40)
    facts = rp.build_facts(team, ref)
    raw = {
        **NO_RETRY,
        "sections": [
            {"id": "operator", "title": "They win 99% of duels", "claims": [GOOD]}
        ],
    }
    body, _ = rp.generate(team, ref, facts, FakeProvider([raw]))
    assert body["sections"][0]["title"] == rp.SECTION_TITLES["operator"]
    report = rp.assemble(
        team, "79", facts, body, "fake", "m", "2026-01-01T00:00:00+00:00"
    )
    assert rp.check_report(report) == []
    bad = {
        **report,
        "sections": [{**body["sections"][0], "title": "They win 99% of duels"}],
    }
    assert any("title" in p for p in rp.check_report(bad))


def test_spot_share_needs_min_casts():
    team = _team("5", "Team", 85)
    clusters = team["maps"]["haven"]["utility"]["attacker"]["opening"]["dark-cover"][
        "clusters"
    ]
    clusters[0]["count"] = rp.MIN_CASTS - 1
    facts = rp.build_facts(team)
    assert "util.haven.attacker.opening.dark-cover.rate" in facts
    assert "util.haven.attacker.opening.dark-cover.spot_share" not in facts
    assert "util.haven.attacker.opening.dark-cover.spot_time" not in facts


def test_cache_key_covers_prompt_validator_and_team_inputs(monkeypatch):
    team = _team("5", "Team", 85)
    facts = rp.build_facts(team)
    key = rp.cache_key(facts, "m", team)
    renamed = {**team, "team": {**team["team"], "last_tournament": "Other Cup"}}
    assert rp.cache_key(facts, "m", renamed) != key
    monkeypatch.setattr(rp, "SYSTEM_PROMPT", rp.SYSTEM_PROMPT + " ")
    assert rp.cache_key(facts, "m", team) != key
    monkeypatch.undo()
    monkeypatch.setattr(rp, "VALIDATOR_VERSION", rp.VALIDATOR_VERSION + 1)
    assert rp.cache_key(facts, "m", team) != key


def test_cache_hit_with_invalid_report_regenerates(tmp_path):
    data = _data_dir(tmp_path)
    reports, cache = tmp_path / "reports", tmp_path / "cache"
    provider = FakeProvider([NO_RETRY, NO_RETRY])
    kw = dict(data_dir=data, reports_dir=reports, cache_dir=cache, provider=provider)
    rp.run(teams="5", **kw)
    entry = json.loads((cache / "5.cache.json").read_text())
    entry["report"]["headline"] = (
        "They won 99% of everything."  # same key, invalid content
    )
    (cache / "5.cache.json").write_text(json.dumps(entry))
    rp.run(teams="5", **kw)
    assert len(provider.prompts) == 2
    assert (
        rp.extract_numbers(json.loads((reports / "5.json").read_text())["headline"])
        == []
    )


def test_check_reports_stale_facts(tmp_path):
    data = _data_dir(tmp_path)
    reports, cache = tmp_path / "reports", tmp_path / "cache"
    kw = dict(data_dir=data, reports_dir=reports, cache_dir=cache)
    rp.run(teams="5", provider=FakeProvider([NO_RETRY]), **kw)
    assert rp.run(teams="5", check=True, **kw) == {"5": []}
    team = _team("5", "Team", 85)
    team["maps"]["haven"]["round_win_rate"]["attacker"] = (
        0.5  # aggregates rebuilt since the report
    )
    (data / "teams" / "5.json").write_text(json.dumps(team))
    problems = rp.run(teams="5", check=True, **kw)["5"]
    assert len(problems) == 1 and problems[0].startswith("stale facts")
    assert "pool.haven.attacker.round_win" in problems[0]


class FlakyProvider(FakeProvider):
    def complete(self, system, user, schema=None):
        if "Team: Cloud9 GC" in user:
            raise subprocess.TimeoutExpired(cmd="claude", timeout=900)
        if "Team: Cloud9 " in user:
            raise RuntimeError("API overloaded")
        return super().complete(system, user, schema)


def test_one_failing_team_does_not_stop_the_batch(tmp_path):
    data = _data_dir(tmp_path)
    reports, cache = tmp_path / "reports", tmp_path / "cache"
    result = rp.run(
        teams="79,3429,5",
        data_dir=data,
        reports_dir=reports,
        cache_dir=cache,
        provider=FlakyProvider([NO_RETRY]),
    )
    assert result["79"] == {"error": "RuntimeError: API overloaded"}
    assert result["3429"] == {"error": "claude CLI timed out after 900s"}
    assert "validation" in result["5"]
    idx = json.loads((reports / "index.json").read_text())
    assert [row["team_id"] for row in idx] == [5]


def test_claude_cli_runs_isolated_in_empty_temp_dir(monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        seen["cwd_files"] = list(Path(kw["cwd"]).iterdir())
        out = {
            "result": "",
            "structured_output": {"fixes": []},
            "usage": {"input_tokens": 3, "output_tokens": 2},
        }
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(out), stderr="")

    monkeypatch.setattr(rp.subprocess, "run", fake_run)
    res = rp.ClaudeCliProvider("claude-sonnet-5-5", "/bin/claude").complete(
        "SYS", "USER", rp.RETRY_SCHEMA
    )
    cmd, kw = seen["cmd"], seen["kw"]
    for flag in (
        "-p",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
    ):
        assert flag in cmd
    assert (
        cmd[cmd.index("--tools") + 1] == ""
        and cmd[cmd.index("--model") + 1] == "claude-sonnet-5-5"
    )
    assert json.loads(cmd[cmd.index("--json-schema") + 1]) == rp.RETRY_SCHEMA
    assert "--bare" not in cmd  # would disable the OAuth login this fallback relies on
    assert kw["input"] == "USER" and kw["timeout"] == rp.CLI_TIMEOUT_S
    assert (
        seen["cwd_files"] == [] and not Path(kw["cwd"]).exists()
    )  # empty temp dir, removed afterwards
    assert json.loads(res.text) == {"fixes": []} and res.usage["input_tokens"] == 3


def test_select_teams_default_order():
    index = {
        "teams": [
            {"id": "5", "name": "A", "games": 10},
            {"id": "6", "name": "B", "games": 30},
            {"id": "3429", "name": "C9GC", "games": 5},
            {"id": "79", "name": "C9", "games": 45},
        ]
    }
    assert rp.select_teams(index, None, 3) == ["79", "3429", "6"]
    assert rp.select_teams(index, "6,5", None) == ["6", "5"]
