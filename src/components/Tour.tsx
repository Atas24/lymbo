import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { springy } from "../lib/motion";
import { KasprSprite, SonnySprite } from "./Sprites";
import type { Page } from "../lib/types";

export interface TourStep {
  /** Screen to switch to for this step. */
  page?: Page;
  /** `data-tour` name of the thing to spotlight. No target = a centered card. */
  target?: string;
  title: string;
  body: string;
}

export const TOUR: TourStep[] = [
  {
    target: "nav",
    title: "Four screens",
    body: "Control Room is your library. KASPR finds jobs on Handshake. SONNY tailors your resume. Settings holds your API key and limits.",
  },
  {
    page: "settings", target: "apikey",
    title: "First: your API key",
    body: "KASPR and SONNY run on your own Anthropic API key (from console.anthropic.com). It's saved in your Mac's Keychain, and you pay Anthropic directly, usually around a cent per batch of jobs.",
  },
  {
    page: "control", target: "resumes",
    title: "Upload your resume",
    body: "Drop in your resume as a Word file (.docx). KASPR compares jobs against it, and SONNY makes tailored versions of it that keep your formatting. A PDF works too, but then SONNY can't make versions.",
  },
  {
    page: "control", target: "stats",
    title: "Your numbers",
    body: "Jobs applied, SONNY workshops, time spent and estimated API spend, all counted on this computer.",
  },
  {
    page: "control", target: "timeline",
    title: "Application timeline",
    body: "Every job you tell KASPR you applied to lands here, with the resume version you used. Update the status as you hear back.",
  },
  {
    page: "control", target: "killswitch",
    title: "The kill switch",
    body: "Stops everything right away: ends the session, stops KASPR mid-step and closes its Chrome window.",
  },
  {
    target: "session",
    title: "Start a session",
    body: "KASPR and SONNY only work while a session is running, never in the background. This bar shows how long you've been at it and the estimated cost.",
  },
  {
    page: "kaspr", target: "handshake",
    title: "Connect Handshake",
    body: "Save your Handshake login once; it stays in your Keychain. KASPR signs you in through a Chrome window. If your school uses Duo, approve it, then click \"I'm signed in\".",
  },
  {
    page: "kaspr", target: "findjobs",
    title: "Tell KASPR what you want",
    body: "Pick where, and internships or full-time, then hit Find jobs. No typing: KASPR works out the searches from your resume.",
  },
  {
    page: "kaspr", target: "slider",
    title: "How specific",
    body: "Slide toward Specific to only see jobs your resume closely matches, or toward Broad to see everything. You can change it anytime.",
  },
  {
    page: "kaspr", target: "cockpit",
    title: "The cockpit",
    body: "KASPR flies you through the jobs one at a time. Each planet is a job; the dashboard shows which resume to use and how well it matches. Hit Next planet (or the → key) to fly to the next one. If none of your resumes fit, click Work with SONNY. To tailor your resume for just one posting, use Work with SONNY on this job.",
  },
  {
    page: "sonny", target: "versions",
    title: "SONNY's resume versions",
    body: "After a batch, SONNY groups the jobs by kind of role and drafts a version of your resume for each. Untick any change you don't want, then approve. From then on KASPR tells you which version to use for each job. You always click Apply yourself.",
  },
  {
    page: "control",
    title: "You're ready",
    body: "Add your API key, upload your resume, start a session, and find some jobs. You can replay this tour anytime from Settings.",
  },
];

const PAD = 10;
const CARD_W = 360;

/** Spotlights one part of the app at a time, switching screens as needed. */
export function Tour({ step, setStep, go, onEnd }: {
  step: number;
  setStep: (n: number) => void;
  go: (p: Page) => void;
  onEnd: () => void;
}) {
  const s = TOUR[step];
  const spot = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);

  // Go to the step's screen, find the target, scroll it into view, then measure it.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    if (s.page) go(s.page);
    const find = async () => {
      await new Promise((r) => setTimeout(r, s.page ? 450 : 50));
      const el = s.target ? document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`) : null;
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        await new Promise((r) => setTimeout(r, 350));
      }
      if (cancelled) return;
      setRect(el ? el.getBoundingClientRect() : null);
      setReady(true);
    };
    find();
    const onResize = () => {
      const el = s.target ? document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
    };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Glide the spotlight to the new target; pop the card in.
  useLayoutEffect(() => {
    if (!ready || !spot.current) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const to = rect
      ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
      : { left: vw / 2, top: vh / 2, width: 0, height: 0 };
    animate(spot.current, {
      left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
      duration: 550, ease: "inOutCubic",
    });
    if (card.current) animate(card.current, { opacity: [0, 1], scale: [0.92, 1], translateY: [10, 0], ease: springy, delay: 150 });
  }, [ready, rect]);

  // Card goes below the target if there's room, otherwise above; centered when there's no target.
  const vw = window.innerWidth, vh = window.innerHeight;
  let cardStyle: React.CSSProperties = { left: vw / 2 - CARD_W / 2, top: vh / 2 - 120 };
  if (rect) {
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 16);
    const below = rect.bottom + PAD + 16;
    cardStyle = below + 230 < vh ? { left, top: below } : { left, top: Math.max(16, rect.top - PAD - 16 - 230) };
    // tall targets (like the sidebar): put the card beside it
    if (rect.height > vh * 0.6) cardStyle = { left: Math.min(rect.right + PAD + 16, vw - CARD_W - 16), top: Math.max(16, rect.top + 40) };
  }

  const last = step === TOUR.length - 1;
  const agent = s.page === "sonny" ? <SonnySprite size={26} /> : <KasprSprite size={30} />;

  return (
    <div className="fixed inset-0 z-[95]" onKeyDown={(e) => e.key === "Escape" && onEnd()}>
      {/* dims everything except the spotlight (a hole made with a huge shadow) */}
      <div ref={spot} className="pointer-events-none fixed rounded-xl ring-2 ring-accent"
        style={{ left: vw / 2, top: vh / 2, width: 0, height: 0, boxShadow: "0 0 0 9999px rgba(12,12,15,0.78)" }} />
      {/* clicks outside the card don't reach the app during the tour */}
      <div className="absolute inset-0" />
      {ready && (
        <div ref={card} className="card fixed flex flex-col gap-3 border-accent/40 shadow-2xl" style={{ width: CARD_W, ...cardStyle }}>
          <div className="flex items-center gap-3">
            {agent}
            <div className="flex-1">
              <div className="font-mono text-[10px] tracking-widest text-muted">STEP {step + 1} OF {TOUR.length}</div>
              <h3 className="font-semibold">{s.title}</h3>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-muted">{s.body}</p>
          <div className="flex gap-1">
            {TOUR.map((_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="text-xs text-muted underline" onClick={onEnd}>Skip tour</button>
            <span className="ml-auto flex gap-2">
              {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
              <button className="btn btn-primary" onClick={() => (last ? onEnd() : setStep(step + 1))}>
                {last ? "Let's go" : "Next"}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

const DONT_SHOW = "lymbo.tour.dontShow";
export const tourDismissed = () => {
  try {
    return localStorage.getItem(DONT_SHOW) === "1";
  } catch {
    return false;
  }
};
export const setTourDismissed = (v: boolean) => {
  try {
    v ? localStorage.setItem(DONT_SHOW, "1") : localStorage.removeItem(DONT_SHOW);
  } catch {
    /* storage unavailable: the welcome card just shows again next time */
  }
};

/** First-open card: take the tour, or not, with "Don't show this again". */
export function Welcome({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  const [dontShow, setDontShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) animate(ref.current, { opacity: [0, 1], scale: [0.9, 1], translateY: [16, 0], ease: springy });
  }, []);
  const close = (start: boolean) => {
    setTourDismissed(dontShow);
    start ? onStart() : onClose();
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/80 backdrop-blur-sm">
      <div ref={ref} className="card flex w-[420px] flex-col items-center gap-4 text-center shadow-2xl">
        <div className="flex items-end gap-4">
          <KasprSprite size={48} />
          <SonnySprite size={40} />
        </div>
        <h2 className="text-xl font-semibold">Welcome to Lymbo</h2>
        <p className="text-sm text-muted">
          KASPR finds jobs on Handshake and SONNY tailors your resume for them. Want a quick tour of how it all works?
          It takes about a minute.
        </p>
        <div className="flex gap-2">
          <button className="btn" onClick={() => close(false)}>Not now</button>
          <button className="btn btn-primary" onClick={() => close(true)}>Take the tour</button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          Don't show this again
        </label>
      </div>
    </div>
  );
}
