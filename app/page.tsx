"use client";

import React, { useEffect, useMemo, useState } from "react";
import EchoComboChart from "./components/charts/EchoComboChart";
import GradebookComboChart from "./components/charts/GradebookComboChart";

type AnyRow = Record<string, any>;
type Row = Record<string, any>;

type AnalyzeResponse = {
  kpis?: Record<string, any>;
  echo?: {
    summary?: AnyRow[];
    modules?: AnyRow[];
  };
  grades?: {
    summary?: AnyRow[]; // includes "Metric"
    module_metrics?: AnyRow[];
  };
  analysis?: {
    text?: string | null;
    error?: string | null;
  };
};

// ---------- Column presets (match Streamlit intent) ----------
const ECHO_SUMMARY_COLS = [
  "Media Title",
  "Video Duration",
  "# of Unique Views",
  "Total Views",
  "Total Watch Time (Min)",
  "Average View %",
  "% of Students Viewing",
  "% of Video Viewed Overall",
];

const ECHO_MODULE_COLS = [
  "Module",
  "Average View %",
  "# of Students Viewing",
  "Overall View %",
  "# of Students",
];

const GRADEBOOK_MODULE_COLS = [
  "Module",
  "Avg % Turned In",
  "Avg Average Excluding Zeros",
  "n_assignments",
];

const ECHO_SUMMARY_PERCENT_COLS = [
  "Average View %",
  "% of Students Viewing",
  "% of Video Viewed Overall",
];
const ECHO_MODULE_PERCENT_COLS = ["Average View %", "Overall View %"];
const GRADEBOOK_MODULE_PERCENT_COLS = [
  "Avg % Turned In",
  "Avg Average Excluding Zeros",
];

// ---------- Column help text (from helptext.py) ----------
const COLUMN_HELP_TEXT: Record<string, string> = {
  // Echo Summary
  "Media Title": "Name of the Echo360 media item as published to students.",
  "Video Duration": "Total runtime of the media in hours:minutes:seconds.",
  "# of Unique Views": "Distinct students who watched this media at least once.",
  "# of Unique Viewers": "Distinct students who watched this media at least once.",
  "Total Views": "Total number of views across all students.",
  "Total Watch Time (Min)": "Total minutes watched across all viewers.",
  "Average View %": "Average portion of the video watched per student viewer.",
  "% of Students Viewing": "Percent of enrolled students who viewed this media.",
  "% of Video Viewed Overall":
    "Share of total video minutes watched across all viewers.",

  // Echo Module
  Module:
    "Canvas module that contains these Echo360 media items or assignments.",
  "# of Students Viewing":
    "Students who watched any Echo360 media within this module.",
  "Overall View %":
    "Combined percentage of media watched by the viewing students.",
  "# of Students": "Total students in the course for comparison to viewers.",

  // Gradebook Module
  "Avg % Turned In":
    "Average submission rate for assignments within the module.",
  "Avg Average Excluding Zeros":
    "Mean assignment score ignoring missing (zero) submissions.",
  n_assignments: "Number of assignments mapped to the module.",
};

// ---------- Tooltip component ----------
function Tooltip({
  text,
  children,
  position = "top",
}: {
  text: string;
  children: React.ReactNode;
  position?: "top" | "bottom";
}) {
  const [show, setShow] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && position === "top" && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-slate-900 rounded-lg whitespace-nowrap shadow-lg pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-900" />
        </span>
      )}
      {show && position === "bottom" && (
        <span className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-2 text-xs text-white bg-slate-900 rounded-lg whitespace-nowrap shadow-lg pointer-events-none">
          {text}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-1 border-4 border-transparent border-b-slate-900" />
        </span>
      )}
    </span>
  );
}

// ---------- Formatting helpers ----------
function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/%/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatNumberCell(n: number) {
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 1000)
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercentCell(v: any) {
  const n = toNumber(v);
  if (n === null) return "";
  const pct = n * 100;
  return `${pct.toFixed(1)}%`;
}

function formatCell(key: string, value: any, percentCols?: string[]) {
  if (value === null || value === undefined) return "";

  if (percentCols?.includes(key)) return formatPercentCell(value);

  // Auto percent if header includes % and value looks like proportion
  const n = toNumber(value);
  if (key.includes("%") && n !== null && n >= 0 && n <= 1.5) {
    return formatPercentCell(n);
  }

  if (typeof value === "number") return formatNumberCell(value);
  if (n !== null && String(value).match(/^[\d,\.\-]+%?$/))
    return formatNumberCell(n);

  return String(value);
}

// ---------- Option B: measure + set widths via colgroup ----------
function isTextHeavyCol(col: string) {
  return /title|name|media|assignment|page|url|link|description/i.test(col);
}

function isNumericishCol(col: string) {
  return /%|count|views|time|duration|avg|total|n_/i.test(col);
}

function buildColWidths(
  rows: AnyRow[],
  cols: string[],
  percentCols?: string[],
  opts?: {
    sample?: number;
    font?: string;
    paddingPx?: number;
    minPx?: number;
    maxTextPx?: number;
    maxDefaultPx?: number;
  }
) {
  const sample = opts?.sample ?? 80;
  const font =
    opts?.font ??
    "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
  const paddingPx = opts?.paddingPx ?? 22; // cell padding + some breathing room
  const minPx = opts?.minPx ?? 70;
  const maxTextPx = opts?.maxTextPx ?? 520; // cap long text columns
  const maxDefaultPx = opts?.maxDefaultPx ?? 320;

  // SSR safety
  if (typeof document === "undefined") return {};

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return {};

  ctx.font = font;

  const widths: Record<string, number> = {};
  const take = rows.slice(0, sample);

  for (const c of cols) {
    let max = ctx.measureText(String(c)).width;

    for (const r of take) {
      const txt = String(formatCell(c, r?.[c], percentCols) ?? "");
      const w = ctx.measureText(txt).width;
      if (w > max) max = w;
    }

    const padded = Math.ceil(max + paddingPx);

    const cap = isTextHeavyCol(c) ? maxTextPx : maxDefaultPx;
    const clamped = Math.max(minPx, Math.min(padded, cap));

    // Numeric-ish columns can be tighter
    widths[c] =
      isNumericishCol(c) && !isTextHeavyCol(c) ? Math.min(clamped, 180) : clamped;
  }

  return widths;
}

// ---------- Table component ----------
function Table({
  title,
  rows,
  columns,
  percentCols,
  maxRows = 50,
}: {
  title: string;
  rows: AnyRow[];
  columns?: string[];
  percentCols?: string[];
  maxRows?: number;
}) {
  const cols = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const keys = Object.keys(rows[0] ?? {});
    if (!columns || columns.length === 0) return keys;

    const set = new Set(keys);
    const filtered = columns.filter((c) => set.has(c));
    return filtered.length ? filtered : keys;
  }, [rows, columns]);

  const limited = useMemo(() => rows?.slice(0, maxRows) ?? [], [rows, maxRows]);

  const colWidths = useMemo(() => {
    return buildColWidths(limited, cols, percentCols, {
      font:
        "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      paddingPx: 26,
      minPx: 70,
      maxTextPx: 520,
      maxDefaultPx: 320,
    });
  }, [limited, cols, percentCols]);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-lg font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">
          Showing {Math.min(rows?.length ?? 0, maxRows)} of {rows?.length ?? 0}
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-max w-full text-sm">
          <colgroup>
            {cols.map((c) => (
              <col
                key={c}
                style={{
                  width: colWidths?.[c] ? `${colWidths[c]}px` : undefined,
                }}
              />
            ))}
          </colgroup>

          <thead className="bg-slate-50 text-slate-700">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className="text-left font-medium px-3 py-2 border-b border-slate-200 whitespace-nowrap"
                >
                  {COLUMN_HELP_TEXT[c] ? (
                    <Tooltip text={COLUMN_HELP_TEXT[c]} position="bottom">
                      <span className="underline decoration-dotted underline-offset-2 cursor-help">
                        {c}
                      </span>
                    </Tooltip>
                  ) : (
                    c
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="text-slate-800">
            {limited.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-slate-50/40">
                {cols.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-2 border-b border-slate-100 whitespace-nowrap"
                    title={String(r?.[c] ?? "")}
                  >
                    {formatCell(c, r?.[c], percentCols)}
                  </td>
                ))}
              </tr>
            ))}

            {(!limited || limited.length === 0) && (
              <tr>
                <td
                  colSpan={Math.max(1, cols.length)}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Main page ----------
export default function Page() {
  const [courseId, setCourseId] = useState("");
  const [gradebookFile, setGradebookFile] = useState<File | null>(null);
  const [echoFile, setEchoFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const [activeTab, setActiveTab] = useState<"tables" | "charts" | "ai">("tables");

  async function onAnalyze() {
    setError(null);
    setResult(null);

    if (!courseId.trim()) {
      setError("Please enter a course ID.");
      return;
    }
    if (!gradebookFile) {
      setError("Please upload a Canvas Gradebook CSV.");
      return;
    }
    if (!echoFile) {
      setError("Please upload an Echo360 Analytics CSV.");
      return;
    }

    setLoading(true);

    try {
      const fd = new FormData();
      fd.append("course_id", courseId.trim());
      fd.append("canvas_gradebook_csv", gradebookFile);
      fd.append("echo_analytics_csv", echoFile);

      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      if (!baseUrl) throw new Error("Missing NEXT_PUBLIC_API_BASE_URL");

      const resp = await fetch(`${baseUrl}/analyze`, {
        method: "POST",
        body: fd,
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Backend error (${resp.status}): ${txt}`);
      }

      const data = (await resp.json()) as AnalyzeResponse;
      setResult(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // ---------- Memoized sorted modules for charts/tables ----------
  const echoSummary = useMemo(() => result?.echo?.summary ?? [], [result]);
  const echoModules = useMemo(() => result?.echo?.modules ?? [], [result]);

  const gradeSummary = useMemo(() => result?.grades?.summary ?? [], [result]);
  const gradeModuleMetrics = useMemo(
    () => result?.grades?.module_metrics ?? [],
    [result]
  );

  const sortedGradeModuleMetrics = useMemo(() => {
    const rows = [...(gradeModuleMetrics ?? [])];
    rows.sort((a, b) =>
      String(a?.Module ?? "").localeCompare(String(b?.Module ?? ""))
    );
    return rows;
  }, [gradeModuleMetrics]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
          <div className="text-2xl font-semibold text-slate-900">
            CLE Analytics Dashboard
          </div>
          <div className="text-sm text-slate-600 mt-1">
            Upload course exports, then view tables, charts, and AI analysis.
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">
                Canvas Course ID
              </label>
              <input
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                placeholder="e.g., 12345"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">
                Canvas Gradebook CSV
              </label>
              <input
                type="file"
                accept=".csv"
                className="w-full text-sm text-slate-700"
                onChange={(e) => setGradebookFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium text-slate-700">
                Echo360 Analytics CSV
              </label>
              <input
                type="file"
                accept=".csv"
                className="w-full text-sm text-slate-700"
                onChange={(e) => setEchoFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
              onClick={onAnalyze}
              disabled={loading}
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>

            {error && <div className="text-sm text-red-700">{error}</div>}
          </div>
        </div>

        {result && (
          <div className="mt-6 grid gap-4">
            {/* Tabs */}
            <div className="flex gap-2">
              {(["tables", "charts", "ai"] as const).map((t) => {
                const active = activeTab === t;
                const label =
                  t === "tables" ? "Tables" : t === "charts" ? "Charts" : "AI Analysis";
                return (
                  <button
                    key={t}
                    id={`tab-${t}`}
                    role="tab"
                    aria-selected={active}
                    aria-controls={`panel-${t}`}
                    className={`rounded-xl px-4 py-2 text-sm font-medium border ${
                      active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50"
                    }`}
                    onClick={() => setActiveTab(t)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Panels */}
            {activeTab === "tables" && (
              <div
                role="tabpanel"
                id="panel-tables"
                aria-labelledby="tab-tables"
                className="grid gap-4"
              >
                <Table
                  title="Echo Summary Rows"
                  rows={echoSummary}
                  columns={ECHO_SUMMARY_COLS}
                  percentCols={ECHO_SUMMARY_PERCENT_COLS}
                  maxRows={200}
                />

                <Table
                  title="Echo Module Metrics"
                  rows={echoModules}
                  columns={ECHO_MODULE_COLS}
                  percentCols={ECHO_MODULE_PERCENT_COLS}
                  maxRows={200}
                />

                <Table
                  title="Gradebook Summary Rows"
                  rows={gradeSummary}
                  maxRows={200}
                />

                <Table
                  title="Gradebook Module Metrics"
                  rows={sortedGradeModuleMetrics}
                  columns={GRADEBOOK_MODULE_COLS}
                  percentCols={GRADEBOOK_MODULE_PERCENT_COLS}
                  maxRows={200}
                />
              </div>
            )}

            {activeTab === "charts" && (
              <div
                role="tabpanel"
                id="panel-charts"
                aria-labelledby="tab-charts"
                className="grid gap-4"
              >
                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
                  <div className="text-lg font-semibold text-slate-900 mb-2">
                    Echo Chart
                  </div>
                  <EchoComboChart moduleRows={echoModules as any} />
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
                  <div className="text-lg font-semibold text-slate-900 mb-2">
                    Gradebook Chart
                  </div>
                  <GradebookComboChart rows={sortedGradeModuleMetrics as any} />
                </div>
              </div>
            )}

            {activeTab === "ai" && (
              <section
                role="tabpanel"
                id="panel-ai"
                aria-labelledby="tab-ai"
                className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
              >
                <h2 className="text-lg font-semibold text-slate-900 mb-2">AI Analysis</h2>

                {result?.analysis?.error ? (
                  <div className="text-sm text-red-700">{result.analysis.error}</div>
                ) : (
                  (() => {
                    const raw = (result?.analysis?.text ?? "").trim();
                    let report: any = null;
                    try {
                      report = raw ? JSON.parse(raw) : null;
                    } catch {
                      report = null;
                    }

                    const cards = Array.isArray(report?.cards) ? report.cards : null;

                    if (!cards || cards.length === 0) {
                      return (
                        <pre className="text-sm font-sans whitespace-pre-wrap text-slate-800">
                          {raw || "No AI analysis returned."}
                        </pre>
                      );
                    }

                    return (
                      <div className="grid gap-4">
                        {cards.map((card: any) => (
                          <section
                            key={String(card?.id ?? card?.title ?? Math.random())}
                            aria-labelledby={`${String(card?.id ?? "card")}-title`}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                          >
                            <h3
                              id={`${String(card?.id ?? "card")}-title`}
                              className="text-base font-semibold text-slate-900"
                            >
                              {String(card?.title ?? "")}
                            </h3>

                            {card?.summary ? (
                              <p className="mt-2 text-sm text-slate-800">
                                {String(card.summary)}
                              </p>
                            ) : null}

                            {Array.isArray(card?.metrics) && card.metrics.length > 0 ? (
                              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                                {card.metrics.map((m: any, idx: number) => (
                                  <div
                                    key={`${String(card?.id ?? "card")}-m-${idx}`}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                                  >
                                    <dt className="text-xs font-medium text-slate-600">
                                      {String(m?.label ?? "")}
                                    </dt>
                                    <dd className="text-sm text-slate-900 break-words">
                                      {String(m?.value ?? "")}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            ) : null}

                            {Array.isArray(card?.bullets) && card.bullets.length > 0 ? (
                              <ul className="mt-3 list-disc pl-5 text-sm text-slate-800 space-y-1">
                                {card.bullets.map((b: any, idx: number) => (
                                  <li key={`${String(card?.id ?? "card")}-b-${idx}`}>
                                    {String(b)}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </section>
                        ))}

                        {raw ? (
                          <details className="rounded-2xl border border-slate-200 bg-white p-4">
                            <summary className="cursor-pointer text-sm font-medium text-slate-700">
                              View raw AI output
                            </summary>
                            <pre className="mt-3 text-xs font-mono whitespace-pre-wrap text-slate-800">
                              {raw}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    );
                  })()
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
