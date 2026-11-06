import { createContext, useContext } from "react";
import type { AgentName, JobContext, JobLink, Page, SessionStatus } from "./types";
import type { KeywordMatch } from "./keywords";

export interface Toast {
  id: number;
  from?: AgentName;
  text: string;
  tone?: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

/** A job from KASPR's search. Listed right away; KASPR fills in the details as it reads each page. */
export interface BatchJob {
  link: JobLink;
  /** Title/company come from the search listing; description from the job page once read. */
  job: JobContext & { location: string };
  read: boolean;
  failed: boolean;
  /** When KASPR finished reading it; jobs are shown in this order. */
  readAt: number | null;
  /** Trimmed text of the job page, for local keyword matching. */
  pageText: string;
  /** Local keyword check against your resume (null until read). */
  match: KeywordMatch | null;
  /** Version to use (approved), or SONNY's proposed version still waiting for the user's OK. */
  versionId: number | null;
  /** Keyword coverage of the chosen version, 0-1. */
  versionCoverage: number | null;
}

export interface KasprState {
  conn: "off" | "connecting" | "needs_user" | "needs_approval" | "on";
  connMsg: string;
  pendingHost: string | null;
  jobs: BatchJob[];
  selectedId: string | null;
  /** Background reading of the job pages. */
  reading: "idle" | "reading" | "paused";
}

export const KASPR_INITIAL: KasprState = {
  conn: "off", connMsg: "", pendingHost: null, jobs: [], selectedId: null, reading: "idle",
};

export interface AppCtx {
  kaspr: KasprState;
  setKaspr: (patch: Partial<KasprState>) => void;
  /** Update jobs from the latest state (safe while KASPR reads in the background). */
  updateJobs: (fn: (jobs: BatchJob[]) => BatchJob[]) => void;
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
