import type { DataIndex, TeamFile } from "./types";

// Team files are fetched on demand (the full set is ~28 MB) and memoized per session.
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

export function loadIndex(): Promise<DataIndex> {
  if (!indexPromise) {
    indexPromise = getJson<DataIndex>("/data/index.json").catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

export function loadTeam(teamId: string): Promise<TeamFile> {
  let p = teamCache.get(teamId);
  if (!p) {
    p = getJson<TeamFile>(`/data/teams/${encodeURIComponent(teamId)}.json`).catch((err) => {
      teamCache.delete(teamId);
      throw err;
    });
    teamCache.set(teamId, p);
  }
  return p;
}
