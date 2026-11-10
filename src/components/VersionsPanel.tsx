import { DeleteButton } from "./DeleteButton";
import { leave, popIn } from "../lib/motion";
import { useEffect, useRef, useState } from "react";
import { api, errText } from "../lib/api";
import { useApp } from "../lib/context";
import type { Edit, Resume, ResumeLine, ResumeVersion } from "../lib/types";
import { ResumePdf } from "./ResumePdf";

const shorten = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** SONNY's drafts: every change as before → after, each one you can untick, then approve. */
export function PendingVersions({ versions, onChange }: { versions: ResumeVersion[]; onChange: () => void }) {
  const { notify } = useApp();
  const [lines, setLines] = useState<Record<number, ResumeLine[]>>({});
  const [skipped, setSkipped] = useState<Record<number, Set<number>>>({}); // version id -> edits turned off
  const [busyId, setBusyId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The original lines, so each change can show what it replaces.
    const bases = [...new Set(versions.map((v) => v.base_resume_id))].filter((b) => !lines[b]);
    if (!bases.length) return;
    Promise.all(bases.map(async (b) => [b, await api.resumeLines(b).catch(() => [])] as const))
      .then((entries) => setLines((l) => ({ ...l, ...Object.fromEntries(entries) })));
  }, [versions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (listRef.current) popIn(listRef.current.querySelectorAll(".edit-row"), 45);
  }, [versions.length]);

  const toggle = (vid: number, i: number) =>
    setSkipped((s) => {
      const set = new Set(s[vid] ?? []);
      set.has(i) ? set.delete(i) : set.add(i);
      return { ...s, [vid]: set };
    });

  const approve = async (v: ResumeVersion) => {
    setBusyId(v.id);
    try {
      const kept: Edit[] = v.edits.filter((_, i) => !skipped[v.id]?.has(i));
      await api.versionApprove(v.id, kept);
      onChange();
      notify({ from: "SONNY", text: `Saved “${v.label}”. KASPR will suggest it for jobs like this.`, tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (v: ResumeVersion) => {
    try {
      await leave(document.getElementById(`pending-${v.id}`));
      await api.versionDelete(v.id);
      onChange();
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  };

  return (
    <div ref={listRef} className="flex flex-col gap-4">
      {versions.map((v) => {
        const byP = new Map((lines[v.base_resume_id] ?? []).map((l) => [l.p, l.text]));
        const keptCount = v.edits.length - (skipped[v.id]?.size ?? 0);
        return (
          <section key={v.id} id={`pending-${v.id}`} className="card flex flex-col gap-4 border-sonny/40">
            <div>
              <div className="font-mono text-[10px] tracking-widest text-sonny">DRAFT · NEEDS YOUR OK</div>
              <h3 className="text-lg font-semibold">{v.label}</h3>
              {v.summary && <p className="text-sm text-muted">{v.summary}</p>}
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div className="grid grid-cols-[16px_1fr_1fr] gap-x-4 px-3">
                <span />
                <span className="label mb-0">Now</span>
                <span className="label mb-0 text-sonny">SONNY's change</span>
              </div>
              {v.edits.map((e, i) => {
                const off = skipped[v.id]?.has(i);
                const before = byP.get(e.p) ?? "";
                let now: React.ReactNode = before;
                let after: React.ReactNode = e.text;
                if (e.op === "insert_after") {
                  now = <span className="italic text-muted">(new line after “{shorten(before, 50)}”)</span>;
                } else if (e.op === "delete") {
                  after = <span className="italic text-accent">(removed)</span>;
                } else if (e.op === "move_after") {
                  after = <span>↑ Moved up, right after “{shorten(byP.get(e.after ?? -1) ?? "", 50)}”</span>;
                }
                return (
                  <label key={i} className={`edit-row grid cursor-pointer grid-cols-[16px_1fr_1fr] items-start gap-x-4 rounded-lg border border-line p-3 transition hover:border-sonny/40 ${off ? "opacity-40" : ""}`}>
                    <input type="checkbox" className="mt-1 accent-[#5fe0a3]" checked={!off} onChange={() => toggle(v.id, i)} />
                    <span className="text-muted">{now}</span>
                    <span>
                      {after}
                      {e.why && <span className="mt-1 block text-xs text-muted">{e.why}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" disabled={busyId === v.id || keptCount === 0} onClick={() => approve(v)}>
                {busyId === v.id ? "Saving…" : `Approve ${keptCount} change${keptCount === 1 ? "" : "s"}`}
              </button>
              <button className="btn" disabled={busyId === v.id} onClick={() => discard(v)}>Discard</button>
              <span className="ml-auto text-xs text-muted">Untick anything you don't want. Your formatting stays the same.</span>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Your main resume plus every version you've approved, with a preview of each. */
export function ResumeLibrary({ resume, versions, onChange }: { resume?: Resume; versions: ResumeVersion[]; onChange: () => void }) {
  const { notify } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: number; url: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => notify({ text: errText(e), tone: "error" }));
  const showVersion = (v: ResumeVersion) => {
    if (open === `v${v.id}`) return setOpen(null);
    setOpen(`v${v.id}`);
    if (v.has_pdf) run(async () => setPreview({ id: v.id, url: URL.createObjectURL(new Blob([await api.versionPdf(v.id)], { type: "application/pdf" })) }));
  };

  return (
    <ul className="flex flex-col gap-2">
      {resume && (
        <li className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === "main" ? null : "main")}>
              <span className="text-sm font-medium">{resume.label}</span>
              <span className="ml-2 rounded bg-panel2 px-2 py-0.5 font-mono text-[10px] text-muted">MAIN</span>
            </button>
            {resume.has_docx && <button className="btn text-xs" onClick={() => run(() => api.resumeOpenFile(resume.id, "docx"))}>Open Word file</button>}
          </div>
          {open === "main" && <div className="mt-3"><ResumePdf resume={resume} height="h-80" /></div>}
        </li>
      )}
      {versions.map((v) => (
        <li key={v.id} id={`lib-${v.id}`} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <button className="min-w-0 flex-1 text-left" onClick={() => showVersion(v)}>
              <div className="text-sm font-medium">{v.label}</div>
              <div className="text-xs text-muted">
                {v.applied} applied · <span className={v.interviewing ? "text-sonny" : ""}>{v.interviewing} interview{v.interviewing === 1 ? "" : "s"}</span>
              </div>
            </button>
            {v.has_pdf ? (
              <button className="btn text-xs" onClick={() => run(() => api.versionOpen(v.id, "pdf"))}>Open PDF</button>
            ) : (
              <button className="btn text-xs" disabled={busyId === v.id}
                onClick={() => { setBusyId(v.id); run(async () => { await api.versionExportPdf(v.id); onChange(); }).finally(() => setBusyId(null)); }}>
                {busyId === v.id ? "Making PDF…" : "Make PDF"}
              </button>
            )}
            <button className="btn text-xs" onClick={() => run(() => api.versionOpen(v.id, "docx"))}>Open Word file</button>
            <DeleteButton what="this version" onConfirm={() => run(async () => {
              await leave(document.getElementById(`lib-${v.id}`));
              await api.versionDelete(v.id);
              onChange();
            })} />
          </div>
          {open === `v${v.id}` && (
            <div className="mt-3">
              {v.summary && <p className="mb-2 text-xs text-muted">{v.summary}</p>}
              {preview?.id === v.id
                ? <iframe src={preview.url} title={v.label} className="h-[28rem] w-full rounded-md border border-line bg-white" />
                : !v.has_pdf && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line p-3 font-mono text-xs text-muted">{v.text}</pre>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
