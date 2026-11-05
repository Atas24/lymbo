import { createContext, useContext } from "react";
import type { AgentName, JobContext, JobLink, Page, SessionStatus } from "./types";
import type { ReadJob } from "./agents";

export interface Toast {
  id: number;
  from?: AgentName;
  text: string;
  tone?: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

export interface KasprState {
  conn: "off" | "connecting" | "needs_user" | "needs_approval" | "on";
  connMsg: string;
  pendingHost: string | null;
  suggestions: string[];
  queue: JobLink[];
  index: number;
  current: ReadJob | null;
}

export const KASPR_INITIAL: KasprState = {
  conn: "off", connMsg: "", pendingHost: null, suggestions: [], queue: [], index: 0, current: null,
};

export interface AppCtx {
  kaspr: KasprState;
  setKaspr: (patch: Partial<KasprState>) => void;
  session: SessionStatus;
  refreshSession: () => Promise<void>;
  startSession: () => Promise<void>;
  killSession: () => Promise<void>;
  hasKey: boolean;
  refreshKey: () => Promise<void>;
  notify: (t: Omit<Toast, "id">) => void;
  setBusy: (agent: AgentName, busy: boolean) => void;
  go: (page: Page) => void;
  /** Job KASPR handed to SONNY for a workshop. */
  workshopJob: JobContext | null;
  setWorkshopJob: (j: JobContext | null) => void;
  /** Where the user said they want to work, confirmed this session (null = KASPR still needs to ask). */
  location: { text: string; summary: string } | null;
  setLocation: (l: { text: string; summary: string } | null) => void;
  /** Bumped whenever Control Room data changes, so views can reload. */
  dataVersion: number;
  bumpData: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
