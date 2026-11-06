import { DeleteButton } from "./DeleteButton";
import { leave, popIn } from "../lib/motion";
import { useEffect, useRef, useState } from "react";
import { api, errText } from "../lib/api";
import { useApp } from "../lib/context";
import type { Edit, ResumeLine, ResumeVersion } from "../lib/types";

/** SONNY's tailored resume versions: review drafts, then use approved ones. */
export function VersionsPanel({ hasDocx }: { hasDocx: boolean }) {
  const { notify, dataVersion, bumpData } = useApp();
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [lines, setLines] = useState<Record<number, ResumeLine[]>>({});
  const [skipped, setSkipped] = useState<Record<number, Set<number>>>({}); // version id -> edit indexes turned off
  const [busyId, setBusyId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: number; url: string } | null>(null);

  useEffect(() => {
    api
      .versions()
      .then(async (vs) => {
        setVersions(vs);
        // Load the original lines so each edit can show "before → after".
        const bases = [...new Set(vs.filter((v) => v.status === "pending").map((v) => v.base_resume_id))];
        const entries = await Promise.all(bases.map(async (b) => [b, await api.resumeLines(b).catch(() => [])] as const));
        setLines(Object.fromEntries(entries));
      })
      .catch((e) => notify({ text: errText(e), tone: "error" }));
  }, [dataVersion, notify]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  // Each proposed change pops in, one after another.
  const listRef = useRef<HTMLDivElement>(null);
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
      bumpData();
      notify({ from: "SONNY", text: `Saved your ${v.label} resume. KASPR will use it for jobs like these.`, tone: "success" });
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => notify({ text: errText(e), tone: "error" }));

  const makePdf = (v: ResumeVersion) => {
    setBusyId(v.id);
    run(async () => {
      await api.versionExportPdf(v.id);
      bumpData();
    }).finally(() => setBusyId(null));
  };

  const togglePreview = (v: ResumeVersion) => {
    if (preview?.id === v.id) return setPreview(null);
    run(async () => {
      const buf = await api.versionPdf(v.id);
      setPreview({ id: v.id, url: URL.createObjectURL(new Blob([buf], { type: "application/pdf" })) });
    });
  };

  const pending = versions.filter((v) => v.status === "pending");
  const approved = versions.filter((v) => v.status === "approved");

  if (versions.length === 0) {
    return (
      <section className="card text-sm text-muted">
        {hasDocx
          ? "After KASPR reads a batch of jobs, I'll sort them by kind of role and draft a version of your resume for each. They'll show up here for your OK."
          : "Upload your resume as a Word file (.docx) in the Control Room. Then, after KASPR reads a batch of jobs, I'll draft tailored versions of it here."}
      </section>
    );
  }

  return (
    <div ref={listRef} className="flex flex-col gap-6">
      {pending.map((v) => {
        const byP = new Map((lines[v.base_resume_id] ?? []).map((l) => [l.p, l.text]));
        const keptCount = v.edits.length - (skipped[v.id]?.size ?? 0);
        return (
          <section key={v.id} id={`ver-${v.id}`} className="card flex flex-col gap-4 border-kaspr/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] tracking-widest text-kaspr">NEW VERSION · NEEDS YOUR OK</div>
                <h3 className="text-lg font-semibold">{v.label}</h3>
                <p className="text-sm text-muted">{v.summary}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">for {v.job_ids.length} job{v.job_ids.length === 1 ? "" : "s"}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {v.edits.map((e, i) => {
                const off = skipped[v.id]?.has(i);
                const before = byP.get(e.p) ?? "";
                return (
                  <li key={i} className="edit-row">
                    <label className={`flex cursor-pointer gap-3 rounded-lg border border-line p-3 text-sm transition ${off ? "opacity-40" : ""}`}>
                      <input type="checkbox" className="mt-1" checked={!off} onChange={() => toggle(v.id, i)} />
                      <div className="flex-1">
                        {e.op === "replace" && (
                          <>
                            <div className="text-muted line-through decoration-muted/50">{before}</div>
                            <div className="mt-1">{e.text}</div>
                          </>
                        )}
                        {e.op === "insert_after" && (
                          <>
                            <div className="text-xs text-muted">New line after “{before.slice(0, 60)}{before.length > 60 ? "…" : ""}”</div>
                            <div className="mt-1 text-sonny">+ {e.text}</div>
                          </>
                        )}
                        {e.op === "delete" && <div className="text-accent line-through">{before}</div>}
                        {e.op === "move_after" && (
                          <>
                            <div className="text-xs text-muted">
                              Moved up to right after “{(byP.get(e.after ?? -1) ?? "").slice(0, 50)}”
                            </div>
                            <div className="mt-1">↑ {before}</div>
                          </>
                        )}
                        {e.why && <div className="mt-1 text-xs text-muted">{e.why}</div>}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" disabled={busyId === v.id} onClick={() => approve(v)}>
                {busyId === v.id ? "Saving…" : `Approve with ${keptCount} change${keptCount === 1 ? "" : "s"}`}
              </button>
              <button className="btn" disabled={busyId === v.id} onClick={() => run(async () => {
                await leave(document.getElementById(`ver-${v.id}`));
                await api.versionDelete(v.id);
                bumpData();
              })}>
                Discard
              </button>
              <span className="ml-auto text-xs text-muted">Your formatting is kept. Only these lines change.</span>
            </div>
          </section>
        );
      })}

      {approved.length > 0 && (
        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">Your resume versions</h2>
          <ul className="flex flex-col gap-2">
            {approved.map((v) => (
              <li key={v.id} id={`ver-${v.id}`} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{v.label}</div>
                    <div className="text-xs text-muted">
                      {v.job_ids.length} job{v.job_ids.length === 1 ? "" : "s"} matched · {v.applied} applied ·{" "}
                      <span className={v.interviewing ? "text-sonny" : ""}>{v.interviewing} interview{v.interviewing === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  {v.has_pdf ? (
                    <>
                      <button className="btn text-xs" onClick={() => togglePreview(v)}>{preview?.id === v.id ? "Hide" : "Preview"}</button>
                      <button className="btn text-xs" onClick={() => run(() => api.versionOpen(v.id, "pdf"))}>Open PDF</button>
                    </>
                  ) : (
                    <button className="btn text-xs" disabled={busyId === v.id} onClick={() => makePdf(v)}>
                      {busyId === v.id ? "Making PDF…" : "Make PDF"}
                    </button>
                  )}
                  <button className="btn text-xs" onClick={() => run(() => api.versionOpen(v.id, "docx"))}>Open Word file</button>
                  <DeleteButton what="this version" onConfirm={() => run(async () => {
                    await leave(document.getElementById(`ver-${v.id}`));
                    await api.versionDelete(v.id);
                    bumpData();
                  })} />
                </div>
                {v.summary && <p className="mt-2 text-xs text-muted">{v.summary}</p>}
                {preview?.id === v.id && (
                  <iframe src={preview.url} title={v.label} className="mt-3 h-[28rem] w-full rounded-md border border-line bg-white" />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
