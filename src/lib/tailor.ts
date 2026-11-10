import { api } from "./api";
import { sonnyTailor } from "./agents";
import { keywordsIn, matchKeywords } from "./keywords";
import type { JobContext, Resume } from "./types";

/**
 * SONNY drafts a version of the Word resume for one job and saves it as "needs your OK".
 * Returns the new version's name. Used by KASPR's and SONNY's Tailor buttons.
 */
export async function tailorForJob(resume: Resume, job: JobContext): Promise<string> {
  const lines = await api.resumeLines(resume.id);
  const g = await sonnyTailor(lines, job, matchKeywords(job.description, resume.content));
  if (!g) throw "SONNY couldn't find changes worth making for this job. Try a cover letter instead.";
  await api.versionCreate({
    baseResumeId: resume.id, label: g.label, summary: g.summary, edits: g.edits,
    jobIds: job.id ? [job.id] : [], keywords: keywordsIn(job.description),
  });
  await api.workshopIncrement();
  return g.label;
}
