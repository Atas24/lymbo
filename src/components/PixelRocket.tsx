import type { CSSProperties } from "react";

// Pixel rocket pointing right. Built from plain divs (a CSS grid), so it renders the same
// in every browser engine, including the WebKit window the macOS app uses.
const ROCKET = [
  "...RR.........",
  "...RRWWWWW....",
  ".FFWWWWBBWWW..",
  "FFFWWWWBBWWWWR",
  ".FFWWWWWWWWW..",
  "...RRWWWWW....",
  "...RR.........",
];
const COLORS: Record<string, string> = { W: "#e8e8f0", B: "#4a7dff", R: "#ff5a4e", F: "#ff9d2e" };
export const ROCKET_W = ROCKET[0].length;
export const ROCKET_H = ROCKET.length;

export function PixelRocket({ px = 4, className = "", style }: { px?: number; className?: string; style?: CSSProperties }) {
  // One SVG (not a grid of boxes), so no seams show between pixels when the rocket tilts.
  // It sits inside a plain div, and only that div is ever moved or rotated.
  return (
    <div className={className} style={{ width: ROCKET_W * px, height: ROCKET_H * px, ...style }} aria-hidden>
      <svg width={ROCKET_W * px} height={ROCKET_H * px} viewBox={`0 0 ${ROCKET_W} ${ROCKET_H}`} shapeRendering="crispEdges" style={{ display: "block" }}>
        {ROCKET.flatMap((row, y) =>
          [...row].map((ch, x) =>
            COLORS[ch] ? (
              <rect key={`${x}-${y}`} className={ch === "F" ? "rocket-flame" : undefined}
                x={x} y={y} width={1.02} height={1.02} fill={COLORS[ch]} />
            ) : null,
          ),
        )}
      </svg>
    </div>
  );
}
