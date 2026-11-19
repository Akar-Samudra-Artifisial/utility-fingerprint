import math

import pytest

from utility_fingerprint_etl.geometry import MapCalib, nearest_site, to_uv, view_to_uv
from utility_fingerprint_etl.rules import (
    expected_switch,
    phase_of,
    round_sides,
    ts_ms,
    weapon_from_kill,
)

# Haven coefficients as recorded in docs/calibration.md (valorant-api.com); sites are hand-made test points.
HAVEN = MapCalib(
    name="haven",
    display_name="Haven",
    display_icon="",
    x_mult=7.5e-05,
    y_mult=-7.5e-05,
    x_add=1.09345,
    y_add=0.642728,
    sites=(("A", 6300.0, -9200.0), ("B", 1900.0, -9200.0)),
)


def test_to_uv_uses_swapped_axes():
    u, v = to_uv(HAVEN, 6300.0, -9200.0)
    assert u == pytest.approx(-9200.0 * 7.5e-05 + 1.09345)  # game y → u
    assert v == pytest.approx(6300.0 * -7.5e-05 + 0.642728)  # game x → v
    assert 0 <= u <= 1 and 0 <= v <= 1


def test_view_to_uv_is_unit_and_swapped():
    du, dv = view_to_uv(
        HAVEN, 1.0, 0.0
    )  # aiming +x in game → straight up on the minimap (v decreases)
    assert du == pytest.approx(0.0)
    assert dv == pytest.approx(-1.0)
    assert math.hypot(*view_to_uv(HAVEN, 0.3, 0.4)) == pytest.approx(1.0)
    assert view_to_uv(HAVEN, 0.0, 0.0) is None


def test_nearest_site():
    site, dist = nearest_site(HAVEN, 2000.0, -9000.0)
    assert site == "B"
    assert dist == pytest.approx(math.hypot(100, 200))


@pytest.mark.parametrize(
    ("t", "plant", "expected"),
    [
        (-1, None, "buy"),
        (0, None, "opening"),
        (14_999, None, "opening"),
        (15_000, None, "mid"),
        (44_999, None, "mid"),
        (45_000, None, "late"),
        (60_000, 70_000, "late"),
        (70_000, 70_000, "post_plant"),
        (10_000, 5_000, "post_plant"),
        (-5, 5_000, "buy"),
    ],
)
def test_phase_of(t, plant, expected):
    assert phase_of(t, plant) == expected


def test_round_sides_from_winner():
    assert round_sides(("1", "2"), "2", "attacker", None) == ("2", "1", "winner")
    assert round_sides(("1", "2"), "2", "defender", {"1": "defender"}) == (
        "1",
        "2",
        "winner",
    )


def test_round_sides_fallback_snapshot_and_unknown():
    assert round_sides(("1", "2"), None, None, {"1": "defender", "2": "attacker"}) == (
        "2",
        "1",
        "snapshot",
    )
    assert round_sides(("1", "2"), None, None, {"1": "attacker", "2": "attacker"}) == (
        None,
        None,
        "unknown",
    )
    assert round_sides(("1", "2"), "9", "attacker", None) == (None, None, "unknown")


def test_expected_switch():
    assert [r for r in range(2, 30) if expected_switch(r)] == [13, 25, 26, 27, 28, 29]


def test_weapon_from_kill():
    assert weapon_from_kill({"game": {"weaponKills": {"operator": 1}}}) == "operator"
    assert weapon_from_kill({"round": {"weaponKills": {"vandal": 3}}}) == "vandal"
    assert weapon_from_kill({"game": {"kills": 1}}) is None
    assert weapon_from_kill(None) is None


def test_ts_ms():
    assert ts_ms("1970-01-01T00:00:01.500Z") == 1500
