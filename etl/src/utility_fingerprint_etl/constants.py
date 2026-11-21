"""Single home for pipeline constants (phases, aggregation thresholds, output paths)."""

from __future__ import annotations

from .config import PROJECT_ROOT

# Output locations (both git-ignored; the pre-commit hook also rejects them).
PARQUET_DIR = PROJECT_ROOT / "data" / "parquet"
SERIES_PARQUET_DIR = PARQUET_DIR / "series"
WEB_DATA_DIR = PROJECT_ROOT / "web" / "public" / "data"

# Round phases, measured from the end of freezetime (t_round_ms = event time - freezetime end).
PHASE_BUY = (
    "buy"  # before freezetime ends (pre-round setups are legal during the buy phase)
)
PHASE_OPENING = "opening"  # 0-15 s
PHASE_MID = "mid"  # 15-45 s
PHASE_LATE = "late"  # > 45 s, before the plant
PHASE_POST_PLANT = "post_plant"  # at/after the plant
PHASES = (PHASE_BUY, PHASE_OPENING, PHASE_MID, PHASE_LATE, PHASE_POST_PLANT)
OPENING_END_MS = 15_000
MID_END_MS = 45_000

SIDES = ("attacker", "defender")

# winType (team-won-round) → outcome
OUTCOMES = {
    "opponentEliminated": "elimination",
    "bombDefused": "defuse",
    "bombExploded": "explode",
    "timeExpired": "time",
}

# Supplement frames ~200 ms apart = 5 Hz; ~1000 ms = 1 Hz (VCT Americas 2025).
LOW_RATE_SPACING_MS = 600

# A cast/kill belongs to a round if it happens up to this long after the round end event.
ROUND_END_GRACE_MS = 2_000

# Aggregation
MIN_TEAM_GAMES = 5
HEAT_GRID_SIZE = 48
HEAT_MIN_COUNT = 2  # cells with fewer events are dropped (no single-event cells)
CLUSTER_EPS_UV = 0.025  # ≈ 3.3 m on a typical map (1 uv unit ≈ 130 m)
CLUSTER_MIN_SAMPLES = 3  # also the minimum cluster size that is published
CLUSTER_MIN_SHARE = 0.05  # min_samples grows to 5 % of the group for large groups
CLUSTER_MAX_PER_GROUP = 5
CLUSTER_TOP_PLAYERS = (
    3  # `players` per cluster: top throwers by share of the cluster's casts
)
FORCE_INCLUDE_TEAM_NAMES = ("Cloud9", "Cloud9 GC")

# Operator profiler: an entry is `low_sample` when its denominator is below these thresholds.
OP_LOW_SAMPLE_ROUNDS = (
    10  # player entries: rounds holding the OP (≈ less than one half of OP play)
)
OP_TEAM_LOW_SAMPLE_ROUNDS = (
    24  # team map/side entries: team rounds on that side (≈ two halves)
)
OP_KILLED_BY_TOP = 3  # weapons listed in `killed_by` for OP holder deaths
# Coarser grid for Operator heat: OP kills are ~3 % of kills, so 48x48 with count >= 2 is mostly empty.
OP_HEAT_GRID_SIZE = 24
