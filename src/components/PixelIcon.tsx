// Small pixel icons for SONNY's desk, drawn as crisp SVGs like the rocket and briefcase.
const ICONS = {
  // a page with a pencil line: tailor the resume
  resume: [
    "..OOOOOOO...",
    "..OWWWWWOO..",
    "..OWAAAWWOO.",
    "..OWWWWWWWO.",
    "..OWAAAAAWO.",
    "..OWWWWWWWO.",
    "..OWAAAAAWO.",
    "..OWWWWWWWO.",
    "..OWAAAWWPO.",
    "..OWWWWWPPO.",
    "..OOOOOOPPO.",
    ".........P..",
  ],
  // an envelope: cover letter
  letter: [
    "............",
    "OOOOOOOOOOOO",
    "OAWWWWWWWWAO",
    "OWAWWWWWWAWO",
    "OWWAWWWWAWWO",
    "OWWWAWWAWWWO",
    "OWWWWAAWWWWO",
    "OWWWWWWWWWWO",
    "OWWWWWWWWWWO",
    "OOOOOOOOOOOO",
    "............",
    "............",
  ],
  // a magnifying glass: quick check
  check: [
    "..OOOO......",
    ".OWWWWO.....",
    "OWAWWWWO....",
    "OWAWWWWO....",
    "OWWWWWWO....",
    "OWWWWWWO....",
    ".OWWWWO.....",
    "..OOOOPP....",
    "......PPP...",
    ".......PPP..",
    "........PP..",
    "............",
  ],
} as const;

export type PixelIconName = keyof typeof ICONS;

export function PixelIcon({ name, size = 36, color = "#5fe0a3" }: { name: PixelIconName; size?: number; color?: string }) {
  const art = ICONS[name];
  const fill: Record<string, string> = { O: "#141017", W: "#eef0f4", A: color, P: "#f5c542" };
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden style={{ display: "block" }}>
      {art.flatMap((row, y) =>
        [...row].map((ch, x) => (fill[ch] ? <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill[ch]} /> : null)),
      )}
    </svg>
  );
}
