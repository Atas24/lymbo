import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { springy } from "../lib/motion";
import type { Toast } from "../lib/context";

function ToastItem({ t, onClose }: { t: Toast; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) animate(ref.current, { translateX: [80, 0], scale: [0.9, 1], opacity: [0, 1], ease: springy });
    // Agent suggestions stay until dismissed; plain notices fade on their own.
    if (!t.action) {
      const id = setTimeout(onClose, 5000);
      return () => clearTimeout(id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const color =
    t.tone === "error" ? "border-accent" : t.from === "SONNY" ? "border-sonny" : t.from === "KASPR" ? "border-kaspr" : "border-line";
  return (
    <div ref={ref} className={`card w-80 border-l-4 ${color} p-4 shadow-xl`}>
      {t.from && <div className="mb-1 font-mono text-[10px] tracking-widest text-muted">{t.from}</div>}
      <p className="text-sm">{t.text}</p>
      <div className="mt-3 flex gap-2">
        {t.action && (
          <button
            className="btn btn-primary"
            onClick={() => {
              t.action!.run();
              onClose();
            }}
          >
            {t.action.label}
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-3">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem t={t} onClose={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
