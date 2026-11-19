import type { DataIndex, ReportIndexEntry, TeamFile, TeamReport } from "./types";

// Where the aggregate JSON lives: same-origin `/data` by default; NEXT_PUBLIC_DATA_BASE_URL (inlined at build
// time) lets the data be hosted elsewhere, e.g. https://example.com/uf-data (no trailing slash needed).
const DATA_BASE = (process.env.NEXT_PUBLIC_DATA_BASE_URL || "/data").replace(/\/+$/, "");

/** URL of a file under the active data base, e.g. dataUrl("index.json") → "/data/index.json". */
export function dataUrl(path: string): string {
  return `${DATA_BASE}/${path}`;
}

// Team files are fetched on demand (~31 MB of team JSON, ~32 MB including reports) and memoized per session.
let indexPromise: Promise<DataIndex> | null = null;
const teamCache = new Map<string, Promise<TeamFile>>();

// The ETL rewrites public/data in place, so a 404/5xx or a half-written file can be transient.
const RETRY_DELAYS_MS = [700, 1800];

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

async function getJson<T>(url: string): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const res = await fetch(url, attempt > 0 ? { cache: "no-store" } : undefined);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

class NotFound extends Error {}

/**
 * Like getJson, but a 404 resolves to null at once (no retry): reports only exist for some teams and
 * the `reports/` folder may be missing entirely. Other failures retry as usual.
 */
async function getOptionalJson<T>(url: string): Promise<T | null> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await wait(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const res = await fetch(url, attempt > 0 ? { cache: "no-store" } : undefined);
      if (res.status === 404) throw new NotFound(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof NotFound) return null;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function loadIndex(): Promise<DataIndex> {
  if (!indexPromise) {
    indexPromise = getJson<DataIndex>(`${DATA_BASE}/index.json`).catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

export function loadTeam(teamId: string): Promise<TeamFile> {
  let p = teamCache.get(teamId);
  if (!p) {
    p = getJson<TeamFile>(`${DATA_BASE}/teams/${encodeURIComponent(teamId)}.json`).catch((err) => {
      teamCache.delete(teamId);
      throw err;
    });
    teamCache.set(teamId, p);
  }
  return p;
}

let reportIndexPromise: Promise<ReportIndexEntry[]> | null = null;
const reportCache = new Map<string, Promise<TeamReport | null>>();

/** Teams with a report; [] when `reports/index.json` does not exist. */
export function loadReportIndex(): Promise<ReportIndexEntry[]> {
  if (!reportIndexPromise) {
    reportIndexPromise = getOptionalJson<ReportIndexEntry[]>(`${DATA_BASE}/reports/index.json`).then(
      (list) => (Array.isArray(list) ? list : []),
      (err) => {
        reportIndexPromise = null;
        throw err;
      },
    );
  }
  return reportIndexPromise;
}

/** null = no report for this team (404). */
export function loadReport(teamId: string): Promise<TeamReport | null> {
  let p = reportCache.get(teamId);
  if (!p) {
    p = getOptionalJson<TeamReport>(`${DATA_BASE}/reports/${encodeURIComponent(teamId)}.json`).catch((err) => {
      reportCache.delete(teamId);
      throw err;
    });
    reportCache.set(teamId, p);
  }
  return p;
}
