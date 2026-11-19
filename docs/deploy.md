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

## Organizer decision first

Hosting depends on the organizers' answer to
[our forum question](https://cloud9.devpost.com/forum_topics/45930-hosting-a-public-demo-with-aggregate-stats-derived-from-grid-data-allowed)
(text in `organizer-question.md`; status: **pending**). The data license forbids making "the Data, or any part or
derivative of it" available to third parties, while allowing results, statistics and charts to be shown to
judges and organizers.

| Answer | What we ship |
|---|---|
| Hosting aggregate JSON allowed | Vercel deployment of `web/out/` (below); link in the Devpost submission. |
| Only screenshots / video allowed | Local demo (judges run the ETL on their own copy of the data) + demo video; screenshots in the README. |
| Neither allowed | Local demo + demo video; `docs/screenshots/` stays out of git and the README keeps the screenshot block commented out. |

Screenshots (`docs/screenshots/*.png`) show derived data, so until the answer they are git-ignored
(`/docs/screenshots/` in `.gitignore`) and rejected by `.githooks/pre-commit` (`^docs/screenshots/`). If
screenshots are allowed (first two rows only when the answer says so explicitly), re-enable them:

1. delete the `/docs/screenshots/` line (and its comment) from `.gitignore`;
2. remove `|^docs/screenshots/` from the `grep -E` pattern in `.githooks/pre-commit`;
3. uncomment the `<!-- TODO: enable after organizer answer … -->` block at the top of `README.md`;
4. `git add docs/screenshots/*.png README.md .gitignore .githooks/pre-commit` and check `git status` shows no
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

## Vercel (only after the organizers allow it)

`scripts/deploy-vercel.sh` builds the export, verifies `out/index.html` and `out/data/index.json`, copies
`web/vercel.json` into `out/` (headers: `Cache-Control: public, max-age=3600` and `X-Robots-Tag: noindex` for
`/data/*`, immutable caching for `/_next/static/*`) and uploads the folder with `vercel deploy out` as a plain
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
