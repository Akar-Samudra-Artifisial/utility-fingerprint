"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { LAST_TEAM_KEY } from "@/lib/url-state";
import { loadIndex, loadReport, loadReportIndex, loadTeam } from "./fetch";
import type { DataIndex, ReportIndexEntry, TeamFile, TeamReport } from "./types";

export type Load<T> = { key: string; data?: T; error?: string; retry: () => void };

type Raw<T> = Omit<Load<T>, "retry">;

export function useIndex(): Load<DataIndex> {
  const [state, setState] = useState<Raw<DataIndex>>({ key: "index" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadIndex().then(
      (data) => alive && setState({ key: "index", data }),
      (e: unknown) => alive && setState({ key: "index", error: String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setState({ key: "index" });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

export function useTeam(teamId: string): Load<TeamFile> {
  const [state, setState] = useState<Raw<TeamFile>>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadTeam(teamId).then(
      (data) => alive && setState({ key: teamId, data }),
      (e: unknown) => alive && setState({ key: teamId, error: String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [teamId, attempt]);
  const retry = useCallback(() => {
    setState({ key: "" });
    setAttempt((n) => n + 1);
  }, []);
  // Ignore a stale result while the next team is loading.
  return state.key === teamId ? { ...state, retry } : { key: teamId, retry };
}

export function useReportIndex(): Load<ReportIndexEntry[]> {
  const [state, setState] = useState<Raw<ReportIndexEntry[]>>({ key: "reports" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadReportIndex().then(
      (data) => alive && setState({ key: "reports", data }),
      (e: unknown) => alive && setState({ key: "reports", error: String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    setState({ key: "reports" });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

/** `data === null` means the team has no report (404), which is not an error. */
export function useReport(teamId: string): Load<TeamReport | null> {
  const [state, setState] = useState<Raw<TeamReport | null>>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadReport(teamId).then(
      (data) => alive && setState({ key: teamId, data }),
      (e: unknown) => alive && setState({ key: teamId, error: String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [teamId, attempt]);
  const retry = useCallback(() => {
    setState({ key: "" });
    setAttempt((n) => n + 1);
  }, []);
  return state.key === teamId ? { ...state, retry } : { key: teamId, retry };
}

function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

/** Last team opened on the map tab (used to pick a compare opponent when Team A is Cloud9). */
export function useLastViewedTeam(): string | null {
  return useSyncExternalStore(
    subscribeStorage,
    () => {
      try {
        return window.localStorage.getItem(LAST_TEAM_KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
}

export function rememberTeam(teamId: string) {
  try {
    window.localStorage.setItem(LAST_TEAM_KEY, teamId);
  } catch {
    // storage disabled (private mode); the fallback opponent is used instead
  }
}
