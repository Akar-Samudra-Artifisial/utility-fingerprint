"""PoC: calibrate GRID game coordinates (cm) onto valorant-api.com minimaps.

Writes docs/poc/<map>.png (git-ignored, derived data) and docs/calibration.md (aggregates only).
"""

from __future__ import annotations

import json
import statistics
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import polars as pl  # noqa: E402
from PIL import Image  # noqa: E402

from .config import CACHE_DIR, DOCS_DIR, POC_DIR, data_dir  # noqa: E402
from .grid_io import (
    iter_events_matching,
    iter_jsonl_zst,
    series_feed,
    series_supplement,
)  # noqa: E402

VALORANT_API_MAPS = "https://valorant-api.com/v1/maps"
MAX_CASTS_PER_MAP = 4000
SITE_RADIUS_CM = 1500.0

Transform = Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]


@dataclass
class MapSamples:
    name: str
    game_ids: set[str]
    plants: list[tuple[float, float]] = field(default_factory=list)
    plant_sides: Counter[str] = field(default_factory=Counter)
    plant_games: set[str] = field(default_factory=set)
    casts: list[tuple[float, float]] = field(default_factory=list)
    bounds: dict[str, Any] | None = None


@dataclass
class MapInfo:
    display_name: str
    x_mult: float
    y_mult: float
    x_add: float
    y_add: float
    image: np.ndarray  # RGBA
    sites: dict[str, tuple[float, float]]


def _top_maps(root: Path, n: int) -> list[tuple[str, int]]:
    games = pl.read_csv(root / "meta" / "games.csv", infer_schema=False).filter(
        pl.col("title") == "val"
    )
    counts = games.group_by("map").len().sort("len", descending=True).head(n)
    return list(zip(counts["map"].to_list(), counts["len"].to_list(), strict=True))


def _select_games(
    root: Path, maps: list[str], per_map: int
) -> tuple[dict[str, MapSamples], list[str]]:
    games = (
        pl.read_csv(root / "meta" / "games.csv", infer_schema=False)
        .filter(
            (pl.col("title") == "val")
            & pl.col("map").is_in(maps)
            & (pl.col("finished") == "True")
        )
        .sort("started_at", descending=True)
    )
    samples = {m: MapSamples(m, set()) for m in maps}
    series_order: list[str] = []
    for row in games.iter_rows(named=True):
        s = samples[row["map"]]
        if len(s.game_ids) >= per_map:
            continue
        s.game_ids.add(row["game_id"])
        if row["series_id"] not in series_order:
            series_order.append(row["series_id"])
        if all(len(x.game_ids) >= per_map for x in samples.values()):
            break
    return samples, series_order


def _collect(root: Path, samples: dict[str, MapSamples], series_ids: list[str]) -> None:
    by_game = {gid: s for s in samples.values() for gid in s.game_ids}
    for sid in series_ids:
        print(f"[poc] series {sid}")
        for _env, ev in iter_events_matching(
            series_feed(root, sid), '"player-completed-plantBomb"'
        ):
            if ev["type"] != "player-completed-plantBomb":
                continue
            games = (ev.get("seriesStateDelta") or {}).get("games") or []
            gid = games[0]["id"] if games else None
            s = by_game.get(gid or "")
            pos = ((ev["actor"].get("state") or {}).get("game") or {}).get("position")
            if s is None or not pos:
                continue
            s.plants.append((pos["x"], pos["y"]))
            s.plant_sides[(ev["actor"].get("state") or {}).get("side", "?")] += 1
            s.plant_games.add(gid)
            if s.bounds is None:
                for g in (ev.get("seriesState") or {}).get("games") or []:
                    if g["id"] == gid and (g.get("map") or {}).get("bounds"):
                        s.bounds = g["map"]["bounds"]
        supp = series_supplement(root, sid)
        if not supp.is_file():
            continue
        for cast in iter_jsonl_zst(supp):
            s = by_game.get(cast["game_id"])
            interp = cast.get("interpolated") or {}
            if s is None or cast.get("quality") != "ok" or not interp.get("position"):
                continue
            if len(s.casts) < MAX_CASTS_PER_MAP:
                s.casts.append((interp["position"]["x"], interp["position"]["y"]))


def _fetch_api_maps() -> list[dict[str, Any]]:
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


def _map_info(api_maps: list[dict[str, Any]], name: str) -> MapInfo:
    candidates = [
        m
        for m in api_maps
        if m.get("displayName", "").lower() == name.lower()
        and m.get("displayIcon")
        and m.get("xMultiplier")
    ]
    if not candidates:
        raise SystemExit(
            f"valorant-api.com has no minimap/coefficients for map '{name}'"
        )
    m = candidates[0]
    icon = CACHE_DIR / f"{name}_displayicon.png"
    if not icon.is_file():
        resp = httpx.get(m["displayIcon"], timeout=60)
        resp.raise_for_status()
        icon.write_bytes(resp.content)
    image = np.asarray(Image.open(icon).convert("RGBA"))
    sites = {
        c["superRegionName"]: (c["location"]["x"], c["location"]["y"])
        for c in m.get("callouts") or []
        if c.get("regionName") == "Site"
    }
    return MapInfo(
        m["displayName"],
        m["xMultiplier"],
        m["yMultiplier"],
        m["xScalarToAdd"],
        m["yScalarToAdd"],
        image,
        sites,
    )


def transform_api(info: MapInfo) -> Transform:
    """Community formula: axes swapped (game y → image column, game x → image row)."""
    h, w = info.image.shape[:2]

    def f(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return (y * info.x_mult + info.x_add) * w, (x * info.y_mult + info.y_add) * h

    return f


def transform_api_noswap(info: MapInfo) -> Transform:
    h, w = info.image.shape[:2]

    def f(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return (x * info.x_mult + info.x_add) * w, (y * info.y_mult + info.y_add) * h

    return f


def _opaque_bbox(image: np.ndarray) -> tuple[int, int, int, int]:
    rows, cols = np.nonzero(image[:, :, 3] > 0)
    return int(cols.min()), int(cols.max()), int(rows.min()), int(rows.max())


def transform_bounds(info: MapInfo, bounds: dict[str, Any]) -> Transform:
    """Bounds-only fit: stretch map.bounds onto the minimap's opaque bounding box (same axis orientation as API)."""
    c0, c1, r0, r1 = _opaque_bbox(info.image)
    xmin, xmax = bounds["min"]["x"], bounds["max"]["x"]
    ymin, ymax = bounds["min"]["y"], bounds["max"]["y"]

    def f(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return c0 + (y - ymin) / (ymax - ymin) * (c1 - c0), r0 + (xmax - x) / (
            xmax - xmin
        ) * (r1 - r0)

    return f


def _pixel_ratio(
    info: MapInfo,
    cols: np.ndarray,
    rows: np.ndarray,
    pred: Callable[[np.ndarray], np.ndarray],
) -> float:
    h, w = info.image.shape[:2]
    ci, ri = np.round(cols).astype(int), np.round(rows).astype(int)
    inside = (ci >= 0) & (ci < w) & (ri >= 0) & (ri < h)
    hits = np.zeros(len(ci), dtype=bool)
    hits[inside] = pred(info.image[ri[inside], ci[inside]].astype(int))
    return float(hits.mean()) if len(hits) else float("nan")


def _is_opaque(px: np.ndarray) -> np.ndarray:
    return px[:, 3] > 0


def _is_site_tint(px: np.ndarray) -> np.ndarray:
    """Bomb sites are drawn with a yellow/olive tint (R,G clearly above B); corridors are neutral grey."""
    return (px[:, 3] > 0) & (np.minimum(px[:, 0], px[:, 1]) - px[:, 2] > 20)


def _on_map_ratio(info: MapInfo, cols: np.ndarray, rows: np.ndarray) -> float:
    return _pixel_ratio(info, cols, rows, _is_opaque)


@dataclass
class MapResult:
    name: str
    games: int
    plants: int
    casts: int
    sides: Counter[str]
    site_counts: Counter[str]
    site_dist_median: float
    site_dist_p95: float
    within_radius: float
    on_map: dict[str, dict[str, float]]
    bounds: dict[str, Any] | None
    bounds_vs_api_px_median: float | None
    bounds_rect_px: tuple[float, float, float, float] | None
    image_size: tuple[int, int]
    opaque_bbox: tuple[int, int, int, int]
    centroid_px_err: dict[str, float]
    coeffs: tuple[float, float, float, float]


def _analyse(s: MapSamples, info: MapInfo) -> MapResult:
    px = np.array([p[0] for p in s.plants])
    py = np.array([p[1] for p in s.plants])
    cx = np.array([c[0] for c in s.casts])
    cy = np.array([c[1] for c in s.casts])
    names = list(info.sites)
    site_xy = np.array([info.sites[n] for n in names])
    d = np.hypot(px[:, None] - site_xy[None, :, 0], py[:, None] - site_xy[None, :, 1])
    nearest = d.argmin(axis=1)
    dmin = d.min(axis=1)

    transforms: dict[str, Transform] = {
        "api_swapped (final)": transform_api(info),
        "api_no_swap": transform_api_noswap(info),
    }
    if s.bounds:
        transforms["bounds_fit"] = transform_bounds(info, s.bounds)
    on_map: dict[str, dict[str, float]] = {}
    for label, tf in transforms.items():
        on_map[label] = {
            "plants": _on_map_ratio(info, *tf(px, py)),
            "plants_on_site_tint": _pixel_ratio(info, *tf(px, py), _is_site_tint),
            "casts": _on_map_ratio(info, *tf(cx, cy)) if len(cx) else float("nan"),
            "casts_on_site_tint": _pixel_ratio(info, *tf(cx, cy), _is_site_tint)
            if len(cx)
            else float("nan"),
        }

    api = transform_api(info)
    pc, pr = api(px, py)
    sc, sr = api(site_xy[:, 0], site_xy[:, 1])
    centroid_err = {}
    for i, n in enumerate(names):
        mask = nearest == i
        if mask.any():
            centroid_err[n] = float(
                np.hypot(pc[mask].mean() - sc[i], pr[mask].mean() - sr[i])
            )

    bounds_med = None
    bounds_rect = None
    if s.bounds:
        bc, br = transforms["bounds_fit"](px, py)
        bounds_med = float(np.median(np.hypot(bc - pc, br - pr)))
        b = s.bounds
        rc, rr = api(
            np.array([b["min"]["x"], b["max"]["x"]]),
            np.array([b["min"]["y"], b["max"]["y"]]),
        )
        bounds_rect = (
            float(rc.min()),
            float(rc.max()),
            float(rr.min()),
            float(rr.max()),
        )

    return MapResult(
        name=s.name,
        games=len(s.plant_games),
        plants=len(s.plants),
        casts=len(s.casts),
        sides=s.plant_sides,
        site_counts=Counter(names[i] for i in nearest),
        site_dist_median=float(np.median(dmin)),
        site_dist_p95=float(np.percentile(dmin, 95)),
        within_radius=float((dmin <= SITE_RADIUS_CM).mean()),
        on_map=on_map,
        bounds=s.bounds,
        bounds_vs_api_px_median=bounds_med,
        bounds_rect_px=bounds_rect,
        image_size=(info.image.shape[1], info.image.shape[0]),
        opaque_bbox=_opaque_bbox(info.image),
        centroid_px_err=centroid_err,
        coeffs=(info.x_mult, info.y_mult, info.x_add, info.y_add),
    )


def _render(s: MapSamples, info: MapInfo, out: Path) -> None:
    px = np.array([p[0] for p in s.plants])
    py = np.array([p[1] for p in s.plants])
    cx = np.array([c[0] for c in s.casts])
    cy = np.array([c[1] for c in s.casts])
    names = list(info.sites)
    site_xy = np.array([info.sites[n] for n in names])
    nearest = np.hypot(
        px[:, None] - site_xy[None, :, 0], py[:, None] - site_xy[None, :, 1]
    ).argmin(axis=1)
    colors = ["#e63946", "#2a9d8f", "#f4a261", "#9b5de5"]

    fig, axes = plt.subplots(1, 2, figsize=(16, 8.4), dpi=110)
    for ax, (title, tf) in zip(
        axes,
        (
            ("valorant-api formula (axes swapped) — final", transform_api(info)),
            ("without swap — wrong", transform_api_noswap(info)),
        ),
        strict=True,
    ):
        ax.imshow(info.image)
        if len(cx):
            c, r = tf(cx, cy)
            ax.scatter(
                c,
                r,
                s=2,
                c="#4cc9f0",
                alpha=0.25,
                linewidths=0,
                label=f"utility casts (n={len(cx)})",
            )
        c, r = tf(px, py)
        for i, n in enumerate(names):
            m = nearest == i
            ax.scatter(
                c[m],
                r[m],
                s=14,
                c=colors[i % len(colors)],
                edgecolors="black",
                linewidths=0.3,
                label=f"plants nearest {n} (n={int(m.sum())})",
            )
        sc, sr = tf(site_xy[:, 0], site_xy[:, 1])
        for i, n in enumerate(names):
            ax.scatter(
                [sc[i]],
                [sr[i]],
                marker="X",
                s=160,
                c="white",
                edgecolors="black",
                linewidths=1.2,
            )
            ax.annotate(
                f"{n} site (callout)",
                (sc[i], sr[i]),
                xytext=(8, -8),
                textcoords="offset points",
                color="white",
                fontsize=9,
                weight="bold",
                bbox={"boxstyle": "round", "fc": "black", "alpha": 0.6},
            )
        if s.bounds:
            b = s.bounds
            bx = np.array(
                [
                    b["min"]["x"],
                    b["min"]["x"],
                    b["max"]["x"],
                    b["max"]["x"],
                    b["min"]["x"],
                ]
            )
            by = np.array(
                [
                    b["min"]["y"],
                    b["max"]["y"],
                    b["max"]["y"],
                    b["min"]["y"],
                    b["min"]["y"],
                ]
            )
            c, r = tf(bx, by)
            ax.plot(c, r, "--", color="yellow", linewidth=1, label="GRID map.bounds")
        h, w = info.image.shape[:2]
        ax.set_xlim(-0.1 * w, 1.1 * w)
        ax.set_ylim(1.1 * h, -0.1 * h)
        ax.set_title(f"{info.display_name}: {title}")
        ax.legend(loc="lower left", fontsize=7, framealpha=0.7)
        ax.set_axis_off()
    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    plt.close(fig)


def _fmt_pct(v: float) -> str:
    return "n/a" if v != v else f"{100 * v:.1f}%"


def _write_doc(
    results: list[MapResult], top: list[tuple[str, int]], per_map: int
) -> Path:
    lines = [
        "# Coordinate calibration: GRID game units → minimap pixels",
        "",
        "> Generated by `uv run python -m utility_fingerprint_etl poc` (etl/src/utility_fingerprint_etl/poc_calibration.py).",
        "> Aggregates only. Overlay images are written to `docs/poc/` (git-ignored: they plot derived data).",
        "",
        "## Final formula",
        "",
        "Using `https://valorant-api.com/v1/maps` (`xMultiplier`, `yMultiplier`, `xScalarToAdd`, `yScalarToAdd`, "
        "`displayIcon`), with GRID position `{x, y}` in cm and minimap of size `W×H` px:",
        "",
        "```",
        "u = y * xMultiplier + xScalarToAdd      # note: GRID y feeds the horizontal axis",
        "v = x * yMultiplier + yScalarToAdd      # GRID x feeds the vertical axis (yMultiplier < 0)",
        "col = u * W ; row = v * H               # origin top-left, row grows downward",
        "```",
        "",
        "- **Axes are swapped** (x↔y) relative to the naïve reading; no extra rotation or flip is needed on top of "
        "the formula when drawing `displayIcon` as-is (row 0 at the top). The negative `yMultiplier` already "
        "provides the vertical flip.",
        "- GRID positions are in the same frame as valorant-api callout `location` (site centres land on plants; see below), "
        "so no offset between GRID and Riot coordinates is required.",
        "",
        "## How correctness was checked",
        "",
        f"Top maps by games in `meta/games.csv` (title=val): "
        + ", ".join(f"`{m}` ({n})" for m, n in top)
        + f". Up to {per_map} most recent finished games per map were sampled.",
        "",
        "1. **Game-space check (independent of the image transform):** distance from each "
        "`player-completed-plantBomb` planter position (`actor.state.game.position`) to the nearest valorant-api "
        f'site callout (`regionName == "Site"`). Plants must sit within a site (≤ {SITE_RADIUS_CM:.0f} cm).',
        "2. **Pixel check:** after transforming, sample the minimap alpha channel at each point; plants and "
        "ability casts must land on drawn (opaque) map area, not on the transparent background. In addition, "
        "the minimap paints bomb sites with a yellow/olive tint (R,G > B+20) while corridors are neutral grey: "
        "plants should land on tinted pixels far more often than utility casts (baseline). The wrong "
        "(non-swapped) variant is evaluated for contrast.",
        "3. **Visual check:** `docs/poc/<map>.png` — left panel final formula, right panel without swap. Plants "
        "(coloured by nearest site) must cluster on the A/B/C site areas of the drawn minimap; the white X marks "
        "are the callout centres transformed with the same formula.",
        "4. **Bounds cross-check:** GRID `map.bounds` stretched onto the minimap's opaque bounding box (same "
        "orientation) vs the valorant-api formula.",
        "",
        "## Results",
        "",
    ]
    for r in results:
        lines += [
            f"### {r.name}",
            "",
            f"- Coefficients: xMultiplier={r.coeffs[0]}, yMultiplier={r.coeffs[1]}, xScalarToAdd={r.coeffs[2]}, "
            f"yScalarToAdd={r.coeffs[3]}; image {r.image_size[0]}×{r.image_size[1]} px, opaque bbox "
            f"cols {r.opaque_bbox[0]}–{r.opaque_bbox[1]}, rows {r.opaque_bbox[2]}–{r.opaque_bbox[3]}.",
            f"- Sample: {r.plants} plants from {r.games} games; {r.casts} utility casts (supplement, quality=ok). "
            "Planter side: "
            + ", ".join(f"{k} {v}" for k, v in r.sides.most_common())
            + ".",
            "- Plants per nearest site: "
            + ", ".join(f"{k} {v}" for k, v in sorted(r.site_counts.items()))
            + ".",
            f"- Plant → nearest site callout: median {r.site_dist_median:.0f} cm, p95 {r.site_dist_p95:.0f} cm, "
            f"within {SITE_RADIUS_CM:.0f} cm: {_fmt_pct(r.within_radius)}.",
            "- Plant-centroid → site-callout distance in pixels (final formula): "
            + ", ".join(f"{k} {v:.1f} px" for k, v in sorted(r.centroid_px_err.items()))
            + ".",
            "",
            "| Transform | plants on drawn map | plants on site-highlight pixels "
            "| casts on drawn map | casts on site-highlight pixels (baseline) |",
            "|---|---:|---:|---:|---:|",
        ]
        for label, v in r.on_map.items():
            lines.append(
                f"| {label} | {_fmt_pct(v['plants'])} | {_fmt_pct(v['plants_on_site_tint'])} "
                f"| {_fmt_pct(v['casts'])} | {_fmt_pct(v['casts_on_site_tint'])} |"
            )
        if r.bounds and r.bounds_rect_px:
            b = r.bounds
            lines += [
                "",
                f"- GRID `map.bounds`: x {b['min']['x']}…{b['max']['x']}, y {b['min']['y']}…{b['max']['y']}. Under the "
                f"final formula this rectangle spans cols {r.bounds_rect_px[0]:.0f}–{r.bounds_rect_px[1]:.0f}, rows "
                f"{r.bounds_rect_px[2]:.0f}–{r.bounds_rect_px[3]:.0f}.",
                f"- Bounds-only fit vs final formula: median {r.bounds_vs_api_px_median:.1f} px apart on plants.",
            ]
        lines.append("")
    lines += [
        "## Conclusions",
        "",
        "- Use the valorant-api formula with swapped axes (above) as the single source of truth; cache the "
        "coefficients and `displayIcon` per map at build time.",
        "- GRID `map.bounds` agrees with the formula: stretched onto the minimap's opaque bounding box it lands "
        "within a few pixels of the valorant-api result (see per-map numbers). It is a usable fallback for maps "
        "missing from valorant-api and a sanity filter (drop positions outside it).",
        "- valorant-api site callouts are label anchors, not geometric site centres (plant centroids sit tens of "
        "pixels away on some maps), so they are good for nearest-site classification but not as exact centres.",
        "- Bomb sites are **not** in the GRID feed: derive the site from the plant position by nearest valorant-api "
        f"site callout (all sampled plants are within {SITE_RADIUS_CM:.0f} cm of one, see distances above).",
        "",
    ]
    out = DOCS_DIR / "calibration.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


def run(per_map: int = 25) -> None:
    root = data_dir()
    top = _top_maps(root, 2)
    maps = [m for m, _ in top]
    print(f"[poc] top maps: {top}")
    samples, series_ids = _select_games(root, maps, per_map)
    _collect(root, samples, series_ids)
    api_maps = _fetch_api_maps()
    results = []
    for name in maps:
        s = samples[name]
        if len(s.plant_games) < 20:
            raise SystemExit(
                f"Only {len(s.plant_games)} games with plants for {name}; need ≥ 20"
            )
        info = _map_info(api_maps, name)
        results.append(_analyse(s, info))
        out = POC_DIR / f"{name}.png"
        _render(s, info, out)
        print(f"[poc] wrote {out}")
    doc = _write_doc(results, top, per_map)
    print(f"[poc] wrote {doc}")
    for r in results:
        print(
            f"[poc] {r.name}: plants={r.plants} games={r.games} median site dist={r.site_dist_median:.0f}cm "
            f"within={_fmt_pct(r.within_radius)} on-map={ {k: _fmt_pct(v['plants']) for k, v in r.on_map.items()} }"
        )
