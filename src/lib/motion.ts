// Shared animation helpers (anime.js), so motion feels the same everywhere.
import { animate, createSpring, stagger, type TargetsParam } from "animejs";

/** Bouncy but quick: used for things arriving on screen. */
export const springy = createSpring({ stiffness: 170, damping: 14 });
export const softSpring = createSpring({ stiffness: 110, damping: 16 });

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Slide + fade in, staggered. */
export function enter(targets: TargetsParam, delay = 60) {
  if (reduced()) return;
  return animate(targets, { opacity: [0, 1], translateY: [18, 0], delay: stagger(delay), ease: softSpring });
}

/** Pop in from small, staggered (chips, badges, list rows). */
export function popIn(targets: TargetsParam, delay = 35) {
  if (reduced()) return;
  return animate(targets, { opacity: [0, 1], scale: [0.6, 1], delay: stagger(delay), ease: springy });
}

/** Shrink + fade out, then resolve (for things being deleted). */
export function leave(el: Element | null): Promise<void> {
  if (!el || reduced()) return Promise.resolve();
  return new Promise((resolve) => {
    animate(el, {
      opacity: [1, 0], scale: [1, 0.92], translateX: [0, 24], duration: 280, ease: "inQuad",
      onComplete: () => resolve(),
    });
  });
}

/** Letters bounce one after another (logo hover, headings). */
export function wave(targets: TargetsParam) {
  if (reduced()) return;
  return animate(targets, { translateY: [0, -6, 0], delay: stagger(40), duration: 500, ease: "inOutSine" });
}

/** Quick squash when a button is pressed. */
export function press(el: Element) {
  if (reduced()) return;
  animate(el, { scale: [0.92, 1], duration: 450, ease: springy });
}
