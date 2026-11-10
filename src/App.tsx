import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { Splash } from "./components/Splash";
import { PixelRocket } from "./components/PixelRocket";
import { Tour, Welcome, setTourDismissed, tourDismissed } from "./components/Tour";
import { DotGrid, type DotGridHandle } from "./components/DotGrid";
import { enter, press, wave } from "./lib/motion";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errText, fmtDuration, fmtUsd } from "./lib/api";
import { Ctx, KASPR_INITIAL, READER_VERSION, type AppCtx, type KasprState, type SeenJob, type Toast } from "./lib/context";
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
  { id: "kaspr", label: "KASPR", hint: "Checks jobs you open" },
  { id: "sonny", label: "SONNY", hint: "Resume workshop" },
  { id: "settings", label: "Settings", hint: "API key, limits" },
];

let toastId = 0;
const RELEASES = "https://github.com/Atas24/lymbo/releases/latest";

// The jobs KASPR read are kept on this computer between launches (most recent 30).
const SEEN_KEY = "lymbo.kaspr.seen";
const MAX_SEEN = 30;
function loadSeen(): SeenJob[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(v) ? v.slice(0, MAX_SEEN) : [];
  } catch {
    return [];
  }
}
function saveSeen(seen: SeenJob[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* storage full or blocked: the list just won't survive a restart */
  }
}

export default function App() {
  const [page, setPage] = useState<Page>("control");
  const [splash, setSplash] = useState(true);
  const [welcome, setWelcome] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const startTour = useCallback(() => { setWelcome(false); setTourStep(0); }, []);
  const pageRef = useRef<HTMLDivElement>(null);
  const grid = useRef<DotGridHandle>(null);
  const logo = useRef<HTMLButtonElement>(null);
  // Switching screens: the dot grid ripples and the screen's cards spring in one after another.
  useEffect(() => {
    if (!pageRef.current) return;
    animate(pageRef.current, { opacity: [0, 1], duration: 250, ease: "outQuad" });
    enter(pageRef.current.querySelectorAll(".card"), 70);
    grid.current?.ripple();
  }, [page]);
  // Clicks ripple the grid from where you clicked; buttons squash a little.
  const onMainClick = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    grid.current?.ripple(e.clientX - r.left, e.clientY - r.top);
    const btn = (e.target as HTMLElement).closest(".btn");
    if (btn && !(btn as HTMLButtonElement).disabled) press(btn);
  };
  const [session, setSession] = useState<SessionStatus>(EMPTY_SESSION);
  const [hasKey, setHasKey] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusySet] = useState<Set<AgentName>>(new Set());
  const [workshopJob, setWorkshopJob] = useState<JobContext | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [kaspr, setKasprState] = useState<KasprState>(() => ({ ...KASPR_INITIAL, seen: loadSeen() }));
  const setKaspr = useCallback((patch: Partial<KasprState>) => setKasprState((k) => ({ ...k, ...patch })), []);
  const addSeen = useCallback((j: SeenJob) => setKasprState((k) => ({ ...k, seen: [j, ...k.seen.filter((x) => x.id !== j.id)].slice(0, MAX_SEEN) })), []);
  useEffect(() => saveSeen(kaspr.seen), [kaspr.seen]);
  const kasprRef = useRef(kaspr);
  kasprRef.current = kaspr;
  const pageNow = useRef(page);
  pageNow.current = page;

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
    setKasprState((k) => ({ ...KASPR_INITIAL, seen: k.seen })); // the kill switch also closes KASPR's Chrome window
    setDataVersion((v) => v + 1);
    notify({ text: "Session ended. Agents are stopped." });
  }, [notify]);

  useEffect(() => {
    refreshKey();
    refreshSession();
  }, [refreshKey, refreshSession]);

  // Look for a newer Lymbo on GitHub when the app opens. Your data isn't touched by updates.
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    check()
      .then((update) => {
        if (!update) return;
        notify({
          text: `Lymbo ${update.version} is available.`,
          action: {
            label: "Update & restart",
            run: async () => {
              notify({ text: "Downloading the update…" });
              try {
                await update.downloadAndInstall();
                await relaunch();
              } catch {
                // macOS can block an app from replacing itself; the download page always works.
                notify({
                  text: `Lymbo couldn't install ${update.version} by itself. Download it and drag it into Applications (choose Replace). Your data stays.`,
                  tone: "error",
                  action: { label: "Download it", run: () => openUrl(RELEASES).catch(() => {}) },
                });
              }
            },
          },
        });
      })
      .catch(() => {}); // offline, or no release yet: just skip
  }, [notify]);

  // Tick the session timer.
  useEffect(() => {
    if (!session.active) return;
    const id = setInterval(refreshSession, 1000);
    return () => clearInterval(id);
  }, [session.active, refreshSession]);

  // KASPR watches the Chrome window: whenever you open a job on Handshake, he reads it.
  // He only reads what's already on your screen; he never clicks or browses on his own.
  useEffect(() => {
    if (!session.active || kaspr.conn !== "on") return;
    let stop = false;
    (async () => {
      while (!stop) {
        try {
          // Jobs read by an older version of the page reader count as unread, so they get a fresh read.
          const known = kasprRef.current.seen.filter((j) => (j.reader ?? 1) >= READER_VERSION).map((j) => j.id);
          const w = await api.hsWatch(known);
          if (stop) break;
          if (w.page && w.id) {
            const p = w.page;
            const job = { title: p.title || "Untitled job", company: p.company, url: p.url, description: p.text };
            addSeen({ id: w.id, job, seenAt: Date.now(), reader: READER_VERSION });
            if (pageNow.current !== "kaspr") {
              notify({
                from: "KASPR",
                text: `I read ${job.title}${job.company ? ` at ${job.company}` : ""}.`,
                action: { label: "See which resume to use", run: () => setPage("kaspr") },
              });
            }
          }
          if (w.id !== kasprRef.current.onScreen) {
            // a newly opened job takes over the screen, even if you'd picked an older one
            setKaspr(w.id ? { onScreen: w.id, pinned: null } : { onScreen: null });
          }
        } catch (e) {
          if (stop) break;
          const msg = errText(e);
          if (/signed you out|isn't connected|Start a session|Session ended/i.test(msg)) {
            setKaspr({ conn: "off", connMsg: "", onScreen: null });
            if (/isn't connected/i.test(msg)) notify({ from: "KASPR", text: "The Handshake window closed. Click Connect to open it again.", tone: "error" });
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    })();
    return () => {
      stop = true;
    };
  }, [session.active, kaspr.conn, addSeen, notify, setKaspr]);

  const visible = useMemo(() => {
    const v = new Set<AgentName>(busy);
    if (page === "kaspr") v.add("KASPR");
    if (page === "sonny") v.add("SONNY");
    return v;
  }, [page, busy]);

  const ctx: AppCtx = {
    kaspr, setKaspr, addSeen, startTour,
    session, refreshSession, startSession, killSession, hasKey, refreshKey, notify, setBusy,
    go: setPage, workshopJob, setWorkshopJob, dataVersion, bumpData: () => setDataVersion((v) => v + 1),
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full">
        <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel px-3 py-5">
          <div className="mb-8 flex items-center gap-2 whitespace-nowrap px-2 font-mono text-xl font-bold tracking-[0.25em]">
            <button ref={logo} onClick={() => setSplash(true)} title="Replay intro"
              onMouseEnter={() => logo.current && wave(logo.current.querySelectorAll("span"))}>
              {"LYMBO".split("").map((c, i) => <span key={i} className="inline-block">{c}</span>)}
              <span className="inline-block text-accent">.</span>
            </button>
            <PixelRocket px={2} className="logo-rocket shrink-0" />
          </div>
          <nav data-tour="nav" className="flex flex-col gap-1">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`relative rounded-lg px-3 py-2 text-left transition ${
                  page === n.id
                    ? "bg-panel2 text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-accent"
                    : "text-muted hover:translate-x-0.5 hover:bg-panel2/60 hover:text-white"
                }`}
              >
                <div className="text-sm font-medium">{n.label}</div>
                <div className="text-xs text-muted">{n.hint}</div>
              </button>
            ))}
          </nav>
          <div className="mt-auto px-2 text-xs text-muted">{version && `v${version} · `}data stays on this computer</div>
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col" onClick={onMainClick}>
          <DotGrid ref={grid} />
          <header className="relative z-10 flex h-20 shrink-0 items-center justify-between border-b border-line bg-ink/70 px-6 backdrop-blur">
            <div data-tour="session" className="flex items-center gap-4">
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

          <div ref={pageRef} key={page} className="relative z-10 min-h-0 flex-1 overflow-y-auto p-6">
            {page === "control" && <ControlRoom />}
            {page === "kaspr" && <KasprPage />}
            {page === "sonny" && <SonnyPage />}
            {page === "settings" && <SettingsPage />}
          </div>
        </main>
      </div>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
      {splash && <Splash onDone={() => { setSplash(false); setPage("control"); if (!tourDismissed()) setWelcome(true); }} />}
      {welcome && !splash && <Welcome onStart={startTour} onClose={() => setWelcome(false)} />}
      {tourStep !== null && !splash && (
        <Tour step={tourStep} setStep={setTourStep} go={setPage}
          onEnd={() => { setTourStep(null); setTourDismissed(true); setPage("control"); }} />
      )}
    </Ctx.Provider>
  );
}
