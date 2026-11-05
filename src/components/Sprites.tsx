// Pixel-art agents, drawn as SVG grids. Each character in a row is one pixel;
// "." is transparent. Pixels whose palette entry has a `group` get wrapped in
// <g class="..."> so anime.js can animate that part (propeller, steam).
import { useEffect, useRef, type ReactElement } from "react";
import { animate, stagger } from "animejs";

type Palette = Record<string, { fill: string; group?: string }>;

function PixelSprite({ grid, palette, size }: { grid: string[]; palette: Palette; size: number }) {
  const w = grid[0].length;
  const h = grid.length;
  const groups = new Map<string, ReactElement[]>();
  grid.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const p = palette[ch];
      if (!p) return;
      const key = p.group ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={p.fill} />);
    }),
  );
  return (
    <svg className="pixel" viewBox={`0 0 ${w} ${h}`} width={size} height={(size * h) / w}>
      {[...groups].map(([cls, rects]) => (
        <g key={cls || "base"} className={cls || undefined}>
          {rects}
        </g>
      ))}
    </svg>
  );
}

// KASPR: owl in a propeller hat.
const OWL = [
  "...RRRR..RRRR...",
  ".......KK.......",
  "......YBBY......",
  ".....YYBBYY.....",
  "...bbYYYYYYbb...",
  "..bbbbbbbbbbbb..",
  "..bwwwbbbbwwwb..",
  "..bwkwbbbbwkwb..",
  "..bwwwboobwwwb..",
  "..bbbbboobbbbb..",
  "..bbllllllllbb..",
  ".bbbllllllllbbb.",
  ".bbbllllllllbbb.",
  "..bbllllllllbb..",
  "...bbbbbbbbbb...",
  "....oo....oo....",
];
const OWL_PALETTE: Palette = {
  R: { fill: "#ff5a4e", group: "kaspr-prop" },
  K: { fill: "#3a3a44" },
  Y: { fill: "#f5c542" },
  B: { fill: "#4a7dff" },
  b: { fill: "#8a5a3b" },
  l: { fill: "#e6c9a1" },
  w: { fill: "#ffffff" },
  k: { fill: "#111111" },
  o: { fill: "#ff9d2e" },
};

// SONNY: smiling chip...
const CHIP = [
  "..s.s..s.s..",
  ".GGGGGGGGGG.",
  "sGggggggggGs",
  ".GgwwggwwgG.",
  "sGgkwggkwgGs",
  ".GggggggggG.",
  "sGgkggggkgGs",
  ".GggkkkkggG.",
  "sGggggggggGs",
  ".GGGGGGGGGG.",
  "..s.s..s.s..",
];
const CHIP_PALETTE: Palette = {
  s: { fill: "#b8b8c4" },
  G: { fill: "#1f8a5b" },
  g: { fill: "#5fe0a3" },
  w: { fill: "#ffffff" },
  k: { fill: "#0c0c0f" },
};

// ...next to a steaming mug. Each steam column is its own group so they drift separately.
const MUG = [
  "..1..2..",
  ".1..2...",
  "..1..2..",
  ".1..2...",
  "........",
  "MMMMMM..",
  "MccccM..",
  "MwwwwMMM",
  "MwwwwM.M",
  "MwwwwM.M",
  "MwwwwMMM",
  "MwwwwM..",
  ".MMMM...",
];
const MUG_PALETTE: Palette = {
  "1": { fill: "#d8d8e0", group: "sonny-steam" },
  "2": { fill: "#d8d8e0", group: "sonny-steam" },
  M: { fill: "#ff9d2e" },
  c: { fill: "#6b3e22" },
  w: { fill: "#f4eadb" },
};

export function KasprSprite({ size = 48, busy = false }: { size?: number; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prop = ref.current?.querySelector(".kaspr-prop");
    if (!prop) return;
    // Faster spin while KASPR is working.
    const spin = animate(prop, {
      scaleX: [1, -1],
      duration: busy ? 120 : 600,
      loop: true,
      alternate: true,
      ease: "linear",
    });
    const bob = busy
      ? animate(ref.current!, { translateY: [0, -3], duration: 300, loop: true, alternate: true, ease: "inOutSine" })
      : null;
    return () => {
      spin.revert();
      bob?.revert();
    };
  }, [busy]);
  return (
    <div ref={ref} title="KASPR">
      <PixelSprite grid={OWL} palette={OWL_PALETTE} size={size} />
    </div>
  );
}

export function SonnySprite({ size = 48, busy = false }: { size?: number; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const steam = ref.current?.querySelectorAll(".sonny-steam");
    if (!steam?.length) return;
    const puff = animate(steam, {
      translateY: [0, -2],
      opacity: [1, 0.15],
      duration: busy ? 500 : 1400,
      delay: stagger(250),
      loop: true,
      alternate: true,
      ease: "inOutSine",
    });
    const bob = busy
      ? animate(ref.current!, { translateY: [0, -3], duration: 300, loop: true, alternate: true, ease: "inOutSine" })
      : null;
    return () => {
      puff.revert();
      bob?.revert();
    };
  }, [busy]);
  return (
    <div ref={ref} className="flex items-end gap-1" title="SONNY">
      <PixelSprite grid={CHIP} palette={CHIP_PALETTE} size={size} />
      <PixelSprite grid={MUG} palette={MUG_PALETTE} size={size * 0.62} />
    </div>
  );
}
