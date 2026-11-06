import { useState } from "react";

/** Trash button that asks once ("Delete? Yes / No") before doing anything. */
export function DeleteButton({ onConfirm, what }: { onConfirm: () => void; what: string }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs" title={`Delete ${what}`} onClick={(e) => e.stopPropagation()}>
        <span className="text-muted">Delete?</span>
        <button className="btn border-accent/60 px-2 py-0.5 text-xs text-accent" onClick={onConfirm}>Yes</button>
        <button className="btn px-2 py-0.5 text-xs" onClick={() => setAsking(false)}>No</button>
      </span>
    );
  }
  return (
    <button title={`Delete ${what}`} onClick={(e) => { e.stopPropagation(); setAsking(true); }}
      className="rounded-md p-1.5 text-muted transition hover:bg-accent/10 hover:text-accent">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}
