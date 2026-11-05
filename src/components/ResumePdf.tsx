import { useEffect, useState } from "react";
import { api, errText } from "../lib/api";
import { useApp } from "../lib/context";
import type { Resume } from "../lib/types";

/** Shows a resume's original PDF, or its text if it was pasted in. */
export function ResumePdf({ resume, height = "h-96" }: { resume: Resume; height?: string }) {
  const { notify } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [noPdf, setNoPdf] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    setUrl(null);
    setNoPdf(false);
    api
      .resumePdf(resume.id)
      .then((buf) => {
        objectUrl = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
        setUrl(objectUrl);
      })
      .catch(() => setNoPdf(true));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resume.id]);

  const open = () => api.resumeOpenPdf(resume.id).catch((e) => notify({ text: errText(e), tone: "error" }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{resume.label}</span>
        {!noPdf && (
          <button className="text-xs text-muted underline hover:text-white" onClick={open}>
            Open PDF in Preview
          </button>
        )}
      </div>
      {url ? (
        <iframe src={url} title={resume.label} className={`${height} w-full rounded-md border border-line bg-white`} />
      ) : noPdf ? (
        <>
          <pre className={`${height} overflow-auto whitespace-pre-wrap rounded-md border border-line bg-ink p-3 font-mono text-xs text-muted`}>
            {resume.content}
          </pre>
          <p className="text-xs text-muted">This resume was added before PDF upload existed. Upload the PDF in the Control Room to see it here.</p>
        </>
      ) : (
        <div className={`${height} rounded-md border border-line`} />
      )}
    </div>
  );
}
