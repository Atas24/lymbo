import { useEffect, useMemo, useRef, useState } from "react";
import { SplitTitle } from "../components/SplitTitle";
import { KasprSprite } from "../components/Sprites";
import { KeywordBar } from "../components/KeywordBar";
import { SearchOverlay, type SearchProgress } from "../components/SearchOverlay";
import { Cockpit } from "../components/Cockpit";
import { api, currentResume, errText } from "../lib/api";
import { kasprSuggestSearches, sonnyBatch } from "../lib/agents";
import { bus } from "../lib/bus";
import { useApp, type BatchJob } from "../lib/context";
import {
  clusterFitsVersion, clusterJobs, keywordsIn, matchKeywords, rankVersions, VERSION_FIT, type KeywordCluster,
} from "../lib/keywords";
import type { JobContext, JobLink, Resume, ResumeVersion } from "../lib/types";

const EMPTY: JobContext = { company: "", title: "", url: "", description: "" };

const PLACES = [
  "Anywhere in the US", "Remote only", "SF Bay Area", "New York City", "Los Angeles", "Seattle", "Boston",
  "Chicago", "Austin", "Washington, DC", "Nashville", "Atlanta", "Denver", "Other",
];

/** Specificity 1-5: how much of a job's keywords your resume must cover to show it. */
const SPECIFICITY = [
  { label: "Show everything", min: 0 },
  { label: "Loose", min: 0.2 },
  { label: "Balanced", min: 0.35 },
  { label: "Close", min: 0.5 },
  { label: "Only close matches", min: 0.65 },
];
const INTERN = /\b(intern|interns|internship|co-?op)\b/i;

type Prefs = { place: string; other: string; type: "internship" | "fulltime" | "both"; spec: number };

/**
 * Background reading of job pages. Lives outside the component so it keeps going
 * if you switch screens, and so only one reader ever runs.
 */
const reader = {
  run: 0, // bumps to cancel a running reader
  paused: false,
  queue: [] as string[],
  needVersions: false,
  /** SONNY gets a first go at versions once a handful of jobs are read, not only at the end. */
  madeEarly: false,
  toldDocx: false,
  approved: [] as ResumeVersion[],
};

/** KASPR read too little of the posting to judge it (under 3 skills found). */
const thin = (m: BatchJob["match"]) => !m || m.covered.length + m.missing.length < 3;

function fromLink(link: JobLink): BatchJob {
  // Listing text is usually: title / company / location / extra lines.
  const lines = link.text.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    link,
    job: { title: lines[0] ?? "Job", company: lines[1] ?? "", location: lines[2] ?? "", url: link.url, description: "" },
    read: false, failed: false, readAt: null, pageText: "", match: null, versionId: null, versionCoverage: null,
  };
}

export default function KasprPage() {
  const { session, notify, setBusy, bumpData, go, setWorkshopJob, setLocation, kaspr, setKaspr, updateJobs, dataVersion } = useApp();
  const [working, setWorking] = useState<string | null>(null);
  const [login, setLogin] = useState<{ email: string; method: string } | null>(null);
  const [editingLogin, setEditingLogin] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", method: "school" });
  const [prefs, setPrefs] = useState<Prefs>({ place: "Anywhere in the US", other: "", type: "internship", spec: 3 });
  const [noResults, setNoResults] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [manual, setManual] = useState<JobContext>(EMPTY);
  const [manualConfirm, setManualConfirm] = useState(false);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [resume, setResume] = useState<Resume | undefined>();
  const jobsRef = useRef(kaspr.jobs);
  jobsRef.current = kaspr.jobs;
  const [search, setSearch] = useState<SearchProgress | null>(null);
  const [sonnyBusy, setSonnyBusy] = useState(false);
  const searchToken = useRef(0);

  useEffect(() => {
    (async () => {
      const [vs, r] = await Promise.all([api.versions(), currentResume()]);
      setVersions(vs);
      setResume(r);
      const approved = vs.filter((v) => v.status === "approved" && v.base_resume_id === r?.id);
      reader.approved = approved;
      if (!approved.length) return;
      updateJobs((jobs) => jobs.map((j) => {
        if (!j.read || (j.versionId && vs.some((v) => v.id === j.versionId))) return j;
        const best = rankVersions(j.pageText, approved)[0];
        return best && best.match.coverage >= VERSION_FIT
          ? { ...j, versionId: best.version.id, versionCoverage: best.match.coverage }
          : j;
      }));
    })().catch(() => {});
  }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.hsLoginStatus().then(setLogin).catch((e) => notify({ text: errText(e), tone: "error" }));
    api
      .locationGet()
      .then((l) => {
        if (!l?.parsed) return;
        const saved = JSON.parse(l.parsed);
        if (saved?.place && saved?.type) setPrefs((p) => ({ ...p, ...saved, spec: saved.spec ?? 3 }));
      })
      .catch(() => {});
  }, [notify]);

  // If reading finished while you were on another screen, make versions now.
  useEffect(() => {
    if (reader.needVersions && kaspr.reading === "idle" && kaspr.jobs.some((j) => j.read)) {
      reader.needVersions = false;
      makeVersions(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      reader.run++;
      await api.hsDisconnect();
      setKaspr({ conn: "off", connMsg: "", jobs: [], selectedId: null, reading: "idle" });
    });

  // ---------- what you're looking for (dropdowns + slider, no AI) ----------

  const prefsText = `Location: ${prefs.place === "Other" ? prefs.other || "anywhere" : prefs.place}. Job type: ${
    prefs.type === "internship" ? "internships only" : prefs.type === "fulltime" ? "full-time jobs only (no internships)" : "internships or full-time"
  }.`;
  const savePrefs = (next: Prefs) => {
    setPrefs(next);
    const place = next.place === "Other" ? next.other : next.place;
    setLocation({ text: place, summary: place });
    api.locationSet(place, JSON.stringify(next)).catch(() => {});
  };

  const typeOk = (j: BatchJob) => {
    if (prefs.type === "both") return true;
    const isIntern = INTERN.test(`${j.job.title} ${j.link.text}`);
    return prefs.type === "internship" ? isIntern : !isIntern;
  };
  /** Whether a job shows at the current specificity. Unread jobs show until KASPR has read them. */
  const shows = (j: BatchJob) => {
    if (prefs.spec === 1) return true;
    if (!typeOk(j)) return false;
    if (j.failed) return prefs.spec <= 2;
    if (!j.read || !j.match) return true;
    const total = j.match.covered.length + j.match.missing.length;
    return total < 3 || j.match.coverage >= SPECIFICITY[prefs.spec - 1].min;
  };
  /** Jobs KASPR has read that pass your filters, in the order it read them. */
  const inRange = useMemo(
    () => kaspr.jobs.filter((j) => j.read && shows(j)).sort((a, b) => (a.readAt ?? 0) - (b.readAt ?? 0)),
    [kaspr.jobs, prefs], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const cur = inRange.find((j) => j.link.id === kaspr.selectedId) ?? inRange[0] ?? null;

  // ---------- reading job pages in the background ----------

  const readLoop = async (run: number, batch: BatchJob[]) => {
    const byId = new Map(batch.map((b) => [b.link.id, b]));
    const r = await currentResume();
    if (!r) return;
    setKaspr({ reading: "reading" });
    reader.approved = (await api.versions()).filter((v) => v.status === "approved" && v.base_resume_id === r.id);
    reader.madeEarly = false;
    let readSoFar = 0;
    while (reader.run === run && reader.queue.length) {
      if (reader.paused) {
        await new Promise((res) => setTimeout(res, 400));
        continue;
      }
      const id = reader.queue.shift()!;
      // The batch is passed in directly, so reading never depends on the screen having updated yet.
      const j = byId.get(id);
      if (!j || jobsRef.current.find((x) => x.link.id === id)?.read) continue;
      try {
        const page = await api.hsReadJob(j.link.url); // Lymbo pauses a few seconds before each page
        if (reader.run !== run) return;
        const match = matchKeywords(page.text, r.content); // local, free
        // Already have a resume version that fits? Use it (local, free).
        let versionId: number | null = null, versionCoverage: number | null = null;
        const best = rankVersions(page.text, reader.approved)[0];
        if (best && !thin(match)) {
          if (best.match.coverage >= VERSION_FIT) {
            versionId = best.version.id;
            versionCoverage = best.match.coverage;
            api.versionLearn(best.version.id, id, keywordsIn(page.text)).catch(() => {});
          }
        }
        updateJobs((jobs) => jobs.map((x) => (x.link.id === id
          ? { ...x, read: true, readAt: Date.now(), pageText: page.text, match, versionId, versionCoverage,
              job: { ...x.job, url: page.url, description: page.text.slice(0, 1500),
                title: page.title || x.job.title, company: page.company || x.job.company } }
          : x)));
        readSoFar++;
        if (!reader.madeEarly && readSoFar >= 6) {
          reader.madeEarly = true;
          setTimeout(() => makeVersions(), 50);
        }
      } catch (e) {
        const msg = errText(e);
        if (/Session ended|signed you out|isn't connected/.test(msg)) {
          if (reader.run === run) notify({ from: "KASPR", text: msg, tone: "error" });
          reader.run++;
          break;
        }
        updateJobs((jobs) => jobs.map((x) => (x.link.id === id ? { ...x, failed: true } : x)));
      }
    }
    if (reader.run !== run) return;
    setKaspr({ reading: "idle" });
    reader.needVersions = true;
    // Sort the rest into resume versions (runs on the next visit if you've switched screens).
    setTimeout(() => {
      if (reader.needVersions && jobsRef.current.length) {
        reader.needVersions = false;
        makeVersions(true);
      }
    }, 300);
  };

  /** No search bar: KASPR builds searches from your resume and saved versions and lists every result. */
  const findJobs = () =>
    task("Working out what to search for…", async () => {
      const r = await currentResume();
      if (!r) throw "Add a resume in the Control Room first.";
      reader.run++;
      reader.queue = [];
      const searchRun = ++searchToken.current;
      setSearch({ queries: [], current: 0, found: 0 });
      try {
        const approved = (await api.versions()).filter((v) => v.status === "approved" && v.base_resume_id === r.id);
        const suggested = await kasprSuggestSearches(r.content, prefsText); // cached after the first time
        const suffix = prefs.type === "internship" ? " intern" : "";
        const queries = [...new Set([...approved.map((v) => v.label), ...suggested].map((q) => q.trim()).filter(Boolean))]
          .slice(0, 3)
          .map((q) => q + suffix);
        const seen = new Map<string, JobLink>();
        for (const [i, q] of queries.entries()) {
          if (searchToken.current !== searchRun) return; // cancelled
          setSearch({ queries, current: i, found: seen.size });
          for (const l of await api.hsSearch(q)) if (!seen.has(l.id)) seen.set(l.id, l);
          setSearch({ queries, current: i, found: seen.size });
        }
        if (searchToken.current !== searchRun) return;
        setSearch({ queries, current: queries.length, found: seen.size });
        await new Promise((res) => setTimeout(res, 700)); // let the last blips land
        startBatch([...seen.values()], queries);
      } finally {
        if (searchToken.current === searchRun) setSearch(null);
      }
    });
  const cancelSearch = () => {
    searchToken.current++;
    setSearch(null);
    notify({ from: "KASPR", text: "Search cancelled." });
  };

  const readThisPage = () => task("Reading the page…", async () => startBatch(await api.hsLinksOnPage(), []));

  /** List everything right away, then read pages in order of how promising the titles look. */
  const startBatch = (links: JobLink[], queries: string[]) => {
    setNoResults(links.length === 0);
    const jobs = links.map(fromLink);
    setConfirming(false);
    setKaspr({ jobs, selectedId: jobs[0]?.link.id ?? null, reading: jobs.length ? "reading" : "idle" });
    if (!jobs.length) return;
    notify({ from: "KASPR", text: `Found ${jobs.length} jobs. Flying you to the first one…` });
    const words = new Set(queries.join(" ").toLowerCase().split(/\W+/).filter((w) => w.length > 2 && w !== "intern"));
    const promise = (j: BatchJob) =>
      [...words].filter((w) => j.job.title.toLowerCase().includes(w)).length + (typeOk(j) ? 1 : 0);
    reader.queue = [...jobs].sort((a, b) => promise(b) - promise(a)).map((j) => j.link.id);
    reader.paused = false;
    const run = ++reader.run;
    readLoop(run, jobs);
  };

  /** Click an unread job: KASPR reads it next. */
  const select = (j: BatchJob) => {
    setConfirming(false);
    setKaspr({ selectedId: j.link.id });
    if (!j.read && !j.failed) reader.queue = [j.link.id, ...reader.queue.filter((id) => id !== j.link.id)];
  };

  const pauseReading = (paused: boolean) => {
    reader.paused = paused;
    setKaspr({ reading: paused ? "paused" : reader.queue.length ? "reading" : "idle" });
  };

  /** Shows the job in Chrome so you can apply. Reading pauses so Chrome stays on your job. */
  const openToApply = () => {
    if (!cur) return;
    if (kaspr.reading === "reading") pauseReading(true);
    task("Opening…", () => api.hsOpen(cur.job.url));
  };

  const markApplied = (job: JobContext, versionId: number | null = null) =>
    task("Logging…", async () => {
      await api.applicationAdd(job.company || "Unknown", job.title, job.url, "", versionId);
      notify({ from: "KASPR", text: `Logged ${job.title}${job.company ? ` at ${job.company}` : ""} in your timeline.`, tone: "success" });
      setConfirming(false);
      bumpData();
    });

  // ---------- resume versions for the batch ----------

  /** Picks a version for each read job that passes your filters; asks SONNY only for new kinds of jobs. */
  const makeVersionsInner = async (final: boolean, forJob?: string) => {
    const r = await currentResume();
    if (!r) return;
    if (!r.has_docx) {
      if (!reader.toldDocx) {
        reader.toldDocx = true;
        notify({ from: "SONNY", text: "Upload your resume as a Word file (.docx) in the Control Room and I'll make tailored versions for batches like this." });
      }
      return;
    }
    const jobs = jobsRef.current.filter((j) => j.read && shows(j) && (!j.versionId || j.link.id === forJob) && !thin(j.match));
    if (!jobs.length) {
      const read = jobsRef.current.filter((j) => j.read && shows(j));
      if (final && !forJob && read.some((j) => !thin(j.match))) {
        notify({ from: "SONNY", text: "Every job in this batch already has a resume version that fits." });
      }
      return;
    }
    setSonnyBusy(true);
    const all = (await api.versions()).filter((v) => v.base_resume_id === r.id);
    const approved = all.filter((v) => v.status === "approved");
    const assigned = new Map<string, { versionId: number; coverage: number | null }>();
    const unmatched: BatchJob[] = [];
    const learn = (vid: number, j: BatchJob) => api.versionLearn(vid, j.link.id, keywordsIn(j.pageText));

    for (const j of jobs) {
      const best = rankVersions(j.pageText, approved)[0];
      if (best && best.match.coverage >= VERSION_FIT) {
        assigned.set(j.link.id, { versionId: best.version.id, coverage: best.match.coverage });
        await learn(best.version.id, j);
      } else unmatched.push(j);
    }

    if (unmatched.length) {
      const byId = new Map(unmatched.map((j) => [j.link.id, j]));
      const maxNew = Math.max(0, Math.min(4, 6 - all.length));
      const clusters = clusterJobs(unmatched.map((j) => ({ id: j.link.id, keywords: keywordsIn(j.pageText) })), Math.max(1, maxNew || 1));
      const fresh: KeywordCluster[] = [];
      let full = 0;
      for (const c of clusters) {
        // When you ask about one job, don't hand it back the version that didn't fit it.
        const skip = forJob && c.jobIds.includes(forJob) ? byId.get(forJob)?.versionId : null;
        const fit = all.filter((v) => v.id !== skip)
          .map((v) => ({ v, score: clusterFitsVersion(c, v.keywords) })).sort((a, b) => b.score - a.score)[0];
        if (fit && fit.score >= 0.5) {
          for (const id of c.jobIds) {
            const j = byId.get(id)!;
            assigned.set(id, { versionId: fit.v.id, coverage: fit.v.text ? matchKeywords(j.pageText, fit.v.text).coverage : null });
            await learn(fit.v.id, j);
          }
        } else if (maxNew > 0) fresh.push(c);
        else full += c.jobIds.length;
      }
      if (full) {
        notify({
          from: "SONNY",
          text: `${full} job${full > 1 ? "s" : ""} need a new resume version, but you already have ${all.length}, the most I keep. Delete one you don't use in the Control Room and I'll make a new one.`,
          action: { label: "Open Control Room", run: () => go("control") },
        });
      }
      if (fresh.length) {
        setBusy("SONNY", true);
        try {
          const lines = await api.resumeLines(r.id);
          const onResume = new Set(keywordsIn(r.content));
          const written = await sonnyBatch(lines, fresh.map((c, i) => ({
            key: `G${i + 1}`,
            jobs: c.jobIds.slice(0, 8).map((id) => ({ title: byId.get(id)!.job.title, company: byId.get(id)!.job.company })),
            focus: c.focus,
            shared: c.shared,
            missing: [...new Set([...c.focus, ...c.shared])].filter((k) => !onResume.has(k)),
          })));
          for (const g of written) {
            const c = fresh[Number(g.key.slice(1)) - 1];
            const vid = await api.versionCreate({
              baseResumeId: r.id, label: g.label, summary: g.summary, edits: g.edits, jobIds: c.jobIds, keywords: Object.keys(c.counts),
            });
            for (const id of c.jobIds) assigned.set(id, { versionId: vid, coverage: null });
          }
          if (!written.length) {
            notify({ from: "SONNY", text: "I looked at this batch but couldn't find changes worth making to your resume. Try Work with SONNY on a single job.", tone: "error" });
          }
          if (written.length) {
            notify({
              from: "SONNY",
              text: `I made ${written.length} resume version${written.length > 1 ? "s" : ""} for this batch (${written.map((g) => g.label).join(", ")}). Look them over before you apply.`,
              action: { label: "Review versions", run: () => { setWorkshopJob(null); go("sonny"); } },
            });
          }
        } catch (e) {
          notify({ from: "SONNY", text: errText(e), tone: "error" });
        } finally {
          setBusy("SONNY", false);
        }
      }
    }
    updateJobs((list) => list.map((j) => {
      const a = assigned.get(j.link.id);
      return a ? { ...j, versionId: a.versionId, versionCoverage: a.coverage } : j;
    }));
    bumpData();
  };
  const makeVersions = async (final = false, forJob?: string) => {
    try {
      await makeVersionsInner(final, forJob);
    } finally {
      setSonnyBusy(false);
    }
  };

  // ---------- manual fallback ----------

  const manualMatch = resume && manual.description.trim() ? matchKeywords(manual.description, resume.content) : null;
  const sendManualToSonny = () => {
    if (!resume || !manualMatch) return;
    bus.publish({ type: "job.recommended", from: "KASPR", to: "SONNY", job: manual, resumeId: resume.id, match: manualMatch });
  };

  // ---------- view ----------

  const busy = !!working;
  const canWork = session.active && kaspr.conn === "on";
  const spec = SPECIFICITY[prefs.spec - 1];
  const curIndex = cur ? inRange.indexOf(cur) : -1;
  const scanning = kaspr.reading !== "idle" && (curIndex === -1 || curIndex === inRange.length - 1);
  const goTo = (j: BatchJob | undefined) => {
    if (!j) return;
    if (reader.paused) pauseReading(false); // back to reading once you've moved on from applying
    select(j);
  };

  /** No good resume for this job: let SONNY make one (or open the job in SONNY). */
  const workWithSonny = async (j: BatchJob) => {
    const v = versions.find((x) => x.id === j.versionId);
    if (v?.status === "pending" || !resume?.has_docx || thin(j.match)) {
      if (!v) setWorkshopJob({ ...j.job, description: j.pageText || j.job.description });
      else setWorkshopJob(null);
      go("sonny");
      return;
    }
    await task("SONNY is drafting a resume for jobs like this…", () => makeVersions(false, j.link.id));
    setWorkshopJob(null);
    go("sonny");
  };

  /** Opens SONNY's one-job workshop with this posting filled in, whatever resume KASPR picked. */
  const sonnyOnJob = (j: BatchJob) => {
    setWorkshopJob({ ...j.job, description: j.pageText || j.job.description });
    go("sonny");
  };

  /** Dashboard panel: which resume to use for this job, or a way to get one from SONNY. */
  const resumePanel = (job: BatchJob) => {
    const version = versions.find((v) => v.id === job.versionId);
    const err = (e: unknown) => notify({ text: errText(e), tone: "error" });
    const sonnyBtn = (
      <button className="btn btn-primary self-start text-xs" disabled={busy || sonnyBusy} onClick={() => workWithSonny(job)}>
        Work with SONNY
      </button>
    );
    if (version?.status === "approved") {
      const weak = job.versionCoverage !== null && job.versionCoverage < VERSION_FIT;
      return (
        <>
          <div className="text-lg font-semibold text-sonny">{version.label}</div>
          {job.versionCoverage !== null && <div className="text-xs text-muted">Covers {Math.round(job.versionCoverage * 100)}% of this job's keywords</div>}
          <div className="mt-auto flex flex-wrap gap-2">
            {weak && sonnyBtn}
            {version.has_pdf && <button className="btn text-xs" onClick={() => api.versionOpen(version.id, "pdf").catch(err)}>Open PDF</button>}
            <button className="btn text-xs" onClick={() => api.versionOpen(version.id, "docx").catch(err)}>Open Word file</button>
          </div>
        </>
      );
    }
    if (version?.status === "pending") {
      return (
        <>
          <div className="text-sm">SONNY drafted <span className="font-semibold text-kaspr">{version.label}</span> for jobs like this. It needs your OK.</div>
          <div className="mt-auto">{sonnyBtn}</div>
        </>
      );
    }
    if (sonnyBusy) return <div className="text-sm text-muted">SONNY is drafting resumes for this batch…</div>;
    if (thin(job.match)) {
      return (
        <>
          <div className="text-sm">KASPR couldn't read enough of this posting to pick a resume.</div>
          <div className="text-xs text-muted">Open it in Chrome to check it yourself, or paste the description into SONNY.</div>
          <div className="mt-auto">{sonnyBtn}</div>
        </>
      );
    }
    const cov = job.match?.coverage ?? 0;
    if (resume && cov >= VERSION_FIT) {
      return (
        <>
          <div className="text-lg font-semibold">Your main resume</div>
          <div className="text-xs text-muted">Covers {Math.round(cov * 100)}% of this job's keywords</div>
          <div className="mt-auto flex gap-2">
            {resume.has_pdf && <button className="btn text-xs" onClick={() => api.resumeOpenFile(resume.id, "pdf").catch(err)}>Open PDF</button>}
            {resume.has_docx && <button className="btn text-xs" onClick={() => api.resumeOpenFile(resume.id, "docx").catch(err)}>Open Word file</button>}
          </div>
        </>
      );
    }
    return (
      <>
        <div className="text-sm">None of your resumes fit this one well yet.</div>
        <div className="mt-auto">{sonnyBtn}</div>
      </>
    );
  };

  const jobActions = (job: BatchJob) =>
    !confirming ? (
      <>
        <button className="btn btn-primary text-xs" disabled={busy} onClick={openToApply}>Open in Chrome to apply</button>
        <button className="btn text-xs" disabled={busy} onClick={() => setConfirming(true)}>I applied</button>
        <button className="btn text-xs" onClick={() => sonnyOnJob(job)}>Work with SONNY on this job</button>
      </>
    ) : (
      <span className="flex flex-wrap items-center gap-2 text-sm">
        Did you submit it?
        <button className="btn btn-primary text-xs" onClick={() => {
          markApplied(job.job, versions.find((v) => v.id === job.versionId && v.status === "approved")?.id ?? null);
          if (reader.paused) pauseReading(false);
        }}>Yes, log it</button>
        <button className="btn text-xs" onClick={() => setConfirming(false)}>No</button>
      </span>
    );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {search && <SearchOverlay progress={search} onCancel={cancelSearch} />}
      <div className="flex items-center gap-4">
        <KasprSprite size={56} busy={busy || kaspr.reading === "reading"} />
        <div>
          <SplitTitle text="KASPR" />
          <p className="text-sm text-muted">
            {working ?? "Finds Handshake jobs and goes through them with you. You always click Apply yourself."}
          </p>
        </div>
      </div>

      {/* ---------- Handshake login ---------- */}
      {kaspr.conn === "on" && login && !editingLogin ? (
        <section data-tour="handshake" className="card flex items-center gap-3 py-3 text-sm">
          <span className="h-2 w-2 rounded-full bg-sonny shadow-[0_0_8px_#5fe0a3]" />
          <span className="flex-1">Connected to Handshake <span className="text-muted">as {login.email}</span></span>
          <button className="text-xs text-muted underline" onClick={disconnect}>Disconnect</button>
        </section>
      ) : (
      <section data-tour="handshake" className="card flex flex-col gap-3">
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
              {[["school", "I sign in through my school"], ["handshake", "I have a Handshake password"]].map(([v, label]) => (
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
              <button className="btn btn-primary" disabled={!form.email.trim() || !form.password || busy} onClick={saveLogin}>Save login</button>
              {editingLogin && <button className="btn" onClick={() => setEditingLogin(false)}>Cancel</button>}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span>{login.email} <span className="text-muted">· {login.method === "school" ? "school sign-in" : "Handshake password"}</span></span>
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
              {kaspr.conn === "needs_user" && <button className="btn btn-primary" disabled={busy} onClick={confirmSignedIn}>I'm signed in</button>}
              {kaspr.conn !== "off" && <button className="btn" disabled={busy && kaspr.conn !== "needs_user"} onClick={disconnect}>Close Handshake</button>}
            </div>
            {!session.active && <p className="text-xs text-muted">Start a session to connect.</p>}
          </>
        )}
      </section>
      )}

      {/* ---------- what you're looking for ---------- */}
      <section data-tour="findjobs" className={`card flex flex-col gap-4 ${canWork ? "" : "pointer-events-none opacity-40"}`}>
        <h2 className="font-semibold">Find jobs</h2>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <div>
            <label className="label">Where</label>
            <select className="input" value={prefs.place} onChange={(e) => savePrefs({ ...prefs, place: e.target.value })}>
              {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Looking for</label>
            <select className="input" value={prefs.type} onChange={(e) => savePrefs({ ...prefs, type: e.target.value as Prefs["type"] })}>
              <option value="internship">Internships</option>
              <option value="fulltime">Full-time jobs</option>
              <option value="both">Both</option>
            </select>
          </div>
          <button className="btn btn-primary h-[38px] px-5" disabled={busy || !canWork} onClick={findJobs}>Find jobs</button>
        </div>
        {prefs.place === "Other" && (
          <input className="input" placeholder="City, state or region" value={prefs.other}
            onChange={(e) => setPrefs({ ...prefs, other: e.target.value })} onBlur={() => savePrefs(prefs)} />
        )}
        <div data-tour="slider">
          <div className="mb-2 flex items-baseline justify-between">
            <label className="label mb-0">How specific</label>
            <span className="text-sm"><span className="text-kaspr">{spec.label}</span>
              {prefs.spec > 1 && <span className="text-xs text-muted"> · your resume covers {Math.round(spec.min * 100)}%+ of a job's keywords</span>}
            </span>
          </div>
          <input type="range" min={1} max={5} step={1} value={prefs.spec} className="slider w-full"
            onChange={(e) => savePrefs({ ...prefs, spec: Number(e.target.value) })} />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-muted">
            <span>Broad</span><span>Specific</span>
          </div>
        </div>
        {noResults && (
          <div className="rounded-md border border-kaspr/40 bg-kaspr/5 px-3 py-2 text-sm">
            KASPR couldn't find job listings on those pages. Search in the Chrome window yourself, then{" "}
            <button className="underline" disabled={busy} onClick={readThisPage}>read that page</button>.
          </div>
        )}
      </section>

      {/* ---------- the cockpit: one job at a time ---------- */}
      {canWork && (
        <Cockpit
          job={cur}
          position={curIndex + 1}
          total={inRange.length}
          scanning={scanning}
          idleMessage={
            kaspr.jobs.length === 0
              ? "Set your course above and hit Find jobs."
              : kaspr.reading !== "idle"
                ? "Scanning for jobs that match…"
                : "No jobs in range at this setting. Slide How specific toward Broad."
          }
          resumePanel={cur ? resumePanel(cur) : null}
          actions={cur ? jobActions(cur) : null}
          onPrev={() => goTo(inRange[curIndex - 1])}
          onNext={() => goTo(inRange[curIndex + 1])}
          canPrev={curIndex > 0}
          canNext={curIndex >= 0 && curIndex + 1 < inRange.length}
        />
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
          {manualMatch && <KeywordBar match={manualMatch} />}
          <div className="flex gap-2">
            <button className="btn" disabled={!manualMatch || !manual.title.trim()} onClick={sendManualToSonny}>Ask SONNY about it</button>
            {!manualConfirm ? (
              <button className="btn" disabled={!manual.company.trim() || !manual.title.trim()} onClick={() => setManualConfirm(true)}>I applied</button>
            ) : (
              <span className="flex items-center gap-2 rounded-md border border-kaspr/50 px-3 py-1">
                <span className="text-sm">Did you submit it?</span>
                <button className="btn btn-primary" onClick={() => { markApplied(manual); setManualConfirm(false); }}>Yes, log it</button>
                <button className="btn" onClick={() => setManualConfirm(false)}>No</button>
              </span>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
