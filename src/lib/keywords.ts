// Local keyword matching: what automated resume screeners check, done on this
// computer for free. The AI never has to list keywords; it gets this result instead.

/** Each group: first entry is the name shown; the rest are other ways people write it. */
const GROUPS: string[][] = [
  // languages
  ["Python"], ["SQL", "mysql", "postgresql", "postgres", "t-sql", "pl/sql", "sqlite"], ["Java"], ["JavaScript", "js", "ecmascript"],
  ["TypeScript"], ["C++", "cpp"], ["C#", "csharp", ".net"], ["Golang"], ["Rust"], ["Scala"], ["Kotlin"], ["Swift"],
  ["MATLAB"], ["SAS"], ["Stata"], ["Julia"], ["Bash", "shell scripting"], ["HTML"], ["CSS"], ["PHP"], ["Ruby"],
  ["VBA"], ["Perl"], ["Solidity"],
  // data / ML
  ["Machine learning", "ml"], ["Deep learning"], ["Statistics", "statistical analysis", "statistical modeling", "statistical"],
  ["Data analysis", "data analytics", "analyze data", "analyzing data"], ["Data visualization", "visualizations", "dashboards", "dashboarding"],
  ["Data cleaning", "data wrangling", "data preparation"], ["Data modeling", "data models"], ["Data engineering"], ["ETL", "elt", "data pipelines", "data pipeline"],
  ["A/B testing", "ab testing", "experimentation", "experiment design"], ["Regression", "linear regression", "logistic regression"],
  ["Forecasting", "time series"], ["Natural language processing", "nlp"], ["Computer vision"], ["LLMs", "large language models", "llm", "generative ai", "genai"],
  ["Predictive modeling", "predictive models"], ["Hypothesis testing"], ["Bayesian"], ["Optimization"], ["Feature engineering"],
  ["pandas"], ["NumPy"], ["scikit-learn", "sklearn"], ["TensorFlow"], ["PyTorch"], ["Keras"], ["XGBoost"], ["SciPy"], ["statsmodels"],
  ["Matplotlib"], ["Seaborn"], ["Plotly"], ["Jupyter", "jupyter notebooks"], ["R Studio", "rstudio"], ["tidyverse", "dplyr", "ggplot2", "ggplot"],
  ["Spark", "pyspark", "apache spark"], ["Hadoop"], ["Kafka"], ["Airflow"], ["dbt"], ["Snowflake"], ["Databricks"], ["BigQuery"], ["Redshift"],
  ["Tableau"], ["Power BI", "powerbi"], ["Looker"], ["Google Sheets"],
  ["Pivot tables", "pivot table", "vlookup", "xlookup"], ["Alteryx"], ["SPSS"],
  // engineering / cloud
  ["AWS", "amazon web services"], ["Azure", "microsoft azure"], ["GCP", "google cloud"], ["Docker"], ["Kubernetes", "k8s"],
  ["Git", "github", "gitlab", "version control"], ["Linux", "unix"], ["REST APIs", "rest api", "restful", "apis", "api"], ["GraphQL"],
  ["React", "react.js", "reactjs"], ["Node.js", "nodejs"], ["Django"], ["Flask"], ["FastAPI"], ["Spring Boot"],
  ["CI/CD", "continuous integration"], ["Terraform"], ["Microservices"], ["NoSQL", "mongodb", "dynamodb", "cassandra"],
  ["Unit testing", "pytest", "jest", "test-driven"], ["Agile", "scrum", "kanban"], ["Jira"], ["Object-oriented programming", "oop", "object oriented"],
  ["Data structures", "algorithms"], ["Distributed systems"], ["Cybersecurity", "security"], ["Embedded systems"],
  ["CAD", "solidworks", "autocad"], ["ROS"], ["Simulation", "simulations"], ["Signal processing"], ["Biomechanics"], ["Motion capture", "motion-capture", "mocap"], ["DAX"], ["Product analytics"],
  // business
  ["Financial modeling", "financial models"], ["Valuation", "dcf"], ["Accounting"], ["Budgeting"], ["Market research"],
  ["Product management", "product roadmap", "roadmap"], ["Project management"], ["Stakeholder management", "stakeholders", "cross-functional"],
  ["CRM", "salesforce", "hubspot"], ["SEO"], ["Google Analytics"], ["Marketing analytics"], ["Business intelligence"],
  ["KPIs", "kpi", "metrics"], ["Reporting", "reports"], ["Consulting"], ["Operations"], ["Supply chain"], ["Risk analysis", "risk management"],
  ["PowerPoint", "slide decks", "pitch decks"], ["Microsoft Word"], ["Microsoft Office", "ms office", "microsoft 365", "office 365"],
  ["Financial analysis", "financial statements", "financial statement analysis"], ["Underwriting"], ["Due diligence"], ["Real estate"],
  ["Investment analysis", "investment memos", "investment memo", "investment thesis"], ["Mergers and acquisitions", "m&a"],
  ["Corporate finance"], ["Private equity"], ["Investment banking"], ["Equity research"], ["Portfolio management"],
  ["Bloomberg", "bloomberg terminal"], ["Capital IQ", "capiq"], ["Economics", "economic analysis", "econometrics"], ["Finance"],
  ["Competitive analysis", "competitor analysis", "competitive landscape"], ["Market sizing"], ["Business development"],
  ["Negotiation", "negotiating"], ["Social media", "social media marketing"], ["Content marketing", "content creation"], ["Copywriting"],
  ["Process improvement", "process optimization"], ["Strategy", "strategic planning", "business strategy"],
  // research / general
  ["Research", "research experience"], ["Literature review"], ["Technical writing", "documentation"], ["Presentations", "presenting", "public speaking"],
  ["Communication", "communication skills", "written and verbal"], ["Teamwork", "collaboration", "collaborative", "team player"],
  ["Leadership", "led a team"], ["Problem solving", "problem-solving"], ["Attention to detail", "detail-oriented", "detail oriented"],
  ["Time management"], ["Mentoring", "mentorship"], ["Customer service", "client-facing", "customer-facing"],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// Not a letter or digit on either side, so "Java" doesn't match "JavaScript".
const bounded = (alts: string[], flags: string) =>
  alts.length ? new RegExp(`(?<![A-Za-z0-9])(?:${alts.map(escape).join("|")})(?![A-Za-z0-9])`, flags) : null;
// Entries starting with "=" must match case exactly ("Excel" the program, not "excel in a fast-paced team").
const PATTERNS = GROUPS.map((g) => {
  const exact = g.filter((v) => v.startsWith("=")).map((v) => v.slice(1));
  const loose = g.filter((v, i) => !v.startsWith("=") && !(i === 0 && exact.length));
  return { name: g[0], loose: bounded(loose.map((v) => v.toLowerCase()), "i"), exact: bounded(exact, "") };
});
// "R" is too short to match loosely; only count it in a list-like spot ("R," "R/" "R programming").
const R_LANG = /(?:^|[\s,(/])R(?=[\s,)/]|$)(?:\s*(?:programming|language|studio|,|\/|and|or))/;

// "Excel" the program, not the verb ("excel in a fast-paced team").
const EXCEL = /(?<![A-Za-z])(?:[Mm]icrosoft Excel|MS Excel|[Ss]preadsheets?|Excel(?!\s+(?:in|at|as|with|on|under|through|when)\b))(?![A-Za-z])/;

export function keywordsIn(text: string): string[] {
  const found = PATTERNS.filter((p) => p.loose?.test(text) || p.exact?.test(text)).map((p) => p.name);
  if (R_LANG.test(text)) found.push("R");
  if (EXCEL.test(text)) found.push("Excel");
  return found;
}

export interface KeywordMatch {
  /** Keywords the job asks for that the resume shows. */
  covered: string[];
  /** Keywords the job asks for that the resume doesn't show. */
  missing: string[];
  /** Share of the job's keywords the resume covers, 0–1. */
  coverage: number;
  /** "3+ years", "Bachelor's", etc. found in the job, for context. */
  requirements: string[];
}

export function matchKeywords(jobText: string, resumeText: string): KeywordMatch {
  const wanted = keywordsIn(jobText);
  const have = new Set(keywordsIn(resumeText));
  const covered = wanted.filter((k) => have.has(k));
  const missing = wanted.filter((k) => !have.has(k));

  const requirements: string[] = [];
  const years = jobText.match(/(\d+)\s*\+?\s*(?:-|to)?\s*\d*\s*years?(?:\s+of)?\s+(?:relevant\s+|professional\s+|work\s+)?experience/i);
  if (years) requirements.push(years[0].replace(/\s+/g, " "));
  const degree = jobText.match(/\b(bachelor'?s|master'?s|ph\.?d|mba|associate'?s)\b/i);
  if (degree) requirements.push(degree[1].replace(/^./, (c) => c.toUpperCase()));

  return { covered, missing, coverage: wanted.length ? covered.length / wanted.length : 1, requirements };
}

/** Whether SONNY should speak up: the resume is missing a meaningful share of what the job asks for. */
export const worthTailoring = (m: KeywordMatch) => m.missing.length >= 3 && m.coverage < 0.7;

/** How well each approved resume version covers a job; best first. Free and local. */
export function rankVersions<V extends { id: number; text: string; keywords: Record<string, number> }>(
  jobText: string,
  versions: V[],
): { version: V; match: KeywordMatch; score: number }[] {
  const jobKw = keywordsIn(jobText);
  return versions
    .map((v) => {
      const match = matchKeywords(jobText, v.text);
      // Small bonus for versions already used for jobs that asked for the same things.
      const seen = jobKw.length ? jobKw.filter((k) => (v.keywords[k] ?? 0) > 0).length / jobKw.length : 0;
      return { version: v, match, score: match.coverage + 0.1 * seen };
    })
    .sort((a, b) => b.score - a.score);
}

/** A version is a good enough fit to use without asking SONNY. */
export const VERSION_FIT = 0.6;

// ---------- grouping a batch by keywords (local, free) ----------

/** Soft skills nearly every posting lists; they shouldn't decide which group a job is in. */
const GENERIC = new Set([
  "Communication", "Teamwork", "Leadership", "Problem solving", "Attention to detail", "Time management",
  "Research", "Reporting", "Presentations", "Operations", "Customer service", "Mentoring", "KPIs",
]);
const weightOf = (k: string, df: number, n: number) => Math.log((n + 1) / (df + 0.5)) * (GENERIC.has(k) ? 0.3 : 1);

export interface JobKeywords {
  id: string;
  keywords: string[];
}

export interface KeywordCluster {
  jobIds: string[];
  /** keyword -> how many jobs in this group ask for it */
  counts: Record<string, number>;
  /** What sets this group apart from the rest of the batch. SONNY tailors around these. */
  focus: string[];
  /** Asked for across the group but also common elsewhere. */
  shared: string[];
}

/**
 * Groups jobs by the keywords they ask for. Rare, specific keywords (Power BI, biomechanics)
 * count more than ones every posting has (communication), so groups split along real
 * differences. Groups that end up too alike are merged.
 */
export function clusterJobs(jobs: JobKeywords[], maxClusters = 4): KeywordCluster[] {
  const n = jobs.length;
  if (n === 0) return [];
  const df: Record<string, number> = {};
  for (const j of jobs) for (const k of new Set(j.keywords)) df[k] = (df[k] ?? 0) + 1;
  const w = (k: string) => weightOf(k, df[k] ?? 0, n);

  type G = { jobs: JobKeywords[]; counts: Record<string, number> };
  const core = (g: G) => {
    // keywords at least half the group asks for (all of them for a single job)
    const need = Math.max(1, Math.ceil(g.jobs.length / 2));
    return new Set(Object.keys(g.counts).filter((k) => g.counts[k] >= need));
  };
  const sim = (a: Set<string>, b: Set<string>) => {
    let inter = 0, union = 0;
    for (const k of new Set([...a, ...b])) {
      union += w(k);
      if (a.has(k) && b.has(k)) inter += w(k);
    }
    return union ? inter / union : 0;
  };
  const add = (g: G, j: JobKeywords) => {
    g.jobs.push(j);
    for (const k of new Set(j.keywords)) g.counts[k] = (g.counts[k] ?? 0) + 1;
  };

  const groups: G[] = [];
  for (const j of [...jobs].sort((a, b) => b.keywords.length - a.keywords.length)) {
    const set = new Set(j.keywords);
    let best: G | null = null, bestSim = 0;
    for (const g of groups) {
      const s = sim(set, core(g));
      if (s > bestSim) [best, bestSim] = [g, s];
    }
    if (best && bestSim >= 0.35) add(best, j);
    else {
      const g: G = { jobs: [], counts: {} };
      add(g, j);
      groups.push(g);
    }
  }

  // Merge groups that are too alike, then the smallest ones until we're under the cap.
  const merge = (a: G, b: G) => {
    for (const j of b.jobs) add(a, j);
    groups.splice(groups.indexOf(b), 1);
  };
  const closestPair = () => {
    let pair: [G, G] | null = null, best = -1;
    for (let i = 0; i < groups.length; i++)
      for (let k = i + 1; k < groups.length; k++) {
        const s = sim(core(groups[i]), core(groups[k]));
        if (s > best) [pair, best] = [[groups[i], groups[k]], s];
      }
    return { pair, best };
  };
  for (let c = closestPair(); c.pair && c.best >= 0.6; c = closestPair()) merge(c.pair[0], c.pair[1]);
  while (groups.length > maxClusters) {
    const smallest = [...groups].sort((a, b) => a.jobs.length - b.jobs.length)[0];
    const others = groups.filter((g) => g !== smallest);
    const target = others.sort((a, b) => sim(core(b), core(smallest)) - sim(core(a), core(smallest)))[0];
    merge(target, smallest);
  }

  return groups.map((g) => {
    const size = g.jobs.length;
    const outside = n - size;
    const scored = Object.keys(g.counts).map((k) => {
      const inShare = g.counts[k] / size;
      const outShare = outside ? ((df[k] ?? 0) - g.counts[k]) / outside : 0;
      return { k, distinct: (inShare - outShare) * (GENERIC.has(k) ? 0.3 : 1), inShare };
    });
    const focus = scored.filter((s) => s.distinct > 0.25).sort((a, b) => b.distinct - a.distinct).slice(0, 8).map((s) => s.k);
    const shared = scored
      .filter((s) => s.inShare >= 0.5 && !focus.includes(s.k))
      .sort((a, b) => b.inShare - a.inShare)
      .slice(0, 8)
      .map((s) => s.k);
    return { jobIds: g.jobs.map((j) => j.id), counts: g.counts, focus: focus.length ? focus : shared.slice(0, 5), shared };
  });
}

/** Does a new group of jobs ask for the same things an existing version was built for? */
export function clusterFitsVersion(cluster: KeywordCluster, versionKeywords: Record<string, number>): number {
  const a = new Set(Object.keys(cluster.counts));
  const b = new Set(Object.keys(versionKeywords));
  // Too few keywords to say anything (a posting KASPR barely read): never a fit.
  if (a.size < 3 || !b.size) return 0;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  return inter / new Set([...a, ...b]).size;
}
