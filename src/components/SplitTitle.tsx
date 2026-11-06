import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { springy, wave } from "../lib/motion";

/** Page heading whose letters spring in, and wave when you hover it. */
export function SplitTitle({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!ref.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = animate(ref.current.querySelectorAll(".ch"), {
      opacity: [0, 1], translateY: [22, 0], rotate: [8, 0], delay: stagger(28), ease: springy,
    });
    return () => void a.pause();
  }, [text]);
  return (
    <h1 ref={ref} className="text-2xl font-semibold" onMouseEnter={() => ref.current && wave(ref.current.querySelectorAll(".ch"))}>
      {[...text].map((c, i) => (
        <span key={i} className="ch inline-block" style={{ whiteSpace: "pre" }}>{c}</span>
      ))}
    </h1>
  );
}
