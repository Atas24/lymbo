// Thin typed wrappers around the Rust commands in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";
import type {
  AiResult, AgentName, Application, CoverLetter, Edit, JobLink, LoginOutcome, Resume, ResumeLine, ResumeVersion,
  SessionStatus, Settings, Stats,
} from "./types";

export const api = {
  sessionStart: () => invoke<SessionStatus>("session_start"),
  sessionKill: () => invoke<SessionStatus>("session_kill"),
  sessionStatus: () => invoke<SessionStatus>("session_status"),

  apiKeyStatus: () => invoke<boolean>("api_key_status"),
  apiKeySet: (key: string) => invoke<void>("api_key_set", { key }),
  apiKeyRemove: () => invoke<void>("api_key_remove"),

  /** tier "fast" = cheap model (KASPR's skimming/scoring), "smart" = stronger model (SONNY's writing). */
  /** cache=false forces a fresh answer (e.g. a new cover letter draft); otherwise repeats are free. */
  ai: (agent: AgentName, system: string, prompt: string, maxTokens?: number, tier: "fast" | "smart" = "smart", cache = true) =>
    invoke<AiResult>("ai_complete", { agent, system, prompt, maxTokens, tier, cache, json: false }),
  /** Same, but the model must answer with a JSON object (enforced by the API, so it always parses). */
  aiJson: (agent: AgentName, system: string, prompt: string, maxTokens?: number, tier: "fast" | "smart" = "smart") =>
    invoke<AiResult>("ai_complete", { agent, system, prompt, maxTokens, tier, cache: true, json: true }),

  modelsList: () => invoke<string[]>("models_list"),

  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<void>("settings_set", { settings }),

  resumes: () => invoke<Resume[]>("resumes_list"),
  resumeAdd: (label: string, content: string) => invoke<number>("resume_add", { label, content }),
  resumeUploadPdf: (fileName: string, bytes: number[]) => invoke<number>("resume_upload_pdf", { fileName, bytes }),
  /** Original PDF bytes; rejects if the resume was pasted as text. */
  resumePdf: (id: number) => invoke<ArrayBuffer>("resume_pdf", { id }),
  resumeOpenPdf: (id: number) => invoke<void>("resume_open_pdf", { id }),
  resumeUploadDocx: (fileName: string, bytes: number[]) => invoke<number>("resume_upload_docx", { fileName, bytes }),
  resumeLines: (id: number) => invoke<ResumeLine[]>("resume_paragraphs", { id }),
  resumeOpenFile: (id: number, kind: "docx" | "pdf") => invoke<void>("resume_open_file", { id, kind }),

  versions: () => invoke<ResumeVersion[]>("versions_list"),
  versionCreate: (v: { baseResumeId: number; label: string; summary: string; edits: Edit[]; jobIds: string[]; keywords: string[] }) =>
    invoke<number>("version_create", v),
  versionApprove: (id: number, edits: Edit[]) => invoke<void>("version_approve", { id, edits }),
  versionArchive: (id: number) => invoke<void>("version_archive", { id }),
  versionDelete: (id: number) => invoke<void>("version_delete", { id }),
  resumeDelete: (id: number) => invoke<void>("resume_delete", { id }),
  coverLetterDelete: (id: number) => invoke<void>("cover_letter_delete", { id }),
  versionLearn: (id: number, jobId: string, keywords: string[]) => invoke<void>("version_learn", { id, jobId, keywords }),
  versionOpen: (id: number, kind: "docx" | "pdf") => invoke<void>("version_open", { id, kind }),
  versionPdf: (id: number) => invoke<ArrayBuffer>("version_pdf", { id }),
  versionExportPdf: (id: number) => invoke<void>("version_export_pdf", { id }),

  resumeSetCurrent: (id: number) => invoke<void>("resume_set_current", { id }),

  applications: () => invoke<Application[]>("applications_list"),
  applicationAdd: (company: string, title: string, url: string, notes: string, versionId: number | null = null) =>
    invoke<number>("application_add", { company, title, url, notes, versionId }),
  applicationSetStatus: (id: number, status: string) =>
    invoke<void>("application_set_status", { id, status }),

  coverLetters: () => invoke<CoverLetter[]>("cover_letters_list"),
  coverLetterAdd: (applicationId: number | null, company: string, content: string) =>
    invoke<number>("cover_letter_add", { applicationId, company, content }),

  stats: () => invoke<Stats>("stats_get"),
  workshopIncrement: () => invoke<void>("workshop_increment"),

  locationGet: () => invoke<{ text: string; parsed: string | null } | null>("location_get"),
  locationSet: (text: string, parsed: string | null) => invoke<void>("location_set", { text, parsed }),

  hsLoginStatus: () => invoke<{ email: string; method: string } | null>("handshake_login_status"),
  hsLoginSet: (email: string, password: string, method: string) =>
    invoke<void>("handshake_login_set", { email, password, method }),
  hsLoginRemove: () => invoke<void>("handshake_login_remove"),
  hsConnect: () => invoke<LoginOutcome>("handshake_connect"),
  hsApproveHost: (host: string) => invoke<void>("handshake_approve_host", { host }),
  hsCheck: () => invoke<boolean>("handshake_check"),
  hsSearch: (query: string) => invoke<JobLink[]>("handshake_search", { query }),
  hsLinksOnPage: () => invoke<JobLink[]>("handshake_links_on_page"),
  hsReadJob: (url: string) => invoke<{ url: string; text: string }>("handshake_read_job", { url }),
  hsOpen: (url: string) => invoke<void>("handshake_open", { url }),
  hsDisconnect: () => invoke<void>("handshake_disconnect"),
};

export async function currentResume(): Promise<Resume | undefined> {
  return (await api.resumes()).find((r) => r.is_current);
}

/** Tauri sends Rust's Err(String) through as a plain string. */
export function errText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong.";
}

/** Pulls the first JSON object out of a model reply. */
export function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw "The agent's reply wasn't in the expected format. Try again.";
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw "The agent's reply wasn't in the expected format. Try again.";
  }
}

export function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
}

export const fmtUsd = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
