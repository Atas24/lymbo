import { useMemo } from "react";

// Pixel briefcase, one per job. Drawn as one crisp SVG (like the rocket) so pixels never seam.
const ART = [
  ".....OOOOOO.....",
  "....OHHHHHHO....",
  "....OH....HO....",
  "OOOOOOOOOOOOOOOO",
  "OSSSSSSSSSSSSSSO",
  "OLLLLLLLLLLLLLLO",
  "OLLLLLLLLLLLLLLO",
  "ODDDDDDGGDDDDDDO",
  "OLLLLLLGGLLLLLLO",
  "OLLLLLLLLLLLLLLO",
  "OLLLLLLLLLLLLLLO",
  "OKKKKKKKKKKKKKKO",
  "OOOOOOOOOOOOOOOO",
];
const W = ART[0].length;
const H = ART.length;

/** Leather colors: [main, highlight, strap, shadow/handle]. Each job always gets the same one. */
const LEATHER = [
  ["#9a6332", "#c28650", "#774b24", "#5a3819"], // brown
  ["#c0702e", "#e0975a", "#96551f", "#723f16"], // cognac
  ["#9a3a4a", "#c25a6a", "#76293a", "#5a1f2b"], // burgundy
  ["#c9965a", "#e6b980", "#a2733e", "#7d5730"], // tan
  ["#6b8a4a", "#8eaf6a", "#526b37", "#3d5129"], // olive
  ["#4f6ea8", "#7593cc", "#3b5487", "#2d4068"], // slate blue
];

function pick(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return LEATHER[(h >>> 0) % LEATHER.length];
}

export function Briefcase({ id, size }: { id: string; size: number }) {
  const [main, light, strap, dark] = useMemo(() => pick(id), [id]);
  const colors: Record<string, string> = { O: "#141017", H: dark, S: light, L: main, D: strap, G: "#f5c542", K: dark };
  const px = size / W;
  return (
    <svg width={size} height={H * px} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" aria-hidden
      style={{ display: "block", filter: `drop-shadow(0 0 ${Math.max(2, size / 8)}px ${main}66)` }}>
      {ART.flatMap((row, y) =>
        [...row].map((ch, x) => (colors[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={colors[ch]} /> : null)),
      )}
    </svg>
  );
}
