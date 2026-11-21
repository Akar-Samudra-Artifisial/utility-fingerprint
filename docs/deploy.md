# Deploying the demo

The web app is a **static export** (`output: "export"` in `web/next.config.ts`): `pnpm build` writes a
self-contained site to `web/out/` with `index.html`, the JS bundles and a copy of `web/public/data/` (the
aggregate JSON: ~31 MB team JSON, ~32 MB including reports; ~33 MB for the whole export). All dashboard state lives in the URL and is read on the client, so
nothing needs a server: no API routes, no server actions, no image optimisation.

Why a static export instead of a regular Vercel Next.js build:

- The aggregate JSON is derived from licensed GRID data and is **git-ignored** (`/web/public/data/`,
  `/web/out/`, plus the pre-commit hook). A git-connected Vercel build would therefore ship **without data**.
  Building locally and uploading the finished folder is the only way the data reaches the host, and it keeps
  the upload an explicit, deliberate step.
- The same `web/out/` folder works on Vercel, any static host and for a fully local demo, so there is one build
  path to test.
- `cacheComponents` / `partialPrefetching` were removed from the Next config because PPR cannot run in export
  mode; the single client-rendered route used neither.

## Organizer decision

We asked the organizers in
[our forum question](https://cloud9.devpost.com/forum_topics/45930-hosting-a-public-demo-with-aggregate-stats-derived-from-grid-data-allowed)
(text and verbatim answer in `organizer-question.md`; status: **answered 2026-11-21, allowed**). The aggregate
stats count as a derived dataset, but showing results, statistics and charts in the hosted demo, screenshots and
the demo video is permitted use under section 4(b) of the data license.

| Answer | What we ship |
|---|---|
| **Hosting aggregate JSON allowed (selected, 2026-11-21)** | Vercel deployment of `web/out/` (below); link in the Devpost submission. |
| Only screenshots / video allowed | Local demo (judges run the ETL on their own copy of the data) + demo video; screenshots in the README. |
| Neither allowed | Local demo + demo video; `docs/screenshots/` stays out of git and the README keeps the screenshot block commented out. |

Compliance with section 4(b) ("include only the small excerpts of the Data reasonably necessary … load the Data
from the GRID repository rather than bundling it"):

- Only the aggregate JSON and the scouting reports are hosted (`web/out/data/`). No raw GRID data, no
  decompressed feeds, no Parquet or other intermediate files are hosted or committed.
- The raw data is never bundled: the ETL loads it from the user's copy of the GRID repository
  (`STL_DATA_DIR`).
- The whole site, including `/data/*`, sends `X-Robots-Tag: noindex` (`web/vercel.json`), so the demo and
  its aggregates are not indexed by search engines.

Screenshots (`docs/screenshots/*.png`) are allowed by the answer and are no longer git-ignored or blocked by
`.githooks/pre-commit`; the screenshot block at the top of `README.md` is enabled. To publish them:
`git add docs/screenshots/*.png README.md .gitignore .githooks/pre-commit` and check `git status` shows no
other data.

## Local static demo

```bash
# 1. data: cd etl && STL_DATA_DIR=/path/to/grid-starter uv run python -m utility_fingerprint_etl build
cd web
pnpm install
pnpm export          # next build + checks out/index.html and out/data/index.json exist
pnpm serve:static    # python3 http.server on http://127.0.0.1:4173 (Ctrl+C to stop)
```

`pnpm start` is an alias for `pnpm serve:static` (`next start` does not work with a static export). Any static
server works, e.g. `npx serve out`. Useful URLs: `/`, `/?tab=report&team=79`, `/?tab=operator&team=79`,
`/data/teams/79.json`.

## Vercel (allowed by the organizers, 2026-11-21)

`scripts/deploy-vercel.sh` builds the export, verifies `out/index.html` and `out/data/index.json`, copies
`web/vercel.json` into `out/` (headers: `X-Robots-Tag: noindex` on every path, `Cache-Control: public,
max-age=3600` for `/data/*`, immutable caching for `/_next/static/*`), re-links the folder to the Vercel project
(`UF_VERCEL_PROJECT`, default `utility-fingerprint`), removes the `.env*` file that `vercel link` writes, and
uploads the folder with `vercel deploy --yes` as a plain
static site (no build runs on Vercel).

```bash
scripts/deploy-vercel.sh --check                          # data check + export only, never deploys
UF_ORGANIZER_APPROVED=yes scripts/deploy-vercel.sh        # preview deployment
UF_ORGANIZER_APPROVED=yes scripts/deploy-vercel.sh --prod # production deployment
```

Without `UF_ORGANIZER_APPROVED=yes` the script refuses to deploy. It needs the Vercel CLI (`vercel login`
once); the first deploy asks which Vercel project to link to.

## Hosting the data separately (optional)

`NEXT_PUBLIC_DATA_BASE_URL` (read at build time, default `/data`) points the app at another location for
`index.json`, `teams/` and `reports/`, e.g. a storage bucket that only judges can reach:

```bash
NEXT_PUBLIC_DATA_BASE_URL=https://example.com/uf-data pnpm build
```

The other host must allow CORS for the app's origin. `web/public/data/` is still copied into `out/`; delete
`out/data` before uploading if the data must not live on the app host.
