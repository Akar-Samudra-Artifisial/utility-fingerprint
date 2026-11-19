"""CLI: `uv run python -m utility_fingerprint_etl {inspect,poc}`."""

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
    args = parser.parse_args()

    if args.command == "inspect":
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
