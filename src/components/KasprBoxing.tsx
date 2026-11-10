import { useEffect, useRef } from "react";
import { KasprSprite } from "./Sprites";

// KASPR waiting for a job: boxing a punching bag. Pixel art drawn as crisp SVGs, moved
// frame by frame with requestAnimationFrame (plain divs only, so it looks the same in the
// macOS WebKit window as in Chrome).

const P = 4; // screen pixels per art pixel

function Pixels({ art, colors }: { art: string[]; colors: Record<string, string> }) {
  const w = art[0].length, h = art.length;
  return (
    <svg width={w * P} height={h * P} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" style={{ display: "block" }} aria-hidden>
      {art.flatMap((row, y) =>
        [...row].map((ch, x) => (colors[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={colors[ch]} /> : null)),
      )}
    </svg>
  );
}

// Boxing glove, pointing right.
const GLOVE = [
  "WRRR.",
  "WRRRR",
  "WRRRD",
  "WDDD.",
];
const GLOVE_COLORS = { W: "#f4eadb", R: "#ff5a4e", D: "#c23a30" };

// Punching bag on its chain; it swings from the top of the chain.
const BAG = [
    "....C....",
    "....c....",
    "....C....",
    "....c....",
    "....C....",
    "....c....",
    "....C....",
    "....c....",
    "....C....",
    "....c....",
    "....C....",
  "...CCC...",
  ".OOOOOOO.",
  "OOOOOOOOO",
  "OhhBBBBBO",
  "OhBBBBBBO",
  "OYYYYYYYO",
  "OhBBBBBBO",
  "OhBBBBBBO",
  "OhBBBBBBO",
  "OhBBBBBBO",
  "OYYYYYYYO",
  "OhBBBBBBO",
  "OBBBBBBBO",
  ".OOOOOOO.",
];
const BAG_COLORS = { O: "#141017", B: "#2f4a7a", h: "#4c6ca3", Y: "#f5c542", C: "#8b8b98", c: "#5a5a66" };

// Little starburst where the glove lands.
const POW = [
  "Y...Y",
  ".Y.Y.",
  "..W..",
  ".Y.Y.",
  "Y...Y",
];
const POW_COLORS = { Y: "#f5c542", W: "#ffffff" };

// Layout (px)
const OWL = { left: 34, top: 56 };
const FRONT = { left: OWL.left + 12 * P, top: OWL.top + 10 * P };
const BACK = { left: OWL.left - 2, top: OWL.top + 9 * P };
const BAG_POS = { left: 120, top: 12 };
const REACH = 18; // how far a punch travels

/** resting = an easy combo now and then; watching = a combo every couple of seconds; reading = quick flurry. */
export function KasprBoxing({ mode }: { mode: "resting" | "watching" | "reading" }) {
  const owl = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const bag = useRef<HTMLDivElement>(null);
  const pow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Punch start times within one cycle (ms).
    const cycle = mode === "reading" ? 900 : mode === "watching" ? 2600 : 3400;
    const punches = mode === "reading" ? [0, 450] : [0, 360];
    const OUT = 90, BACK_MS = 150; // glove out, glove back
    const t0 = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      const t = now - t0;
      const inCycle = t % cycle;
      const cycleStart = t - inCycle;

      // Front glove: out fast, back a bit slower.
      let ext = 0;
      for (const s of punches) {
        const dt = inCycle - s;
        if (dt >= 0 && dt < OUT) ext = Math.max(ext, 1 - (1 - dt / OUT) ** 2);
        else if (dt >= OUT && dt < OUT + BACK_MS) ext = Math.max(ext, 1 - (dt - OUT) / BACK_MS);
      }

      // Bag: each hit starts a swing that dies down. Hits from the last cycle still count.
      let angle = 0;
      let flash = 0;
      for (const base of [cycleStart - cycle, cycleStart]) {
        punches.forEach((s, i) => {
          const dt = t - (base + s + OUT);
          if (dt < 0) return;
          angle += (i === 0 ? 11 : 15) * Math.exp(-dt / 420) * Math.sin(dt / 120);
          if (dt < 140) flash = Math.max(flash, 1 - dt / 140);
        });
      }

      // Boxer bounce; the back glove stays up on guard.
      const bob = Math.round(Math.sin(t / 220) * 1.5);
      const lunge = Math.round(ext * 3);
      if (owl.current) owl.current.style.transform = `translate(${lunge}px, ${bob}px)`;
      if (front.current) front.current.style.transform = `translate(${Math.round(ext * REACH / 2) * 2 + lunge}px, ${bob}px)`;
      if (back.current) back.current.style.transform = `translate(${lunge}px, ${bob + Math.round(Math.sin(t / 160))}px)`;
      if (bag.current) bag.current.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      if (pow.current) {
        pow.current.style.opacity = String(flash);
        pow.current.style.transform = `scale(${0.6 + (1 - flash) * 0.8})`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <div className="relative" style={{ width: 210, height: 132 }} aria-label="KASPR boxing a punching bag">
      {/* beam the bag hangs from */}
      <div className="absolute rounded-sm bg-[#3a3a44]" style={{ left: 110, top: 8, width: 56, height: 4 }} />
      <div ref={bag} className="absolute" style={{ left: BAG_POS.left, top: BAG_POS.top, transformOrigin: "50% 0" }}>
        <Pixels art={BAG} colors={BAG_COLORS} />
      </div>
      <div ref={back} className="absolute z-20" style={BACK}><Pixels art={GLOVE} colors={GLOVE_COLORS} /></div>
      <div ref={owl} className="absolute z-10" style={OWL}><KasprSprite size={16 * P} busy={mode === "reading"} /></div>
      <div ref={front} className="absolute z-20" style={FRONT}><Pixels art={GLOVE} colors={GLOVE_COLORS} /></div>
      <div ref={pow} className="absolute z-30" style={{ left: BAG_POS.left - 10, top: FRONT.top - 2, opacity: 0 }}>
        <Pixels art={POW} colors={POW_COLORS} />
      </div>
      {/* floor */}
      <div className="absolute h-0.5 bg-line" style={{ left: 16, right: 16, top: OWL.top + 16 * P + 2 }} />
    </div>
  );
}
