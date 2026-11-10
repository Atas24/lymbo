import { createContext, useContext } from "react";
import type { AgentName, JobContext, Page, SessionStatus } from "./types";

export interface Toast {
  id: number;
  from?: AgentName;
  text: string;
  tone?: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

/** A job KASPR read: one you opened on Handshake, or one you pasted in. */
export interface SeenJob {
  /** Handshake's job id, or "pasted-<time>". */
  id: string;
  /** description = the whole posting as KASPR read it */
  job: JobContext;
  seenAt: number;
  /** Which version of KASPR's page reader read it; older reads get read again. */
  reader?: number;
}

/** Bump when KASPR's page reader improves, so jobs read the old way are read again. */
export const READER_VERSION = 4;

export interface KasprState {
  conn: "off" | "connecting" | "needs_user" | "needs_approval" | "on";
  connMsg: string;
  pendingHost: string | null;
  /** Jobs KASPR has read, newest first. */
  seen: SeenJob[];
  /** Id of the job open in the Chrome window right now. */
  onScreen: string | null;
  /** A job you picked from the list; null = show whatever's on screen. */
  pinned: string | null;
}

export const KASPR_INITIAL: KasprState = {
  conn: "off", connMsg: "", pendingHost: null, seen: [], onScreen: null, pinned: null,
};

export interface AppCtx {
  kaspr: KasprState;
  setKaspr: (patch: Partial<KasprState>) => void;
  /** Adds a job KASPR read (or you pasted) to the top of the list. */
  addSeen: (j: SeenJob) => void;
  /** Starts the guided tour (also from Settings). */
  startTour: () => void;
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
