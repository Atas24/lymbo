import { useEffect, useMemo, useRef, useState } from "react";
import { animate, createSpring, stagger } from "animejs";
import { PixelRocket } from "./PixelRocket";
import { KasprSprite } from "./Sprites";

/**
 * Opening screen: the LYMBO logo, KASPR riding a pixel rocket, and a Blast off button.
 * Clicking it launches the rocket off the screen and opens the app.
 *
 * The launch uses plain CSS transitions and keyframes (not a library) so it looks the
 * same in every browser engine, including the WebKit window the macOS app uses.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const ship = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"idle" | "ignite" | "launch">("idle");
  const stars = useMemo(
    () => Array.from({ length: 80 }, () => ({
      x: Math.random() * 100, y: Math.random() * 100, s: Math.random() < 0.2 ? 3 : 2, d: Math.random() * 2,
    })),
    [],
  );

  // Letters spring in (decorative; if it can't run, they're simply shown).
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      const letters = el.querySelectorAll<HTMLElement>(".splash-letter");
      letters.forEach((l) => (l.style.opacity = "0"));
      const a = animate(letters, {
        translateY: [40, 0], opacity: [0, 1], rotate: [-12, 0],
        delay: stagger(80, { start: 150 }), ease: createSpring({ stiffness: 140, damping: 11 }),
      });
      return () => void a.pause();
    } catch {
      el.querySelectorAll<HTMLElement>(".splash-letter").forEach((l) => (l.style.opacity = "1"));
    }
  }, []);

  const blastOff = () => {
    if (phase !== "idle") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onDone();
    setPhase("ignite"); // rumble + big flames
    setTimeout(() => {
      setPhase("launch"); // fly up and away, leaving exhaust puffs
      const el = root.current;
      const rocket = ship.current;
      if (!el || !rocket) return;
      const box = el.getBoundingClientRect();
      const start = performance.now();
      const DURATION = 1100;
      let frame = 0;
      const fly = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        const e = t * t * t; // slow at first, then fast, like a real launch
        const tilt = -35 * Math.min(1, t * 3);
        rocket.style.transform =
          `translate(${e * window.innerWidth * 0.6}px, ${-e * window.innerHeight * 0.9}px) rotate(${tilt}deg) scale(${1 - 0.3 * e})`;
        if (frame++ % 2 === 0) {
          const r = rocket.getBoundingClientRect();
          const p = document.createElement("span");
          p.className = "exhaust";
          p.style.left = `${r.left - box.left + r.width * 0.1}px`;
          p.style.top = `${r.top - box.top + r.height * 0.8}px`;
          el.appendChild(p);
          setTimeout(() => p.remove(), 700);
        }
        if (t < 1) requestAnimationFrame(fly);
      };
      requestAnimationFrame(fly);
    }, 650);
    setTimeout(() => {
      if (root.current) {
        root.current.style.transition = "opacity 450ms ease";
        root.current.style.opacity = "0";
      }
      setTimeout(onDone, 450);
    }, 1750);
  };

  // Enter or Space also launches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") blastOff();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={root} className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-ink ${phase === "ignite" ? "rumble" : ""}`}>
      {stars.map((s, i) => (
        <span key={i} className={`splash-star absolute bg-white ${phase === "launch" ? "warp" : ""}`}
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s` }} />
      ))}

      <div className="flex font-mono text-6xl font-bold tracking-[0.35em]">
        {"LYMBO".split("").map((c, i) => <span key={i} className="splash-letter inline-block">{c}</span>)}
        <span className="splash-letter inline-block text-accent">.</span>
      </div>
      <div className="mt-3 text-sm text-muted">find it · tailor it · apply</div>

      {/* KASPR riding the rocket */}
      <div ref={ship} className={`relative mt-14 ${phase === "idle" ? "ship-idle" : ""} ${phase === "ignite" ? "ship-ignite" : ""} ${phase === "launch" ? "ship-launch" : ""}`}
        style={{ width: 14 * 9, height: 7 * 9 + 44 }}>
        <div className="absolute left-1/2 top-0 -translate-x-[40%]">
          <KasprSprite size={44} busy={phase !== "idle"} />
        </div>
        <div className={`absolute bottom-0 left-0 ${phase !== "idle" ? "boost" : ""}`}>
          <PixelRocket px={9} />
        </div>
      </div>

      <button onClick={blastOff} disabled={phase !== "idle"}
        className="blast-btn mt-10 rounded-full border-2 border-accent bg-accent px-10 py-3 font-mono text-lg font-bold tracking-[0.25em] text-ink transition disabled:opacity-0">
        BLAST OFF
      </button>
      <div className={`mt-3 text-xs text-muted/60 transition ${phase === "idle" ? "" : "opacity-0"}`}>or press Enter</div>
    </div>
  );
}
