// Agent logic that isn't tied to a single screen.
import { api, parseJson } from "./api";
import {
  KASPR_SYSTEM, SONNY_SYSTEM, kasprEvaluatePrompt, kasprLocationPrompt, kasprRankPrompt, kasprReadJobPrompt, kasprSearchPrompt,
  sonnyAlignmentPrompt,
} from "./prompts";
import type { JobContext, JobLink } from "./types";
import type { KeywordMatch } from "./keywords";

export interface KasprVerdict {
  score: number;
  recommend: boolean;
  reasons: string[];
}

export interface SonnyReview {
  verdict: "good" | "workshop";
  summary: string;
  missing: string[];
  irrelevant: string[];
  suggestions: { section: string; change: string; why: string }[];
}

export interface LocationFilters {
  places: string[];
  remote: "only" | "ok" | "no";
  relocate: boolean;
  summary: string;
}

/** KASPR reads the user's free-text answer about where they want to work. */
export async function kasprReadLocation(answer: string): Promise<LocationFilters> {
  const r = await api.aiJson("KASPR", KASPR_SYSTEM, kasprLocationPrompt(answer), 400, "fast");
  const v = parseJson<LocationFilters>(r.text);
  return { places: v.places ?? [], remote: v.remote ?? "ok", relocate: !!v.relocate, summary: v.summary || answer };
}

export async function kasprEvaluate(resume: string, job: JobContext, location: string): Promise<KasprVerdict> {
  const r = await api.aiJson("KASPR", KASPR_SYSTEM, kasprEvaluatePrompt(resume, job.title, job.company, job.description, location), 600, "fast");
  const v = parseJson<KasprVerdict>(r.text);
  return { score: Number(v.score) || 0, recommend: !!v.recommend, reasons: v.reasons ?? [] };
}

/** SONNY's AI review. The keyword check is done locally first and handed in, so SONNY only writes suggestions. */
export async function sonnyReview(resume: string, job: JobContext, match: KeywordMatch): Promise<SonnyReview> {
  const r = await api.aiJson(
    "SONNY", SONNY_SYSTEM,
    sonnyAlignmentPrompt(resume, job.title, job.company, job.description, match.covered, match.missing), 1500,
  );
  const v = parseJson<SonnyReview>(r.text);
  return {
    verdict: v.verdict === "workshop" ? "workshop" : "good",
    summary: v.summary ?? "",
    missing: match.missing,
    irrelevant: v.irrelevant ?? [],
    suggestions: v.suggestions ?? [],
  };
}

export async function kasprSuggestSearches(resume: string, location: string): Promise<string[]> {
  const r = await api.aiJson("KASPR", KASPR_SYSTEM, kasprSearchPrompt(resume, location), 400, "fast");
  return parseJson<{ queries: string[] }>(r.text).queries?.filter(Boolean).slice(0, 3) ?? [];
}

export interface ReadJob {
  job: JobContext & { location: string };
  verdict: KasprVerdict;
  /** Local keyword check against the full job page (no AI). */
  match: KeywordMatch;
}

/** Turns a raw Handshake page into a structured job and scores it, in one call. */
export async function kasprReadJob(
  resume: string, location: string, url: string, pageText: string, match: KeywordMatch,
): Promise<ReadJob> {
  const r = await api.aiJson("KASPR", KASPR_SYSTEM, kasprReadJobPrompt(resume, location, pageText), 900, "fast");
  const v = parseJson<{
    company: string; title: string; location: string; description: string;
    score: number; recommend: boolean; reasons: string[];
  }>(r.text);
  return {
    job: { company: v.company || "Unknown employer", title: v.title || "Untitled job", location: v.location || "", url, description: v.description || "" },
    verdict: { score: Number(v.score) || 0, recommend: !!v.recommend, reasons: v.reasons ?? [] },
    match,
  };
}

/** One cheap call over search-result titles, so KASPR only opens jobs that could fit. */
export async function kasprRank(resume: string, location: string, links: JobLink[]): Promise<JobLink[]> {
  if (links.length <= 2) return links;
  const listing = links.map((l) => `${l.id}: ${l.text || "(no title shown)"}`).join("\n");
  const r = await api.aiJson("KASPR", KASPR_SYSTEM, kasprRankPrompt(resume, location, listing), 600, "fast");
  const ids = parseJson<{ open: string[] }>(r.text).open ?? [];
  const byId = new Map(links.map((l) => [l.id, l]));
  return ids.map((id) => byId.get(String(id))).filter((l): l is JobLink => !!l);
}
