import { KasprSprite, SonnySprite } from "./Sprites";
import type { AgentName } from "../lib/types";

/** Top-right: shows whichever agents you're using right now. */
export function AgentDock({ visible, busy }: { visible: Set<AgentName>; busy: Set<AgentName> }) {
  if (visible.size === 0) return null;
  return (
    <div className="flex items-end gap-4">
      {visible.has("KASPR") && (
        <div className="flex flex-col items-center gap-1">
          <KasprSprite size={40} busy={busy.has("KASPR")} />
          <span className="font-mono text-[10px] tracking-widest text-kaspr">
            KASPR{busy.has("KASPR") ? "…" : ""}
          </span>
        </div>
      )}
      {visible.has("SONNY") && (
        <div className="flex flex-col items-center gap-1">
          <SonnySprite size={34} busy={busy.has("SONNY")} />
          <span className="font-mono text-[10px] tracking-widest text-sonny">
            SONNY{busy.has("SONNY") ? "…" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
