"""`build` command: extract every VALORANT series in parallel (resumable), combine Parquet, aggregate JSON."""

from __future__ import annotations

import json
import os
import shutil
import time
import traceback
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import polars as pl

from .config import data_dir
from .constants import PARQUET_DIR, SERIES_PARQUET_DIR
from .extract import (
    CASTS_SCHEMA,
    KILLS_SCHEMA,
    OP_POSITIONS_SCHEMA,
    OP_ROUNDS_SCHEMA,
    ROUNDS_SCHEMA,
    GameMeta,
    SeriesContext,
    process_series,
)
from .geometry import MapCalib, load_calibs
from .grid_io import series_feed, series_supplement

_CTX: dict[str, Any] = {}


def _init_worker(
    rosters: dict[tuple[str, str], tuple[str, str, str]], calibs: dict[str, MapCalib]
) -> None:
    _CTX["rosters"] = rosters
    _CTX["calibs"] = calibs


def _run_one(
    series_id: str,
    feed: str,
    supplement: str | None,
    games: dict[str, GameMeta],
    out_dir: str,
) -> tuple[str, str, dict[str, Any]]:
    try:
        ctx = SeriesContext(
            series_id=series_id,
            feed=Path(feed),
            supplement=Path(supplement) if supplement else None,
            games=games,
            rosters={k: v for k, v in _CTX["rosters"].items() if k[0] in games},
            calibs=_CTX["calibs"],
            out_dir=Path(out_dir),
        )
        return series_id, "ok", process_series(ctx)
    except Exception as exc:  # noqa: BLE001 — a broken series must not stop the build
        return (
            series_id,
            "error",
            {
                "error": f"{type(exc).__name__}: {exc}",
                "trace": traceback.format_exc(limit=3),
            },
        )


def load_meta(root: Path) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    games = pl.read_csv(root / "meta" / "games.csv", infer_schema=False).filter(
        pl.col("title") == "val"
    )
    series = pl.read_csv(root / "val" / "series.csv", infer_schema=False)
    rosters = pl.read_csv(root / "meta" / "rosters.csv", infer_schema=False).filter(
        pl.col("title") == "val"
    )
    return games, series, rosters


def games_table(games: pl.DataFrame, series: pl.DataFrame) -> pl.DataFrame:
    return games.join(
        series.select("series_id", pl.col("event").alias("tournament"), "stage"),
        on="series_id",
        how="left",
    ).select(
        "series_id",
        "game_id",
        pl.col("game_number").cast(pl.Int32),
        "map",
        "patch",
        pl.col("started_at").str.to_datetime(time_zone="UTC", strict=False),
        "tournament",
        "stage",
        "team1_id",
        "team1_name",
        "team1_side",
        pl.col("team1_score").cast(pl.Int32, strict=False),
        "team2_id",
        "team2_name",
        "team2_side",
        pl.col("team2_score").cast(pl.Int32, strict=False),
        pl.col("winner_team_id"),
        (pl.col("finished") == "True").alias("finished"),
    )


def extract_all(limit: int | None, force: bool, workers: int) -> dict[str, Any]:
    root = data_dir()
    games, series, rosters = load_meta(root)
    calibs = load_calibs()
    missing_maps = sorted(set(games["map"].unique().to_list()) - set(calibs))
    roster_map = {
        (r["game_id"], r["player_id"]): (
            r["team_id"],
            r["player_name"],
            r["character_name"],
        )
        for r in rosters.iter_rows(named=True)
    }
    games_by_series: dict[str, dict[str, GameMeta]] = {}
    for g in games.iter_rows(named=True):
        games_by_series.setdefault(g["series_id"], {})[g["game_id"]] = GameMeta(
            g["game_id"], g["map"], g["team1_id"], g["team2_id"]
        )

    rows = series.to_dicts()
    if limit:
        rows = rows[:limit]
    SERIES_PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "series_total": len(rows),
        "missing_map_calibration": missing_maps,
    }
    skipped: Counter[str] = Counter()
    jobs = []
    for r in rows:
        sid = r["series_id"]
        out_dir = SERIES_PARQUET_DIR / sid
        if sid not in games_by_series:
            skipped["no_games_in_meta"] += 1
            continue
        feed = series_feed(root, sid)
        if not feed.is_file():
            skipped["feed_missing"] += 1
            continue
        # op_rounds/op_positions were added in week 4: older extractions are redone automatically
        if (
            (out_dir / "_SUCCESS").is_file()
            and (out_dir / "op_rounds.parquet").is_file()
            and (out_dir / "op_positions.parquet").is_file()
            and not force
        ):
            skipped["already_done"] += 1
            continue
        if out_dir.exists():
            shutil.rmtree(out_dir)
        supp = series_supplement(root, sid)
        jobs.append(
            (
                sid,
                str(feed),
                str(supp) if supp.is_file() else None,
                games_by_series[sid],
                str(out_dir),
            )
        )

    print(
        f"[build] {len(jobs)} series to extract, skipped: {dict(skipped)}, workers={workers}",
        flush=True,
    )
    errors: dict[str, str] = {}
    stats: Counter[str] = Counter()
    t0 = time.monotonic()
    done = 0
    with ProcessPoolExecutor(
        max_workers=workers, initializer=_init_worker, initargs=(roster_map, calibs)
    ) as pool:
        futures = [pool.submit(_run_one, *job) for job in jobs]
        for fut in as_completed(futures):
            sid, status, payload = fut.result()
            done += 1
            if status == "ok":
                stats.update(payload["stats"])
            else:
                errors[sid] = payload["error"]
                print(f"[build] ERROR series {sid}: {payload['error']}", flush=True)
            if done % 25 == 0 or done == len(jobs):
                elapsed = time.monotonic() - t0
                eta = elapsed / done * (len(jobs) - done)
                print(
                    f"[build] {done}/{len(jobs)} series ({elapsed:.0f}s, eta {eta:.0f}s)",
                    flush=True,
                )
    report.update(
        extracted=len(jobs) - len(errors),
        skipped=dict(skipped),
        errors=errors,
        extract_seconds=round(time.monotonic() - t0, 1),
        extract_stats=dict(stats),
    )
    games_table(games, series).write_parquet(PARQUET_DIR / "games.parquet")
    return report


def combine() -> dict[str, int]:
    counts = {}
    for name, schema in (
        ("rounds", ROUNDS_SCHEMA),
        ("kills", KILLS_SCHEMA),
        ("casts", CASTS_SCHEMA),
        ("op_rounds", OP_ROUNDS_SCHEMA),
        ("op_positions", OP_POSITIONS_SCHEMA),
    ):
        files = sorted(
            str(p / f"{name}.parquet")
            for p in SERIES_PARQUET_DIR.iterdir()
            if (p / "_SUCCESS").is_file()
        )
        df = (
            pl.concat([pl.read_parquet(f) for f in files])
            if files
            else pl.DataFrame(schema=schema)
        )
        df.write_parquet(PARQUET_DIR / f"{name}.parquet")
        counts[name] = df.height
    counts["games"] = pl.read_parquet(PARQUET_DIR / "games.parquet").height
    return counts


def side_switch_check(rounds: pl.DataFrame) -> dict[str, Any]:
    """Verify from data when attacker/defender swap between consecutive rounds of a game."""
    r = (
        rounds.filter(pl.col("attacker_team_id").is_not_null())
        .sort("game_id", "round_number")
        .with_columns(
            prev_att=pl.col("attacker_team_id").shift(1).over("game_id"),
            prev_rn=pl.col("round_number").shift(1).over("game_id"),
        )
        .filter(pl.col("prev_rn") == pl.col("round_number") - 1)
        .with_columns(switched=pl.col("attacker_team_id") != pl.col("prev_att"))
    )
    by_round = (
        r.group_by("round_number")
        .agg(n=pl.len(), switched=pl.col("switched").sum())
        .sort("round_number")
    )
    switch_rounds = by_round.filter(pl.col("switched") > pl.col("n") / 2)[
        "round_number"
    ].to_list()
    snapshot_agree = rounds.filter(
        pl.col("snapshot_attacker_team_id").is_not_null()
        & pl.col("attacker_team_id").is_not_null()
    )
    return {
        "rounds_where_majority_switch": switch_rounds,
        "switch_rate_r13": _rate(by_round, 13),
        "switch_rate_r2_12": _rate_range(by_round, 2, 12),
        "switch_rate_r14_24": _rate_range(by_round, 14, 24),
        "switch_rate_ot_25plus": _rate_range(by_round, 25, 99),
        "side_source": dict(Counter(rounds["side_source"].to_list())),
        "snapshot_agrees_with_winner_side": round(
            float(
                (
                    snapshot_agree["snapshot_attacker_team_id"]
                    == snapshot_agree["attacker_team_id"]
                ).mean()
                or 0
            ),
            4,
        ),
    }


def _rate(by_round: pl.DataFrame, rn: int) -> float | None:
    row = by_round.filter(pl.col("round_number") == rn)
    return round(row["switched"][0] / row["n"][0], 4) if row.height else None


def _rate_range(by_round: pl.DataFrame, lo: int, hi: int) -> float | None:
    sub = by_round.filter(pl.col("round_number").is_between(lo, hi))
    n = sub["n"].sum()
    return round(sub["switched"].sum() / n, 4) if n else None


def run(
    limit: int | None = None,
    force: bool = False,
    workers: int | None = None,
    skip_extract: bool = False,
) -> None:
    t0 = time.monotonic()
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    report_path = PARQUET_DIR / "_build_report.json"
    report: dict[str, Any] = {}
    if skip_extract:
        # keep the extraction stats of the last full extraction; only recombine/aggregate keys are refreshed
        if report_path.is_file():
            report.update(json.loads(report_path.read_text(encoding="utf-8")))
        report["aggregate_only_run"] = True
    else:
        report.update(extract_all(limit, force, workers))
    report["rows"] = combine()
    print(f"[build] parquet rows: {report['rows']}", flush=True)
    report["side_switch_check"] = side_switch_check(
        pl.read_parquet(PARQUET_DIR / "rounds.parquet")
    )
    from .aggregate import run as aggregate

    report["aggregate"] = aggregate()
    report["total_seconds"] = round(time.monotonic() - t0, 1)
    (PARQUET_DIR / "_build_report.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8"
    )
    print(
        f"[build] done in {report['total_seconds']}s; report: {PARQUET_DIR / '_build_report.json'}",
        flush=True,
    )
