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

Scouting reports (Claude, from the aggregate JSON only; every number written in a claim must match a cited
fact; qualitative wording is not machine-checked, see `docs/data-pipeline.md`):

```bash
uv run python -m utility_fingerprint_etl report --teams 79,3429 --dry-run   # fact sheets + prompts, no LLM
ANTHROPIC_API_KEY=... uv run python -m utility_fingerprint_etl report --teams 79,3429
uv run python -m utility_fingerprint_etl report --top 20     # Cloud9, Cloud9 GC, then most games; cached
uv run python -m utility_fingerprint_etl report --top 20 --check   # re-validate written reports
```

Without `ANTHROPIC_API_KEY` the command falls back to the Claude Code CLI (`claude -p`). Pass the key inline
for this one command as above. **Do not `export ANTHROPIC_API_KEY` in the shell where Claude Code runs:** Claude
Code would then bill that key instead of your subscription. Model: `claude-sonnet-5-5` (`UF_REPORT_MODEL` to
override); `--force` ignores the cache.

See `docs/data-pipeline.md` for tables, phase/side definitions, the report validator and licensing notes.

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
