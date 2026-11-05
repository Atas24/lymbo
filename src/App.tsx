import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText, fmtDuration, fmtUsd } from "./lib/api";
import { bus } from "./lib/bus";
import { worthTailoring } from "./lib/keywords";
import { Ctx, KASPR_INITIAL, type AppCtx, type KasprState, type Toast } from "./lib/context";
import type { AgentName, JobContext, Page, SessionStatus } from "./lib/types";
import { AgentDock } from "./components/AgentDock";
import { Toasts } from "./components/Toasts";
import ControlRoom from "./pages/ControlRoom";
import KasprPage from "./pages/KasprPage";
import SonnyPage from "./pages/SonnyPage";
import SettingsPage from "./pages/SettingsPage";

const EMPTY_SESSION: SessionStatus = { active: false, elapsed_secs: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };

const NAV: { id: Page; label: string; hint: string }[] = [
  { id: "control", label: "Control Room", hint: "Library, timeline, stats" },
  { id: "kaspr", label: "KASPR", hint: "Find & apply" },
  { id: "sonny", label: "SONNY", hint: "Resume workshop" },
  { id: "settings", label: "Settings", hint: "API key, limits" },
];

let toastId = 0;

export default function App() {
  const [page, setPage] = useState<Page>("control");
  const [session, setSession] = useState<SessionStatus>(EMPTY_SESSION);
  const [hasKey, setHasKey] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusySet] = useState<Set<AgentName>>(new Set());
  const [workshopJob, setWorkshopJob] = useState<JobContext | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [location, setLocation] = useState<{ text: string; summary: string } | null>(null);
  const [kaspr, setKasprState] = useState<KasprState>(KASPR_INITIAL);
  const setKaspr = useCallback((patch: Partial<KasprState>) => setKasprState((k) => ({ ...k, ...patch })), []);

  const notify = useCallback((t: Omit<Toast, "id">) => setToasts((ts) => [...ts, { ...t, id: ++toastId }]), []);
  const setBusy = useCallback((agent: AgentName, on: boolean) => {
    setBusySet((prev) => {
      const next = new Set(prev);
      on ? next.add(agent) : next.delete(agent);
      return next;
    });
  }, []);

  const refreshSession = useCallback(async () => setSession(await api.sessionStatus()), []);
  const refreshKey = useCallback(async () => {
    try {
      setHasKey(await api.apiKeyStatus());
    } catch (e) {
      notify({ text: errText(e), tone: "error" });
    }
  }, [notify]);

  const startSession = useCallback(async () => {
    if (!hasKey) {
      notify({ text: "Add your Anthropic API key in Settings to start a session.", tone: "error" });
      setPage("settings");
      return;
    }
    setSession(await api.sessionStart());
  }, [hasKey, notify]);

  const killSession = useCallback(async () => {
    setSession(await api.sessionKill());
    setBusySet(new Set());
    setLocation(null); // KASPR asks again next session
    setKasprState(KASPR_INITIAL); // the kill switch also closes KASPR's Chrome window
    setDataVersion((v) => v + 1);
    notify({ text: "Session ended. Agents are stopped." });
  }, [notify]);

  useEffect(() => {
    refreshKey();
    refreshSession();
  }, [refreshKey, refreshSession]);

  // Tick the session timer.
  useEffect(() => {
    if (!session.active) return;
    const id = setInterval(refreshSession, 1000);
    return () => clearInterval(id);
  }, [session.active, refreshSession]);

  // SONNY listens for jobs KASPR recommends, and pipes up if the resume needs work.
  useEffect(
    () =>
      bus.subscribe(async (msg) => {
        if (msg.type !== "job.recommended") return;
        setBusy("SONNY", true);
        try {
          // The keyword check already ran locally, so SONNY decides without an AI call.
          const m = msg.match;
          const review = {
            verdict: (worthTailoring(m) ? "workshop" : "good") as "workshop" | "good",
            missing: m.missing,
            summary: m.missing.length
              ? `your resume covers ${m.covered.length} of ${m.covered.length + m.missing.length} keywords. Missing: ${m.missing.slice(0, 4).join(", ")}.`
              : "",
          };
          const total = m.covered.length + m.missing.length;
          bus.publish({
            type: "alignment.result", from: "SONNY", to: "USER", job: msg.job,
            verdict: review.verdict, summary: review.summary, missing: review.missing,
          });
          notify({
            from: "SONNY",
            text:
              review.verdict === "workshop"
                ? `Before you apply to ${msg.job.company}: ${review.summary}`
                : `Your resume lines up well with ${msg.job.title} at ${msg.job.company}${total ? ` (${m.covered.length} of ${total} keywords)` : ""}.`,
            action:
              review.verdict === "workshop"
                ? { label: "Workshop it", run: () => { setWorkshopJob(msg.job); setPage("sonny"); } }
                : undefined,
          });
        } catch (e) {
          notify({ from: "SONNY", text: errText(e), tone: "error" });
        } finally {
          setBusy("SONNY", false);
        }
      }),
    [notify, setBusy],
  );

  const visible = useMemo(() => {
    const v = new Set<AgentName>(busy);
    if (page === "kaspr") v.add("KASPR");
    if (page === "sonny") v.add("SONNY");
    return v;
  }, [page, busy]);

  const ctx: AppCtx = {
    kaspr, setKaspr,
    session, refreshSession, startSession, killSession, hasKey, refreshKey, notify, setBusy,
    go: setPage, workshopJob, setWorkshopJob, location, setLocation, dataVersion, bumpData: () => setDataVersion((v) => v + 1),
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full">
        <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel px-3 py-5">
          <div className="mb-8 px-2 font-mono text-xl font-bold tracking-[0.3em]">
            LYMBO<span className="text-accent">.</span>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`rounded-lg px-3 py-2 text-left transition ${
                  page === n.id ? "bg-panel2 text-white" : "text-muted hover:bg-panel2/60 hover:text-white"
                }`}
              >
                <div className="text-sm font-medium">{n.label}</div>
                <div className="text-xs text-muted">{n.hint}</div>
              </button>
            ))}
          </nav>
          <div className="mt-auto px-2 text-xs text-muted">v0.1 · data stays on this computer</div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-20 shrink-0 items-center justify-between border-b border-line px-6">
            <div className="flex items-center gap-4">
              {session.active ? (
                <>
                  <span className="flex items-center gap-2 font-mono text-sm">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-sonny" />
                    {fmtDuration(session.elapsed_secs)}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {(session.input_tokens + session.output_tokens).toLocaleString()} tokens · ~{fmtUsd(session.cost_usd)}
                  </span>
                  <button className="btn" onClick={killSession}>End session</button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={() => startSession().catch((e) => notify({ text: errText(e), tone: "error" }))}>
                  Start session
                </button>
              )}
            </div>
            <AgentDock visible={visible} busy={busy} />
          </header>

          {!hasKey && page !== "settings" && (
            <div className="border-b border-line bg-accent/10 px-6 py-2 text-sm">
              Agents need your Anthropic API key.{" "}
              <button className="underline" onClick={() => setPage("settings")}>Add it in Settings</button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {page === "control" && <ControlRoom />}
            {page === "kaspr" && <KasprPage />}
            {page === "sonny" && <SonnyPage />}
            {page === "settings" && <SettingsPage />}
          </div>
        </main>
      </div>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </Ctx.Provider>
  );
}
