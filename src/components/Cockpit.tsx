import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { animate, createSpring } from "animejs";
import type { BatchJob } from "../lib/context";
import { KasprSprite } from "./Sprites";

const pop = createSpring({ stiffness: 90, damping: 13 });

/** Stable 0..1 numbers from a job id, so each job always gets the same planet. */
function seeded(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (n: number) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ n;
    return ((h >>> 0) % 1000) / 1000;
  };
}

/** A planet drawn with gradients: color, bands and sometimes a ring, picked from the job id. */
function Planet({ id, size }: { id: string; size: number }) {
  const look = useMemo(() => {
    const r = seeded(id);
    const hue = Math.floor(r(1) * 360);
    return {
      hue,
      ring: r(2) > 0.55,
      tilt: -25 + r(3) * 50,
      bands: r(4) > 0.35,
      glow: `hsla(${hue}, 80%, 60%, 0.35)`,
    };
  }, [id]);
  const { hue } = look;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {look.ring && (
        <div className="absolute left-1/2 top-1/2 rounded-[50%] border-[6px]"
          style={{
            width: size * 1.7, height: size * 0.42, transform: `translate(-50%, -50%) rotate(${look.tilt}deg)`,
            borderColor: `hsla(${(hue + 40) % 360}, 60%, 75%, 0.55)`,
          }} />
      )}
      <div className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          background: `radial-gradient(circle at 32% 30%, hsl(${hue}, 85%, 78%), hsl(${hue}, 65%, 48%) 45%, hsl(${(hue + 20) % 360}, 70%, 18%) 78%)`,
          boxShadow: `0 0 60px 8px ${look.glow}, inset -18px -14px 40px rgba(0,0,0,.55)`,
        }}>
        {look.bands && (
          <div className="absolute inset-0 opacity-40 mix-blend-overlay"
            style={{ background: `repeating-linear-gradient(${look.tilt}deg, transparent 0 14px, hsla(${(hue + 30) % 360}, 70%, 85%, .6) 14px 22px)` }} />
        )}
      </div>
      {look.ring && (
        // front half of the ring, drawn over the planet
        <div className="absolute left-1/2 top-1/2 overflow-hidden" style={{
          width: size * 1.7, height: size * 0.21, transform: `translate(-50%, 0) rotate(${look.tilt}deg)`, transformOrigin: "50% 0",
        }}>
          <div className="rounded-[50%] border-[6px]" style={{
            width: size * 1.7, height: size * 0.42, marginTop: -size * 0.21,
            borderColor: `hsla(${(hue + 40) % 360}, 60%, 75%, 0.75)`,
          }} />
        </div>
      )}
    </div>
  );
}

function Starfield({ warp }: { warp: boolean }) {
  const stars = useMemo(
    () => Array.from({ length: 140 }, () => ({ x: Math.random() * 100, y: Math.random() * 100, s: Math.random() < 0.15 ? 2.5 : 1.5, o: 0.3 + Math.random() * 0.7 })),
    [],
  );
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="star-drift absolute inset-[-10%]">
        {stars.map((st, i) => (
          <span key={i} className={`absolute rounded-full bg-white ${warp ? "star-warp" : "star-still"}`}
            style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, opacity: st.o }} />
        ))}
      </div>
    </div>
  );
}

export interface CockpitProps {
  job: BatchJob | null;
  /** 1-based position among jobs in range, and how many there are. */
  position: number;
  total: number;
  /** KASPR is still reading and the next job isn't ready. */
  scanning: boolean;
  /** Message for the window when there's nothing to show. */
  idleMessage: string;
  resumePanel: ReactNode;
  actions: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

/**
 * KASPR's job viewer: the view from a spaceship cockpit. Each job is a planet outside the
 * window; going to the next job flies past it at warp speed to the next one.
 */
export function Cockpit(p: CockpitProps) {
  const [shown, setShown] = useState<BatchJob | null>(p.job);
  const [warp, setWarp] = useState(false);
  const [details, setDetails] = useState(false);
  const planet = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const dir = useRef<1 | -1>(1);
  const busy = useRef(false);

  // Fly to a new job: current planet streaks past, stars stretch, the new one approaches.
  useEffect(() => {
    if (p.job?.link.id === shown?.link.id) {
      if (p.job !== shown) setShown(p.job); // same job, new details (e.g. resume assigned)
      return;
    }
    if (busy.current) return;
    const out = planet.current, lab = label.current;
    if (!shown || !out) {
      setShown(p.job);
      return;
    }
    busy.current = true;
    setDetails(false);
    setWarp(true);
    const d = dir.current;
    animate(out, { scale: [1, 3], translateX: [0, -d * 700], opacity: [1, 0], duration: 520, ease: "inQuad" });
    if (lab) animate(lab, { opacity: [1, 0], translateX: [0, -d * 120], duration: 300, ease: "inQuad" });
    setTimeout(() => {
      setShown(p.job);
      setTimeout(() => setWarp(false), 250);
      busy.current = false;
    }, 560);
  }, [p.job]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrival: the new planet grows in from the distance.
  useEffect(() => {
    if (!shown) return;
    if (planet.current) animate(planet.current, { scale: [0.05, 1], translateX: [dir.current * 60, 0], opacity: [0, 1], ease: pop });
    if (label.current) animate(label.current, { opacity: [0, 1], translateX: [dir.current * 40, 0], translateY: [14, 0], delay: 250, duration: 500, ease: "outQuad" });
  }, [shown?.link.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow keys move between jobs (unless you're typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (e.key === "ArrowRight" && p.canNext) { dir.current = 1; p.onNext(); }
      if (e.key === "ArrowLeft" && p.canPrev) { dir.current = -1; p.onPrev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const match = shown?.match;
  const total = match ? match.covered.length + match.missing.length : 0;
  const pct = match && total ? Math.round(match.coverage * 100) : null;

  return (
    <div data-tour="cockpit" className="cockpit relative overflow-hidden rounded-2xl border border-line bg-[#05050a]" style={{ height: 600 }}>
      {/* ---- outside the window ---- */}
      <div className="absolute inset-x-0 top-0" style={{ height: "64%" }}>
        <Starfield warp={warp} />
        <div className="absolute inset-0 flex items-center justify-center">
          {shown ? (
            <div className="flex items-center gap-10">
              <div ref={planet}><Planet id={shown.link.id} size={190} /></div>
              <div ref={label} className="hologram max-w-[300px]">
                <div className="font-mono text-[10px] tracking-[0.3em] text-sonny/80">JOB {p.position} OF {p.total}</div>
                <h3 className="mt-1 text-2xl font-semibold leading-tight">{shown.job.title}</h3>
                <div className="mt-1 text-sm text-white/70">{shown.job.company}</div>
                {shown.job.location && <div className="text-xs text-white/50">{shown.job.location}</div>}
                {shown.read && shown.job.description && (
                  <button className="mt-3 text-xs text-sonny underline" onClick={() => setDetails((v) => !v)}>
                    {details ? "Hide details" : "Scan details"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              {p.scanning && <div className="radar-mini" />}
              <p className="max-w-sm text-sm text-white/60">{p.idleMessage}</p>
            </div>
          )}
        </div>
        {details && shown && (
          <div className="hologram absolute inset-x-10 bottom-4 top-4 overflow-y-auto p-5 text-sm text-white/80">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.3em] text-sonny/80">SCAN · {shown.job.title}</span>
              <button className="text-xs underline" onClick={() => setDetails(false)}>Close</button>
            </div>
            <p className="whitespace-pre-wrap">{shown.job.description}</p>
          </div>
        )}
      </div>

      {/* ---- the cockpit frame: window struts ---- */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 600" preserveAspectRatio="none">
        <defs>
          <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1c1c24" />
            <stop offset="1" stopColor="#0d0d12" />
          </linearGradient>
        </defs>
        <path d="M0 0 H1000 V26 L860 40 H140 L0 26 Z" fill="url(#frame)" />
        <path d="M0 0 L140 40 L60 384 H0 Z" fill="url(#frame)" />
        <path d="M1000 0 L860 40 L940 384 H1000 Z" fill="url(#frame)" />
        <path d="M140 40 L60 384 M860 40 L940 384" stroke="#2a2a33" strokeWidth="3" />
        <path d="M140 40 H860" stroke="#2a2a33" strokeWidth="2" />
      </svg>

      {/* ---- dashboard ---- */}
      <div className="dashboard absolute inset-x-0 bottom-0 grid grid-cols-[1.2fr_0.8fr_1.2fr] gap-4 px-6 pb-5 pt-6" style={{ height: "36%" }}>
        <div className="panel flex flex-col gap-2">
          <div className="font-mono text-[10px] tracking-[0.3em] text-muted">RESUME TO USE</div>
          {shown ? p.resumePanel : <div className="text-sm text-muted">—</div>}
        </div>

        <div className="panel flex flex-col items-center justify-center gap-1">
          <div className="relative h-20 w-20">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#2a2a33" strokeWidth="8" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={pct === null ? "#2a2a33" : pct >= 60 ? "#5fe0a3" : pct >= 35 ? "#f5c542" : "#ff5a4e"}
                strokeWidth="8" strokeLinecap="round" strokeDasharray={`${((pct ?? 0) / 100) * 264} 264`} style={{ transition: "stroke-dasharray .6s ease" }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono text-lg font-bold">
              {pct === null ? "…" : `${pct}%`}
            </div>
          </div>
          <div className="font-mono text-[10px] tracking-[0.2em] text-muted">
            {pct === null ? (shown && !shown.read ? "SCANNING" : "MATCH") : `${match!.covered.length}/${total} KEYWORDS`}
          </div>
        </div>

        <div className="panel flex flex-col justify-between gap-2">
          <div className="flex flex-wrap gap-2">{shown && p.actions}</div>
          <div className="flex items-center gap-2">
            <button className="btn px-4" disabled={!p.canPrev} onClick={() => { dir.current = -1; p.onPrev(); }}>◀</button>
            <button className="thruster flex-1" disabled={!p.canNext} onClick={() => { dir.current = 1; p.onNext(); }}>
              {p.canNext ? "NEXT PLANET ▶" : p.scanning ? "SCANNING…" : "END OF BATCH"}
            </button>
          </div>
        </div>
      </div>

      {/* KASPR riding along on the dashboard */}
      <div className="pointer-events-none absolute bottom-[34%] left-6">
        <KasprSprite size={36} busy={p.scanning} />
      </div>
    </div>
  );
}
