"""Per-series extraction: GRID feed + ability supplement → rounds / kills / casts Parquet."""

from __future__ import annotations

import json
import statistics
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import polars as pl

from .constants import (
    LOW_RATE_SPACING_MS,
    MID_END_MS,
    OUTCOMES,
    PHASE_MID,
    PHASE_OPENING,
    ROUND_END_GRACE_MS,
)
from .geometry import MapCalib, nearest_site, to_uv, view_to_uv
from .grid_io import iter_jsonl_zst, iter_lines
from .rules import phase_of, round_sides, ts_ms, weapon_from_kill

NEEDLES = (
    '"type":"game-started-round"',
    '"type":"round-ended-freezetime"',
    '"type":"player-completed-plantBomb"',
    '"type":"team-completed-plantBomb"',
    '"type":"team-won-round"',
    '"type":"game-ended-round"',
    '"type":"player-killed-player"',
    '"action":"!',
)
PICKUP_NEEDLE = '"type":"player-pickedUp-item"'
OPERATOR_ID = "operator"

S, I32, I64, F64, B = pl.Utf8, pl.Int32, pl.Int64, pl.Float64, pl.Boolean
ROUNDS_SCHEMA = {
    "series_id": S,
    "game_id": S,
    "map": S,
    "round_number": I32,
    "started_at_ms": I64,
    "freezetime_end_at_ms": I64,
    "ended_at_ms": I64,
    "winner_team_id": S,
    "winner_side": S,
    "attacker_team_id": S,
    "defender_team_id": S,
    "side_source": S,
    "snapshot_attacker_team_id": S,
    "outcome": S,
    "plant_at_ms": I64,
    "plant_t_round_ms": I64,
    "plant_site": S,
    "plant_site_dist_cm": F64,
    "plant_x": F64,
    "plant_y": F64,
    "plant_u": F64,
    "plant_v": F64,
    "planter_id": S,
    "plant_team_id": S,
}
KILLS_SCHEMA = {
    "series_id": S,
    "game_id": S,
    "map": S,
    "round_number": I32,
    "occurred_at_ms": I64,
    "t_round_ms": I64,
    "phase": S,
    "killer_id": S,
    "killer_name": S,
    "killer_team_id": S,
    "killer_agent": S,
    "killer_side": S,
    "victim_id": S,
    "victim_name": S,
    "victim_team_id": S,
    "victim_agent": S,
    "weapon": S,
    "is_first_kill_of_round": B,
    "grid_first_kill": B,
    "killer_x": F64,
    "killer_y": F64,
    "killer_u": F64,
    "killer_v": F64,
    "victim_x": F64,
    "victim_y": F64,
    "victim_u": F64,
    "victim_v": F64,
    "killer_had_op": B,
    "victim_had_op": B,
}
# One row per Operator "stint": a player holding the OP in a round (from freezetime end, or picked up later).
OP_ROUNDS_SCHEMA = {
    "series_id": S,
    "game_id": S,
    "map": S,
    "round_number": I32,
    "player_id": S,
    "player_name": S,
    "team_id": S,
    "side": S,
    "source": S,  # freezetime_inventory | pickup | kill_inferred
    "start_t_round_ms": I64,
    "op_kills": I32,
    "died": B,
    "died_t_round_ms": I64,
    "died_phase": S,
    "killed_by_weapon": S,
    "lost_to_enemy": B,  # an enemy picked up an Operator after this holder died (same round)
    "recovered_by_team": B,  # a teammate picked it up after this holder died
}
# Positions of an OP holder (alive, holding) during opening + mid, from the seriesState snapshot carried by
# feed events. One row per distinct consecutive position of that holder; local only, aggregated later.
OP_POSITIONS_SCHEMA = {
    "series_id": S,
    "game_id": S,
    "map": S,
    "round_number": I32,
    "player_id": S,
    "team_id": S,
    "side": S,
    "t_round_ms": I64,
    "phase": S,
    "x": F64,
    "y": F64,
    "u": F64,
    "v": F64,
}
CASTS_SCHEMA = {
    "series_id": S,
    "game_id": S,
    "map": S,
    "round_number": I32,
    "occurred_at_ms": I64,
    "t_round_ms": I64,
    "phase": S,
    "team_id": S,
    "player_id": S,
    "player_name": S,
    "agent": S,
    "ability": S,
    "slot": S,
    "side": S,
    "x": F64,
    "y": F64,
    "z": F64,
    "view_x": F64,
    "view_y": F64,
    "view_z": F64,
    "u": F64,
    "v": F64,
    "view_u": F64,
    "view_v": F64,
    "quality": S,
    "sample_hz": pl.Int8,
    "in_grid": B,
    "charges_consumed": I32,
}


@dataclass(frozen=True)
class GameMeta:
    game_id: str
    map: str
    team1_id: str
    team2_id: str


@dataclass(frozen=True)
class SeriesContext:
    series_id: str
    feed: Path
    supplement: Path | None
    games: dict[str, GameMeta]
    rosters: dict[
        tuple[str, str], tuple[str, str, str]
    ]  # (game_id, player_id) → (team_id, name, agent)
    calibs: dict[str, MapCalib]
    out_dir: Path


@dataclass
class RoundRec:
    number: int
    started_at: int | None = None
    freeze_end: int | None = None
    ended_at: int | None = None
    winner: str | None = None
    winner_side: str | None = None
    win_type: str | None = None
    snapshot_sides: dict[str, str] = field(default_factory=dict)
    plant_at: int | None = None
    plant_pos: tuple[float, float] | None = None
    planter: str | None = None
    plant_team: str | None = None
    # Operator holders at round-ended-freezetime: player_id → team_id (from seriesState inventory)
    op_holders: dict[str, str | None] = field(default_factory=dict)
    # Operator pickups after freezetime: (t, order, player_id, team_id)
    op_pickups: list[tuple[int, tuple[int, int, str], str, str | None]] = field(
        default_factory=list
    )
    # Player positions (t, player_id, x, y) from freezetime end to +MID_END_MS, only in rounds with an OP
    pos_samples: list[tuple[int, str, float, float]] = field(default_factory=list)


@dataclass
class KillRec:
    game_id: str
    round_number: int | None
    t: int
    killer: str
    killer_team: str | None
    victim: str
    victim_team: str | None
    weapon: str | None
    grid_first: bool
    killer_pos: tuple[float, float] | None
    victim_pos: tuple[float, float] | None
    # tie-break for kills sharing a timestamp: (envelope sequenceNumber, index in envelope, event id)
    order: tuple[int, int, str] = (0, 0, "")


def first_kill_indices(kills: list[KillRec]) -> set[int]:
    """Index of exactly one earliest kill per (game_id, round_number), ordered by (t, order)."""
    best: dict[tuple[str, int], int] = {}
    for i, k in enumerate(kills):
        if k.round_number is None:
            continue
        key = (k.game_id, k.round_number)
        j = best.get(key)
        if j is None or (k.t, k.order) < (kills[j].t, kills[j].order):
            best[key] = i
    return set(best.values())


def _round_no(target_id: str | None) -> int | None:
    if target_id and target_id.startswith("round-"):
        try:
            return int(target_id.split("-", 1)[1])
        except ValueError:
            return None
    return None


def _event_game_id(ev: dict[str, Any]) -> str | None:
    games = (ev.get("seriesStateDelta") or {}).get("games") or []
    if games and games[0].get("id"):
        return str(games[0]["id"])
    actor = ev.get("actor") or {}
    return str(actor["id"]) if actor.get("type") == "game" else None


def _pos(state: dict[str, Any] | None) -> tuple[float, float] | None:
    p = ((state or {}).get("game") or {}).get("position")
    return (float(p["x"]), float(p["y"])) if p else None


def op_holders_from_state(
    series_state: dict[str, Any] | None, gid: str
) -> dict[str, str | None]:
    """Players of game `gid` whose inventory holds an Operator (player_id → team_id)."""
    holders: dict[str, str | None] = {}
    for g in (series_state or {}).get("games") or []:
        if g.get("id") != gid:
            continue  # a full snapshot lists every game of the series
        for tm in g.get("teams") or []:
            for p in tm.get("players") or []:
                items = (p.get("inventory") or {}).get("items") or []
                if any(
                    it.get("id") == OPERATOR_ID and (it.get("quantity") or 0) > 0
                    for it in items
                ):
                    holders[str(p["id"])] = str(tm["id"]) if tm.get("id") else None
    return holders


def positions_from_state(
    series_state: dict[str, Any] | None, gid: str
) -> list[tuple[str, float, float]]:
    """(player_id, x, y) of every player of game `gid` that has a position in the snapshot."""
    out = []
    for g in (series_state or {}).get("games") or []:
        if g.get("id") != gid:
            continue
        for tm in g.get("teams") or []:
            for p in tm.get("players") or []:
                pos = p.get("position")
                if pos and pos.get("x") is not None and pos.get("y") is not None:
                    out.append((str(p["id"]), float(pos["x"]), float(pos["y"])))
    return out


_OCCURRED_AT = '"occurredAt":"'


def _line_ts(line: str) -> int | None:
    """occurredAt of an envelope line without decoding the JSON (None if absent)."""
    i = line.find(_OCCURRED_AT)
    if i < 0:
        return None
    start = i + len(_OCCURRED_AT)
    end = line.find('"', start)
    try:
        return ts_ms(line[start:end])
    except ValueError:
        return None


def _wanted(line: str) -> bool:
    if any(n in line for n in NEEDLES):
        return True
    return PICKUP_NEEDLE in line and f'"{OPERATOR_ID}"' in line


def parse_feed(
    ctx: SeriesContext,
) -> tuple[dict[str, dict[int, RoundRec]], list[KillRec], Counter[str]]:
    rounds: dict[str, dict[int, RoundRec]] = {gid: {} for gid in ctx.games}
    current: dict[str, int] = {}
    kills: list[KillRec] = []
    stats: Counter[str] = Counter()
    # game_id → round whose opening+mid window is being sampled for OP holder positions
    sampling: dict[str, RoundRec] = {}
    for line in iter_lines(ctx.feed):
        if not _wanted(line):
            if not sampling:
                continue
            t_line = _line_ts(line)
            if t_line is None or not any(
                t_line <= (r.freeze_end or 0) + MID_END_MS for r in sampling.values()
            ):
                continue
        env = json.loads(line)
        t = ts_ms(env["occurredAt"])
        seq = int(env.get("sequenceNumber") or 0)
        for ev_index, ev in enumerate(env["events"]):
            etype = ev["type"]
            gid = _event_game_id(ev)
            if gid not in ctx.games:
                continue
            actor, target = ev.get("actor") or {}, ev.get("target") or {}
            game_rounds = rounds[gid]
            srec = sampling.get(gid)
            if srec is not None:
                if t >= (srec.freeze_end or 0) + MID_END_MS:
                    del sampling[gid]
                else:
                    srec.pos_samples.extend(
                        (t, pid, x, y)
                        for pid, x, y in positions_from_state(
                            ev.get("seriesState"), gid
                        )
                    )
            if str(ev.get("action", "")).startswith("!"):
                stats[f"reversal:{etype}"] += 1
                _apply_reversal(etype, actor, target, gid, game_rounds, current, kills)
                continue
            if etype == "game-started-round":
                rn = _round_no(target.get("id"))
                if rn is None:
                    continue
                rec = game_rounds.setdefault(rn, RoundRec(rn))
                rec.started_at = t
                for g in (ev.get("seriesState") or {}).get("games") or []:
                    if g.get("id") == gid:
                        rec.snapshot_sides = {
                            str(tm["id"]): tm.get("side", "")
                            for tm in g.get("teams") or []
                        }
                current[gid] = rn
                sampling.pop(gid, None)
            elif etype == "round-ended-freezetime":
                rn = current.get(gid)
                if rn is not None:
                    rec = game_rounds[rn]
                    rec.freeze_end = t
                    rec.op_holders = op_holders_from_state(ev.get("seriesState"), gid)
                    if rec.op_holders:
                        rec.pos_samples = [
                            (t, pid, x, y)
                            for pid, x, y in positions_from_state(
                                ev.get("seriesState"), gid
                            )
                        ]
                        sampling[gid] = rec
            elif etype == "player-pickedUp-item":
                rn = current.get(gid)
                if target.get("id") != OPERATOR_ID or rn is None:
                    continue
                rec = game_rounds[rn]
                if rec.freeze_end is None or t < rec.freeze_end:
                    continue  # buy-phase handovers are already in the freezetime inventory
                stats["op_pickups"] += 1
                rec.op_pickups.append(
                    (
                        t,
                        (seq, ev_index, str(ev.get("id") or "")),
                        str(actor.get("id")),
                        (actor.get("state") or {}).get("teamId"),
                    )
                )
                _start_sampling(sampling, gid, rec, t, ev)
            elif etype in ("player-completed-plantBomb", "team-completed-plantBomb"):
                rn = current.get(gid)
                if rn is None:
                    continue
                rec = game_rounds[rn]
                if etype == "player-completed-plantBomb":
                    rec.plant_at = t
                    rec.plant_pos = _pos(actor.get("state"))
                    rec.planter = str(actor.get("id"))
                    rec.plant_team = (actor.get("state") or {}).get("teamId")
                elif rec.plant_at is None:
                    rec.plant_at = t
                    rec.plant_team = str(actor.get("id"))
            elif etype == "team-won-round":
                rn = _round_no(target.get("id")) or current.get(gid)
                if rn is None:
                    continue
                rec = game_rounds.setdefault(rn, RoundRec(rn))
                rec.winner = str(actor.get("id"))
                rec.winner_side = (actor.get("state") or {}).get("side")
                rec.win_type = ((actor.get("stateDelta") or {}).get("round") or {}).get(
                    "winType"
                )
            elif etype == "game-ended-round":
                rn = _round_no(target.get("id")) or current.get(gid)
                if rn is not None and rn in game_rounds:
                    game_rounds[rn].ended_at = t
            elif etype == "player-killed-player":
                a_state, t_state = actor.get("state") or {}, target.get("state") or {}
                delta = actor.get("stateDelta") or {}
                kills.append(
                    KillRec(
                        game_id=gid,
                        round_number=current.get(gid),
                        t=t,
                        killer=str(actor.get("id")),
                        killer_team=a_state.get("teamId"),
                        victim=str(target.get("id")),
                        victim_team=t_state.get("teamId"),
                        weapon=weapon_from_kill(delta),
                        grid_first=bool((delta.get("round") or {}).get("firstKill")),
                        killer_pos=_pos(a_state),
                        victim_pos=_pos(t_state),
                        order=(seq, ev_index, str(ev.get("id") or "")),
                    )
                )
                rn = current.get(gid)
                if kills[-1].weapon == OPERATOR_ID and rn in game_rounds:
                    # may start an OP stint (kill_inferred) in a round without a freezetime holder
                    _start_sampling(sampling, gid, game_rounds[rn], t, ev)
    return rounds, kills, stats


def _start_sampling(
    sampling: dict[str, RoundRec], gid: str, rec: RoundRec, t: int, ev: dict[str, Any]
) -> None:
    """Start sampling positions mid-round (OP pickup / OP kill) when the round is not sampled yet."""
    if gid in sampling or rec.freeze_end is None or t >= rec.freeze_end + MID_END_MS:
        return
    sampling[gid] = rec
    # this event's snapshot was not sampled at the top of the loop (sampling was off)
    rec.pos_samples.extend(
        (t, pid, x, y) for pid, x, y in positions_from_state(ev.get("seriesState"), gid)
    )


def _apply_reversal(
    etype: str,
    actor: dict[str, Any],
    target: dict[str, Any],
    gid: str,
    game_rounds: dict[int, RoundRec],
    current: dict[str, int],
    kills: list[KillRec],
) -> None:
    if etype == "player-!killed-player":
        for i in range(len(kills) - 1, -1, -1):
            k = kills[i]
            if (
                k.game_id == gid
                and k.killer == str(actor.get("id"))
                and k.victim == str(target.get("id"))
            ):
                del kills[i]
                break
    elif etype == "team-!won-round":
        rn = _round_no(target.get("id")) or current.get(gid)
        if rn in game_rounds:
            rec = game_rounds[rn]
            rec.winner = rec.winner_side = rec.win_type = None
    elif etype == "player-!completed-plantBomb":
        rn = current.get(gid)
        if rn in game_rounds:
            rec = game_rounds[rn]
            rec.plant_at, rec.plant_pos, rec.planter, rec.plant_team = (
                None,
                None,
                None,
                None,
            )
    elif etype == "game-!started-round":
        rn = _round_no(target.get("id"))
        if rn in game_rounds:
            del game_rounds[rn]


@dataclass
class OpStint:
    player: str
    team: str | None
    source: str
    start_t: int
    op_kills: int = 0
    died: bool = False
    died_t: int | None = None
    killed_by_weapon: str | None = None
    lost_to_enemy: bool = False
    recovered_by_team: bool = False


def resolve_op(
    rounds: dict[str, dict[int, RoundRec]], kills: list[KillRec]
) -> tuple[
    dict[int, tuple[bool, bool]], dict[tuple[str, int], list[OpStint]], Counter[str]
]:
    """Replay each round: who holds an Operator when each kill happens.

    Holders start from the freezetime-end inventory; a holder who dies drops the OP and the next Operator
    pickup in that round is attributed to that drop (enemy → lost_to_enemy, teammate → recovered_by_team).
    Returns ({kill index: (killer_had_op, victim_had_op)}, {(game, round): stints}, stats).
    """
    by_round: dict[tuple[str, int], list[int]] = {}
    for i, k in enumerate(kills):
        if k.round_number is not None:
            by_round.setdefault((k.game_id, k.round_number), []).append(i)
    had: dict[int, tuple[bool, bool]] = {}
    out: dict[tuple[str, int], list[OpStint]] = {}
    stats: Counter[str] = Counter()
    for gid, game_rounds in rounds.items():
        for rn, rec in game_rounds.items():
            if rec.freeze_end is None:
                continue
            stints = [
                OpStint(p, team, "freezetime_inventory", rec.freeze_end)
                for p, team in sorted(rec.op_holders.items())
            ]
            active = {s.player: s for s in stints}
            dropped: list[OpStint] = []
            timeline: list[tuple[int, tuple[int, int, str], int, Any]] = [
                (kills[i].t, kills[i].order, 0, i) for i in by_round.get((gid, rn), [])
            ] + [(t, order, 1, (p, team)) for t, order, p, team in rec.op_pickups]
            for _t, _order, kind, payload in sorted(timeline, key=lambda e: e[:2]):
                if kind == 1:
                    player, team = payload
                    if player in active:
                        continue
                    if dropped:
                        prev = dropped.pop()
                        if (
                            team is not None
                            and prev.team is not None
                            and team != prev.team
                        ):
                            prev.lost_to_enemy = True
                        else:
                            prev.recovered_by_team = True
                    stint = OpStint(player, team, "pickup", _t)
                    stints.append(stint)
                    active[player] = stint
                    continue
                k = kills[payload]
                killer_s, victim_s = active.get(k.killer), active.get(k.victim)
                if k.weapon == OPERATOR_ID and killer_s is None:
                    # OP kill by a player not seen holding one (e.g. pickup without an event): the kill proves
                    # they hold it from now on; a pending drop is attributed like a pickup.
                    stats["op_kill_by_nonholder"] += 1
                    if dropped:
                        prev = dropped.pop()
                        if (
                            k.killer_team is not None
                            and prev.team is not None
                            and k.killer_team != prev.team
                        ):
                            prev.lost_to_enemy = True
                        else:
                            prev.recovered_by_team = True
                    killer_s = OpStint(k.killer, k.killer_team, "kill_inferred", k.t)
                    stints.append(killer_s)
                    active[k.killer] = killer_s
                    stats["op_stint_kill_inferred"] += 1
                had[payload] = (killer_s is not None, victim_s is not None)
                if k.weapon == OPERATOR_ID and killer_s is not None:
                    killer_s.op_kills += 1
                if victim_s is not None:
                    victim_s.died, victim_s.died_t = True, k.t
                    victim_s.killed_by_weapon = k.weapon
                    del active[k.victim]
                    dropped.append(victim_s)
            if stints:
                out[(gid, rn)] = stints
                stats["op_stints"] += len(stints)
    return had, out, stats


def _stint_team_side(
    ctx: SeriesContext, gid: str, s: OpStint, rrow: dict[str, Any] | None
) -> tuple[str | None, str | None]:
    """Team/side of a stint: event team first, roster team as fallback (also when the event team id does not
    match either side of the round)."""
    roster = ctx.rosters.get((gid, s.player))
    roster_team = roster[0] if roster else None
    for team in (s.team, roster_team):
        side = _side(rrow, team)
        if side is not None:
            return team, side
    return s.team or roster_team, None


def build_op_rounds(
    ctx: SeriesContext,
    stints: dict[tuple[str, int], list[OpStint]],
    index: dict[tuple[str, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    rows = []
    for (gid, rn), group in sorted(stints.items()):
        rrow = index.get((gid, rn))
        base = _round_base(rrow) if rrow else None
        for s in group:
            roster = ctx.rosters.get((gid, s.player))
            team, side = _stint_team_side(ctx, gid, s, rrow)
            died_t = (
                s.died_t - base if s.died_t is not None and base is not None else None
            )
            rows.append(
                {
                    "series_id": ctx.series_id,
                    "game_id": gid,
                    "map": ctx.games[gid].map,
                    "round_number": rn,
                    "player_id": s.player,
                    "player_name": roster[1] if roster else None,
                    "team_id": team,
                    "side": side,
                    "source": s.source,
                    "start_t_round_ms": s.start_t - base if base is not None else None,
                    "op_kills": s.op_kills,
                    "died": s.died,
                    "died_t_round_ms": died_t,
                    "died_phase": phase_of(died_t, rrow["plant_t_round_ms"])
                    if died_t is not None and rrow
                    else None,
                    "killed_by_weapon": s.killed_by_weapon,
                    "lost_to_enemy": s.lost_to_enemy,
                    "recovered_by_team": s.recovered_by_team,
                }
            )
    return rows


def build_op_positions(
    ctx: SeriesContext,
    rounds: dict[str, dict[int, RoundRec]],
    stints: dict[tuple[str, int], list[OpStint]],
    index: dict[tuple[str, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Positions of each OP stint while alive and holding (from stint start up to and including its death),
    opening + mid only (pre-plant, 0 ≤ t_round_ms < MID_END_MS); consecutive duplicates dropped."""
    rows = []
    for (gid, rn), group in sorted(stints.items()):
        rec, rrow = rounds[gid].get(rn), index.get((gid, rn))
        if rec is None or rrow is None or rec.freeze_end is None:
            continue
        calib = ctx.calibs.get(ctx.games[gid].map)
        for s in group:
            team, side = _stint_team_side(ctx, gid, s, rrow)
            last: tuple[float, float] | None = None
            for t, pid, x, y in rec.pos_samples:
                if pid != s.player or t < s.start_t:
                    continue
                if s.died_t is not None and t > s.died_t:
                    break
                t_round = t - rec.freeze_end
                phase = phase_of(t_round, rrow["plant_t_round_ms"])
                if phase not in (PHASE_OPENING, PHASE_MID) or (x, y) == last:
                    continue
                last = (x, y)
                u, v = _uv(calib, (x, y))
                rows.append(
                    {
                        "series_id": ctx.series_id,
                        "game_id": gid,
                        "map": ctx.games[gid].map,
                        "round_number": rn,
                        "player_id": s.player,
                        "team_id": team,
                        "side": side,
                        "t_round_ms": t_round,
                        "phase": phase,
                        "x": x,
                        "y": y,
                        "u": u,
                        "v": v,
                    }
                )
    return rows


def _uv(
    calib: MapCalib | None, pos: tuple[float, float] | None
) -> tuple[float | None, float | None]:
    if calib is None or pos is None:
        return None, None
    return to_uv(calib, pos[0], pos[1])


def build_rounds(
    ctx: SeriesContext, rounds: dict[str, dict[int, RoundRec]]
) -> tuple[list[dict[str, Any]], dict[tuple[str, int], dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    index: dict[tuple[str, int], dict[str, Any]] = {}
    for gid, game_rounds in rounds.items():
        meta = ctx.games[gid]
        calib = ctx.calibs.get(meta.map)
        for rn in sorted(game_rounds):
            r = game_rounds[rn]
            att, dfn, source = round_sides(
                (meta.team1_id, meta.team2_id),
                r.winner,
                r.winner_side,
                r.snapshot_sides,
            )
            snap_att = next(
                (t for t, s in r.snapshot_sides.items() if s == "attacker"), None
            )
            base = (
                r.freeze_end
            )  # no fallback: without freezetime end, t_round_ms/phase are unknown
            site = nearest_site(calib, *r.plant_pos) if calib and r.plant_pos else None
            pu, pv = _uv(calib, r.plant_pos)
            row = {
                "series_id": ctx.series_id,
                "game_id": gid,
                "map": meta.map,
                "round_number": rn,
                "started_at_ms": r.started_at,
                "freezetime_end_at_ms": r.freeze_end,
                "ended_at_ms": r.ended_at,
                "winner_team_id": r.winner,
                "winner_side": r.winner_side,
                "attacker_team_id": att,
                "defender_team_id": dfn,
                "side_source": source,
                "snapshot_attacker_team_id": snap_att,
                "outcome": OUTCOMES.get(r.win_type or "", r.win_type),
                "plant_at_ms": r.plant_at,
                "plant_t_round_ms": (r.plant_at - base)
                if r.plant_at is not None and base is not None
                else None,
                "plant_site": site[0] if site else None,
                "plant_site_dist_cm": site[1] if site else None,
                "plant_x": r.plant_pos[0] if r.plant_pos else None,
                "plant_y": r.plant_pos[1] if r.plant_pos else None,
                "plant_u": pu,
                "plant_v": pv,
                "planter_id": r.planter,
                "plant_team_id": r.plant_team,
            }
            rows.append(row)
            index[(gid, rn)] = row
    return rows, index


def _round_base(row: dict[str, Any]) -> int | None:
    return row["freezetime_end_at_ms"]


def _side(row: dict[str, Any] | None, team_id: str | None) -> str | None:
    if row is None or team_id is None:
        return None
    if team_id == row["attacker_team_id"]:
        return "attacker"
    if team_id == row["defender_team_id"]:
        return "defender"
    return None


def build_kills(
    ctx: SeriesContext,
    kills: list[KillRec],
    index: dict[tuple[str, int], dict[str, Any]],
    had_op: dict[int, tuple[bool, bool]] | None = None,
) -> list[dict[str, Any]]:
    firsts = first_kill_indices(kills)
    rows = []
    for i, k in enumerate(kills):
        # None when the round had no freezetime inventory snapshot (holder unknown)
        k_had, v_had = (had_op or {}).get(i, (None, None))
        meta = ctx.games[k.game_id]
        calib = ctx.calibs.get(meta.map)
        rrow = (
            index.get((k.game_id, k.round_number))
            if k.round_number is not None
            else None
        )
        base = _round_base(rrow) if rrow else None
        t_round = k.t - base if base is not None else None
        phase = (
            phase_of(t_round, rrow["plant_t_round_ms"])
            if t_round is not None and rrow
            else None
        )
        killer_r = ctx.rosters.get((k.game_id, k.killer))
        victim_r = ctx.rosters.get((k.game_id, k.victim))
        ku, kv = _uv(calib, k.killer_pos)
        vu, vv = _uv(calib, k.victim_pos)
        killer_team = k.killer_team or (killer_r[0] if killer_r else None)
        rows.append(
            {
                "series_id": ctx.series_id,
                "game_id": k.game_id,
                "map": meta.map,
                "round_number": k.round_number,
                "occurred_at_ms": k.t,
                "t_round_ms": t_round,
                "phase": phase,
                "killer_id": k.killer,
                "killer_name": killer_r[1] if killer_r else None,
                "killer_team_id": killer_team,
                "killer_agent": killer_r[2] if killer_r else None,
                "killer_side": _side(rrow, killer_team),
                "victim_id": k.victim,
                "victim_name": victim_r[1] if victim_r else None,
                "victim_team_id": k.victim_team or (victim_r[0] if victim_r else None),
                "victim_agent": victim_r[2] if victim_r else None,
                "weapon": k.weapon,
                "is_first_kill_of_round": i in firsts,
                "grid_first_kill": k.grid_first,
                "killer_x": k.killer_pos[0] if k.killer_pos else None,
                "killer_y": k.killer_pos[1] if k.killer_pos else None,
                "killer_u": ku,
                "killer_v": kv,
                "victim_x": k.victim_pos[0] if k.victim_pos else None,
                "victim_y": k.victim_pos[1] if k.victim_pos else None,
                "victim_u": vu,
                "victim_v": vv,
                "killer_had_op": k_had,
                "victim_had_op": v_had,
            }
        )
    return rows


def _cast_position(cast: dict[str, Any]) -> dict[str, Any] | None:
    """Pick the best caster frame per the supplement README quality rules."""
    quality = cast.get("quality")
    if quality == "gap_exceeded":
        frames = [f for f in (cast.get("frame_before"), cast.get("frame_after")) if f]
        return min(frames, key=lambda f: abs(f["offset_ms"])) if frames else None
    return cast.get("interpolated")


def build_casts(
    ctx: SeriesContext, index: dict[tuple[str, int], dict[str, Any]]
) -> tuple[list[dict[str, Any]], Counter[str]]:
    stats: Counter[str] = Counter()
    if ctx.supplement is None or not ctx.supplement.is_file():
        stats["no_supplement"] += 1
        return [], stats
    by_game: dict[str, list[dict[str, Any]]] = {}
    for (gid, _rn), row in index.items():
        by_game.setdefault(gid, []).append(row)
    for rows in by_game.values():
        rows.sort(key=lambda r: r["started_at_ms"] or 0)

    raw: list[dict[str, Any]] = []
    spacing: dict[str, list[int]] = {}
    for cast in iter_jsonl_zst(ctx.supplement):
        gid = cast.get("game_id")
        if gid not in ctx.games:
            stats["cast_unknown_game"] += 1
            continue
        raw.append(cast)
        fb, fa = cast.get("frame_before"), cast.get("frame_after")
        if fb and fa and len(spacing.setdefault(gid, [])) < 2000:
            spacing[gid].append(fa["offset_ms"] - fb["offset_ms"])
    hz = {
        gid: (1 if statistics.median(v) > LOW_RATE_SPACING_MS else 5)
        for gid, v in spacing.items()
        if v
    }

    out = []
    for cast in raw:
        gid = cast["game_id"]
        meta = ctx.games[gid]
        calib = ctx.calibs.get(meta.map)
        t = ts_ms(cast["occurred_at"])
        rrow = _find_round(by_game.get(gid, []), t)
        if rrow is None:
            stats["cast_outside_round"] += 1
        base = _round_base(rrow) if rrow else None
        t_round = t - base if base is not None else None
        phase = (
            phase_of(t_round, rrow["plant_t_round_ms"])
            if rrow and t_round is not None
            else None
        )
        roster = ctx.rosters.get((gid, cast["player_id"]))
        team = roster[0] if roster else None
        frame = _cast_position(cast) or {}
        pos, view = frame.get("position"), frame.get("view")
        u = v = vu = vv = None
        if calib and pos:
            u, v = to_uv(calib, pos["x"], pos["y"])
        if calib and view:
            d = view_to_uv(calib, view["x"], view["y"])
            if d:
                vu, vv = d
        out.append(
            {
                "series_id": ctx.series_id,
                "game_id": gid,
                "map": meta.map,
                "round_number": rrow["round_number"] if rrow else None,
                "occurred_at_ms": t,
                "t_round_ms": t_round,
                "phase": phase,
                "team_id": team,
                "player_id": cast["player_id"],
                "player_name": roster[1] if roster else None,
                "agent": roster[2] if roster else None,
                "ability": cast.get("ability"),
                "slot": cast.get("slot"),
                "side": _side(rrow, team),
                "x": pos["x"] if pos else None,
                "y": pos["y"] if pos else None,
                "z": pos.get("z") if pos else None,
                "view_x": view["x"] if view else None,
                "view_y": view["y"] if view else None,
                "view_z": view.get("z") if view else None,
                "u": u,
                "v": v,
                "view_u": vu,
                "view_v": vv,
                "quality": cast.get("quality"),
                "sample_hz": hz.get(gid),
                "in_grid": bool(cast.get("in_grid")),
                "charges_consumed": cast.get("charges_consumed"),
            }
        )
    return out, stats


def _find_round(rows: list[dict[str, Any]], t: int) -> dict[str, Any] | None:
    found = None
    for i, r in enumerate(rows):
        start = r["started_at_ms"]
        if start is None or start > t:
            break
        end = r["ended_at_ms"]
        next_start = rows[i + 1]["started_at_ms"] if i + 1 < len(rows) else None
        limit = end + ROUND_END_GRACE_MS if end is not None else next_start
        if limit is None or t <= limit:
            found = r
    return found


def _write(rows: list[dict[str, Any]], schema: dict[str, Any], path: Path) -> int:
    df = (
        pl.DataFrame(rows, schema=schema, orient="row")
        if rows
        else pl.DataFrame(schema=schema)
    )
    tmp = path.with_suffix(".tmp")
    df.write_parquet(tmp)
    tmp.replace(path)
    return df.height


def missing_freezetime_stats(
    round_rows: list[dict[str, Any]],
    kill_rows: list[dict[str, Any]],
    cast_rows: list[dict[str, Any]],
) -> Counter[str]:
    """Rounds without round-ended-freezetime, and kills/casts in them (t_round_ms/phase left null)."""
    stats: Counter[str] = Counter()
    stats["round_no_freezetime"] = sum(
        r["freezetime_end_at_ms"] is None for r in round_rows
    )
    for name, rows in (("kill", kill_rows), ("cast", cast_rows)):
        stats[f"{name}_no_freezetime"] = sum(
            r["round_number"] is not None and r["t_round_ms"] is None for r in rows
        )
    return +stats  # drop zero counts


def process_series(ctx: SeriesContext) -> dict[str, Any]:
    """Extract one series; writes <out_dir>/{rounds,kills,casts,op_rounds,op_positions}.parquet + _SUCCESS."""
    rounds, kills, stats = parse_feed(ctx)
    round_rows, index = build_rounds(ctx, rounds)
    had_op, stints, op_stats = resolve_op(rounds, kills)
    stats.update(op_stats)
    kill_rows = build_kills(ctx, kills, index, had_op)
    op_rows = build_op_rounds(ctx, stints, index)
    stats["op_stint_side_unknown"] = sum(r["side"] is None for r in op_rows)
    op_pos_rows = build_op_positions(ctx, rounds, stints, index)
    cast_rows, cast_stats = build_casts(ctx, index)
    stats.update(cast_stats)
    stats.update(missing_freezetime_stats(round_rows, kill_rows, cast_rows))
    ctx.out_dir.mkdir(parents=True, exist_ok=True)
    counts = {
        "rounds": _write(round_rows, ROUNDS_SCHEMA, ctx.out_dir / "rounds.parquet"),
        "kills": _write(kill_rows, KILLS_SCHEMA, ctx.out_dir / "kills.parquet"),
        "casts": _write(cast_rows, CASTS_SCHEMA, ctx.out_dir / "casts.parquet"),
        "op_rounds": _write(
            op_rows, OP_ROUNDS_SCHEMA, ctx.out_dir / "op_rounds.parquet"
        ),
        "op_positions": _write(
            op_pos_rows, OP_POSITIONS_SCHEMA, ctx.out_dir / "op_positions.parquet"
        ),
    }
    (ctx.out_dir / "_SUCCESS").write_text(
        json.dumps({"counts": counts, "stats": dict(stats)}), encoding="utf-8"
    )
    return {"counts": counts, "stats": dict(stats)}
