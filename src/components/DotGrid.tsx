import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { animate, stagger } from "animejs";

export interface DotGridHandle {
  /** Ripple out from a point in the grid's own coordinates (or the center). */
  ripple: (x?: number, y?: number) => void;
}

const GAP = 34;

/**
 * The anime.js-style dot grid: faint dots behind the app that ripple outward when you
 * switch screens or click. Purely decorative and ignores the mouse.
 */
export const DotGrid = forwardRef<DotGridHandle>(function DotGrid(_, ref) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ cols: 0, rows: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () =>
      setSize({ cols: Math.ceil(el.clientWidth / GAP), rows: Math.ceil(el.clientHeight / GAP) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    ripple: (x?: number, y?: number) => {
      const el = box.current;
      if (!el || !size.cols || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const col = x === undefined ? Math.floor(size.cols / 2) : Math.min(size.cols - 1, Math.max(0, Math.round(x / GAP)));
      const row = y === undefined ? Math.floor(size.rows / 2) : Math.min(size.rows - 1, Math.max(0, Math.round(y / GAP)));
      animate(el.querySelectorAll(".dot"), {
        scale: [1, 2.6, 1],
        opacity: [0.12, 0.7, 0.12],
        backgroundColor: ["#8b8b98", "#ff5a4e", "#8b8b98"],
        delay: stagger(28, { grid: [size.cols, size.rows], from: row * size.cols + col }),
        duration: 900,
        ease: "inOutQuad",
      });
    },
  }), [size]);

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${size.cols}, ${GAP}px)`, gridAutoRows: `${GAP}px` }}>
        {Array.from({ length: size.cols * size.rows }, (_, i) => (
          <span key={i} className="flex items-center justify-center">
            <span className="dot block h-[3px] w-[3px] rounded-full bg-muted opacity-[0.12]" />
          </span>
        ))}
      </div>
    </div>
  );
});
