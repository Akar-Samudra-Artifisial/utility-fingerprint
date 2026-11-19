"""Map calibration (valorant-api.com coefficients) and coordinate helpers. See docs/calibration.md."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

import httpx

from .config import CACHE_DIR

VALORANT_API_MAPS = "https://valorant-api.com/v1/maps"


@dataclass(frozen=True)
class MapCalib:
    name: str  # lowercase, matches GRID map.name / meta games.csv
    display_name: str
    display_icon: str
    x_mult: float
    y_mult: float
    x_add: float
    y_add: float
    sites: tuple[tuple[str, float, float], ...]  # (site letter, game x, game y)


def to_uv(calib: MapCalib, x: float, y: float) -> tuple[float, float]:
    """Game cm → normalized minimap coords (0..1, origin top-left). Axes are swapped (calibration.md)."""
    return y * calib.x_mult + calib.x_add, x * calib.y_mult + calib.y_add


def view_to_uv(calib: MapCalib, vx: float, vy: float) -> tuple[float, float] | None:
    """Game-space aim direction → unit direction on the minimap (same axis swap, no offset)."""
    du, dv = vy * calib.x_mult, vx * calib.y_mult
    norm = math.hypot(du, dv)
    return (du / norm, dv / norm) if norm > 0 else None


def nearest_site(calib: MapCalib, x: float, y: float) -> tuple[str, float] | None:
    best: tuple[str, float] | None = None
    for letter, sx, sy in calib.sites:
        d = math.hypot(x - sx, y - sy)
        if best is None or d < best[1]:
            best = (letter, d)
    return best


def fetch_api_maps() -> list[dict[str, Any]]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / "valorant-api-maps.json"
    if not cache.is_file():
        resp = httpx.get(VALORANT_API_MAPS, timeout=30)
        resp.raise_for_status()
        cache.write_text(resp.text, encoding="utf-8")
    data = json.loads(cache.read_text(encoding="utf-8")).get("data")
    if not isinstance(data, list):
        raise SystemExit(
            f"Unexpected valorant-api.com response in {cache}: missing 'data' list"
        )
    return data


def load_calibs() -> dict[str, MapCalib]:
    out: dict[str, MapCalib] = {}
    for m in fetch_api_maps():
        name = str(m.get("displayName", "")).lower()
        if not m.get("xMultiplier") or not m.get("displayIcon") or name in out:
            continue
        sites = tuple(
            (c["superRegionName"], float(c["location"]["x"]), float(c["location"]["y"]))
            for c in m.get("callouts") or []
            if c.get("regionName") == "Site"
        )
        out[name] = MapCalib(
            name=name,
            display_name=m["displayName"],
            display_icon=m["displayIcon"],
            x_mult=float(m["xMultiplier"]),
            y_mult=float(m["yMultiplier"]),
            x_add=float(m["xScalarToAdd"]),
            y_add=float(m["yScalarToAdd"]),
            sites=sites,
        )
    return out
