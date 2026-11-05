import { useRef } from "react";
import { animate } from "animejs";
import { useApp } from "../lib/context";

export function KillSwitch() {
  const { session, killSession } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  const press = async () => {
    if (ref.current) animate(ref.current, { scale: [0.9, 1], duration: 400, ease: "outElastic(1, .5)" });
    await killSession();
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        ref={ref}
        onClick={press}
        disabled={!session.active}
        className="h-36 w-36 rounded-full border-4 border-[#7a1410] bg-gradient-to-b from-[#ff3b30] to-[#b3150c]
                   font-mono text-lg font-bold tracking-widest text-white shadow-[0_8px_0_#5c0f0b,0_0_40px_rgba(255,59,48,.35)]
                   transition active:translate-y-1 active:shadow-[0_3px_0_#5c0f0b] disabled:opacity-35 disabled:shadow-none"
      >
        KILL
        <br />
        SWITCH
      </button>
      <p className="text-center text-xs text-muted">
        {session.active ? "Stops the session and all agent activity now." : "No session running."}
      </p>
    </div>
  );
}
