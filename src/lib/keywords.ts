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
  ["AI", "=AI", "artificial intelligence", "ai-powered", "ai tools", "ai models"], ["AI tools", "chatgpt", "copilot", "openai", "anthropic", "gemini"],
  ["Prompt engineering", "prompting", "prompt design"], ["Analytics", "analytics", "analytical"], ["Automation", "automate", "automating", "automated", "workflow automation"],
  ["Data quality", "data integrity", "data validation"], ["Process documentation", "process mapping", "standard operating procedures", "sops"],
  ["Google Workspace", "g suite", "google docs", "google slides"], ["Airtable"], ["Zapier"], ["Data entry"], ["Market analysis"],
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

/** Soft skills nearly every posting lists; they shouldn't decide how a resume gets tailored. */
export const GENERIC = new Set([
  "Communication", "Teamwork", "Leadership", "Problem solving", "Attention to detail", "Time management",
  "Research", "Reporting", "Presentations", "Operations", "Customer service", "Mentoring", "KPIs",
]);

// ---------- which resume to use for one job (local, free) ----------

export interface ResumeOption {
  /** "main" or "v<id>" */
  key: string;
  kind: "main" | "version";
  id: number;
  label: string;
  text: string;
  has_pdf: boolean;
  has_docx: boolean;
}

export interface RankedResume {
  option: ResumeOption;
  match: KeywordMatch;
}

/** Every resume in the library against one job: most keywords covered first; ties go to your main resume. */
export function rankResumes(jobText: string, options: ResumeOption[]): RankedResume[] {
  return options
    .map((option) => ({ option, match: matchKeywords(jobText, option.text) }))
    .sort((a, b) =>
      b.match.coverage - a.match.coverage ||
      b.match.covered.length - a.match.covered.length ||
      (a.option.kind === "main" ? -1 : b.option.kind === "main" ? 1 : 0));
}

/** One or two plain sentences on why the top resume is the one to use. */
export function whyBest(ranked: RankedResume[]): string {
  const [best, next] = ranked;
  if (!best) return "";
  const total = best.match.covered.length + best.match.missing.length;
  if (total === 0) return "KASPR couldn't find specific skills in this posting to compare. Check the description under the job title to see what he read.";
  let s = `Covers ${best.match.covered.length} of the ${total} skills this job asks for`;
  if (!next) s += ".";
  else if (best.match.coverage > next.match.coverage) {
    const extra = best.match.covered.filter((k) => !next.match.covered.includes(k));
    s += extra.length
      ? `, more than ${next.option.label}. It has ${list(extra.slice(0, 3))}${extra.length > 3 ? " and more" : ""}, which ${next.option.label} doesn't.`
      : `, the most of your resumes.`;
  } else s += `. Your other resumes cover the same amount, so use this one.`;
  if (best.match.coverage < VERSION_FIT) s += " None of your resumes is a strong fit yet, so this is a good one to tailor with SONNY.";
  return s;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
