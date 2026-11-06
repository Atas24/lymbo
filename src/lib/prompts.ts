// What each agent is told. Kept in one place so it's easy to tune.

export const KASPR_SYSTEM =
  "You help the user decide which jobs are worth applying to. You compare a job posting to the " +
  "user's resume and give an honest relevance score. You never apply to anything yourself. " +
  "Reply with JSON only.";

export const kasprLocationPrompt = (answer: string) => `
The user was asked where they want to work. Their answer: "${answer}"

Turn it into search filters. Return only this JSON:
{"places": ["<city, state or region>", "..."],
 "remote": "only" | "ok" | "no",
 "relocate": <true|false>,
 "summary": "<short plain restatement, e.g. Chicago or Austin, remote is fine>"}
Use "ok" for remote if they didn't mention it.`;

export const kasprEvaluatePrompt = (resume: string, jobTitle: string, company: string, jd: string, location: string) => `
RESUME:
${resume}

WHAT THEY'RE LOOKING FOR: ${location || "not specified"}

JOB: ${jobTitle} at ${company}
${jd}

Score how relevant this job is for this person, including whether the location and job type fit what they want. Return only this JSON:
{"score": <0-100>, "recommend": <true|false>, "reasons": ["<short reason>", "..."]}`;

export const kasprSearchPrompt = (resume: string, location: string) => `
RESUME:
${resume}

WHAT THEY'RE LOOKING FOR: ${location || "not specified"}

Suggest 3 short Handshake search phrases (2-4 words each, like a job title someone would type)
for roles this person is a strong fit for. Return only this JSON:
{"queries": ["<phrase>", "<phrase>", "<phrase>"]}`;

export const kasprReadJobPrompt = (resume: string, location: string, pageText: string) => `
RESUME:
${resume}

WHAT THEY'RE LOOKING FOR: ${location || "not specified"}

TEXT OF A HANDSHAKE JOB PAGE (may include menus and other page text; ignore those):
"""
${pageText}
"""

Pull out the job and score how relevant it is for this person, including whether the location and job type (internship vs full-time) fit. A job of the wrong type should score under 30.
Return only this JSON:
{"company": "<employer>", "title": "<job title>", "location": "<where, or Remote>",
 "description": "<the responsibilities and requirements, condensed to under 1000 characters>",
 "score": <0-100>, "recommend": <true|false>, "reasons": ["<short reason>", "... (max 3)"]}`;

export const kasprRankPrompt = (resume: string, location: string, listings: string) => `
RESUME:
${resume}

WHAT THEY'RE LOOKING FOR: ${location || "not specified"}

JOB LISTINGS FROM A HANDSHAKE SEARCH (id: listing text):
${listings}

Which of these are worth opening? Skip ones that are clearly a bad fit from the title, company, location,
or job type (internship vs full-time). Return only this JSON, best first:
{"open": ["<id>", "..."]}`;

export const SONNY_SYSTEM =
  "You help the user tailor their resume and cover letters for specific jobs, including getting " +
  "past automated resume screeners. You only suggest changes; you never invent experience the " +
  "user doesn't have. Use plain, direct language with no buzzwords.";

export const sonnyAlignmentPrompt = (
  resume: string, jobTitle: string, company: string, jd: string, covered: string[], missing: string[],
) => `
RESUME:
${resume}

JOB: ${jobTitle} at ${company}
${jd}

KEYWORD CHECK (already done, don't repeat it):
On the resume: ${covered.join(", ") || "none"}
Not on the resume: ${missing.join(", ") || "none"}

Suggest specific resume edits for this job. Focus on missing keywords the person plausibly has
experience with (based on the rest of the resume), and on wording that better matches the job.
Never suggest claiming experience they don't show. Return only this JSON:
{"verdict": "good" | "workshop",
 "summary": "<one or two sentences>",
 "irrelevant": ["<resume content that doesn't help for this job>", "..."],
 "suggestions": [{"section": "<resume section>", "change": "<specific edit to make>", "why": "<reason>"}]}
Use "workshop" only if tailoring would clearly help.`;

export const sonnyCoverLetterPrompt = (resume: string, jobTitle: string, company: string, jd: string) => `
RESUME:
${resume}

JOB: ${jobTitle} at ${company}
${jd}

Write a cover letter for this job, under 300 words. Only use experience that's on the resume.
Be specific and concrete. Return just the letter text.`;

export interface BatchGroupInput {
  key: string;
  jobs: { title: string; company: string }[];
  /** What sets this group apart from the rest of the batch (found locally). */
  focus: string[];
  /** Also common across the group. */
  shared: string[];
  /** Group keywords the resume doesn't show yet. */
  missing: string[];
}

export const sonnyBatchPrompt = (lines: { p: number; text: string; locked: boolean }[], groups: BatchGroupInput[]) => `
THE USER'S RESUME, line by line (P = line number; [fixed] lines can't be changed or moved):
${lines.map((l) => `P${l.p}${l.locked ? " [fixed]" : ""}: ${l.text}`).join("\n")}

GROUPS OF JOBS (already sorted by keywords on the user's computer):
${groups
  .map(
    (g) => `${g.key}: ${g.jobs.map((j) => `${j.title} at ${j.company}`).join("; ")}
  Focus keywords (what sets this group apart): ${g.focus.join(", ") || "none"}
  Also common: ${g.shared.join(", ") || "none"}
  Not on the resume yet: ${g.missing.join(", ") || "nothing"}`,
  )
  .join("\n\n")}

Write one tailored version of the resume for each group. The versions must be clearly different
from each other, each built around its own focus keywords:
- Rewrite the summary/objective line (if there is one) and the skills line(s) so the focus keywords
  the resume supports come first.
- Move the 2-3 bullets that best show the focus keywords to the top of their section
  (op "move_after", with "after" = the line the bullet should come right after, usually the job/title line).
- Re-word bullets to use the group's terms for things the resume already shows.
- Never add a skill, tool, employer, number, degree or result the resume doesn't support. If a focus
  keyword isn't supported by the resume, leave it out.
- Keep each changed line within ~15% of its original length. Don't change names, contact info,
  headings, dates or [fixed] lines.
- 5 to 12 edits per group. Plain, direct wording, no buzzwords.

Return only this JSON:
{"groups": [{"group": "<G1, G2, ...>", "label": "<short role name, e.g. Data Analyst>",
             "summary": "<one sentence: what this version leads with>",
             "edits": [{"p": <line number>, "op": "replace" | "insert_after" | "delete" | "move_after",
                        "text": "<new text, for replace / insert_after>",
                        "after": <line number, for move_after>, "why": "<short reason>"}]}]}`;
