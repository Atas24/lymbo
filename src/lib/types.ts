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
