"""Scouting reports: deterministic fact sheet per team → Claude → number validator → reports/<team_id>.json.

The model only sees aggregates already published in web/public/data (no Parquet, no GRID rows). Every claim must
cite fact ids, and every number in a claim must match one of its cited facts (with rounding tolerance); failing
claims get one retry, then are dropped and listed under `validation`.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from .config import PROJECT_ROOT
from .constants import PHASES, SIDES, WEB_DATA_DIR

PROMPT_VERSION = 2
VALIDATOR_VERSION = 2  # bump when validation rules change (invalidates the cache)
DEFAULT_MODEL = "claude-sonnet-5-5"
REPORTS_DIR = WEB_DATA_DIR / "reports"  # git-ignored with the rest of web/public/data
CACHE_DIR = (
    PROJECT_ROOT / "data" / "reports"
)  # git-ignored: cache, dry-run fact sheets and prompts
REFERENCE_TEAM_ID = "79"  # Cloud9
FALLBACK_REFERENCE_TEAM_ID = "3429"  # Cloud9 GC (reference for Cloud9 itself)
DEFAULT_TOP = 20
MAX_FACTS = 150
MAX_TOKENS = 8000
CLI_TIMEOUT_S = 900

# Same gates as the dashboard Compare tab (web/src/lib/data/compare.ts)
LOW_SAMPLE_GAMES = 3
MIN_GAP = 0.05
MIN_CASTS = 5

UTIL_MAPS = (
    3  # most-played maps (>= LOW_SAMPLE_GAMES games) with utility signature facts
)
UTIL_PER_SIDE = 3  # (ability, phase) signatures per map and side
OP_PLAYERS = 2
OP_PLAYER_SPLITS = 3
OP_TEAM_SPLITS = 4
VS_DIFFS = 6

_EPS = 1e-9  # float slack so the tolerance bounds are inclusive
PCT_TOL = 0.5 + _EPS  # percentage points
RATE_TOL = 0.01 + _EPS
SECONDS_TOL = 0.5 + _EPS

SECTION_IDS = ("utility", "operator", "maps", "vs_reference")
SECTION_TITLES = {
    "utility": "Utility signature",
    "operator": "Operator profile",
    "maps": "Map pool",
    "vs_reference": "Versus reference",
}
SECTION_TAB = {
    "utility": "map",
    "operator": "operator",
    "maps": "map",
    "vs_reference": "compare",
}
TABS = ("map", "operator", "compare")
SIDE_ALIASES = {
    "attacker": "attacker",
    "attack": "attacker",
    "defender": "defender",
    "defense": "defender",
    "defence": "defender",
}
SIDE_LABEL = {"attacker": "Attack", "defender": "Defense"}
PHASE_LABEL = {
    "buy": "Buy",
    "opening": "Opening",
    "mid": "Mid-round",
    "late": "Late",
    "post_plant": "Post-plant",
}
UNITS = ("pct", "count", "rate", "seconds")


# ---------------------------------------------------------------- names (mirror web/src/lib/format.ts)


def _title(slug: str) -> str:
    return " ".join(w[:1].upper() + w[1:] for w in re.split(r"[-_\s]+", slug) if w)


def _agent(slug: str) -> str:
    return "KAY/O" if slug.lower() in ("kayo", "kay/o") else _title(slug)


def _map_name(key: str) -> str:
    return _title(key)


# ---------------------------------------------------------------- fact sheet


def _round_value(value: float, unit: str) -> float | int:
    if unit == "count":
        return int(value)
    if unit == "seconds":
        return int(value)
    if unit == "pct":  # same precision as the team JSON; the UI shows whole percents
        return round(float(value), 3)
    return round(float(value), 2)


def _seconds(ms: float) -> int:
    """Clock seconds as the UI shows them; 0–1 s after freezetime end is "barrier drop" (0)."""
    if 0 <= ms < 1000:
        return 0
    return int(round(ms / 1000))


class _Facts:
    def __init__(self, limit: int = MAX_FACTS) -> None:
        self.facts: dict[str, dict[str, Any]] = {}
        self.limit = limit

    def add(
        self,
        fid: str,
        label: str,
        value: float,
        unit: str,
        map_: str | None = None,
        side: str | None = None,
        phase: str | None = None,
    ) -> None:
        if len(self.facts) >= self.limit or value is None:
            return
        self.facts[fid] = {
            "label": label,
            "value": _round_value(value, unit),
            "unit": unit,
            "map": map_,
            "side": side,
            "phase": phase,
        }


def _maps_by_games(team: dict[str, Any]) -> list[str]:
    maps = team["maps"]
    return sorted(maps, key=lambda m: (-maps[m]["games"], m))


def _ability_label(maps_entry: dict[str, Any], ability: str) -> str:
    meta = maps_entry.get("abilities", {}).get(ability) or {}
    agent = meta.get("agent")
    return f"{_agent(agent)} {_title(ability)}" if agent else _title(ability)


def _rates(
    entry: dict[str, Any], side: str
) -> dict[tuple[str, str], tuple[float, int]]:
    """(ability, phase) → (casts per round, casts), the Compare normalisation (count / rounds_played)."""
    out = {}
    for phase, abilities in (entry.get("utility", {}).get(side) or {}).items():
        for ability, s in abilities.items():
            rp = s.get("rounds_played") or 0
            out[(ability, phase)] = (s["count"] / rp if rp > 0 else 0.0, s["count"])
    return out


def build_facts(
    team: dict[str, Any], ref: dict[str, Any] | None = None, limit: int = MAX_FACTS
) -> dict[str, dict[str, Any]]:
    """Deterministic fact sheet from a team JSON (and the reference team JSON for the vs_reference facts).

    Low-sample entries are left out entirely (map < 3 games, OP entries flagged `low_sample`), and
    `op_lost_to_enemy` is never used (always 0: Operator pickups by the enemy are not visible in the feed).
    """
    f = _Facts(limit)
    name = team["team"]["name"]
    maps = team["maps"]
    f.add("games", f"{name} games in the dataset", team["team"]["games"], "count")

    # map pool
    for m in _maps_by_games(team):
        e = maps[m]
        if e["games"] >= LOW_SAMPLE_GAMES:
            f.add(f"pool.{m}.games", f"Games on {_map_name(m)}", e["games"], "count", m)
            f.add(
                f"pool.{m}.wins", f"Games won on {_map_name(m)}", e["wins"], "count", m
            )
            for side in SIDES:
                wr = (e.get("round_win_rate") or {}).get(side)
                if wr is not None:
                    f.add(
                        f"pool.{m}.{side}.round_win",
                        f"Round win rate on {_map_name(m)} {SIDE_LABEL[side]}",
                        wr,
                        "pct",
                        m,
                        side,
                    )

    _operator_facts(f, team)
    if ref is not None:
        _vs_facts(f, team, ref)
    _utility_facts(f, team)
    return f.facts


def _operator_facts(f: _Facts, team: dict[str, Any]) -> None:
    op = team.get("operator") or {}
    if op.get("team_kills"):
        f.add(
            "op.team.op_kill_share",
            "Share of the team's kills made with the Operator",
            op["team_op_kills"] / op["team_kills"],
            "pct",
        )
        f.add("op.team.op_kills", "Team Operator kills", op["team_op_kills"], "count")
    if op.get("team_first_kills"):
        f.add(
            "op.team.first_kill_op_share",
            "Share of the team's first kills made with the Operator",
            op["team_first_kills_with_op"] / op["team_first_kills"],
            "pct",
        )
    players = [
        p
        for p in op.get("players") or []
        if not p.get("low_sample") and p.get("rounds_with_op")
    ]
    players.sort(key=lambda p: (-p["rounds_with_op"], p["player_id"]))
    for p in players[:OP_PLAYERS]:
        pid, who = p["player_id"], p.get("name") or p["player_id"]
        base = f"op.player.{pid}"
        f.add(
            f"{base}.rounds_with_op",
            f"{who}: rounds holding the Operator",
            p["rounds_with_op"],
            "count",
        )
        f.add(f"{base}.op_kills", f"{who}: Operator kills", p["op_kills"], "count")
        f.add(
            f"{base}.op_round_rate",
            f"{who}: share of their rounds holding the Operator",
            p.get("op_round_rate"),
            "pct",
        )
        f.add(
            f"{base}.op_survival_rate",
            f"{who}: survival rate in rounds holding the Operator",
            p.get("op_survival_rate"),
            "pct",
        )
        f.add(
            f"{base}.op_kills_per_op_round",
            f"{who}: Operator kills per Operator round",
            p.get("op_kills_per_op_round"),
            "rate",
        )
        if p.get("first_kills"):
            f.add(
                f"{base}.first_kill_op_share",
                f"{who}: share of their first kills made with the Operator",
                p.get("first_kill_op_share"),
                "pct",
            )
        splits = [
            (m, side, s)
            for m, me in (p.get("maps") or {}).items()
            for side, s in (me.get("sides") or {}).items()
            if not s.get("low_sample") and s.get("rounds_with_op")
        ]
        splits.sort(key=lambda x: (-x[2]["rounds_with_op"], x[0], x[1]))
        for m, side, s in splits[:OP_PLAYER_SPLITS]:
            where = f"{_map_name(m)} {SIDE_LABEL[side]}"
            sb = f"{base}.{m}.{side}"
            f.add(
                f"{sb}.rounds_with_op",
                f"{who}: rounds holding the Operator on {where}",
                s["rounds_with_op"],
                "count",
                m,
                side,
            )
            f.add(
                f"{sb}.op_round_rate",
                f"{who}: share of rounds holding the Operator on {where}",
                s.get("op_round_rate"),
                "pct",
                m,
                side,
            )
            f.add(
                f"{sb}.op_kills",
                f"{who}: Operator kills on {where}",
                s["op_kills"],
                "count",
                m,
                side,
            )
    team_splits = [
        (m, side, s)
        for m, sides in (op.get("by_map") or {}).items()
        for side, s in sides.items()
        if not s.get("low_sample") and s.get("rounds_with_op")
    ]
    team_splits.sort(key=lambda x: (-x[2]["rounds_with_op"], x[0], x[1]))
    for m, side, s in team_splits[:OP_TEAM_SPLITS]:
        where = f"{_map_name(m)} {SIDE_LABEL[side]}"
        top = (s.get("top_op_player") or {}).get("name")
        tail = f" (top OP player: {top})" if top else ""
        f.add(
            f"op.map.{m}.{side}.op_round_pct",
            f"Share of team rounds with an Operator on {where}{tail}",
            s["op_round_pct"],
            "pct",
            m,
            side,
        )
        f.add(
            f"op.map.{m}.{side}.rounds_with_op",
            f"Team rounds with an Operator on {where}",
            s["rounds_with_op"],
            "count",
            m,
            side,
        )
        if s.get("first_kills"):
            f.add(
                f"op.map.{m}.{side}.first_kill_op_share",
                f"Share of team first kills made with the Operator on {where}",
                s["first_kill_op_share"],
                "pct",
                m,
                side,
            )


def _utility_facts(f: _Facts, team: dict[str, Any]) -> None:
    maps = team["maps"]
    played = [m for m in _maps_by_games(team) if maps[m]["games"] >= LOW_SAMPLE_GAMES]
    for m in played[:UTIL_MAPS]:
        e = maps[m]
        for side in SIDES:
            rates = _rates(e, side)
            ranked = sorted(
                ((k, v) for k, v in rates.items() if v[1] >= MIN_CASTS),
                key=lambda kv: (-kv[1][0], kv[0]),
            )
            top, abilities = [], set()
            for k, v in ranked:  # one phase per ability: its highest-rate phase
                if k[0] not in abilities and len(top) < UTIL_PER_SIDE:
                    abilities.add(k[0])
                    top.append((k, v))
            for (ability, phase), (rate, count) in top:
                what = _ability_label(e, ability)
                where = f"{_map_name(m)} {SIDE_LABEL[side]}, {PHASE_LABEL[phase]}"
                base = f"util.{m}.{side}.{phase}.{ability}"
                f.add(
                    f"{base}.rate",
                    f"{what}: casts per round ({where})",
                    rate,
                    "rate",
                    m,
                    side,
                    phase,
                )
                f.add(
                    f"{base}.casts",
                    f"{what}: casts ({where})",
                    count,
                    "count",
                    m,
                    side,
                    phase,
                )
                spots = e["utility"][side][phase][ability].get("clusters") or []
                top_spot = max(spots, key=lambda c: c["count"]) if spots else None
                if top_spot is not None and top_spot["count"] >= MIN_CASTS:
                    f.add(
                        f"{base}.spot_share",
                        f"{what}: share of these casts thrown from its most-used caster spot ({where})",
                        top_spot["share"],
                        "pct",
                        m,
                        side,
                        phase,
                    )
                    f.add(
                        f"{base}.spot_time",
                        f"{what}: average round clock of casts from that spot ({where}; 0 = barrier drop)",
                        _seconds(top_spot["mean_t_round_ms"]),
                        "seconds",
                        m,
                        side,
                        phase,
                    )


def _vs_facts(f: _Facts, team: dict[str, Any], ref: dict[str, Any]) -> None:
    name, ref_name = team["team"]["name"], ref["team"]["name"]
    op, rop = team.get("operator") or {}, ref.get("operator") or {}
    if rop.get("team_kills"):
        f.add(
            "vs.op_kill_share.ref",
            f"{ref_name}: share of kills made with the Operator",
            rop["team_op_kills"] / rop["team_kills"],
            "pct",
        )
    if rop.get("team_first_kills"):
        f.add(
            "vs.first_kill_op_share.ref",
            f"{ref_name}: share of first kills made with the Operator",
            rop["team_first_kills_with_op"] / rop["team_first_kills"],
            "pct",
        )
    candidates = []
    for m in sorted(set(team["maps"]) & set(ref["maps"])):
        a, b = team["maps"][m], ref["maps"][m]
        if a["games"] < LOW_SAMPLE_GAMES or b["games"] < LOW_SAMPLE_GAMES:
            continue
        for side in SIDES:
            ra, rb = _rates(a, side), _rates(b, side)
            for key in set(ra) | set(rb):
                if (
                    key[1] == "buy"
                ):  # buy-phase gaps mostly reflect agent picks (sprints, setups), not tendencies
                    continue
                x, ca = ra.get(key, (0.0, 0))
                y, cb = rb.get(key, (0.0, 0))
                gap = abs(x - y)
                if gap < MIN_GAP or (ca if x >= y else cb) < MIN_CASTS:
                    continue
                candidates.append((gap, m, side, key, x, y))
    candidates.sort(key=lambda c: (-c[0], c[1], c[2], c[3]))
    seen: set[tuple[str, str, str]] = set()
    for gap, m, side, (ability, phase), x, y in candidates:
        if (m, side, ability) in seen:
            continue
        seen.add((m, side, ability))
        if len(seen) > VS_DIFFS:
            break
        what = _ability_label(team["maps"][m], ability)
        if what == _title(ability):
            what = _ability_label(ref["maps"][m], ability)
        where = f"{_map_name(m)} {SIDE_LABEL[side]}, {PHASE_LABEL[phase]}"
        base = f"vs.{m}.{side}.{phase}.{ability}"
        f.add(
            f"{base}.team_rate",
            f"{name}: {what} casts per round ({where})",
            x,
            "rate",
            m,
            side,
            phase,
        )
        f.add(
            f"{base}.ref_rate",
            f"{ref_name}: {what} casts per round ({where})",
            y,
            "rate",
            m,
            side,
            phase,
        )
        f.add(
            f"{base}.gap",
            f"Gap {name} minus {ref_name} in {what} casts per round, absolute ({where})",
            gap,
            "rate",
            m,
            side,
            phase,
        )


# ---------------------------------------------------------------- validator


_WHITELIST = re.compile(
    r"\bround\s+(?:1|13)\b"  # pistol rounds
    r"|\btop[\s-]+[123]\b"
    r"|\b0\s*[–-]\s*15\s*s(?:ec(?:ond)?s?)?\b"  # phase windows
    r"|\b15\s*[–-]\s*45\s*s(?:ec(?:ond)?s?)?\b"
    r"|\b(?:first|after)\s+45\s*s(?:ec(?:ond)?s?)?\b"
    r"|\b45\s*s\+",
    re.IGNORECASE,
)
_NUMBER = re.compile(
    r"(?<![\w.:,×])"
    r"(?P<num>\d+:\d{2}|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?P<unit>\s?%|\s?percent\b|\s?(?:seconds|second|secs|sec|s)(?![\w])|\s?[x×](?![\w]))?"
    r"(?![\w%])"
)
# Multipliers written before the number ("x3", "×3"): always a derived ratio.
_PREFIX_MULT = re.compile(r"(?<![\w])[x×]\s?\d+(?:\.\d+)?(?![\w])", re.IGNORECASE)
# Number words carry numbers the validator cannot check, so they are rejected (conservative).
_NUMBER_WORDS = re.compile(
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen"
    r"|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred"
    r"|thousand|twice|thrice|half|halves|thirds?|quarters?|double[ds]?|doubling|triple[ds]?|tripling"
    r"|dozens?|percent|percentage)\b",
    re.IGNORECASE,
)
# Phrases where a number word is not a quantity.
_WORD_WHITELIST = re.compile(
    r"\bone[\s-]way\b|\bno\s+one\b|\bone\s+another\b", re.IGNORECASE
)


@dataclass(frozen=True)
class Number:
    raw: str
    value: float
    kind: str  # pct | seconds | ratio | decimal | int | word


def extract_numbers(text: str) -> list[Number]:
    """Numbers stated in a claim. Ordinals ("1st"), digits inside names ("v1c"), pistol-round mentions and the
    phase windows (0–15 s, 15–45 s) are ignored; everything else must be backed by a fact. Number words
    ("two", "twice", "half", "percent" without a digit) and multipliers ("3x", "x3", "×3") are returned as
    kinds `word` / `ratio`, which never match a fact."""
    clean = _WHITELIST.sub(" ", text)
    out = []
    for m in _PREFIX_MULT.finditer(clean):
        out.append(Number(m.group(0).strip(), 0.0, "ratio"))
    clean = _PREFIX_MULT.sub(" ", clean)
    words = _WORD_WHITELIST.sub(" ", clean)
    words = _NUMBER.sub(" ", words)  # "67 percent" is a percentage, not a number word
    for m in _NUMBER_WORDS.finditer(words):
        out.append(Number(m.group(0), 0.0, "word"))
    for m in _NUMBER.finditer(clean):
        num, unit = m.group("num"), (m.group("unit") or "").strip().lower()
        if ":" in num:
            mins, secs = num.split(":")
            out.append(
                Number(m.group(0).strip(), int(mins) * 60 + int(secs), "seconds")
            )
            continue
        value = float(num.replace(",", ""))
        if unit in ("%", "percent"):
            kind = "pct"
        elif unit in ("x", "×"):
            kind = "ratio"
        elif unit:
            kind = "seconds"
        else:
            kind = "decimal" if "." in num else "int"
        out.append(Number(m.group(0).strip(), value, kind))
    return out


def _matches(n: Number, fact: dict[str, Any]) -> bool:
    unit, v = fact["unit"], float(fact["value"])
    if n.kind == "pct":
        return unit == "pct" and abs(v * 100 - n.value) <= PCT_TOL
    if n.kind == "seconds":
        return unit == "seconds" and abs(abs(v) - n.value) <= SECONDS_TOL
    if n.kind == "decimal":
        return unit == "rate" and abs(v - n.value) <= RATE_TOL
    if n.kind == "int":
        return (
            (unit == "count" and v == n.value)
            or (unit == "seconds" and abs(abs(v) - n.value) <= SECONDS_TOL)
            or (unit == "rate" and abs(v - n.value) <= RATE_TOL)
        )
    return False  # ratios are derived numbers, never in the fact sheet


def validate_claim(
    claim: Any, facts: dict[str, dict[str, Any]], require_facts: bool = True
) -> list[str]:
    """Errors for one claim (empty list = valid)."""
    if not isinstance(claim, dict):
        return ["claim is not an object"]
    text = claim.get("text")
    if not isinstance(text, str) or not text.strip():
        return ["empty text"]
    ids = claim.get("fact_ids")
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        return ["fact_ids must be a list of strings"]
    if require_facts and not ids:
        return ["no fact_ids cited"]
    unknown = [i for i in ids if i not in facts]
    if unknown:
        return [f"unknown fact_ids: {', '.join(unknown)}"]
    cited = [facts[i] for i in ids]
    errors = []
    for n in extract_numbers(text):
        if n.kind == "ratio":
            errors.append(
                f"'{n.raw}' is a derived ratio; only numbers from the cited facts are allowed"
            )
        elif n.kind == "word":
            errors.append(
                f"'{n.raw}' is a number word; write numbers as digits from the cited facts or drop them"
            )
        elif not any(_matches(n, fact) for fact in cited):
            errors.append(f"'{n.raw}' does not match any cited fact value")
    return errors


def headline_errors(text: Any, team_name: str) -> list[str]:
    """The headline cites no facts, so it may not contain any number (digits, number words, multipliers).
    The team's own name is ignored (names like "100 Thieves")."""
    if not isinstance(text, str) or not text.strip():
        return ["empty headline"]
    clean = text.replace(team_name, " ") if team_name else text
    return [
        f"'{n.raw}': the headline must not contain numbers"
        for n in extract_numbers(clean)
    ]


def fallback_headline(team_name: str) -> str:
    """Deterministic headline without numbers (used when the model's headline fails validation twice)."""
    return f"{team_name}: scouting report built from the published aggregates."


# ---------------------------------------------------------------- prompt


SYSTEM_PROMPT = """You are a VALORANT tactical scouting analyst writing a pre-match report for a professional \
coaching staff. You get a fact sheet of aggregated statistics about one team. Write in English, concise and \
specific, in the voice of a scouting analyst. Return ONLY a JSON object, no prose, no code fences.

Hard rules:
- Every claim and counter cites the fact ids it relies on in "fact_ids" (at least one, only ids from the sheet).
- Every number you write must be the "display" value of one of the cited facts, written exactly as displayed \
(percentages as whole numbers with %, rates with two decimals, counts as integers, times as m:ss). \
Do not compute new numbers: no sums, differences, ratios, averages or "x times" multipliers.
- Never write numbers as words: no "one", "two", "twice", "half", "a third", "double", "dozen", "percent" \
(use "%" after a fact value). Say "a single", "a pair of", "most", "more often" instead. \
The headline contains no numbers at all.
- A time of 0:00 is written as "barrier drop" (the first second after freezetime ends).
- Utility spots are where the CASTER stood when using the ability, not where the utility landed.
- Do not invent facts beyond the sheet. Small samples were already removed; do not speculate about missing data.
- map/side/phase fields use the keys from the sheet (side: "attacker" or "defender"; phase: buy, opening, mid, \
late, post_plant) or null. tab is "map" (utility and map pool), "operator" or "compare" (versus reference).
"""

OUTPUT_SPEC = """Output JSON shape:
{"headline": "1-2 sentences summarising the team's identity",
 "sections": [
   {"id": "utility", "title": "...", "claims": [CLAIM, ...]},
   {"id": "operator", "title": "...", "claims": [...]},
   {"id": "maps", "title": "...", "claims": [...]},
   {"id": "vs_reference", "title": "...", "claims": [...]}
 ],
 "counters": [CLAIM, ...]}
CLAIM = {"text": "...", "fact_ids": ["..."], "map": "<map key>"|null, "side": "attacker"|"defender"|null,
         "phase": "<phase>"|null, "tab": "map"|"operator"|"compare"}
Write 3-5 claims per section (skip vs_reference if the sheet has no vs.* facts) and 3-5 counters: concrete \
counter-strategy suggestions for an opponent preparing against this team, each grounded in cited facts."""


def display(fact: dict[str, Any]) -> str:
    v, unit = fact["value"], fact["unit"]
    if unit == "pct":
        return f"{round(v * 100)}%"
    if unit == "rate":
        return f"{v:.2f}"
    if unit == "seconds":
        if v == 0:
            return "barrier drop"
        sign = "-" if v < 0 else ""
        return f"{sign}{abs(v) // 60}:{abs(v) % 60:02d}"
    return str(v)


def facts_table(facts: dict[str, dict[str, Any]]) -> str:
    rows = ["id | label | display | map | side | phase"]
    for fid, fact in facts.items():
        rows.append(
            " | ".join(
                [fid, fact["label"], display(fact)]
                + [fact[k] or "-" for k in ("map", "side", "phase")]
            )
        )
    return "\n".join(rows)


def build_prompt(
    team: dict[str, Any], ref_name: str | None, facts: dict[str, dict[str, Any]]
) -> str:
    t = team["team"]
    ref_line = (
        f"Reference team for vs_reference: {ref_name}."
        if ref_name
        else "No reference team."
    )
    return (
        f"Team: {t['name']} (last tournament: {t.get('last_tournament') or 'n/a'}). {ref_line}\n\n"
        f"Fact sheet:\n{facts_table(facts)}\n\n{OUTPUT_SPEC}"
    )


def build_retry_prompt(
    facts: dict[str, dict[str, Any]], failures: list[dict[str, Any]]
) -> str:
    return (
        "Some claims failed number validation. Rewrite each one so that every number is the exact display value "
        "of one of its cited facts (or remove the number), keeping its meaning. Return ONLY JSON: "
        '{"fixes": [{"ref": "<same ref>", "text": "...", "fact_ids": ["..."]}]}. Omit a ref to drop that claim.\n\n'
        f"Failed claims:\n{json.dumps(failures, ensure_ascii=False, indent=1)}\n\n"
        f"Fact sheet:\n{facts_table(facts)}"
    )


# ---------------------------------------------------------------- providers


@dataclass
class LLMResult:
    text: str
    usage: dict[str, Any] = field(default_factory=dict)


_NULLABLE_STR = {"type": ["string", "null"]}
_CLAIM_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "fact_ids": {"type": "array", "items": {"type": "string"}},
        "map": _NULLABLE_STR,
        "side": _NULLABLE_STR,
        "phase": _NULLABLE_STR,
        "tab": {"type": "string", "enum": list(TABS)},
    },
    "required": ["text", "fact_ids", "map", "side", "phase", "tab"],
    "additionalProperties": False,
}
# Structured output schemas (JSON guaranteed parseable); field values are still checked by the validator.
REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "enum": list(SECTION_IDS)},
                    "title": {"type": "string"},
                    "claims": {"type": "array", "items": _CLAIM_SCHEMA},
                },
                "required": ["id", "title", "claims"],
                "additionalProperties": False,
            },
        },
        "counters": {"type": "array", "items": _CLAIM_SCHEMA},
    },
    "required": ["headline", "sections", "counters"],
    "additionalProperties": False,
}
RETRY_SCHEMA = {
    "type": "object",
    "properties": {
        "fixes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string"},
                    "text": {"type": "string"},
                    "fact_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["ref", "text", "fact_ids"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["fixes"],
    "additionalProperties": False,
}


class Provider(Protocol):
    name: str
    model: str

    def complete(
        self, system: str, user: str, schema: dict[str, Any] | None = None
    ) -> LLMResult: ...


class AnthropicProvider:
    name = "anthropic-api"

    def __init__(self, model: str) -> None:
        import anthropic  # imported lazily: the CLI provider and tests do not need it

        self.model = model
        self._client = (
            anthropic.Anthropic()
        )  # reads ANTHROPIC_API_KEY from the environment

    def complete(
        self, system: str, user: str, schema: dict[str, Any] | None = None
    ) -> LLMResult:
        extra: dict[str, Any] = {}
        if schema is not None:
            extra["output_config"] = {
                "format": {"type": "json_schema", "schema": schema}
            }
        msg = self._client.messages.create(
            model=self.model,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": user}],
            **extra,
        )
        if msg.stop_reason == "max_tokens":
            raise RuntimeError(
                f"model output hit max_tokens={MAX_TOKENS} (output truncated)"
            )
        text = "".join(b.text for b in msg.content if b.type == "text")
        return LLMResult(
            text,
            {
                "input_tokens": msg.usage.input_tokens,
                "output_tokens": msg.usage.output_tokens,
            },
        )


class ClaudeCliProvider:
    name = "claude-cli"

    def __init__(self, model: str, binary: str) -> None:
        self.model = model
        self._binary = binary

    def complete(
        self, system: str, user: str, schema: dict[str, Any] | None = None
    ) -> LLMResult:
        cmd = [
            self._binary,
            "-p",
            "--output-format",
            "json",
            "--model",
            self.model,
            "--tools",
            "",
            "--system-prompt",
            system,
            # isolation: no MCP servers, no skills/slash commands, no saved session. (--bare is not used: it
            # disables OAuth login, which is the point of this fallback.)
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-session-persistence",
        ]
        if schema is not None:
            cmd += ["--json-schema", json.dumps(schema)]
        # empty temp cwd: no project CLAUDE.md / .claude settings are discovered
        with tempfile.TemporaryDirectory(prefix="uf-report-") as cwd:
            proc = subprocess.run(
                cmd,
                input=user,
                capture_output=True,
                text=True,
                timeout=CLI_TIMEOUT_S,
                check=False,
                cwd=cwd,
            )
        if proc.returncode != 0:
            raise RuntimeError(
                f"claude CLI exited with {proc.returncode}: {proc.stderr.strip()[:500]}"
            )
        try:
            out = json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"claude CLI did not return JSON ({e})") from e
        if out.get("is_error") or not isinstance(out.get("result"), str):
            raise RuntimeError(
                f"claude CLI returned an error: {str(out.get('result'))[:500]}"
            )
        usage = out.get("usage") or {}
        structured = out.get("structured_output")
        return LLMResult(
            json.dumps(structured) if isinstance(structured, dict) else out["result"],
            {
                "input_tokens": usage.get("input_tokens"),
                "output_tokens": usage.get("output_tokens"),
                "cost_usd": out.get("total_cost_usd"),
            },
        )


def pick_provider() -> Provider:
    model = os.environ.get("UF_REPORT_MODEL") or DEFAULT_MODEL
    if os.environ.get("ANTHROPIC_API_KEY"):
        return AnthropicProvider(model)
    binary = shutil.which("claude")
    if binary:
        return ClaudeCliProvider(model, binary)
    raise SystemExit(
        "report: no LLM provider. Set ANTHROPIC_API_KEY for this command only (Anthropic API), "
        "or install the Claude Code CLI (`claude`) and log in. Use --dry-run to only write fact sheets and prompts."
    )


# ---------------------------------------------------------------- generation


def parse_json(text: str) -> dict[str, Any]:
    """The model's JSON object (tolerates code fences or text around it)."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model output contains no JSON object")
    data = json.loads(text[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("model output is not a JSON object")
    return data


def _normalise(
    claim: dict[str, Any],
    facts: dict[str, dict[str, Any]],
    team_maps: set[str],
    default_tab: str,
) -> dict[str, Any]:
    """Keep only schema fields; enum values the dashboard understands, filled from the cited facts when unanimous."""
    cited = [facts[i] for i in claim["fact_ids"]]

    def from_facts(key: str) -> str | None:
        vals = {c[key] for c in cited}
        return vals.pop() if len(vals) == 1 else None

    raw_map = str(claim.get("map") or "").lower() or None
    raw_side = SIDE_ALIASES.get(str(claim.get("side") or "").lower())
    raw_phase = claim.get("phase") if claim.get("phase") in PHASES else None
    tab = claim.get("tab") if claim.get("tab") in TABS else default_tab
    map_ = raw_map if raw_map in team_maps else from_facts("map")
    return {
        "text": claim["text"].strip(),
        "fact_ids": list(dict.fromkeys(claim["fact_ids"])),
        "map": map_ if map_ in team_maps else None,
        "side": raw_side or from_facts("side"),
        "phase": raw_phase or from_facts("phase"),
        "tab": tab,
    }


@dataclass
class _Item:
    ref: str
    claim: Any
    section: str | None  # None = counter


def _items(raw: dict[str, Any]) -> list[_Item]:
    items = []
    sections = raw.get("sections") if isinstance(raw.get("sections"), list) else []
    for s in sections:
        if not isinstance(s, dict) or s.get("id") not in SECTION_IDS:
            continue
        for i, c in enumerate(s.get("claims") or []):
            items.append(_Item(f"{s['id']}.{i}", c, s["id"]))
    counters = raw.get("counters") if isinstance(raw.get("counters"), list) else []
    for i, c in enumerate(counters):
        items.append(_Item(f"counter.{i}", c, None))
    return items


def generate(
    team: dict[str, Any],
    ref: dict[str, Any] | None,
    facts: dict[str, dict[str, Any]],
    provider: Provider,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Call the model, validate, retry failing claims once. Returns (report without generated_at, usage)."""
    usage: dict[str, Any] = {"calls": 0}

    def call(user: str, schema: dict[str, Any]) -> dict[str, Any]:
        res = provider.complete(SYSTEM_PROMPT, user, schema)
        usage["calls"] += 1
        for k, v in res.usage.items():
            if isinstance(v, (int, float)):
                usage[k] = usage.get(k, 0) + v
        return parse_json(res.text)

    ref_name = ref["team"]["name"] if ref else None
    raw = call(build_prompt(team, ref_name, facts), REPORT_SCHEMA)
    items = _items(raw)
    team_name = team["team"]["name"]
    headline = raw.get("headline") if isinstance(raw.get("headline"), str) else ""

    errors = {it.ref: validate_claim(it.claim, facts) for it in items}
    head_errors = headline_errors(headline, team_name)
    first_head_errors = head_errors
    retries = 0
    failing = [it for it in items if errors[it.ref]]
    if failing or head_errors:
        retries = 1
        payload = [
            {
                "ref": it.ref,
                "text": (it.claim or {}).get("text")
                if isinstance(it.claim, dict)
                else None,
                "fact_ids": (it.claim or {}).get("fact_ids")
                if isinstance(it.claim, dict)
                else None,
                "errors": errors[it.ref],
            }
            for it in failing
        ]
        if head_errors:
            payload.append(
                {
                    "ref": "headline",
                    "text": headline,
                    "fact_ids": [],
                    "errors": head_errors
                    + [
                        "rewrite the headline without any number (no digits, no number words)"
                    ],
                }
            )
        try:
            fixes = (
                call(build_retry_prompt(facts, payload), RETRY_SCHEMA).get("fixes")
                or []
            )
        except (ValueError, RuntimeError) as e:
            fixes = []
            usage["retry_error"] = str(e)[:200]
        by_ref = {fx.get("ref"): fx for fx in fixes if isinstance(fx, dict)}
        for it in failing:
            fx = by_ref.get(it.ref)
            if fx is None:
                errors[it.ref] = errors[it.ref] + ["dropped by the model on retry"]
                continue
            fixed = (
                {**it.claim, "text": fx.get("text"), "fact_ids": fx.get("fact_ids")}
                if isinstance(it.claim, dict)
                else {"text": fx.get("text"), "fact_ids": fx.get("fact_ids")}
            )
            new_errors = validate_claim(fixed, facts)
            if new_errors:
                errors[it.ref] = errors[it.ref] + [
                    f"after retry: {e}" for e in new_errors
                ]
            else:
                it.claim, errors[it.ref] = fixed, []
        if head_errors:
            fx = by_ref.get("headline")
            if fx and not headline_errors(fx.get("text"), team_name):
                headline, head_errors = fx["text"], []

    team_maps = set(team["maps"])
    sections = {sid: [] for sid in SECTION_IDS}
    counters, dropped = [], []
    if (
        head_errors
    ):  # deterministic fallback without numbers; recorded under validation.dropped
        dropped.append(
            {
                "text": headline,
                "reason": "headline: "
                + "; ".join(
                    first_head_errors
                    + [
                        f"after retry: {e}"
                        for e in head_errors
                        if e not in first_head_errors
                    ]
                )
                + "; replaced by the fallback headline",
            }
        )
        headline = fallback_headline(team_name)
    for it in items:
        if errors[it.ref]:
            text = it.claim.get("text") if isinstance(it.claim, dict) else None
            dropped.append(
                {"text": str(text or ""), "reason": "; ".join(errors[it.ref])}
            )
            continue
        if it.section is None:
            counters.append(_normalise(it.claim, facts, team_maps, "compare"))
        else:
            sections[it.section].append(
                _normalise(it.claim, facts, team_maps, SECTION_TAB[it.section])
            )
    kept = sum(len(v) for v in sections.values()) + len(counters)
    report = {
        "headline": headline.strip(),
        "sections": [
            # fixed titles: model-written titles are free text the validator cannot check
            {"id": sid, "title": SECTION_TITLES[sid], "claims": claims}
            for sid, claims in sections.items()
            if claims
        ],
        "counters": counters,
        "validation": {
            "claims_total": len(items),
            "claims_kept": kept,
            "claims_dropped": len(items) - kept,
            "retries": retries,
            "dropped": dropped,
        },
    }
    return report, usage


def cache_key(
    facts: dict[str, dict[str, Any]], model: str, team: dict[str, Any]
) -> str:
    """Changes whenever anything that shapes the model output or its validation changes."""
    prompt_hash = hashlib.sha256(
        (
            SYSTEM_PROMPT
            + OUTPUT_SPEC
            + json.dumps(REPORT_SCHEMA, sort_keys=True)
            + json.dumps(RETRY_SCHEMA, sort_keys=True)
        ).encode()
    ).hexdigest()
    t = team["team"]
    blob = json.dumps(
        {
            "facts": facts,
            "prompt_version": PROMPT_VERSION,
            "prompt_hash": prompt_hash,
            "validator_version": VALIDATOR_VERSION,
            "model": model,
            "team_name": t["name"],
            "last_tournament": t.get("last_tournament"),
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode()).hexdigest()


def assemble(
    team: dict[str, Any],
    ref_id: str | None,
    facts: dict[str, dict[str, Any]],
    body: dict[str, Any],
    provider_name: str,
    model: str,
    generated_at: str,
) -> dict[str, Any]:
    t = team["team"]
    return {
        "version": 1,
        "team_id": int(t["id"]),
        "team_name": t["name"],
        "generated_at": generated_at,
        "model": model,
        "provider": provider_name,
        "games": int(t["games"]),
        "headline": body["headline"],
        "sections": body["sections"],
        "counters": body["counters"],
        "reference_team_id": int(ref_id) if ref_id else None,
        "facts": facts,
        "validation": body["validation"],
    }


def check_report(report: dict[str, Any]) -> list[str]:
    """Re-validate a written report against its own embedded facts (used by `report --check` and tests)."""
    facts = report["facts"]
    problems = []
    for s in report["sections"]:
        if s["id"] not in SECTION_IDS:
            problems.append(f"unknown section {s['id']}")
        for c in s["claims"]:
            problems += [
                f"{s['id']}: {e} — {c['text'][:60]}" for e in validate_claim(c, facts)
            ]
    for c in report["counters"]:
        problems += [
            f"counter: {e} — {c['text'][:60]}" for e in validate_claim(c, facts)
        ]
    problems += [
        f"headline: {e}"
        for e in headline_errors(report["headline"], report["team_name"])
    ]
    for s in report["sections"]:
        if s["id"] in SECTION_TITLES and s["title"] != SECTION_TITLES[s["id"]]:
            problems.append(f"section {s['id']}: title is not the fixed title")
    for c in [c for s in report["sections"] for c in s["claims"]] + report["counters"]:
        if (
            c["side"] not in (None, *SIDES)
            or c["phase"] not in (None, *PHASES)
            or c["tab"] not in TABS
        ):
            problems.append(f"bad enum in claim: {c['text'][:60]}")
    kept = sum(len(s["claims"]) for s in report["sections"]) + len(report["counters"])
    if kept != report["validation"]["claims_kept"]:
        problems.append("validation.claims_kept does not match the claims in the file")
    return problems


# ---------------------------------------------------------------- CLI entry


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def select_teams(
    index: dict[str, Any], teams: str | None, top: int | None
) -> list[str]:
    known = {str(t["id"]) for t in index["teams"]}
    if teams:
        ids = [x.strip() for x in teams.split(",") if x.strip()]
        missing = [x for x in ids if x not in known]
        if missing:
            raise SystemExit(
                f"report: unknown team ids (not in index.json): {', '.join(missing)}"
            )
        return ids
    n = top or DEFAULT_TOP
    first = [t for t in (REFERENCE_TEAM_ID, FALLBACK_REFERENCE_TEAM_ID) if t in known]
    rest = sorted(
        (t for t in index["teams"] if str(t["id"]) not in first),
        key=lambda t: (-t["games"], t["name"]),
    )
    return (first + [str(t["id"]) for t in rest])[:n]


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    tmp.replace(path)


def write_index(reports_dir: Path) -> list[dict[str, Any]]:
    rows = []
    for p in sorted(reports_dir.glob("*.json")):
        if p.name == "index.json":
            continue
        r = _load(p)
        rows.append(
            {
                "team_id": r["team_id"],
                "team_name": r["team_name"],
                "generated_at": r["generated_at"],
                "claims_kept": r["validation"]["claims_kept"],
            }
        )
    order = {int(REFERENCE_TEAM_ID): 0, int(FALLBACK_REFERENCE_TEAM_ID): 1}
    rows.sort(key=lambda r: (order.get(r["team_id"], 2), r["team_name"]))
    _write_json(reports_dir / "index.json", rows)
    return rows


def run(
    teams: str | None = None,
    top: int | None = None,
    force: bool = False,
    dry_run: bool = False,
    check: bool = False,
    data_dir: Path = WEB_DATA_DIR,
    reports_dir: Path = REPORTS_DIR,
    cache_dir: Path = CACHE_DIR,
    provider: Provider | None = None,
) -> dict[str, Any]:
    index_path = data_dir / "index.json"
    if not index_path.is_file():
        raise SystemExit(f"report: {index_path} not found; run `build` first")
    index = _load(index_path)
    ids = select_teams(index, teams, top)

    if check:
        result = {}
        for tid in ids:
            path = reports_dir / f"{tid}.json"
            if not path.is_file():
                result[tid] = ["missing report file"]
                print(f"[report] check {tid}: missing report file")
                continue
            r = _load(path)
            team, ref, _ = _team_and_ref(data_dir, tid)
            result[tid] = check_report(r) + stale_facts(r, build_facts(team, ref))
            print(
                f"[report] check {tid}: claims_kept={r['validation']['claims_kept']} problems={len(result[tid])}"
            )
            for p in result[tid]:
                print(f"  - {p}")
        return result

    if not dry_run and provider is None:
        provider = pick_provider()
    results: dict[str, Any] = {}
    try:
        for tid in ids:
            try:
                results[tid] = _run_team(
                    tid, data_dir, reports_dir, cache_dir, provider, force, dry_run
                )
            except subprocess.TimeoutExpired as e:
                results[tid] = {"error": f"claude CLI timed out after {e.timeout}s"}
            except Exception as e:  # noqa: BLE001 — incl. anthropic.APIError; one team must not stop the batch
                results[tid] = {"error": f"{type(e).__name__}: {str(e)[:300]}"}
            if "error" in results[tid]:
                print(f"[report] {tid} FAILED: {results[tid]['error']}")
    finally:
        if not dry_run and reports_dir.is_dir():
            write_index(reports_dir)
    return results


def stale_facts(
    report: dict[str, Any], current: dict[str, dict[str, Any]]
) -> list[str]:
    """Problems when the report's embedded facts differ from a fact sheet rebuilt from the current aggregates."""
    old = report["facts"]
    if old == current:
        return []
    changed = sorted(k for k in set(old) | set(current) if old.get(k) != current.get(k))
    return [
        f"stale facts: {len(changed)} fact(s) differ from the current aggregates "
        f"(e.g. {', '.join(changed[:3])}); regenerate with `report --force`"
    ]


def _team_and_ref(
    data_dir: Path, tid: str
) -> tuple[dict[str, Any], dict[str, Any] | None, str | None]:
    team = _load(data_dir / "teams" / f"{tid}.json")
    ref_id: str | None = (
        FALLBACK_REFERENCE_TEAM_ID if tid == REFERENCE_TEAM_ID else REFERENCE_TEAM_ID
    )
    ref_path = data_dir / "teams" / f"{ref_id}.json"
    ref = _load(ref_path) if ref_path.is_file() else None
    return team, ref, ref_id if ref is not None else None


def _run_team(
    tid: str,
    data_dir: Path,
    reports_dir: Path,
    cache_dir: Path,
    provider: Provider | None,
    force: bool,
    dry_run: bool,
) -> dict[str, Any]:
    team, ref, ref_id = _team_and_ref(data_dir, tid)
    facts = build_facts(team, ref)
    if dry_run:
        prompt = build_prompt(team, ref["team"]["name"] if ref else None, facts)
        cache_dir.mkdir(parents=True, exist_ok=True)
        _write_json(cache_dir / f"{tid}.facts.json", facts)
        (cache_dir / f"{tid}.prompt.txt").write_text(
            f"=== SYSTEM ===\n{SYSTEM_PROMPT}\n=== USER ===\n{prompt}\n",
            encoding="utf-8",
        )
        print(
            f"[report] dry-run {tid}: {len(facts)} facts, prompt {len(prompt)} chars → {cache_dir}"
        )
        return {"facts": len(facts), "prompt_chars": len(prompt)}
    if provider is None:
        raise RuntimeError("no LLM provider")
    key = cache_key(facts, provider.model, team)
    cache_path = cache_dir / f"{tid}.cache.json"
    cached = _load(cache_path) if cache_path.is_file() else None
    report = None
    usage: dict[str, Any] = {}
    if cached and cached.get("key") == key and not force:
        problems = check_report(cached["report"]) + stale_facts(cached["report"], facts)
        if problems:
            print(
                f"[report] {tid}: cached report fails validation ({len(problems)}), regenerating"
            )
        else:
            report, usage = cached["report"], {"calls": 0, "cached": True}
    if report is None:
        body, usage = generate(team, ref, facts, provider)
        report = assemble(
            team,
            ref_id,
            facts,
            body,
            provider.name,
            provider.model,
            datetime.now(UTC).isoformat(timespec="seconds"),
        )
        _write_json(cache_path, {"key": key, "report": report, "usage": usage})
    _write_json(reports_dir / f"{tid}.json", report)
    v = report["validation"]
    print(
        f"[report] {tid} {report['team_name']}: facts={len(facts)} kept={v['claims_kept']}/"
        f"{v['claims_total']} dropped={v['claims_dropped']} retries={v['retries']} usage={usage}"
    )
    return {"validation": v, "usage": usage}
