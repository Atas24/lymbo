import { useEffect, useRef, type ReactNode } from "react";
import { animate } from "animejs";
import { springy } from "../lib/motion";
import { KasprSprite, SonnySprite } from "./Sprites";

/** Springs in from above when an agent appears. */
function Pop({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) animate(ref.current, { translateY: [-30, 0], scale: [0.4, 1], opacity: [0, 1], ease: springy });
  }, []);
  return <div ref={ref}>{children}</div>;
}
import type { AgentName } from "../lib/types";

/** Top-right: shows whichever agents you're using right now. */
export function AgentDock({ visible, busy }: { visible: Set<AgentName>; busy: Set<AgentName> }) {
  if (visible.size === 0) return null;
  return (
    <div className="flex items-end gap-4">
      {visible.has("KASPR") && (
        <Pop><div className="flex flex-col items-center gap-1">
          <KasprSprite size={40} busy={busy.has("KASPR")} />
          <span className="font-mono text-[10px] tracking-widest text-kaspr">
            KASPR{busy.has("KASPR") ? "…" : ""}
          </span>
        </div></Pop>
      )}
      {visible.has("SONNY") && (
        <Pop><div className="flex flex-col items-center gap-1">
          <SonnySprite size={34} busy={busy.has("SONNY")} />
          <span className="font-mono text-[10px] tracking-widest text-sonny">
            SONNY{busy.has("SONNY") ? "…" : ""}
          </span>
        </div></Pop>
      )}
    </div>
  );
}
