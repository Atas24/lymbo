import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { SplitTitle } from "../components/SplitTitle";
import { api, currentResume, errText } from "../lib/api";
import { sonnyReview, type SonnyReview } from "../lib/agents";
import { SONNY_SYSTEM, sonnyCoverLetterPrompt } from "../lib/prompts";
import { tailorForJob } from "../lib/tailor";
import { useApp } from "../lib/context";
import type { JobContext, Resume, ResumeVersion } from "../lib/types";
import { SonnySprite } from "../components/Sprites";
import { SpeechBubble } from "../components/SpeechBubble";
import { Briefcase } from "../components/Briefcase";
import { PixelIcon, type PixelIconName } from "../components/PixelIcon";
import { PendingVersions, ResumeLibrary } from "../components/VersionsPanel";
import { matchKeywords } from "../lib/keywords";
import { popIn, springy } from "../lib/motion";

const EMPTY: JobContext = { company: "", title: "", url: "", description: "" };
type Work = "tailor" | "letter" | "review";

const TILES: { id: Work; icon: PixelIconName; title: string; body: string }[] = [
  { id: "tailor", icon: "resume", title: "Tailor my resume", body: "A new version of your Word resume for this job. You OK every change." },
  { id: "letter", icon: "letter", title: "Write a cover letter", body: "Under 300 words, using only what's on your resume." },
  { id: "review", icon: "check", title: "Quick check", body: "What I'd change for this job, without making a new version." },
];

export default function SonnyPage() {
  const { session, notify, setBusy, workshopJob, bumpData, dataVersion, kaspr } = useApp();
  const [resume, setResume] = useState<Resume | undefined>();
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  // The job SONNY is working on: the one handed over from KASPR, else the last job KASPR read.
  const [job, setJob] = useState<JobContext | null>(
    () => workshopJob ?? (kaspr.seen[0] ? { ...kaspr.seen[0].job, id: kaspr.seen[0].id } : null),
  );
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState<JobContext>(EMPTY);
  const [working, setWorking] = useState<Work | null>(null);
  const [review, setReview] = useState<SonnyReview | null>(null);
  const [letter, setLetter] = useState("");

  useEffect(() => {
    Promise.all([currentResume(), api.versions()])
      .then(([r, vs]) => { setResume(r); setVersions(vs); })
      .catch((e) => notify({ text: errText(e), tone: "error" }));
  }, [notify, dataVersion]);

  const pickJob = (j: JobContext | null) => {
    setJob(j);
    setReview(null);
    setLetter("");
    setPasting(false);
  };
  useEffect(() => {
    if (workshopJob) pickJob(workshopJob);
  }, [workshopJob]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = versions.filter((v) => v.base_resume_id === resume?.id);
  const pending = mine.filter((v) => v.status === "pending");
  const approved = mine.filter((v) => v.status === "approved");

  const run = async (kind: Work) => {
    if (!resume || !job) return;
    if (kind === "tailor" && !resume.has_docx) {
      notify({ from: "SONNY", text: "I need your resume as a Word file (.docx) to make versions. Upload it in the Control Room. Quick check works without it.", tone: "error" });
      return;
    }
    setWorking(kind);
    setBusy("SONNY", true);
    try {
      if (kind === "tailor") {
        const label = await tailorForJob(resume, job);
        notify({ from: "SONNY", text: `Drafted “${label}”. It's at the top of this page for your OK.`, tone: "success" });
        document.querySelector("[data-pending]")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (kind === "review") {
        setReview(await sonnyReview(resume.content, job, matchKeywords(job.description, resume.content)));
        await api.workshopIncrement();
      } else {
        const r = await api.ai("SONNY", SONNY_SYSTEM, sonnyCoverLetterPrompt(resume.content, job.title, job.company, job.description), 1200, "smart", false);
        setLetter(r.text.trim());
        await api.workshopIncrement();
      }
      bumpData();
    } catch (e) {
      notify({ from: "SONNY", text: errText(e), tone: "error" });
    } finally {
      setWorking(null);
      setBusy("SONNY", false);
    }
  };

  // "Cover letter with SONNY" from KASPR: start writing as soon as everything's loaded.
  const lettered = useRef<JobContext | null>(null);
  useEffect(() => {
    if (workshopJob?.want !== "letter" || lettered.current === workshopJob || !resume || !session.active || job !== workshopJob) return;
    lettered.current = workshopJob;
    run("letter");
  }, [workshopJob, resume, session.active, job]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLetter = async () => {
    if (!job) return;
    try {
      await api.coverLetterAdd(null, job.company || job.title || "Unknown company", letter);
      bumpData();
      notify({ from: "SONNY", text: "Cover letter saved to the Control Room.", tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  };

  // What SONNY says: always the next thing to do.
  const say = useMemo(() => {
    const at = job?.company ? ` at ${job.company}` : "";
    if (working === "tailor") return `Tailoring your resume for ${job?.title}${at}. This takes about half a minute.`;
    if (working === "letter") return `Writing your cover letter for ${job?.title}${at}…`;
    if (working === "review") return `Reading ${job?.title} next to your resume…`;
    if (!resume) return "Upload your resume in the Control Room first. A Word file (.docx) lets me make tailored versions of it.";
    if (pending.length) {
      return pending.length === 1
        ? `I drafted “${pending[0].label}”. Look over my changes below, untick anything you don't want, then approve it.`
        : `I drafted ${pending.length} resumes. Look over my changes below and approve the ones you like.`;
    }
    if (letter) return "Here's your cover letter. Change anything you like, then save it to the Control Room.";
    if (review) return "Here's what I'd change. Want me to make those changes in a new version? Click Tailor my resume.";
    if (!job) return "Open a job in KASPR, or paste one below, and I'll get to work.";
    if (!session.active) return `Start a session at the top and I'll get to work on ${job.title}.`;
    return `What should I do for ${job.title}${at}?`;
  }, [working, job, resume, pending, letter, review, session.active]);

  // Tiles pop in, and the briefcase drops onto the desk, when the job changes.
  const desk = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!desk.current) return;
    popIn(desk.current.querySelectorAll(".tile"), 60);
    const bc = desk.current.querySelector(".case-in");
    if (bc) animate(bc, { translateY: [-18, 0], rotate: [-10, 0], opacity: [0, 1], ease: springy });
  }, [job]);

  const ready = !!resume && !!job && session.active && !working;
  const seenOptions = kaspr.seen.map((s) => ({ id: s.id, label: `${s.job.title}${s.job.company ? ` · ${s.job.company}` : ""}` }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-start gap-4">
        <SonnySprite size={64} busy={!!working} />
        <div className="flex flex-col gap-2">
          <SplitTitle text="SONNY" />
          <SpeechBubble text={say} />
        </div>
      </div>

      {pending.length > 0 && (
        <div data-pending className="flex flex-col gap-3">
          <h2 className="label mb-0 text-sonny">Needs your OK</h2>
          <PendingVersions versions={pending} onChange={bumpData} />
        </div>
      )}

      {/* ---------- the job on SONNY's desk ---------- */}
      <section ref={desk} data-tour="desk" className="card flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <div className="case-in shrink-0">
            {job ? <Briefcase id={job.id ?? job.title} size={52} /> : <div className="h-[42px] w-[52px] rounded border border-dashed border-line" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="whitespace-nowrap font-mono text-[10px] tracking-widest text-muted">ON MY DESK</div>
            <div className="truncate text-lg font-semibold">{job ? job.title || "Untitled job" : "No job yet"}</div>
            {job?.company && <div className="text-sm text-muted">{job.company}</div>}
          </div>
          <div className="w-60 shrink-0">
          <select className="input text-xs" value={pasting ? "paste" : job?.id ?? ""}
            onChange={(e) => {
              if (e.target.value === "paste") return setPasting(true);
              const s = kaspr.seen.find((x) => x.id === e.target.value);
              if (s) pickJob({ ...s.job, id: s.id });
            }}>
            {!job && !pasting && <option value="">Pick a job…</option>}
            {job && !job.id && !pasting && <option value="">{job.title || "This job"}</option>}
            {seenOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            <option value="paste">Paste a different job…</option>
          </select>
          </div>
        </div>

        {pasting && (
          <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <div className="grid grid-cols-2 gap-3">
              <input className="input" placeholder="Job title" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} />
              <input className="input" placeholder="Company" value={paste.company} onChange={(e) => setPaste({ ...paste, company: e.target.value })} />
            </div>
            <textarea className="input h-36" placeholder="Paste the job description" value={paste.description} onChange={(e) => setPaste({ ...paste, description: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={!paste.description.trim()}
                onClick={() => { pickJob({ ...paste, title: paste.title.trim() || "Pasted job" }); setPaste(EMPTY); }}>
                Put it on the desk
              </button>
              <button className="btn" onClick={() => setPasting(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {TILES.map((t) => (
            <button key={t.id} disabled={!ready} onClick={() => run(t.id)}
              className={`tile group flex flex-col gap-3 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed ${
                working === t.id ? "border-sonny bg-sonny/10" : "border-line bg-panel2/40 enabled:hover:-translate-y-0.5 enabled:hover:border-sonny/60 enabled:hover:bg-sonny/5"
              } ${!ready && working !== t.id ? "opacity-50" : ""}`}>
              <span className={working === t.id ? "animate-pulse" : "transition group-enabled:group-hover:-rotate-6"}>
                <PixelIcon name={t.icon} size={40} />
              </span>
              <span className="font-semibold">{working === t.id ? "Working on it…" : t.title}</span>
              <span className="text-xs leading-relaxed text-muted">{t.body}</span>
            </button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-muted">
          {!session.active && "Start a session to use SONNY. Each one sends your resume and this job to Anthropic and costs a few cents. "}
          SONNY is AI and can get things wrong, so read what he writes before you send it.
        </p>

        {review && (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex items-center gap-3">
              <span className={`rounded px-2 py-0.5 font-mono text-xs ${review.verdict === "good" ? "bg-sonny/15 text-sonny" : "bg-kaspr/15 text-kaspr"}`}>
                {review.verdict === "good" ? "LINES UP WELL" : "WORTH TAILORING"}
              </span>
              <p className="text-sm">{review.summary}</p>
            </div>
            {review.suggestions.length > 0 && (
              <ol className="flex flex-col gap-2">
                {review.suggestions.map((s, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-line p-3 text-sm">
                    <span className="font-mono text-sonny">{i + 1}</span>
                    <span className="flex-1">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted">{s.section}</span>
                      <span className="mt-0.5 block">{s.change}</span>
                      <span className="mt-1 block text-xs text-muted">{s.why}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {review.irrelevant.length > 0 && (
              <p className="text-xs text-muted">Less useful for this job: {review.irrelevant.join("; ")}</p>
            )}
          </div>
        )}

        {letter && (
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <PixelIcon name="letter" size={20} />
              <h3 className="font-semibold">Cover letter</h3>
            </div>
            <textarea className="input h-80 text-sm leading-relaxed" value={letter} onChange={(e) => setLetter(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={saveLetter}>Save to Control Room</button>
              <button className="btn" onClick={() => navigator.clipboard.writeText(letter)}>Copy</button>
              <button className="btn" disabled={!ready} onClick={() => run("letter")}>Write another</button>
            </div>
          </div>
        )}
      </section>

      {/* ---------- library ---------- */}
      <section data-tour="versions" className="card flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Your resumes</h2>
          <span className="text-xs text-muted">KASPR picks from these for every job</span>
        </div>
        <ResumeLibrary resume={resume} versions={approved} onChange={bumpData} />
      </section>
    </div>
  );
}
