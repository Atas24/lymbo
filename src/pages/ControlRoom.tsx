import { useEffect, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import { api, errText, fmtDuration, fmtUsd } from "../lib/api";
import { useApp } from "../lib/context";
import { APPLICATION_STATUSES, type Application, type CoverLetter, type Resume, type Stats } from "../lib/types";
import { KillSwitch } from "../components/KillSwitch";
import { ResumePdf } from "../components/ResumePdf";

const STATUS_COLOR: Record<string, string> = {
  applied: "bg-kaspr",
  interviewing: "bg-[#4a7dff]",
  offer: "bg-sonny",
  rejected: "bg-accent",
  withdrawn: "bg-muted",
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat card opacity-0">
      <div className="label">{label}</div>
      <div className="font-mono text-3xl font-semibold">{value}</div>
    </div>
  );
}

export default function ControlRoom() {
  const { notify, dataVersion, bumpData } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [letters, setLetters] = useState<CoverLetter[]>([]);
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
    Promise.all([api.stats(), api.resumes(), api.applications(), api.coverLetters()])
      .then(([s, r, a, c]) => {
        setStats(s);
        setResumes(r);
        setApps(a);
        setLetters(c);
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
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      notify({ text: "Pick a PDF file.", tone: "error" });
      return;
    }
    setUploading(true);
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      await api.resumeUploadPdf(file.name, bytes);
      setShowAdd(false);
      bumpData();
      notify({ text: `${file.name} saved as your current resume. Click it below to check the text came through right.`, tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
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
          <h1 className="text-2xl font-semibold">Control Room</h1>
          <p className="text-sm text-muted">Everything KASPR and SONNY know about you lives here, on this computer.</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-6">
        <div ref={statsRef} className="grid grid-cols-2 gap-4">
          <StatCard label="Jobs applied" value={String(stats?.applied_count ?? 0)} />
          <StatCard label="SONNY workshops" value={String(stats?.workshop_sessions ?? 0)} />
          <StatCard label="Time applying" value={fmtDuration(stats?.seconds_applying ?? 0)} />
          <StatCard label="API spend (est.)" value={fmtUsd(stats?.lifetime_cost_usd ?? 0)} />
        </div>
        <div className="card flex items-center justify-center px-8">
          <KillSwitch />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Resume library */}
        <section className="card">
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
                <span className="font-mono text-2xl">{uploading ? "…" : "PDF"}</span>
                <span className="text-sm">{uploading ? "Reading your resume…" : "Drop your resume PDF here, or click to choose"}</span>
                <span className="text-xs text-muted">The newest upload becomes your current resume</span>
              </button>
              <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => uploadPdf(e.target.files?.[0])} />
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
            <p className="text-sm text-muted">No resume yet. Upload your resume PDF so KASPR can judge which jobs fit you.</p>
          )}
          <ul className="flex flex-col gap-2">
            {resumes.map((r) => (
              <li key={r.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <button className="text-left" onClick={() => setOpen(open === `r${r.id}` ? null : `r${r.id}`)}>
                    <div className="text-sm font-medium">{r.label}</div>
                    <div className="text-xs text-muted">{r.created_at}</div>
                  </button>
                  {r.is_current ? (
                    <span className="rounded bg-sonny/15 px-2 py-0.5 font-mono text-[10px] text-sonny">CURRENT</span>
                  ) : (
                    <button className="btn text-xs" onClick={() => api.resumeSetCurrent(r.id).then(bumpData)}>
                      Make current
                    </button>
                  )}
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
        <section className="card">
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

      <section className="card">
        <h2 className="mb-4 font-semibold">Cover letters</h2>
        {letters.length === 0 && <p className="text-sm text-muted">Cover letters you save from SONNY land here.</p>}
        <ul className="flex flex-col gap-2">
          {letters.map((l) => (
            <li key={l.id} className="rounded-lg border border-line p-3">
              <button className="w-full text-left" onClick={() => setOpen(open === `c${l.id}` ? null : `c${l.id}`)}>
                <span className="text-sm font-medium">{l.company}</span>
                <span className="ml-2 text-xs text-muted">{l.created_at}</span>
              </button>
              {open === `c${l.id}` && (
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-muted">{l.content}</pre>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
