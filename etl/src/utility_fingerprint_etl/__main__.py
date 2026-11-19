"""CLI: `uv run python -m utility_fingerprint_etl {inspect,poc,build,report}`."""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="utility_fingerprint_etl")
    sub = parser.add_subparsers(dest="command", required=True)
    p_inspect = sub.add_parser(
        "inspect", help="sample series and write docs/data-schema.md"
    )
    p_inspect.add_argument(
        "--series",
        nargs="*",
        help="series ids to sample (default: 3 picked from series.csv)",
    )
    p_poc = sub.add_parser(
        "poc", help="coordinate calibration PoC → docs/calibration.md + docs/poc/*.png"
    )
    p_poc.add_argument("--games-per-map", type=int, default=25)
    p_build = sub.add_parser(
        "build", help="full ETL: series → data/parquet → web/public/data JSON"
    )
    p_build.add_argument(
        "--limit", type=int, help="only the first N series of val/series.csv (dev)"
    )
    p_build.add_argument(
        "--force",
        action="store_true",
        help="re-extract series that already have Parquet",
    )
    p_build.add_argument(
        "--workers", type=int, help="parallel processes (default: CPU count - 1)"
    )
    p_build.add_argument(
        "--aggregate-only",
        action="store_true",
        help="skip extraction; recombine + aggregate",
    )
    p_report = sub.add_parser(
        "report",
        help="scouting reports per team with Claude, from the aggregate JSON → web/public/data/reports",
    )
    pick = p_report.add_mutually_exclusive_group()
    pick.add_argument("--teams", help="comma-separated team ids, e.g. 79,3429")
    pick.add_argument(
        "--top",
        type=int,
        help="Cloud9, Cloud9 GC, then teams with most games (default total: 20)",
    )
    p_report.add_argument(
        "--force", action="store_true", help="ignore the cache and call the model again"
    )
    p_report.add_argument(
        "--dry-run",
        action="store_true",
        help="only write fact sheets + prompts to data/reports (no LLM call)",
    )
    p_report.add_argument(
        "--check",
        action="store_true",
        help="re-run the number validator on existing report files (no LLM call)",
    )
    args = parser.parse_args()

    if args.command == "report":
        from .report import run as report

        result = report(
            teams=args.teams,
            top=args.top,
            force=args.force,
            dry_run=args.dry_run,
            check=args.check,
        )
        if args.check and any(result.values()):
            raise SystemExit(1)
        failed = [
            tid for tid, r in result.items() if isinstance(r, dict) and "error" in r
        ]
        if failed:
            raise SystemExit(f"report: failed for team(s) {', '.join(failed)}")
    elif args.command == "inspect":
        from .inspect_schema import run

        run(args.series)
    elif args.command == "build":
        from .build import run as build

        build(
            limit=args.limit,
            force=args.force,
            workers=args.workers,
            skip_extract=args.aggregate_only,
        )
    else:
        from .poc_calibration import run

        run(args.games_per_map)


if __name__ == "__main__":
    main()
