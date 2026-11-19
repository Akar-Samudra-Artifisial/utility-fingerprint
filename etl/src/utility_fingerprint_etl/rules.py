"""Small pure rules shared by extraction and tests: phases, sides, weapons, timestamps."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from .constants import (
    MID_END_MS,
    OPENING_END_MS,
    PHASE_BUY,
    PHASE_LATE,
    PHASE_MID,
    PHASE_OPENING,
    PHASE_POST_PLANT,
)


def ts_ms(value: str) -> int:
    """ISO-8601 UTC timestamp ('…Z') → epoch milliseconds."""
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def phase_of(t_round_ms: int, plant_t_round_ms: int | None) -> str:
    if t_round_ms < 0:
        return PHASE_BUY
    if plant_t_round_ms is not None and t_round_ms >= plant_t_round_ms:
        return PHASE_POST_PLANT
    if t_round_ms < OPENING_END_MS:
        return PHASE_OPENING
    if t_round_ms < MID_END_MS:
        return PHASE_MID
    return PHASE_LATE


def weapon_from_kill(actor_state_delta: Mapping[str, Any] | None) -> str | None:
    """Weapon = key incremented in actor.stateDelta.game.weaponKills (no dedicated field in GRID)."""
    game = (actor_state_delta or {}).get("game") or {}
    keys = list((game.get("weaponKills") or {}).keys())
    if not keys:
        rnd = (actor_state_delta or {}).get("round") or {}
        keys = list((rnd.get("weaponKills") or {}).keys())
    return keys[0] if len(keys) == 1 else (sorted(keys)[0] if keys else None)


def round_sides(
    team_ids: tuple[str, str],
    winner_team_id: str | None,
    winner_side: str | None,
    snapshot_sides: Mapping[str, str] | None,
) -> tuple[str | None, str | None, str]:
    """Return (attacker_team_id, defender_team_id, source).

    Primary source: the winner's `side` at `team-won-round` (correct for that round by definition).
    Fallback: team sides in the `game-started-round` full snapshot.
    """
    if winner_team_id in team_ids and winner_side in ("attacker", "defender"):
        other = team_ids[1] if winner_team_id == team_ids[0] else team_ids[0]
        if winner_side == "attacker":
            return winner_team_id, other, "winner"
        return other, winner_team_id, "winner"
    if snapshot_sides:
        att = [t for t in team_ids if snapshot_sides.get(t) == "attacker"]
        dfn = [t for t in team_ids if snapshot_sides.get(t) == "defender"]
        if len(att) == 1 and len(dfn) == 1:
            return att[0], dfn[0], "snapshot"
    return None, None, "unknown"


def expected_switch(round_number: int) -> bool:
    """Whether sides should differ from the previous round under standard VALORANT rules
    (half-time after round 12, then every overtime round from 25). Used only to *check* the data."""
    return round_number == 13 or round_number >= 25
