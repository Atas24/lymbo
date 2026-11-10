// Fit checks for one job, done on this computer (no AI, free): what the posting asks for
// (degree, graduation date, GPA, experience) checked against the resume, plus plain facts
// about the job (type, where, pay, work authorization).

export interface FitCheck {
  label: string;
  detail: string;
  /** ok = your resume meets it, warn = it may not, info = just a fact about the job */
  status: "ok" | "warn" | "info";
}

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const years = (s: string) => [...s.matchAll(/\b(20[1-4]\d)\b/g)].map((m) => Number(m[1]));
/** The sentence (or line) around a match, trimmed for display. */
function around(text: string, re: RegExp, max = 140): string | null {
  for (const l of lines(text)) {
    const m = l.match(re);
    if (!m) continue;
    const parts = l.split(/(?<=[.!?])\s+/);
    const s = parts.find((p) => re.test(p)) ?? l;
    return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
  }
  return null;
}

// ---------- facts about the job ----------

function jobType(job: string): string | null {
  const top = job.slice(0, 900);
  for (const t of [top, job]) {
    if (/\b(internship|intern|co-?op)\b/i.test(t)) return /\bco-?op\b/i.test(t) ? "Co-op" : "Internship";
    if (/\bpart[- ]time\b/i.test(t)) return "Part-time";
    if (/\bfull[- ]time\b/i.test(t)) return "Full-time";
  }
  return null;
}

function workSetup(job: string): string | null {
  const top = job.slice(0, 900);
  for (const t of [top, job]) {
    if (/\bhybrid\b/i.test(t)) return "Hybrid";
    if (/\bremote\b/i.test(t) && !/\bnot remote\b|\bno remote\b/i.test(t)) return "Remote";
    if (/\bon[- ]?site\b|\bin[- ]person\b|\bonsite\b/i.test(t)) return "On-site";
  }
  return null;
}

function place(job: string): string | null {
  for (const l of lines(job).slice(0, 30)) {
    const m = l.match(/\b([A-Z][A-Za-z.'-]+(?: [A-Z][A-Za-z.'-]+){0,3}, (?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?))\b/);
    if (m && l.length < 120) return m[1];
  }
  return null;
}

const PAY = /\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?(?:\s?(?:-|–|to)\s?\$?\s?\d[\d,]*(?:\.\d+)?\s?[kK]?)?(?:\s?(?:\/|per|an|a)\s?(?:hr|hour|yr|year|annually|mo|month|wk|week))?/;
function pay(job: string): string | null {
  const m = job.match(PAY);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

// ---------- things to check against the resume ----------

const LEVELS = ["Associate's", "Bachelor's", "Master's", "PhD"] as const;
const DEGREE_RE = [
  /\bassociate'?s? (?:degree|of)\b|\ba\.a\.s?\b/i,
  /\bbachelor'?s?\b|\bb\.s\.|\bb\.a\.|\bb\.sc\b|\bbs (?:in|degree)\b|\bba (?:in|degree)\b|\bundergraduate\b/i,
  /\bmaster'?s?\b|\bm\.s\.|\bm\.a\.|\bmba\b|\bm\.eng\b|\bms (?:in|degree)\b|\bgraduate degree\b/i,
  /\bph\.?d\b|\bdoctora(?:l|te)\b/i,
];
function degreeLevels(t: string): number[] {
  return DEGREE_RE.map((re, i) => (re.test(t) ? i : -1)).filter((i) => i >= 0);
}

function degreeCheck(job: string, resume: string): FitCheck | null {
  // Only look at lines that talk about a degree/education, so "master the tools" doesn't count.
  const jobLines = lines(job).filter((l) => /degree|bachelor|master|ph\.?d|mba|pursuing|enrolled|student|b\.s\.|m\.s\./i.test(l)).join("\n");
  const wanted = degreeLevels(jobLines);
  if (!wanted.length) return null;
  const min = Math.min(...wanted);
  const have = degreeLevels(resume);
  const label = "Degree";
  const asks = wanted.length > 1 ? `${LEVELS[min]} or higher` : LEVELS[min];
  if (!have.length) return { label, status: "info", detail: `Asks for a ${asks}. KASPR couldn't find a degree on your resume.` };
  const top = Math.max(...have);
  return top >= min
    ? { label, status: "ok", detail: `Asks for a ${asks}. Your resume shows a ${LEVELS[top]}.` }
    : { label, status: "warn", detail: `Asks for a ${asks}. Your resume shows a ${LEVELS[top]}.` };
}

function gradCheck(job: string, resume: string): FitCheck | null {
  const s = around(job, /graduat|class of|grad date/i, 200);
  if (!s) return null;
  const ys = years(s);
  if (!ys.length) return null;
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const later = ys.length === 1 && /or later|or after|\bafter\b|onward/i.test(s);
  const earlier = ys.length === 1 && /or earlier|\bbefore\b|\bby\b|no later/i.test(s);
  // Your graduation year: lines that say expected/anticipated/graduating, else degree lines.
  const resumeLines = lines(resume);
  const pick = (re: RegExp) => resumeLines.filter((l) => re.test(l)).flatMap(years);
  const mine = pick(/expected|anticipated|graduat|candidate|class of/i);
  const yours = mine.length ? Math.max(...mine) : (() => {
    const d = pick(/bachelor|master|b\.s\.|m\.s\.|b\.a\.|ph\.?d|mba|university|college/i);
    return d.length ? Math.max(...d) : null;
  })();
  const label = "Graduation";
  const range = later ? `${lo} or later` : earlier ? `${lo} or earlier` : lo === hi ? `${lo}` : `${lo}–${hi}`;
  if (yours === null) return { label, status: "info", detail: `Looking for grads in ${range}. KASPR couldn't find your graduation date.` };
  const fits = later ? yours >= lo : earlier ? yours <= lo : yours >= lo && yours <= hi;
  return { label, status: fits ? "ok" : "warn", detail: `Looking for grads in ${range}. Your resume says ${yours}.` };
}

function gpaCheck(job: string, resume: string): FitCheck | null {
  const j =
    job.match(/GPA[^.\n\d]{0,25}(\d\.\d{1,2})/i) ??
    job.match(/(\d\.\d{1,2})\s*(?:\/\s*4\.0+\s*)?(?:\+|or (?:higher|above|better))?\s*(?:cumulative\s+|overall\s+)?GPA/i);
  if (!j) return null;
  const need = Number(j[1]);
  if (!(need > 1 && need <= 4.5)) return null;
  const r =
    resume.match(/GPA[^.\n\d]{0,10}(\d\.\d{1,2})/i) ??
    resume.match(/(\d\.\d{1,2})\s*(?:\/\s*4\.0+\s*)?(?:cumulative\s+|overall\s+)?GPA/i);
  const label = "GPA";
  if (!r) return { label, status: "info", detail: `Asks for a ${need.toFixed(1)}+ GPA. Your GPA isn't on your resume.` };
  const have = Number(r[1]);
  return { label, status: have >= need ? "ok" : "warn", detail: `Asks for a ${need.toFixed(1)}+ GPA. Your resume says ${r[1]}.` };
}

function experience(job: string): FitCheck | null {
  const m = job.match(/(\d+)\s*\+?\s*(?:-|to)?\s*\d*\s*years?(?:\s+of)?\s+(?:relevant\s+|professional\s+|work\s+|industry\s+)?experience/i);
  return m ? { label: "Experience", status: "info", detail: `Asks for ${m[0].replace(/\s+/g, " ")}.` } : null;
}

function authorization(job: string): FitCheck | null {
  const s = around(job, /sponsor|work authori[sz]ation|authori[sz]ed to work|citizen|security clearance/i);
  return s ? { label: "Work authorization", status: "info", detail: s } : null;
}

/** Everything KASPR can tell about a job without AI, in the order it's shown. */
export function fitChecks(job: string, resume: string): FitCheck[] {
  const out: FitCheck[] = [];
  const type = jobType(job);
  if (type) out.push({ label: "Type", status: "info", detail: type });
  const where = [workSetup(job), place(job)].filter(Boolean).join(" · ");
  if (where) out.push({ label: "Where", status: "info", detail: where });
  const p = pay(job);
  if (p) out.push({ label: "Pay", status: "info", detail: p });
  for (const c of [degreeCheck(job, resume), gradCheck(job, resume), gpaCheck(job, resume), experience(job), authorization(job)]) {
    if (c) out.push(c);
  }
  return out;
}
