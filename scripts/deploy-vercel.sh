#!/usr/bin/env bash
# Deploy the static export (web/out, including the aggregate JSON in web/out/data) to Vercel.
#
# The aggregate JSON is git-ignored (derived from licensed GRID data), so a git-connected Vercel build would ship
# without data. Instead this script builds locally and uploads the finished folder as a plain static site.
#
# ONLY run this after the organizers have allowed hosting aggregate stats publicly (see docs/organizer-question.md
# and docs/deploy.md). The script refuses to deploy unless UF_ORGANIZER_APPROVED=yes is set for this command.
#
# Usage (from anywhere):
#   scripts/deploy-vercel.sh --check            # verify data + build the export, do not deploy
#   UF_ORGANIZER_APPROVED=yes scripts/deploy-vercel.sh            # preview deployment
#   UF_ORGANIZER_APPROVED=yes scripts/deploy-vercel.sh --prod     # production deployment
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WEB="$ROOT/web"
OUT="$WEB/out"
MODE=preview
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --prod) MODE=production ;;
    --check) CHECK_ONLY=1 ;;
    *) echo "deploy-vercel: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f "$WEB/public/data/index.json" ]; then
  echo "deploy-vercel: web/public/data/index.json not found. Run the ETL first:" >&2
  echo "  cd etl && STL_DATA_DIR=/path/to/grid-starter uv run python -m utility_fingerprint_etl build" >&2
  exit 1
fi
if [ ! -f "$WEB/public/data/reports/index.json" ]; then
  echo "deploy-vercel: warning: no scouting reports (web/public/data/reports/index.json); the Report tab will be empty." >&2
fi

if [ "$CHECK_ONLY" -eq 0 ] && [ "${UF_ORGANIZER_APPROVED:-}" != "yes" ]; then
  echo "deploy-vercel: refusing to deploy. Hosting derived GRID aggregates needs the organizers' OK" >&2
  echo "(docs/organizer-question.md). Once allowed, re-run with UF_ORGANIZER_APPROVED=yes." >&2
  exit 1
fi

echo "deploy-vercel: building static export…"
(cd "$WEB" && pnpm build)
for f in index.html data/index.json; do
  if [ ! -f "$OUT/$f" ]; then
    echo "deploy-vercel: build output is missing out/$f" >&2
    exit 1
  fi
done
# Headers (cache + noindex for /data) travel with the uploaded folder.
cp "$WEB/vercel.json" "$OUT/vercel.json"
echo "deploy-vercel: export ready in web/out"

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "deploy-vercel: --check only, not deploying."
  exit 0
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "deploy-vercel: the Vercel CLI is not installed (pnpm add -g vercel, then vercel login)." >&2
  exit 1
fi
# The export wipes out/.vercel, so re-link on every run (project name: UF_VERCEL_PROJECT).
(cd "$OUT" && vercel link --yes --project "${UF_VERCEL_PROJECT:-utility-fingerprint}")
# `vercel link` writes .env.local (OIDC token) + .gitignore into the folder; never upload them.
rm -f "$OUT"/.env* "$OUT/.gitignore"
if [ "$MODE" = production ]; then
  (cd "$OUT" && vercel deploy --yes --prod)
else
  (cd "$OUT" && vercel deploy --yes)
fi
