import { SplitTitle } from "../components/SplitTitle";
import { useEffect, useMemo, useState } from "react";
import { api, currentResume, errText } from "../lib/api";
import { sonnyReview, type SonnyReview } from "../lib/agents";
import { SONNY_SYSTEM, sonnyCoverLetterPrompt } from "../lib/prompts";
import { useApp } from "../lib/context";
import type { JobContext, Resume } from "../lib/types";
import { SonnySprite } from "../components/Sprites";
import { ResumePdf } from "../components/ResumePdf";
import { VersionsPanel } from "../components/VersionsPanel";
import { KeywordBar } from "../components/KeywordBar";
import { matchKeywords } from "../lib/keywords";

const EMPTY: JobContext = { company: "", title: "", url: "", description: "" };

export default function SonnyPage() {
  const { session, notify, setBusy, workshopJob, bumpData, dataVersion } = useApp();
  const [job, setJob] = useState<JobContext>(workshopJob ?? EMPTY);
  const [resume, setResume] = useState<Resume | undefined>();
  const [review, setReview] = useState<SonnyReview | null>(null);
  const [letter, setLetter] = useState("");
  const [working, setWorking] = useState<"review" | "letter" | null>(null);
  const [counted, setCounted] = useState(false);
  // Open on a single job when KASPR or the manual flow hands one over; otherwise show versions.
  const [tab, setTab] = useState<"versions" | "single">(workshopJob ? "single" : "versions");

  useEffect(() => {
    currentResume().then(setResume).catch((e) => notify({ text: errText(e), tone: "error" }));
  }, [notify, dataVersion]);
  useEffect(() => {
    if (workshopJob) {
      setTab("single");
      setJob(workshopJob);
      setReview(null);
      setLetter("");
      setCounted(false);
    }
  }, [workshopJob]);

  // Instant keyword check as you type or paste, done locally (no AI, no cost).
  const match = useMemo(
    () => (resume && job.description.trim() ? matchKeywords(job.description, resume.content) : null),
    [resume, job.description],
  );

  const field = (k: keyof JobContext) => ({
    value: job[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setJob({ ...job, [k]: e.target.value }),
  });
  const ready = !!resume && job.company.trim() && job.title.trim() && job.description.trim();

  // One workshop = one job worked on with SONNY, however many times you ask.
  const countWorkshop = async () => {
    if (counted) return;
    setCounted(true);
    await api.workshopIncrement();
    bumpData();
  };

  const run = async (kind: "review" | "letter") => {
    if (!resume) return;
    setWorking(kind);
    setBusy("SONNY", true);
    try {
      if (kind === "review") {
        setReview(await sonnyReview(resume.content, job, match ?? matchKeywords(job.description, resume.content)));
      } else {
        const r = await api.ai("SONNY", SONNY_SYSTEM, sonnyCoverLetterPrompt(resume.content, job.title, job.company, job.description), 1200, "smart", false);
        setLetter(r.text.trim());
      }
      await countWorkshop();
    } catch (e) {
      notify({ from: "SONNY", text: errText(e), tone: "error" });
    } finally {
      setWorking(null);
      setBusy("SONNY", false);
    }
  };

  const saveLetter = async () => {
    try {
      await api.coverLetterAdd(null, job.company || "Unknown company", letter);
      bumpData();
      notify({ from: "SONNY", text: "Cover letter saved to the Control Room.", tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <SonnySprite size={48} busy={!!working} />
        <div>
          <SplitTitle text="SONNY" />
          <p className="text-sm text-muted">Tailors your resume for the kinds of jobs KASPR finds. Nothing changes without your OK.</p>
        </div>
      </div>

      <div data-tour="versions" className="flex gap-1 self-start rounded-lg border border-line p-1">
        {([["versions", "Resume versions"], ["single", "Check one job"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${tab === id ? "bg-panel2 text-white" : "text-muted hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "versions" && <VersionsPanel hasDocx={!!resume?.has_docx} />}

      {tab === "single" && (<>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">The job</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Company</label>
              <input className="input" {...field("company")} />
            </div>
            <div>
              <label className="label">Job title</label>
              <input className="input" {...field("title")} />
            </div>
          </div>
          <div>
            <label className="label">Job description</label>
            <textarea className="input h-56" {...field("description")} />
          </div>
          {match && <KeywordBar match={match} showCovered />}
        </section>

        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">Your current resume</h2>
          {resume ? (
            <ResumePdf resume={resume} />
          ) : (
            <p className="text-sm text-muted">Add a resume in the Control Room first.</p>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={!ready || !!working || !session.active} onClick={() => run("review")}>
          {working === "review" ? "SONNY is reading…" : "Check my resume against this job"}
        </button>
        <button className="btn" disabled={!ready || !!working || !session.active} onClick={() => run("letter")}>
          {working === "letter" ? "Drafting…" : "Draft a cover letter"}
        </button>
        <span className="text-xs text-muted">
          {session.active ? "Sends your current resume and this job description to Anthropic." : "Start a session to use SONNY."}
        </span>
      </div>

      {review && (
        <section className="card flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className={`rounded px-2 py-0.5 font-mono text-xs ${review.verdict === "good" ? "bg-sonny/15 text-sonny" : "bg-kaspr/15 text-kaspr"}`}>
              {review.verdict === "good" ? "GOOD ALIGNMENT" : "WORTH TAILORING"}
            </span>
            <p className="text-sm">{review.summary}</p>
          </div>
          {review.irrelevant.length > 0 && (
            <div>
              <div className="label">Less useful for this job</div>
              <ul className="list-disc pl-5 text-sm text-muted">
                {review.irrelevant.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {review.suggestions.length > 0 && (
            <div>
              <div className="label">Suggested edits</div>
              <ul className="flex flex-col gap-2">
                {review.suggestions.map((s, i) => (
                  <li key={i} className="rounded-lg border border-line p-3 text-sm">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-sonny">{s.section}</div>
                    <div className="mt-1">{s.change}</div>
                    <div className="mt-1 text-xs text-muted">{s.why}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted">
            When you've updated your resume, add the new version in the Control Room so KASPR uses it.
          </p>
        </section>
      )}

      {letter && (
        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">Cover letter draft</h2>
          <textarea className="input h-80 text-sm leading-relaxed" value={letter} onChange={(e) => setLetter(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={saveLetter}>Save to Control Room</button>
            <button className="btn" onClick={() => navigator.clipboard.writeText(letter)}>Copy</button>
          </div>
        </section>
      )}
      </>)}
    </div>
  );
}
