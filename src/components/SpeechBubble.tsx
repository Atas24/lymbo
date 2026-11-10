import { useEffect, useState } from "react";

/** What SONNY is saying right now, typed out a few letters at a time. */
export function SpeechBubble({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const id = setInterval(() => setShown((n) => (n >= text.length ? (clearInterval(id), n) : n + 2)), 16);
    return () => clearInterval(id);
  }, [text]);
  return (
    <div className="relative max-w-xl rounded-2xl border border-sonny/40 bg-[#101a16] px-4 py-3 text-sm leading-relaxed">
      {/* tail pointing at SONNY */}
      <span className="absolute -left-[7px] top-5 h-3 w-3 rotate-45 border-b border-l border-sonny/40 bg-[#101a16]" />
      <span>{text.slice(0, shown)}</span>
      <span className="invisible">{text.slice(shown)}</span>
    </div>
  );
}
