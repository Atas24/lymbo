import { useEffect, useState } from "react";
import { api, currentResume, errText } from "../lib/api";
import { kasprEvaluate, kasprRank, kasprReadJob, kasprReadLocation, kasprSuggestSearches, type KasprVerdict } from "../lib/agents";
import { bus } from "../lib/bus";
import { useApp } from "../lib/context";
import type { JobContext, JobLink } from "../lib/types";
import { KasprSprite } from "../components/Sprites";
import { KeywordBar } from "../components/KeywordBar";
import { matchKeywords } from "../lib/keywords";

const EMPTY: JobContext = { company: "", title: "", url: "", description: "" };

function ScoreBlock({ verdict }: { verdict: KasprVerdict }) {
  return (
    <div className="flex items-start gap-4">
      <div className={`font-mono text-4xl font-bold ${verdict.score >= 70 ? "text-sonny" : verdict.score >= 45 ? "text-kaspr" : "text-accent"}`}>
        {verdict.score}
      </div>
      <div className="flex-1">
        <div className="font-medium">{verdict.recommend ? "Worth applying" : "Probably not a fit"}</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function KasprPage() {
  const { session, notify, setBusy, bumpData, go, setWorkshopJob, location, setLocation, kaspr, setKaspr } = useApp();
  const [working, setWorking] = useState<string | null>(null); // what KASPR is doing right now
  const [login, setLogin] = useState<{ email: string; method: string } | null>(null);
  const [editingLogin, setEditingLogin] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", method: "school" });
  const [locAnswer, setLocAnswer] = useState("");
  const [editingLoc, setEditingLoc] = useState(false);
  const [query, setQuery] = useState("");
  const [noResults, setNoResults] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [manual, setManual] = useState<JobContext>(EMPTY);
  const [manualVerdict, setManualVerdict] = useState<KasprVerdict | null>(null);
  const [manualConfirm, setManualConfirm] = useState(false);

  useEffect(() => {
    api.hsLoginStatus().then(setLogin).catch((e) => notify({ text: errText(e), tone: "error" }));
    api.locationGet().then((l) => l && setLocAnswer(l.text)).catch(() => {});
  }, [notify]);

  /** Runs a KASPR task with the busy animation and error toasts. */
  const task = async (label: string, fn: () => Promise<void>) => {
    setWorking(label);
    setBusy("KASPR", true);
    try {
      await fn();
    } catch (e) {
      notify({ from: "KASPR", text: errText(e), tone: "error" });
    } finally {
      setWorking(null);
      setBusy("KASPR", false);
    }
  };

  // ---------- login ----------

  const saveLogin = () =>
    task("Saving your login…", async () => {
      await api.hsLoginSet(form.email, form.password, form.method);
      setLogin({ email: form.email.trim(), method: form.method });
      setForm({ email: "", password: "", method: form.method });
      setEditingLogin(false);
      notify({ from: "KASPR", text: "Login saved to your keychain.", tone: "success" });
    });

  const removeLogin = () =>
    task("Removing…", async () => {
      await api.hsLoginRemove();
      await api.hsDisconnect();
      setLogin(null);
      setKaspr({ conn: "off", connMsg: "" });
    });

  const applyOutcome = (o: Awaited<ReturnType<typeof api.hsConnect>>) => {
    if (o.status === "logged_in") setKaspr({ conn: "on", connMsg: o.message, pendingHost: null });
    else if (o.status === "needs_approval") setKaspr({ conn: "needs_approval", connMsg: o.message, pendingHost: o.host });
    else setKaspr({ conn: "needs_user", connMsg: o.message, pendingHost: null });
  };

  const connect = () =>
    task("Signing in to Handshake…", async () => {
      setKaspr({ conn: "connecting", connMsg: "" });
      try {
        applyOutcome(await api.hsConnect());
      } catch (e) {
        setKaspr({ conn: "off", connMsg: "" });
        throw e;
      }
    });

  const approveHost = () =>
    task("Signing in…", async () => {
      if (kaspr.pendingHost) await api.hsApproveHost(kaspr.pendingHost);
      applyOutcome(await api.hsConnect());
    });

  const confirmSignedIn = () =>
    task("Checking…", async () => {
      if (await api.hsCheck()) setKaspr({ conn: "on", connMsg: "Signed in to Handshake." });
      else notify({ from: "KASPR", text: "Handshake still shows the login page. Finish signing in in the Chrome window." });
    });

  const disconnect = () =>
    task("Closing…", async () => {
      await api.hsDisconnect();
      setKaspr({ conn: "off", connMsg: "", queue: [], index: 0, current: null });
    });

  // ---------- where to work ----------

  const answerLocation = () =>
    task("Noting that…", async () => {
      const f = await kasprReadLocation(locAnswer);
      await api.locationSet(locAnswer, JSON.stringify(f));
      setLocation({ text: locAnswer, summary: f.summary });
      setEditingLoc(false);
    });
  const askingLocation = session.active && (!location || editingLoc);

  // ---------- searching and reading jobs ----------

  const suggest = () =>
    task("Thinking of searches…", async () => {
      const resume = await currentResume();
      if (!resume) throw "Add a resume in the Control Room first.";
      const qs = await kasprSuggestSearches(resume.content, location?.text ?? "");
      setKaspr({ suggestions: qs });
      if (!query && qs[0]) setQuery(qs[0]);
    });

  const readAt = async (queue: JobLink[], index: number) => {
    const link = queue[index];
    if (!link) return;
    const resume = await currentResume();
    if (!resume) throw "Add a resume in the Control Room first.";
    setConfirming(false);
    setKaspr({ queue, index, current: null });
    const page = await api.hsReadJob(link.url);
    // Keyword check runs locally on the full page; the AI only scores and summarizes.
    const match = matchKeywords(page.text, resume.content);
    const read = await kasprReadJob(resume.content, location?.text ?? "", page.url, page.text, match);
    setKaspr({ queue, index, current: read });
    if (read.verdict.recommend) {
      bus.publish({
        type: "job.recommended", from: "KASPR", to: "SONNY", job: read.job, resumeId: resume.id,
        match: read.match,
      });
    }
  };

  const startQueue = async (links: JobLink[]) => {
    if (links.length === 0) {
      setNoResults(true);
      setKaspr({ queue: [], index: 0, current: null });
      return;
    }
    // Skim the titles first so KASPR only opens jobs that could fit. Small batches keep a human pace.
    const resume = await currentResume();
    if (!resume) throw "Add a resume in the Control Room first.";
    const ranked = await kasprRank(resume.content, location?.text ?? "", links);
    const queue = ranked.slice(0, 12);
    if (links.length && !queue.length) {
      notify({ from: "KASPR", text: `Skimmed ${links.length} listings and none looked like a fit. Try a different search.` });
    } else if (queue.length < links.length) {
      notify({ from: "KASPR", text: `Skimmed ${links.length} listings and picked ${queue.length} worth a closer look.` });
    }
    setNoResults(false);
    if (queue.length) await readAt(queue, 0);
    else setKaspr({ queue: [], index: 0, current: null });
  };

  const search = () => task("Searching Handshake…", async () => startQueue(await api.hsSearch(query)));
  const readThisPage = () => task("Reading the page…", async () => startQueue(await api.hsLinksOnPage()));
  const next = () => task("Reading the next job…", () => readAt(kaspr.queue, kaspr.index + 1));
  const openToApply = () =>
    kaspr.current && task("Opening…", () => api.hsOpen(kaspr.current!.job.url));

  const markApplied = (job: JobContext, verdict: KasprVerdict | null) =>
    task("Logging…", async () => {
      await api.applicationAdd(job.company, job.title, job.url, verdict ? `KASPR score ${verdict.score}` : "");
      notify({ from: "KASPR", text: `Logged ${job.title} at ${job.company} in your timeline.`, tone: "success" });
      setConfirming(false);
      bumpData();
    });

  // ---------- manual fallback ----------

  const evaluateManual = () =>
    task("Reading…", async () => {
      const resume = await currentResume();
      if (!resume) throw "Add a resume in the Control Room first.";
      const v = await kasprEvaluate(resume.content, manual, location?.text ?? "");
      setManualVerdict(v);
      if (v.recommend) {
        bus.publish({
          type: "job.recommended", from: "KASPR", to: "SONNY", job: manual, resumeId: resume.id,
          match: matchKeywords(manual.description, resume.content),
        });
      }
    });

  const busy = !!working;
  const cur = kaspr.current;
  const canWork = session.active && kaspr.conn === "on" && !askingLocation;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-4">
        <KasprSprite size={56} busy={busy} />
        <div>
          <h1 className="text-2xl font-semibold">KASPR</h1>
          <p className="text-sm text-muted">
            {working ?? "Goes through Handshake jobs with you, one at a time. You always click Apply yourself."}
          </p>
        </div>
      </div>

      {/* ---------- Handshake login ---------- */}
      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Handshake</h2>
          <span className={`font-mono text-xs ${kaspr.conn === "on" ? "text-sonny" : "text-muted"}`}>
            ● {kaspr.conn === "on" ? "CONNECTED" : kaspr.conn === "off" ? "NOT CONNECTED" : "SIGNING IN"}
          </span>
        </div>

        {!login || editingLogin ? (
          <>
            <p className="text-xs text-muted">
              Your login is saved in your Mac's Keychain. KASPR only types it into Handshake, or your school's login
              page after you OK it. It's never sent to the AI.
            </p>
            <div className="flex gap-4 text-sm">
              {[
                ["school", "I sign in through my school"],
                ["handshake", "I have a Handshake password"],
              ].map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" checked={form.method === v} onChange={() => setForm({ ...form, method: v })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{form.method === "school" ? "School email / username" : "Email"}</label>
                <input className="input" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={!form.email.trim() || !form.password || busy} onClick={saveLogin}>
                Save login
              </button>
              {editingLogin && <button className="btn" onClick={() => setEditingLogin(false)}>Cancel</button>}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>
                {login.email} <span className="text-muted">· {login.method === "school" ? "school sign-in" : "Handshake password"}</span>
              </span>
              <span className="flex gap-3 text-xs text-muted">
                <button className="underline" onClick={() => setEditingLogin(true)}>Change</button>
                <button className="underline" onClick={removeLogin}>Remove</button>
              </span>
            </div>

            {kaspr.connMsg && kaspr.conn !== "on" && (
              <p className="rounded-md border border-kaspr/40 bg-kaspr/5 px-3 py-2 text-sm">{kaspr.connMsg}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {(kaspr.conn === "off" || kaspr.conn === "connecting") && (
                <button className="btn btn-primary" disabled={!session.active || busy} onClick={connect}>
                  {kaspr.conn === "connecting" ? "Signing in…" : "Connect"}
                </button>
              )}
              {kaspr.conn === "needs_approval" && (
                <>
                  <button className="btn btn-primary" disabled={busy} onClick={approveHost}>Yes, sign me in there</button>
                  <button className="btn" disabled={busy} onClick={() => setKaspr({ conn: "needs_user", connMsg: "OK. Sign in yourself in the Chrome window, then click \"I'm signed in\"." })}>
                    No, I'll do it
                  </button>
                </>
              )}
              {kaspr.conn === "needs_user" && (
                <button className="btn btn-primary" disabled={busy} onClick={confirmSignedIn}>I'm signed in</button>
              )}
              {kaspr.conn !== "off" && <button className="btn" disabled={busy && kaspr.conn !== "needs_user"} onClick={disconnect}>Close Handshake</button>}
            </div>
            {!session.active && <p className="text-xs text-muted">Start a session to connect.</p>}
          </>
        )}
      </section>

      {/* ---------- where to work ---------- */}
      {askingLocation && (
        <section className="card flex gap-4 border-kaspr/40">
          <KasprSprite size={36} busy={busy} />
          <div className="flex flex-1 flex-col gap-3">
            <p className="text-sm">
              Before I start looking: <span className="font-medium">where do you want to work?</span>{" "}
              <span className="text-muted">Say it however you like, e.g. "Chicago or Austin, remote is fine too, open to moving for the right job."</span>
            </p>
            <textarea
              className="input h-20"
              value={locAnswer}
              onChange={(e) => setLocAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && locAnswer.trim() && !busy) {
                  e.preventDefault();
                  answerLocation();
                }
              }}
            />
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={!locAnswer.trim() || busy} onClick={answerLocation}>Tell KASPR</button>
              {editingLoc && <button className="btn" onClick={() => setEditingLoc(false)}>Cancel</button>}
            </div>
          </div>
        </section>
      )}

      {location && !editingLoc && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Looking in:</span>
          <span className="rounded-full border border-kaspr/40 px-3 py-0.5">{location.summary}</span>
          <button className="text-xs text-muted underline" onClick={() => setEditingLoc(true)}>Change</button>
        </div>
      )}

      {/* ---------- search ---------- */}
      <section className={`card flex flex-col gap-3 ${canWork ? "" : "pointer-events-none opacity-40"}`}>
        <h2 className="font-semibold">Find jobs</h2>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="e.g. data analyst intern"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && query.trim() && !busy && search()}
          />
          <button className="btn btn-primary shrink-0" disabled={!query.trim() || busy} onClick={search}>Search Handshake</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn text-xs" disabled={busy} onClick={suggest}>Suggest searches from my resume</button>
          {kaspr.suggestions.map((s) => (
            <button key={s} className="rounded-full border border-line px-3 py-0.5 text-xs hover:border-kaspr" onClick={() => setQuery(s)}>
              {s}
            </button>
          ))}
        </div>
        {noResults && (
          <div className="rounded-md border border-kaspr/40 bg-kaspr/5 px-3 py-2 text-sm">
            KASPR couldn't find job listings on that page. Search in the Chrome window yourself, then{" "}
            <button className="underline" disabled={busy} onClick={readThisPage}>read that page</button>.
          </div>
        )}
        <p className="text-xs text-muted">
          KASPR pauses a few seconds between pages on purpose. Each job's page text and your resume are sent to Anthropic to score it.
        </p>
      </section>

      {/* ---------- current job ---------- */}
      {kaspr.queue.length > 0 && (
        <section className="card flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted">
              JOB {kaspr.index + 1} OF {kaspr.queue.length}
            </span>
            {!cur && <span className="text-xs text-kaspr">{working ?? ""}</span>}
          </div>
          {cur ? (
            <>
              <div>
                <h3 className="text-lg font-semibold">{cur.job.title}</h3>
                <div className="text-sm text-muted">
                  {cur.job.company}
                  {cur.job.location && ` · ${cur.job.location}`}
                </div>
              </div>
              <ScoreBlock verdict={cur.verdict} />
              <KeywordBar match={cur.match} />
              {cur.verdict.recommend && <p className="text-xs text-muted">Sent to SONNY to check your resume against it.</p>}
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">What the job asks for</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted">{cur.job.description}</p>
              </details>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary" disabled={busy} onClick={openToApply}>Open in Chrome to apply</button>
                <button className="btn" onClick={() => { setWorkshopJob(cur.job); go("sonny"); }}>Workshop with SONNY</button>
                {!confirming ? (
                  <button className="btn" disabled={busy} onClick={() => setConfirming(true)}>I applied</button>
                ) : (
                  <span className="flex items-center gap-2 rounded-md border border-kaspr/50 px-3 py-1">
                    <span className="text-sm">Did you submit it?</span>
                    <button className="btn btn-primary" onClick={() => markApplied(cur.job, cur.verdict)}>Yes, log it</button>
                    <button className="btn" onClick={() => setConfirming(false)}>No</button>
                  </span>
                )}
                <button className="btn ml-auto" disabled={busy || kaspr.index + 1 >= kaspr.queue.length} onClick={next}>
                  {kaspr.index + 1 >= kaspr.queue.length ? "That's all of them" : "Next job →"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{kaspr.queue[kaspr.index]?.text || "Loading…"}</p>
          )}
        </section>
      )}

      {/* ---------- manual fallback ---------- */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Paste a job instead</summary>
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Company" value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} />
            <input className="input" placeholder="Job title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
          </div>
          <textarea className="input h-40" placeholder="Job description" value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} />
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              disabled={!session.active || busy || !manual.company.trim() || !manual.title.trim() || !manual.description.trim()}
              onClick={evaluateManual}
            >
              Evaluate with KASPR
            </button>
            {manualVerdict && !manualConfirm && (
              <button className="btn" onClick={() => setManualConfirm(true)}>I applied</button>
            )}
            {manualVerdict && manualConfirm && (
              <span className="flex items-center gap-2 rounded-md border border-kaspr/50 px-3 py-1">
                <span className="text-sm">Did you submit it?</span>
                <button className="btn btn-primary" onClick={() => { markApplied(manual, manualVerdict); setManualConfirm(false); }}>Yes, log it</button>
                <button className="btn" onClick={() => setManualConfirm(false)}>No</button>
              </span>
            )}
          </div>
          {manualVerdict && <ScoreBlock verdict={manualVerdict} />}
        </div>
      </details>
    </div>
  );
}
