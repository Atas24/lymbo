import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { SplitTitle } from "../components/SplitTitle";
import { KasprSprite, SonnySprite } from "../components/Sprites";
import { KeywordBar } from "../components/KeywordBar";
import { Briefcase } from "../components/Briefcase";
import { KasprBoxing } from "../components/KasprBoxing";
import { api, currentResume, errText } from "../lib/api";
import { tailorForJob } from "../lib/tailor";
import { useApp, type SeenJob } from "../lib/context";
import { keywordsIn, rankResumes, whyBest, VERSION_FIT, type RankedResume, type ResumeOption } from "../lib/keywords";
import { fitChecks, type FitCheck } from "../lib/requirements";
import { enter, popIn, springy } from "../lib/motion";
import type { JobContext, Resume, ResumeVersion } from "../lib/types";

const EMPTY: JobContext = { company: "", title: "", url: "", description: "" };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const barColor = (n: number) => (n >= VERSION_FIT ? "bg-sonny" : n >= 0.4 ? "bg-kaspr" : "bg-accent");
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function KasprPage() {
  const { session, notify, setBusy, bumpData, go, setWorkshopJob, kaspr, setKaspr, addSeen, dataVersion } = useApp();
  const [working, setWorking] = useState<string | null>(null);
  const [login, setLogin] = useState<{ email: string; method: string } | null>(null);
  const [editingLogin, setEditingLogin] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", method: "school" });
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [resume, setResume] = useState<Resume | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [tailoring, setTailoring] = useState(false);
  const [paste, setPaste] = useState<JobContext>(EMPTY);

  useEffect(() => {
    Promise.all([api.versions(), currentResume()])
      .then(([vs, r]) => { setVersions(vs); setResume(r); })
      .catch((e) => notify({ text: errText(e), tone: "error" }));
  }, [dataVersion, notify]);

  useEffect(() => {
    api.hsLoginStatus().then(setLogin).catch((e) => notify({ text: errText(e), tone: "error" }));
  }, [notify]);

  const busy = !!working;
  const task = async (label: string, fn: () => Promise<void>) => {
    setWorking(label);
    setBusy("KASPR", true);
    try {
      await fn();
    } catch (e) {
      notify({ from: "KASPR", text: errText(e), tone: "error" });
    } finally {
      setWorking(null);
      setBusy("KASPR", false);
    }
  };

  // ---------- Handshake login ----------

  const saveLogin = () =>
    task("Saving your login…", async () => {
      await api.hsLoginSet(form.email, form.password, form.method);
      setLogin({ email: form.email.trim(), method: form.method });
      setForm({ email: "", password: "", method: form.method });
      setEditingLogin(false);
      notify({ from: "KASPR", text: "Login saved to your keychain.", tone: "success" });
    });

  const removeLogin = () =>
    task("Removing…", async () => {
      await api.hsLoginRemove();
      await api.hsDisconnect();
      setLogin(null);
      setKaspr({ conn: "off", connMsg: "", onScreen: null });
    });

  const applyOutcome = (o: Awaited<ReturnType<typeof api.hsConnect>>) => {
    if (o.status === "logged_in") setKaspr({ conn: "on", connMsg: o.message, pendingHost: null });
    else if (o.status === "needs_approval") setKaspr({ conn: "needs_approval", connMsg: o.message, pendingHost: o.host });
    else setKaspr({ conn: "needs_user", connMsg: o.message, pendingHost: null });
  };

  const connect = () =>
    task("Signing in to Handshake…", async () => {
      setKaspr({ conn: "connecting", connMsg: "" });
      try {
        applyOutcome(await api.hsConnect());
      } catch (e) {
        setKaspr({ conn: "off", connMsg: "" });
        throw e;
      }
    });

  const approveHost = () =>
    task("Signing in…", async () => {
      if (kaspr.pendingHost) await api.hsApproveHost(kaspr.pendingHost);
      applyOutcome(await api.hsConnect());
    });

  const confirmSignedIn = () =>
    task("Checking…", async () => {
      if (await api.hsCheck()) setKaspr({ conn: "on", connMsg: "Signed in to Handshake." });
      else notify({ from: "KASPR", text: "Handshake still shows the login page. Finish signing in in the Chrome window." });
    });

  const disconnect = () =>
    task("Closing…", async () => {
      await api.hsDisconnect();
      setKaspr({ conn: "off", connMsg: "", onScreen: null, pinned: null });
    });

  // ---------- the job being shown ----------

  // A job you picked from the list, else the one open in Chrome, else the last one KASPR read.
  const shownId = kaspr.pinned ?? kaspr.onScreen ?? kaspr.seen[0]?.id ?? null;
  const shown = kaspr.seen.find((j) => j.id === shownId) ?? null;
  const readingNew = !!kaspr.onScreen && !kaspr.pinned && !shown; // on screen, but KASPR is still reading it
  const isOnScreen = !!shown && shown.id === kaspr.onScreen;

  const options = useMemo<ResumeOption[]>(() => {
    if (!resume) return [];
    return [
      { key: "main", kind: "main", id: resume.id, label: "your main resume", text: resume.content, has_pdf: resume.has_pdf, has_docx: resume.has_docx },
      ...versions
        .filter((v) => v.status === "approved" && v.base_resume_id === resume.id)
        .map((v): ResumeOption => ({ key: `v${v.id}`, kind: "version", id: v.id, label: v.label, text: v.text, has_pdf: v.has_pdf, has_docx: true })),
    ];
  }, [resume, versions]);

  const ranked = useMemo(() => (shown ? rankResumes(shown.job.description, options) : []), [shown, options]);
  const checks = useMemo(() => (shown && resume ? fitChecks(shown.job.description, resume.content) : []), [shown, resume]);
  const draft = shown ? versions.find((v) => v.status === "pending" && v.job_ids.includes(shown.id)) : undefined;
  const best = ranked[0];

  // New job: the analysis slides in, chips pop.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setConfirming(false);
    if (!panel.current) return;
    animate(panel.current.querySelector(".case-in") ?? [], { scale: [0.4, 1], opacity: [0, 1], rotate: [-12, 0], translateY: [-14, 0], ease: springy });
    enter(panel.current.querySelectorAll(".card"), 70);
  }, [shown?.id]);
  const checksRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (checksRef.current) popIn(checksRef.current.children, 45);
  }, [shown?.id, checks.length]);

  const nameOf = (o: ResumeOption) => (o.kind === "main" ? resume?.label ?? "Main resume" : o.label);
  const openFile = (o: ResumeOption, kind: "pdf" | "docx") =>
    (o.kind === "main" ? api.resumeOpenFile(o.id, kind) : api.versionOpen(o.id, kind)).catch((e) => notify({ text: errText(e), tone: "error" }));

  // ---------- SONNY, for this job (always available) ----------

  const tailor = async (s: SeenJob) => {
    if (!resume) return notify({ text: "Add your resume in the Control Room first.", tone: "error" });
    if (!resume.has_docx) {
      // Without the Word file SONNY can't make a version, but he can still suggest edits.
      setWorkshopJob({ ...s.job, id: s.id });
      go("sonny");
      return;
    }
    setTailoring(true);
    setBusy("SONNY", true);
    try {
      const label = await tailorForJob(resume, { ...s.job, id: s.id });
      bumpData();
      notify({ from: "SONNY", text: `I drafted “${label}” for ${s.job.title}. Look over the changes, then approve it.`, tone: "success" });
      setWorkshopJob(null);
      go("sonny");
    } catch (e) {
      notify({ from: "SONNY", text: errText(e), tone: "error" });
    } finally {
      setTailoring(false);
      setBusy("SONNY", false);
    }
  };

  const coverLetter = (s: SeenJob) => {
    setWorkshopJob({ ...s.job, id: s.id, want: "letter" });
    go("sonny");
  };

  const markApplied = (s: SeenJob, r: RankedResume | undefined) =>
    task("Logging…", async () => {
      const versionId = r?.option.kind === "version" ? r.option.id : null;
      await api.applicationAdd(s.job.company || "Unknown", s.job.title, s.job.url, "", versionId);
      if (versionId) api.versionLearn(versionId, s.id, keywordsIn(s.job.description)).catch(() => {});
      notify({ from: "KASPR", text: `Logged ${s.job.title}${s.job.company ? ` at ${s.job.company}` : ""} in your timeline.`, tone: "success" });
      setConfirming(false);
      bumpData();
    });

  const analyzePasted = () => {
    const id = `pasted-${Date.now()}`;
    addSeen({ id, job: { ...paste, title: paste.title.trim() || "Pasted job", company: paste.company.trim() }, seenAt: Date.now() });
    setKaspr({ pinned: id });
    setPaste(EMPTY);
  };

  // ---------- view ----------

  const canWork = session.active && kaspr.conn === "on";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <KasprSprite size={56} busy={busy || readingNew} />
        <div>
          <SplitTitle text="KASPR" />
          <p className="text-sm text-muted">
            {working ?? "Open any job on Handshake and KASPR tells you which resume to use. You always click Apply yourself."}
          </p>
        </div>
      </div>

      {/* ---------- Handshake login ---------- */}
      {kaspr.conn === "on" && login && !editingLogin ? (
        <section data-tour="handshake" className="card flex items-center gap-3 py-3 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sonny shadow-[0_0_8px_#5fe0a3]" />
          <span className="flex-1">Watching your Handshake window <span className="text-muted">· signed in as {login.email}</span></span>
          <button className="text-xs text-muted underline" onClick={disconnect}>Close Handshake</button>
        </section>
      ) : (
        <section data-tour="handshake" className="card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Handshake</h2>
            <span className={`font-mono text-xs ${kaspr.conn === "on" ? "text-sonny" : "text-muted"}`}>
              ● {kaspr.conn === "on" ? "CONNECTED" : kaspr.conn === "off" ? "NOT CONNECTED" : "SIGNING IN"}
            </span>
          </div>
          {!login || editingLogin ? (
            <>
              <p className="text-xs text-muted">
                Your login is saved in your Mac's Keychain. KASPR only types it into Handshake, or your school's login
                page after you OK it. It's never sent to the AI.
              </p>
              <div className="flex gap-4 text-sm">
                {[["school", "I sign in through my school"], ["handshake", "I have a Handshake password"]].map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="radio" checked={form.method === v} onChange={() => setForm({ ...form, method: v })} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{form.method === "school" ? "School email / username" : "Email"}</label>
                  <input className="input" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input className="input" type="password" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={!form.email.trim() || !form.password || busy} onClick={saveLogin}>Save login</button>
                {editingLogin && <button className="btn" onClick={() => setEditingLogin(false)}>Cancel</button>}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm">
                <span>{login.email} <span className="text-muted">· {login.method === "school" ? "school sign-in" : "Handshake password"}</span></span>
                <span className="flex gap-3 text-xs text-muted">
                  <button className="underline" onClick={() => setEditingLogin(true)}>Change</button>
                  <button className="underline" onClick={removeLogin}>Remove</button>
                </span>
              </div>
              {kaspr.connMsg && kaspr.conn !== "on" && (
                <p className="rounded-md border border-kaspr/40 bg-kaspr/5 px-3 py-2 text-sm">{kaspr.connMsg}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {(kaspr.conn === "off" || kaspr.conn === "connecting") && (
                  <button className="btn btn-primary" disabled={!session.active || busy} onClick={connect}>
                    {kaspr.conn === "connecting" ? "Signing in…" : "Connect"}
                  </button>
                )}
                {kaspr.conn === "needs_approval" && (
                  <>
                    <button className="btn btn-primary" disabled={busy} onClick={approveHost}>Yes, sign me in there</button>
                    <button className="btn" disabled={busy} onClick={() => setKaspr({ conn: "needs_user", connMsg: "OK. Sign in yourself in the Chrome window, then click \"I'm signed in\"." })}>
                      No, I'll do it
                    </button>
                  </>
                )}
                {kaspr.conn === "needs_user" && <button className="btn btn-primary" disabled={busy} onClick={confirmSignedIn}>I'm signed in</button>}
                {kaspr.conn !== "off" && <button className="btn" disabled={busy && kaspr.conn !== "needs_user"} onClick={disconnect}>Close Handshake</button>}
              </div>
              {!session.active && <p className="text-xs text-muted">Start a session to connect.</p>}
            </>
          )}
        </section>
      )}

      {/* ---------- the job ---------- */}
      <div ref={panel} data-tour="analysis" className="flex flex-col gap-6">
        {readingNew ? (
          <WaitCard text="KASPR is reading this job…" sub="Give the page a second to load." mode="reading" />
        ) : !shown ? (
          <WaitCard
            text={canWork ? "Open a job on Handshake in the Chrome window." : "Connect to Handshake, then open any job."}
            sub="KASPR reads it the moment it opens and checks it against your resumes. He never clicks or browses on his own."
            mode={canWork ? "watching" : "resting"}
          />
        ) : (
          <>
            {/* header */}
            <section className="card flex items-center gap-5">
              <div className="case-in shrink-0 px-2"><Briefcase id={shown.id} size={72} /></div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] tracking-widest text-muted">
                  {isOnScreen ? "OPEN IN CHROME NOW" : shown.id.startsWith("pasted-") ? "PASTED JOB" : `READ ${ago(shown.seenAt).toUpperCase()}`}
                  {!isOnScreen && kaspr.onScreen && (
                    <button className="ml-3 normal-case tracking-normal text-kaspr underline" onClick={() => setKaspr({ pinned: null })}>
                      Back to the job in Chrome
                    </button>
                  )}
                </div>
                <h2 className="truncate text-xl font-semibold">{shown.job.title}</h2>
                {shown.job.company && <div className="text-sm text-muted">{shown.job.company}</div>}
              </div>
            </section>

            {/* which resume */}
            <section data-tour="resume-pick" className="card flex flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <h3 className="label mb-0">Resume to use</h3>
                {best && <span className="font-mono text-xs text-muted">covers {pct(best.match.coverage)} of this job's skills</span>}
              </div>
              {!best ? (
                <p className="text-sm text-muted">Add your resume in the Control Room and KASPR will compare it to this job.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`text-2xl font-semibold ${best.match.coverage >= VERSION_FIT ? "text-sonny" : "text-kaspr"}`}>{nameOf(best.option)}</span>
                    {best.option.kind === "main" && <span className="rounded bg-panel2 px-2 py-0.5 font-mono text-[10px] text-muted">MAIN</span>}
                    {best.option.kind === "version" && <span className="rounded bg-sonny/10 px-2 py-0.5 font-mono text-[10px] text-sonny">SONNY VERSION</span>}
                    <span className="ml-auto flex gap-2">
                      {best.option.has_pdf && <button className="btn text-xs" onClick={() => openFile(best.option, "pdf")}>Open PDF</button>}
                      {best.option.has_docx && <button className="btn text-xs" onClick={() => openFile(best.option, "docx")}>Open Word file</button>}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{whyBest(ranked)}</p>
                  {ranked.length > 1 && (
                    <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
                      {ranked.map((r) => (
                        <li key={r.option.key} className="flex items-center gap-3 text-sm">
                          <span className={`w-44 truncate ${r === best ? "font-medium" : "text-muted"}`}>{nameOf(r.option)}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                            <div className={`h-full rounded-full ${barColor(r.match.coverage)} transition-all duration-700`} style={{ width: pct(r.match.coverage) }} />
                          </div>
                          <span className="w-10 text-right font-mono text-xs text-muted">{pct(r.match.coverage)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {draft && (
                <div className="flex items-center gap-3 rounded-lg border border-sonny/40 bg-sonny/5 px-3 py-2 text-sm">
                  <SonnySprite size={22} />
                  <span className="flex-1">SONNY drafted <b>{draft.label}</b> for this job. It needs your OK before KASPR suggests it.</span>
                  <button className="btn text-xs" onClick={() => { setWorkshopJob(null); go("sonny"); }}>Review it</button>
                </div>
              )}
              <div data-tour="sonny-actions" className="flex flex-wrap gap-2 border-t border-line pt-4">
                <button className="btn btn-primary" disabled={tailoring || !session.active} onClick={() => tailor(shown)}>
                  {tailoring ? "SONNY is tailoring…" : "Tailor with SONNY"}
                </button>
                <button className="btn" disabled={!session.active} onClick={() => coverLetter(shown)}>Cover letter with SONNY</button>
                {!confirming ? (
                  <button className="btn" disabled={busy} onClick={() => setConfirming(true)}>I applied</button>
                ) : (
                  <span className="flex flex-wrap items-center gap-2 rounded-md border border-kaspr/50 px-3 py-1 text-sm">
                    Did you submit it{best ? <> with <b>{nameOf(best.option)}</b></> : null}?
                    <button className="btn btn-primary text-xs" onClick={() => markApplied(shown, best)}>Yes, log it</button>
                    <button className="btn text-xs" onClick={() => setConfirming(false)}>No</button>
                  </span>
                )}
              </div>
              {!session.active && <p className="text-xs text-muted">Start a session to work with SONNY.</p>}
            </section>

            {/* skills */}
            {best && (best.match.covered.length + best.match.missing.length > 0) && (
              <section className="card flex flex-col gap-3">
                <h3 className="label mb-0">Skills this job asks for</h3>
                <KeywordBar match={{ ...best.match, requirements: [] }} showCovered />
                <p className="text-xs text-muted">
                  <span className="text-sonny">Green</span> = on {nameOf(best.option)}. <span className="text-kaspr">Orange</span> = not on it yet.
                </p>
              </section>
            )}

            {/* requirements */}
            {checks.length > 0 && (
              <section data-tour="checks" className="card flex flex-col gap-3">
                <h3 className="label mb-0">The details</h3>
                <ul ref={checksRef} className="flex flex-col gap-2">
                  {checks.map((c) => <CheckRow key={c.label} c={c} />)}
                </ul>
              </section>
            )}

            <details className="card">
              <summary className="cursor-pointer text-sm font-medium">The posting as KASPR read it</summary>
              <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">{shown.job.description}</pre>
            </details>
          </>
        )}
      </div>

      {/* ---------- jobs you've looked at ---------- */}
      {kaspr.seen.length > 0 && (
        <section data-tour="history" className="card flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h3 className="label mb-0">Jobs you've looked at</h3>
            <button className="text-xs text-muted underline" onClick={() => setKaspr({ seen: [], pinned: null })}>Clear</button>
          </div>
          <ul className="flex flex-col">
            {kaspr.seen.map((j) => {
              const top = rankResumes(j.job.description, options)[0];
              return (
                <li key={j.id}>
                  <button onClick={() => setKaspr({ pinned: j.id === kaspr.onScreen ? null : j.id })}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-panel2 ${j.id === shownId ? "bg-panel2" : ""}`}>
                    <Briefcase id={j.id} size={20} />
                    <span className="min-w-0 flex-1 truncate">
                      {j.job.title}{j.job.company && <span className="text-muted"> · {j.job.company}</span>}
                    </span>
                    {top && <span className="hidden truncate text-xs text-muted sm:inline">{nameOf(top.option)} · {pct(top.match.coverage)}</span>}
                    {j.id === kaspr.onScreen && <span className="h-1.5 w-1.5 rounded-full bg-sonny" title="Open in Chrome" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ---------- a job from anywhere ---------- */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Paste a job instead</summary>
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-muted">For jobs that aren't on Handshake. KASPR checks it the same way.</p>
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Job title" value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} />
            <input className="input" placeholder="Company" value={paste.company} onChange={(e) => setPaste({ ...paste, company: e.target.value })} />
          </div>
          <textarea className="input h-40" placeholder="Job description" value={paste.description} onChange={(e) => setPaste({ ...paste, description: e.target.value })} />
          <button className="btn btn-primary self-start" disabled={!paste.description.trim()} onClick={analyzePasted}>Check this job</button>
        </div>
      </details>
    </div>
  );
}

function CheckRow({ c }: { c: FitCheck }) {
  const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "·";
  const tone = c.status === "ok" ? "border-sonny/50 text-sonny" : c.status === "warn" ? "border-accent/60 text-accent" : "border-line text-muted";
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${tone}`}>{icon}</span>
      <span className="w-36 shrink-0 text-muted">{c.label}</span>
      <span className="flex-1">{c.detail}</span>
    </li>
  );
}

/** Empty state: KASPR boxing a punching bag while he waits for you to open a job. */
function WaitCard({ text, sub, mode }: { text: string; sub: string; mode: "resting" | "watching" | "reading" }) {
  return (
    <section className="card flex flex-col items-center gap-4 py-10 text-center">
      <KasprBoxing mode={mode} />
      <div>
        <div className="font-medium">{text}</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{sub}</p>
      </div>
    </section>
  );
}
