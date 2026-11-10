import { DeleteButton } from "../components/DeleteButton";
import { leave } from "../lib/motion";
import { SplitTitle } from "../components/SplitTitle";
import { useEffect, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import { api, errText, fmtDuration, fmtUsd } from "../lib/api";
import { useApp } from "../lib/context";
import { APPLICATION_STATUSES, type Application, type CoverLetter, type Resume, type ResumeVersion, type Stats } from "../lib/types";
import { KillSwitch } from "../components/KillSwitch";
import { ResumePdf } from "../components/ResumePdf";

const STATUS_COLOR: Record<string, string> = {
  applied: "bg-kaspr",
  interviewing: "bg-[#4a7dff]",
  offer: "bg-sonny",
  rejected: "bg-accent",
  withdrawn: "bg-muted",
};

/** A stat whose number counts up when it appears or changes. */
function StatCard({ label, value, format }: { label: string; value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(format(0));
  const from = useRef(0);
  useEffect(() => {
    const obj = { n: from.current };
    const a = animate(obj, {
      n: value, duration: 900, ease: "outExpo",
      onUpdate: () => setShown(format(obj.n)),
      onComplete: () => { from.current = value; setShown(format(value)); },
    });
    return () => void a.pause();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stat card opacity-0">
      <div className="label">{label}</div>
      <div className="font-mono text-3xl font-semibold">{shown}</div>
    </div>
  );
}

export default function ControlRoom() {
  const { notify, dataVersion, bumpData, go, setWorkshopJob } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [letters, setLetters] = useState<CoverLetter[]>([]);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newText, setNewText] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api.stats(), api.resumes(), api.applications(), api.coverLetters(), api.versions()])
      .then(([s, r, a, c, v]) => {
        setStats(s);
        setResumes(r);
        setApps(a);
        setLetters(c);
        setVersions(v);
      })
      .catch((e) => notify({ text: errText(e), tone: "error" }));
  }, [dataVersion, notify]);

  useEffect(() => {
    if (!stats || !statsRef.current) return;
    const a = animate(statsRef.current.querySelectorAll(".stat"), {
      translateY: [12, 0], opacity: [0, 1], delay: stagger(70), duration: 450, ease: "outQuad",
    });
    return () => void a.revert();
  }, [stats]);

  const saveResume = async () => {
    try {
      await api.resumeAdd(newLabel || `Resume ${resumes.length + 1}`, newText);
      setNewLabel("");
      setNewText("");
      setShowAdd(false);
      bumpData();
      notify({ text: "Resume saved and set as current.", tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  };

  const uploadPdf = async (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    const isDocx = name.endsWith(".docx");
    if (!isDocx && !name.endsWith(".pdf")) {
      notify({ text: "Pick a Word file (.docx) or a PDF.", tone: "error" });
      return;
    }
    setUploading(true);
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      if (isDocx) await api.resumeUploadDocx(file.name, bytes);
      else await api.resumeUploadPdf(file.name, bytes);
      setShowAdd(false);
      bumpData();
      notify({
        text: isDocx
          ? `${file.name} is now your current resume. SONNY can make tailored versions of it.`
          : `${file.name} saved as your current resume. Upload the Word (.docx) version too if you want SONNY to make tailored versions.`,
        tone: "success",
      });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** Animates the row away, then deletes it. */
  const remove = async (rowId: string, del: () => Promise<void>, done: string) => {
    try {
      await leave(document.getElementById(rowId));
      await del();
      bumpData();
      notify({ text: done });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
      bumpData();
    }
  };

  const setStatus = async (id: number, status: string) => {
    try {
      await api.applicationSetStatus(id, status);
      bumpData();
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <SplitTitle text="Control Room" />
          <p className="text-sm text-muted">Everything KASPR and SONNY know about you lives here, on this computer.</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-6">
        <div ref={statsRef} data-tour="stats" className="grid grid-cols-2 gap-4">
          <StatCard label="Jobs applied" value={stats?.applied_count ?? 0} format={(n) => String(Math.round(n))} />
          <StatCard label="SONNY workshops" value={stats?.workshop_sessions ?? 0} format={(n) => String(Math.round(n))} />
          <StatCard label="Time applying" value={stats?.seconds_applying ?? 0} format={(n) => fmtDuration(n)} />
          <StatCard label="API spend (est.)" value={stats?.lifetime_cost_usd ?? 0} format={fmtUsd} />
        </div>
        <div data-tour="killswitch" className="card flex items-center justify-center px-8">
          <KillSwitch />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Resume library */}
        <section data-tour="resumes" className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Resumes</h2>
            <button className="btn" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Cancel" : "Upload resume"}
            </button>
          </div>
          {showAdd && !pasteMode && (
            <div className="mb-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); uploadPdf(e.dataTransfer.files[0]); }}
                disabled={uploading}
                className={`flex h-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition ${
                  dragging ? "border-sonny bg-sonny/5" : "border-line hover:border-muted"
                }`}
              >
                <span className="font-mono text-2xl">{uploading ? "…" : "DOCX · PDF"}</span>
                <span className="text-sm">{uploading ? "Reading your resume…" : "Drop your resume here, or click to choose"}</span>
                <span className="text-xs text-muted">Word (.docx) lets SONNY make tailored versions that keep your formatting</span>
              </button>
              <input ref={fileRef} type="file" accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => uploadPdf(e.target.files?.[0])} />
              <button className="self-start text-xs text-muted underline" onClick={() => setPasteMode(true)}>Paste text instead</button>
            </div>
          )}
          {showAdd && pasteMode && (
            <div className="mb-4 flex flex-col gap-2">
              <input className="input" placeholder="Label (e.g. Data analyst – Nov)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <textarea className="input h-48 font-mono text-xs" placeholder="Paste your resume text here" value={newText} onChange={(e) => setNewText(e.target.value)} />
              <div className="flex items-center gap-3">
                <button className="btn btn-primary" onClick={saveResume} disabled={!newText.trim()}>Save as current resume</button>
                <button className="text-xs text-muted underline" onClick={() => setPasteMode(false)}>Upload a PDF instead</button>
              </div>
            </div>
          )}
          {resumes.length === 0 && !showAdd && (
            <p className="text-sm text-muted">No resume yet. Upload your resume (ideally the Word .docx) so KASPR can tell you which resume fits each job.</p>
          )}
          <ul className="flex flex-col gap-2">
            {resumes.map((r) => (
              <li key={r.id} id={`res-${r.id}`} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <button className="text-left" onClick={() => setOpen(open === `r${r.id}` ? null : `r${r.id}`)}>
                    <div className="text-sm font-medium">{r.label}</div>
                    <div className="text-xs text-muted">{r.created_at}</div>
                  </button>
                  <span className="flex items-center gap-2">
                    {r.is_current ? (
                      <span className="rounded bg-sonny/15 px-2 py-0.5 font-mono text-[10px] text-sonny">CURRENT</span>
                    ) : (
                      <button className="btn text-xs" onClick={() => api.resumeSetCurrent(r.id).then(bumpData)}>
                        Make current
                      </button>
                    )}
                    <DeleteButton what="this resume and its versions" onConfirm={() => remove(`res-${r.id}`, () => api.resumeDelete(r.id), "Resume deleted.")} />
                  </span>
                </div>
                {open === `r${r.id}` && (
                  <div className="mt-3">
                    <ResumePdf resume={r} height="h-80" />
                    <details className="mt-2 text-xs text-muted">
                      <summary className="cursor-pointer">Text the agents see</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono">{r.content}</pre>
                    </details>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Application timeline */}
        <section data-tour="timeline" className="card">
          <h2 className="mb-4 font-semibold">Application timeline</h2>
          {apps.length === 0 && (
            <p className="text-sm text-muted">Nothing yet. When you tell KASPR you applied, it shows up here.</p>
          )}
          <ol className="relative ml-2 border-l border-line">
            {apps.map((a) => (
              <li key={a.id} className="mb-5 ml-5">
                <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${STATUS_COLOR[a.status] ?? "bg-muted"}`} />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{a.title}</div>
                    <div className="text-xs text-muted">
                      {a.company} · {a.applied_at.slice(0, 10)}
                    </div>
                  </div>
                  <select
                    className="rounded-md border border-line bg-ink px-2 py-1 text-xs"
                    value={a.status}
                    onChange={(e) => setStatus(a.id, e.target.value)}
                  >
                    {APPLICATION_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
      <section data-tour="sonny-resumes" className="card">
        <h2 className="mb-4 font-semibold">Resumes made with SONNY</h2>
        {versions.length === 0 && (
          <p className="text-sm text-muted">Resumes SONNY tailors for you land here. Click Tailor with SONNY on any job in KASPR.</p>
        )}
        <ul className="flex flex-col gap-2">
          {versions.map((v) => {
            const base = resumes.find((r) => r.id === v.base_resume_id);
            const err = (e: unknown) => notify({ text: errText(e), tone: "error" });
            return (
              <li key={v.id} id={`ver-${v.id}`} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === `v${v.id}` ? null : `v${v.id}`)}>
                    <span className="block text-sm font-medium">{v.label}</span>
                    <span className="block text-xs text-muted">
                      {v.created_at.slice(0, 10)}{base ? ` · from ${base.label}` : ""} · {v.applied} applied
                    </span>
                  </button>
                  {v.status === "approved" ? (
                    <span className="rounded bg-sonny/15 px-2 py-0.5 font-mono text-[10px] text-sonny">APPROVED</span>
                  ) : (
                    <button className="rounded bg-kaspr/15 px-2 py-0.5 font-mono text-[10px] text-kaspr" onClick={() => { setWorkshopJob(null); go("sonny"); }}>
                      NEEDS YOUR OK
                    </button>
                  )}
                  <DeleteButton what="this resume version" onConfirm={() => remove(`ver-${v.id}`, () => api.versionDelete(v.id), "Resume version deleted.")} />
                </div>
                {open === `v${v.id}` && (
                  <div className="mt-3 flex flex-col gap-3">
                    {v.summary && <p className="text-sm text-muted">{v.summary}</p>}
                    {v.status === "approved" ? (
                      <div className="flex gap-2">
                        {v.has_pdf && <button className="btn text-xs" onClick={() => api.versionOpen(v.id, "pdf").catch(err)}>Open PDF</button>}
                        <button className="btn text-xs" onClick={() => api.versionOpen(v.id, "docx").catch(err)}>Open Word file</button>
                      </div>
                    ) : (
                      <button className="btn btn-primary self-start text-xs" onClick={() => { setWorkshopJob(null); go("sonny"); }}>
                        Review the changes in SONNY
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2 className="mb-4 font-semibold">Cover letters</h2>
        {letters.length === 0 && <p className="text-sm text-muted">Cover letters you save from SONNY land here.</p>}
        <ul className="flex flex-col gap-2">
          {letters.map((l) => (
            <li key={l.id} id={`cl-${l.id}`} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <button className="flex-1 text-left" onClick={() => setOpen(open === `c${l.id}` ? null : `c${l.id}`)}>
                  <span className="block text-sm font-medium">{l.company}</span>
                  <span className="block text-xs text-muted">{l.created_at}</span>
                </button>
                <DeleteButton what="this cover letter" onConfirm={() => remove(`cl-${l.id}`, () => api.coverLetterDelete(l.id), "Cover letter deleted.")} />
              </div>
              {open === `c${l.id}` && (
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-muted">{l.content}</pre>
              )}
            </li>
          ))}
        </ul>
      </section>
      </div>
    </div>
  );
}
