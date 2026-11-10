export interface SessionStatus {
  active: boolean;
  elapsed_secs: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface Settings {
  model: string;
  fast_model: string;
  fast_input_price_per_mtok: number;
  fast_output_price_per_mtok: number;
  spend_limit_usd: number;
  input_price_per_mtok: number;
  output_price_per_mtok: number;
}

export interface Resume {
  id: number;
  has_docx: boolean;
  has_pdf: boolean;
  label: string;
  content: string;
  is_current: boolean;
  created_at: string;
}

export interface Application {
  id: number;
  company: string;
  title: string;
  url: string;
  status: string;
  notes: string;
  applied_at: string;
}

export interface CoverLetter {
  id: number;
  application_id: number | null;
  company: string;
  content: string;
  created_at: string;
}

export interface Stats {
  applied_count: number;
  workshop_sessions: number;
  seconds_applying: number;
  lifetime_cost_usd: number;
}

export interface AiResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  session: SessionStatus;
}

/** A job as KASPR sees it, and as it gets handed to SONNY. */
export interface JobContext {
  company: string;
  title: string;
  url: string;
  description: string;
  /** KASPR's id for the job (Handshake id, or "pasted-<time>"), when there is one. */
  id?: string;
  /** What to do when this job is handed to SONNY (e.g. draft a cover letter right away). */
  want?: "letter";
}

export interface JobLink {
  id: string;
  url: string;
  text: string;
}

export interface LoginOutcome {
  status: "logged_in" | "needs_user" | "needs_approval";
  message: string;
  host: string | null;
}

export type AgentName = "KASPR" | "SONNY";
export type Page = "control" | "kaspr" | "sonny" | "settings";

export const APPLICATION_STATUSES = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;

/** One change SONNY proposes to a line (paragraph) of the .docx resume. */
export interface Edit {
  p: number;
  op: "replace" | "insert_after" | "delete" | "move_after";
  text?: string;
  /** For move_after: the line this one goes right after. */
  after?: number;
  why?: string;
}

export interface ResumeLine {
  p: number;
  text: string;
  locked: boolean;
}

/** A tailored copy of the .docx resume for one kind of role. */
export interface ResumeVersion {
  id: number;
  base_resume_id: number;
  label: string;
  summary: string;
  status: "pending" | "approved";
  edits: Edit[];
  job_ids: string[];
  /** keyword -> how many matched jobs asked for it */
  keywords: Record<string, number>;
  text: string;
  created_at: string;
  applied: number;
  interviewing: number;
  has_pdf: boolean;
}
