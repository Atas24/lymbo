import type { KeywordMatch } from "../lib/keywords";

/** Instant, local keyword coverage: what a resume screener would look for. */
export function KeywordBar({ match, showCovered = false }: { match: KeywordMatch; showCovered?: boolean }) {
  const total = match.covered.length + match.missing.length;
  if (total === 0 && match.requirements.length === 0) return null;
  const pct = Math.round(match.coverage * 100);
  const color = pct >= 70 ? "bg-sonny" : pct >= 45 ? "bg-kaspr" : "bg-accent";
  return (
    <div className="flex flex-col gap-2">
      {total > 0 && (
        <div className="flex items-center gap-3">
          <span className="label mb-0 shrink-0">Keywords</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 font-mono text-xs text-muted">
            {match.covered.length}/{total}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {showCovered &&
          match.covered.map((k) => (
            <span key={k} className="rounded-full border border-sonny/40 px-2.5 py-0.5 text-xs text-sonny">{k}</span>
          ))}
        {match.missing.map((k) => (
          <span key={k} className="rounded-full border border-kaspr/40 px-2.5 py-0.5 text-xs" title="Not on your resume">{k}</span>
        ))}
        {match.requirements.map((r) => (
          <span key={r} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">{r}</span>
        ))}
      </div>
    </div>
  );
}
