// Agent logic that isn't tied to a single screen.
import { api, parseJson } from "./api";
import { SONNY_SYSTEM, sonnyAlignmentPrompt, sonnyBatchPrompt, type BatchGroupInput } from "./prompts";
import type { Edit, JobContext, ResumeLine } from "./types";
import { GENERIC, type KeywordMatch } from "./keywords";

export interface SonnyReview {
  verdict: "good" | "workshop";
  summary: string;
  missing: string[];
  irrelevant: string[];
  suggestions: { section: string; change: string; why: string }[];
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

export interface SonnyGroup {
  key: string;
  label: string;
  summary: string;
  edits: Edit[];
}

/**
 * SONNY writes one tailored version per group. The groups and their focus keywords were
 * worked out locally, so SONNY only does the writing. Edits are checked here so nothing
 * touches a locked line or a line that doesn't exist.
 */
export async function sonnyBatch(lines: ResumeLine[], groups: BatchGroupInput[]): Promise<SonnyGroup[]> {
  const r = await api.aiJson("SONNY", SONNY_SYSTEM, sonnyBatchPrompt(lines, groups), 8000);
  const v = parseJson<{ groups?: (Omit<SonnyGroup, "key"> & { group: string })[] }>(r.text);
  const byP = new Map(lines.map((l) => [l.p, l]));
  const keys = new Set(groups.map((g) => g.key));
  return (v.groups ?? [])
    .filter((g) => keys.has(String(g.group)))
    .map((g) => ({
      key: String(g.group),
      label: String(g.label || "Tailored").slice(0, 40),
      summary: String(g.summary || ""),
      edits: (g.edits ?? [])
        .map((e) => ({ ...e, p: Number(e.p), after: e.after === undefined || e.after === null ? undefined : Number(e.after) }))
        .filter((e) => {
          const line = byP.get(e.p);
          if (!line || line.locked) return false;
          if (e.op === "delete") return true;
          if (e.op === "move_after") return e.after !== undefined && e.after !== e.p && byP.has(e.after);
          return (e.op === "replace" || e.op === "insert_after") && !!e.text?.trim();
        })
        .slice(0, 12),
    }))
    .filter((g) => g.edits.length > 0);
}

/**
 * SONNY tailors the resume for one job you're looking at. The job's skills were found locally:
 * the ones that set it apart lead, soft skills go last.
 */
export async function sonnyTailor(lines: ResumeLine[], job: JobContext, match: KeywordMatch): Promise<SonnyGroup | null> {
  const lead = (ks: string[]) => [...ks.filter((k) => !GENERIC.has(k)), ...ks.filter((k) => GENERIC.has(k))];
  const [g] = await sonnyBatch(lines, [{
    key: "G1",
    jobs: [{ title: job.title, company: job.company }],
    focus: lead([...match.covered, ...match.missing]).slice(0, 8),
    shared: [],
    missing: match.missing,
    posting: job.description.slice(0, 3500),
  }]);
  return g ?? null;
}
