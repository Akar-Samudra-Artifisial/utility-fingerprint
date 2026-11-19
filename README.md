# Utility Fingerprint

VALORANT tactical scouting for **Sky's The Limit 2026 — Cloud9 x JetBrains Hackathon** (category: VALORANT
Tactical Scouting). Utility Fingerprint turns GRID match feeds and the ability-cast supplement into a per-team
"fingerprint" of where and when they use utility, drawn on the minimap, plus an LLM-written scouting report.

## Layout

| Path | What |
|---|---|
| `etl/` | Python 3.12+ ETL (uv, Polars, zstandard). Streams GRID `.jsonl.zst` → small aggregate JSON for the web app. |
| `web/` | Next.js (App Router, TypeScript, Tailwind) front end; canvas 2D minimap. |
| `docs/` | Data schema, calibration notes, AI workflow log. `docs/poc/` is git-ignored (derived data). |

## Data (never committed)

The GRID data is licensed for the hackathon only and must not be committed or redistributed. Clone the official
data repo **next to** this repo and point `STL_DATA_DIR` at it:

```bash
cp .env.example .env            # then edit STL_DATA_DIR
export STL_DATA_DIR=/path/to/stl-hackathon-2026-grid-starter
```

If `STL_DATA_DIR` is unset the ETL falls back to `../stl-hackathon-2026-grid-starter`.

Enable the guard hook once per clone (blocks staging `*.zst`, `*.jsonl`, `*.parquet`, `data/`):

```bash
git config core.hooksPath .githooks
```

## ETL

```bash
cd etl
uv sync
uv run python -m utility_fingerprint_etl inspect   # → docs/data-schema.md
uv run python -m utility_fingerprint_etl poc       # → docs/calibration.md, docs/poc/<map>.png
```

Full pipeline (all series → `data/parquet/` → aggregated JSON in `web/public/data/`, both git-ignored):

```bash
uv run python -m utility_fingerprint_etl build            # resumable; --force re-extracts, --limit N for dev
uv run python -m utility_fingerprint_etl build --aggregate-only
uv run pytest
```

See `docs/data-pipeline.md` for tables, phase/side definitions and licensing notes.

`poc` downloads minimaps and coefficients from https://valorant-api.com into `etl/.cache/` (git-ignored).

## Web

```bash
cd web
pnpm install
pnpm dev      # http://localhost:3000
pnpm build
```

## License

Code: MIT (see `LICENSE`). Match data: © GRID eSports GmbH / Riot Games / Cloud9, not included. This project is
not endorsed by Riot Games.
