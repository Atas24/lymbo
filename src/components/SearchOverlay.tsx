import { useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { KasprSprite } from "./Sprites";
import { springy } from "../lib/motion";

export interface SearchProgress {
  queries: string[];
  /** Index of the search running now (queries.length when finishing up). */
  current: number;
  found: number;
}

const TIPS = [
  "KASPR waits a few seconds between pages, like a person would.",
  "Every job shows up in the list. Use the How specific slider to narrow it down.",
  "Click any job in the list and KASPR reads it next.",
  "Matching jobs to your resume happens on your computer. It's free.",
  "Opening a job to apply pauses KASPR so Chrome stays on your page.",
  "SONNY makes tailored versions of your resume once the batch is read.",
];

/** Full-screen "KASPR is searching" screen: radar sweep, a blip per job found, progress per search. */
export function SearchOverlay({ progress, onCancel }: { progress: SearchProgress; onCancel: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const blips = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState(0);
  const tipRef = useRef<HTMLParagraphElement>(null);
  // Blip positions are random but stable for the life of the overlay.
  const spots = useMemo(
    () => Array.from({ length: 120 }, () => {
      const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.68;
      return { x: 50 + Math.cos(a) * r * 50, y: 50 + Math.sin(a) * r * 50 };
    }),
    [],
  );

  useEffect(() => {
    if (root.current) animate(root.current, { opacity: [0, 1], duration: 300, ease: "outQuad" });
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 3500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (tipRef.current) animate(tipRef.current, { opacity: [0, 1], translateY: [6, 0], duration: 400, ease: "outQuad" });
  }, [tip]);

  // New blips pop in as jobs are found.
  const shown = Math.min(progress.found, spots.length);
  const prevShown = useRef(0);
  useEffect(() => {
    if (!blips.current) return;
    const fresh = [...blips.current.children].slice(prevShown.current, shown);
    if (fresh.length) animate(fresh, { scale: [0, 1.6, 1], opacity: [0, 1], duration: 600, ease: springy });
    prevShown.current = shown;
  }, [shown]);

  return (
    <div ref={root} className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/85 backdrop-blur-sm">
      <div className="flex w-[440px] flex-col items-center gap-6">
        <div className="relative h-72 w-72">
          {/* rings */}
          {[1, 0.7, 0.4].map((s) => (
            <div key={s} className="absolute rounded-full border border-kaspr/20"
              style={{ inset: `${((1 - s) / 2) * 100}%` }} />
          ))}
          <div className="absolute left-1/2 top-0 h-full w-px bg-kaspr/10" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-kaspr/10" />
          {/* sweep */}
          <div className="radar-sweep absolute inset-0 rounded-full" />
          {/* a blip per job found */}
          <div ref={blips} className="absolute inset-0">
            {spots.slice(0, shown).map((s, i) => (
              <span key={i} className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sonny shadow-[0_0_8px_#5fe0a3]"
                style={{ left: `${s.x}%`, top: `${s.y}%` }} />
            ))}
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <KasprSprite size={64} busy />
          </div>
        </div>

        <div className="text-center">
          <div className="font-mono text-4xl font-bold">{progress.found}</div>
          <div className="text-sm text-muted">jobs found so far</div>
        </div>

        <ul className="flex w-full flex-col gap-1.5">
          {progress.queries.map((q, i) => {
            const state = i < progress.current ? "done" : i === progress.current ? "now" : "next";
            return (
              <li key={q} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                state === "now" ? "border-kaspr/50 bg-kaspr/5" : "border-line"} ${state === "next" ? "text-muted" : ""}`}>
                <span className="w-4 text-center font-mono">
                  {state === "done" ? <span className="text-sonny">✓</span> : state === "now" ? <span className="spin inline-block text-kaspr">◐</span> : "·"}
                </span>
                <span className="flex-1 truncate">Searching “{q}”</span>
              </li>
            );
          })}
          {progress.current >= progress.queries.length && progress.queries.length > 0 && (
            <li className="flex items-center gap-3 rounded-lg border border-kaspr/50 bg-kaspr/5 px-3 py-2 text-sm">
              <span className="spin inline-block w-4 text-center text-kaspr">◐</span>
              <span>Putting the list together…</span>
            </li>
          )}
        </ul>

        <p ref={tipRef} className="h-10 text-center text-xs text-muted">{TIPS[tip]}</p>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
