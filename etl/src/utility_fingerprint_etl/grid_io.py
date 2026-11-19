"""Streaming readers for zstd-compressed JSON Lines files."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import zstandard


def iter_lines(path: Path) -> Iterator[str]:
    with zstandard.open(path, "rt", encoding="utf-8") as f:
        yield from f


def iter_jsonl_zst(path: Path) -> Iterator[dict[str, Any]]:
    for line in iter_lines(path):
        yield json.loads(line)


def iter_events_matching(
    path: Path, needle: str
) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    """Yield (envelope, event) pairs, only json-decoding lines that contain `needle`.

    Substring pre-filtering keeps scans of ~100 MB uncompressed feeds fast.
    """
    for line in iter_lines(path):
        if needle not in line:
            continue
        env = json.loads(line)
        for event in env["events"]:
            yield env, event


def series_feed(data_dir: Path, series_id: str) -> Path:
    return data_dir / "val" / f"events_{series_id}_grid.jsonl.zst"


def series_supplement(data_dir: Path, series_id: str) -> Path:
    return data_dir / "val-ability-supplements" / f"{series_id}.jsonl.zst"
