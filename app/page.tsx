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

const ECHO_MODULE_COLS = ["Module", "Average View %", "# of Students Viewing", "Overall View %", "# of Students"];

const GRADEBOOK_MODULE_COLS = ["Module", "Avg % Turned In", "Avg Average Excluding Zeros", "n_assignments"];

const ECHO_SUMMARY_PERCENT_COLS = ["Average View %", "% of Students Viewing", "% of Video Viewed Overall"];
const ECHO_MODULE_PERCENT_COLS = ["Average View %", "Overall View %"];
const GRADEBOOK_MODULE_PERCENT_COLS = ["Avg % Turned In", "Avg Average Excluding Zeros"];

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
  "% of Video Viewed Overall": "Share of total video minutes watched across all viewers.",

  // Echo Module
  "Module": "Canvas module that contains these Echo360 media items or assignments.",
  "# of Students Viewing": "Students who watched any Echo360 media within this module.",
  "Overall View %": "Combined percentage of media watched by the viewing students.",
  "# of Students": "Total students in the course for comparison to viewers.",

  // Gradebook Module
  "Avg % Turned In": "Average submission rate for assignments within the module.",
  "Avg Average Excluding Zeros": "Mean assignment score ignoring missing (zero) submissions.",
  "n_assignments": "Number of assignments mapped to the module.",
};

// ---------- Tooltip component ----------
function Tooltip({ text, children, position = "top" }: { text: string; children: React.ReactNode; position?: "top" | "bottom" }) {
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
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
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
  if (n !== null && String(value).match(/^[\d,\.\-]+%?$/)) return formatNumberCell(n);

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
  const font = opts?.font ?? "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
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
    widths[c] = isNumericishCol(c) && !isTextHeavyCol(c) ? Math.min(clamped, 180) : clamped;
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
    const picked = columns.filter((c) => set.has(c));

    // Don’t collapse to 1 col if mismatch—fall back to all keys
    if (picked.length <= 1 && keys.length > 1) return keys;

    return picked;
  }, [rows, columns]);

  const slice = useMemo(() => rows.slice(0, maxRows), [rows, maxRows]);

  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!slice.length || !cols.length) {
      setColWidths({});
      return;
    }

    const widths = buildColWidths(rows, cols, percentCols, {
      sample: Math.min(120, rows.length),
      font: "12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      paddingPx: 20,
      minPx: 70,
      maxTextPx: 520,
      maxDefaultPx: 320,
    });

    setColWidths(widths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols.join("|"), (percentCols ?? []).join("|"), maxRows]);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 min-w-0">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">
          Showing {slice.length.toLocaleString()}
          {rows.length > slice.length ? ` of ${rows.length.toLocaleString()}` : ""} rows
        </div>
      </div>

      {slice.length === 0 ? (
        <div className="text-sm text-slate-600">No data.</div>
      ) : (
        // Individual table scroll container (x + y), with a fixed max height and sticky header
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          {/* This box is constrained to the card width (screen-width container) */}
          <div
            className="w-full max-h-[520px] overflow-x-auto overflow-y-auto"
            aria-label={`${title} table`}
          >
            {/* Table can be wider than the box; scroll happens on the box */}
            <table className="w-max text-[13px] leading-5 table-fixed">

              <colgroup>
                {cols.map((c) => (
                  <col key={c} style={colWidths[c] ? { width: `${colWidths[c]}px` } : undefined} />
                ))}
              </colgroup>

              <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
                <tr>
                  {cols.map((c) => {
                    const textHeavy = isTextHeavyCol(c);
                    const helpText = COLUMN_HELP_TEXT[c];
                    return (
                      <th
                        key={c}
                        scope="col"
                        className={`text-left px-2 py-2 text-xs font-semibold text-slate-800 align-top ${
                          textHeavy ? "break-words" : "whitespace-nowrap"
                        }`}
                      >
                        <span>
                          {c}
                          {helpText && (
                            <Tooltip text={helpText} position="bottom">
                              <span className="ml-1 text-slate-400 hover:text-slate-600 cursor-help">ⓘ</span>
                            </Tooltip>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {slice.map((r, idx) => (
                  <tr
                    key={idx}
                    className="border-t border-slate-300/70 odd:[&>td]:bg-white even:[&>td]:bg-slate-100 hover:[&>td]:bg-slate-200/60"
                  >

                    {cols.map((c) => {
                      const textHeavy = isTextHeavyCol(c);
                      return (
                        <td
                          key={c}
                          className={`px-2 py-2 text-[13px] leading-5 text-slate-800 align-top ${
                            textHeavy ? "break-words" : "whitespace-nowrap"
                          }`}
                        >
                          {formatCell(c, r[c], percentCols)}
                        </td>

                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [activeTab, setActiveTab] = useState<"tables" | "charts" | "ai">("tables");

  const [courseId, setCourseId] = useState("");
  const [canvasCsv, setCanvasCsv] = useState<File | null>(null);
  const [echoCsv, setEchoCsv] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";

  const echoSummary = result?.echo?.summary ?? [];
  const echoModules = result?.echo?.modules ?? [];

  const gradeSummary = result?.grades?.summary ?? [];
  const gradeModuleMetrics = result?.grades?.module_metrics ?? [];

  const gradeSummaryPercentCols = useMemo(() => {
    if (!gradeSummary?.[0]) return [];
    return Object.keys(gradeSummary[0]).filter((k) => k !== "Metric");
  }, [gradeSummary]);

  // Sort gradebook module metrics by Canvas module order (from echoModules)
  const sortedGradeModuleMetrics = useMemo(() => {
    if (!gradeModuleMetrics || gradeModuleMetrics.length === 0) return gradeModuleMetrics;
    if (!echoModules || echoModules.length === 0) return gradeModuleMetrics;

    // Extract module order from echoModules
    const moduleOrder = echoModules.map((row) => {
      return String(row.Module ?? row.module ?? row["Module Name"] ?? row.module_name ?? "");
    });

    // Create a map of module name to its position
    const orderMap = new Map<string, number>();
    moduleOrder.forEach((module, idx) => {
      if (module && !orderMap.has(module)) {
        orderMap.set(module, idx);
      }
    });

    // Sort gradeModuleMetrics by the module order
    return [...gradeModuleMetrics].sort((a, b) => {
      const moduleA = String(a.Module ?? a.module ?? a["Module Name"] ?? a.module_name ?? "");
      const moduleB = String(b.Module ?? b.module ?? b["Module Name"] ?? b.module_name ?? "");

      const posA = orderMap.get(moduleA) ?? 999999;
      const posB = orderMap.get(moduleB) ?? 999999;

      return posA - posB;
    });
  }, [gradeModuleMetrics, echoModules]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    const kpiData = {
      studentsEnrolled: null as number | null,
      averageViewPercent: null as number | null,
      averageAssignmentGrade: null as number | null,
      medianLetterGrade: null as string | null,
    };

    // Students Enrolled - from echo modules "# of Students"
    if (echoModules && echoModules.length > 0) {
      const firstModule = echoModules[0];
      const studentCount =
        toNumber(firstModule["# of Students"]) ??
        toNumber(firstModule["# Students"]) ??
        toNumber(firstModule.students_count);
      if (studentCount !== null) {
        kpiData.studentsEnrolled = studentCount;
      }
    }

    // Average View % - average of "Average View %" from echo summary
    if (echoSummary && echoSummary.length > 0) {
      const viewPercentages = echoSummary
        .map((row) => toNumber(row["Average View %"] ?? row["Avg View %"]))
        .filter((v): v is number => v !== null);

      if (viewPercentages.length > 0) {
        const sum = viewPercentages.reduce((acc, val) => acc + val, 0);
        kpiData.averageViewPercent = sum / viewPercentages.length;
      }
    }

    // Average Assignment Grade - from gradeSummary "Average Excluding Zeros"
    if (gradeSummary && gradeSummary.length > 0) {
      const avgExcludingZerosRow = gradeSummary.find(
        (row) => row.Metric === "Average Excluding Zeros" || row.Metric === "Avg Average Excluding Zeros"
      );

      if (avgExcludingZerosRow) {
        const values = Object.entries(avgExcludingZerosRow)
          .filter(([key]) => key !== "Metric")
          .map(([, value]) => toNumber(value))
          .filter((v): v is number => v !== null);

        if (values.length > 0) {
          const sum = values.reduce((acc, val) => acc + val, 0);
          kpiData.averageAssignmentGrade = sum / values.length;
        }
      }
    }

    // Median Letter Grade - from backend KPIs if available
    if (result?.kpis?.["Median Letter Grade"]) {
      kpiData.medianLetterGrade = result.kpis["Median Letter Grade"];
    }

    return kpiData;
  }, [echoSummary, echoModules, gradeSummary, result?.kpis]);

  async function runAnalysis() {
    setError(null);

    if (!apiBase) {
      setError("Missing NEXT_PUBLIC_API_BASE_URL environment variable in Vercel.");
      return;
    }
    if (!courseId.trim()) {
      setError("Please enter a Canvas Course ID (number).");
      return;
    }
    if (!canvasCsv || !echoCsv) {
      setError("Please upload both CSV files.");
      return;
    }

    try {
      setLoading(true);

      const form = new FormData();
      form.append("course_id", courseId.trim());
      form.append("canvas_gradebook_csv", canvasCsv);
      form.append("echo_analytics_csv", echoCsv);

      const res = await fetch(`${apiBase.replace(/\/$/, "")}/analyze`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Backend error (${res.status}): ${txt}`);
      }

      const json = (await res.json()) as AnalyzeResponse;
      setResult(json);
      setStep(3);
      setActiveTab("tables");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  const steps = [
    { n: 1 as const, label: "Enter course" },
    { n: 2 as const, label: "Upload CSVs" },
    { n: 3 as const, label: "Review insights" },
  ];

  const canGoToStep = (n: 1 | 2 | 3) => {
    if (n <= step) return true;
    // Avoid changing behavior: only allow step 3 navigation once results exist.
    return n === 3 && !!result;
  };

  return (
    <main className="min-h-screen">
      {/* Screen-width container (centered) */}
      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        <header className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CLE Analytics Dashboard</h1>
              <p className="mt-1 text-sm text-slate-600">Canvas Gradebook + Echo360 analytics</p>
            </div>
            <div className="text-xs text-slate-500">Vercel (Frontend) + Render (Backend)</div>
          </div>
          <div className="mt-5 border-t border-slate-200" />

          {/* Stepper */}
          <nav aria-label="Progress" className="mt-5">
            <ol className="flex flex-wrap gap-2">
              {steps.map((s) => {
                const isActive = s.n === step;
                const isComplete = s.n < step;
                const disabled = !canGoToStep(s.n);
                return (
                  <li key={s.n} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => !disabled && setStep(s.n)}
                      disabled={disabled}
                      aria-current={isActive ? "step" : undefined}
                      className={
                        "group inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen disabled:opacity-50 disabled:cursor-not-allowed " +
                        (isActive
                          ? "border-slate-900 bg-slate-900 text-white"
                          : isComplete
                          ? "border-slate-200 bg-white text-slate-800"
                          : "border-slate-200 bg-white text-slate-700")
                      }
                    >
                      <span
                        className={
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold " +
                          (isActive
                            ? "bg-white/15 text-white"
                            : isComplete
                            ? "bg-slate-100 text-slate-800"
                            : "bg-slate-100 text-slate-700")
                        }
                        aria-hidden="true"
                      >
                        {s.n}
                      </span>
                      <span className="truncate">{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </header>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {step === 1 && (
          <section aria-label="Enter course" className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Step 1: Enter Course</h2>
            <div className="text-sm text-slate-600 mb-3">
              Use the numeric Canvas Course ID (the number in the course URL).
            </div>

            <label className="block text-sm font-medium text-slate-800 mb-1">Canvas Course ID</label>
            <input
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-csuGreen focus:border-csuGreen"
              placeholder="e.g., 123456"
            />

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setStep(2)}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen"
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-label="Upload CSVs" className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Step 2: Upload CSVs</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-800 mb-1">Canvas Gradebook CSV</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCanvasCsv(e.target.files?.[0] ?? null)}
                  className="w-full"
                />
                <div className="text-xs text-slate-500 mt-1">{canvasCsv ? canvasCsv.name : "No file selected"}</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-800 mb-1">Echo360 Analytics CSV</label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setEchoCsv(e.target.files?.[0] ?? null)}
                  className="w-full"
                />
                <div className="text-xs text-slate-500 mt-1">{echoCsv ? echoCsv.name : "No file selected"}</div>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => setStep(1)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen"
              >
                Back
              </button>

              <button
                onClick={runAnalysis}
                disabled={loading}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen disabled:opacity-60"
              >
                {loading ? "Running..." : "Run Analysis"}
              </button>
            </div>

            {loading && (
              <div className="mt-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="text-sm font-medium text-slate-700">Analyzing your data...</div>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-slate-600 via-slate-800 to-slate-600 animate-[progress_1.5s_ease-in-out_infinite] bg-[length:200%_100%]" />
                </div>
                <div className="text-xs text-slate-500 mt-2">This may take a few moments...</div>
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <div>
            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {/* Students Enrolled */}
              <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                <div className="text-xs font-medium text-slate-500 tracking-wide mb-1 flex items-center gap-1">
                  Students Enrolled
                  <Tooltip text="Unique students with Canvas enrollments included in these metrics.">
                    <span className="inline-block cursor-help text-slate-400 hover:text-slate-600">
                      ⓘ
                    </span>
                  </Tooltip>
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                  {kpis.studentsEnrolled !== null ? kpis.studentsEnrolled.toLocaleString() : "—"}
                </div>
              </div>

              {/* Average View % */}
              <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                <div className="text-xs font-medium text-slate-500 tracking-wide mb-1 flex items-center gap-1">
                  Average View %
                  <Tooltip text="Average Echo360 engagement percentage across all published media.">
                    <span className="inline-block cursor-help text-slate-400 hover:text-slate-600">
                      ⓘ
                    </span>
                  </Tooltip>
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                  {kpis.averageViewPercent !== null
                    ? `${(kpis.averageViewPercent * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>

              {/* Average Assignment Grade */}
              <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                <div className="text-xs font-medium text-slate-500 tracking-wide mb-1 flex items-center gap-1">
                  Average Assignment Grade
                  <Tooltip text="Mean assignment score for the class, combining all available grades.">
                    <span className="inline-block cursor-help text-slate-400 hover:text-slate-600">
                      ⓘ
                    </span>
                  </Tooltip>
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                  {kpis.averageAssignmentGrade !== null
                    ? `${(kpis.averageAssignmentGrade * 100).toFixed(1)}%`
                    : "—"}
                </div>
              </div>

              {/* Median Letter Grade */}
              <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                <div className="text-xs font-medium text-slate-500 tracking-wide mb-1 flex items-center gap-1">
                  Median Letter Grade
                  <Tooltip text="Median letter grade calculated from current Canvas scores.">
                    <span className="inline-block cursor-help text-slate-400 hover:text-slate-600">
                      ⓘ
                    </span>
                  </Tooltip>
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                  {kpis.medianLetterGrade ?? "—"}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div
              role="tablist"
              aria-label="Insights"
              className="mb-4 inline-flex flex-wrap gap-2 rounded-2xl bg-white border border-slate-200 p-2"
            >
              {(["tables", "charts", "ai"] as const).map((t, idx) => {
                const label = t === "tables" ? "Tables" : t === "charts" ? "Charts" : "AI Analysis";
                const selected = activeTab === t;
                const tabs = ["tables", "charts", "ai"] as const;

                const handleKeyDown = (e: React.KeyboardEvent) => {
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    const nextIdx = (idx + 1) % tabs.length;
                    setActiveTab(tabs[nextIdx]);
                    setTimeout(() => document.getElementById(`tab-${tabs[nextIdx]}`)?.focus(), 0);
                  } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    const prevIdx = (idx - 1 + tabs.length) % tabs.length;
                    setActiveTab(tabs[prevIdx]);
                    setTimeout(() => document.getElementById(`tab-${tabs[prevIdx]}`)?.focus(), 0);
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setActiveTab(tabs[0]);
                    setTimeout(() => document.getElementById(`tab-${tabs[0]}`)?.focus(), 0);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    setActiveTab(tabs[tabs.length - 1]);
                    setTimeout(() => document.getElementById(`tab-${tabs[tabs.length - 1]}`)?.focus(), 0);
                  }
                };

                return (
                  <button
                    key={t}
                    role="tab"
                    id={`tab-${t}`}
                    aria-selected={selected}
                    aria-controls={`panel-${t}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveTab(t)}
                    onKeyDown={handleKeyDown}
                    className={
                      "rounded-xl px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-csuGreen " +
                      (selected
                        ? "bg-slate-900 text-white"
                        : "bg-white border border-slate-200 text-slate-900 hover:bg-slate-50")
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {activeTab === "tables" && (
              <div
                role="tabpanel"
                id="panel-tables"
                aria-labelledby="tab-tables"
                className="grid gap-4"
              >
                <Table
                  title="Echo Summary"
                  rows={echoSummary}
                  columns={ECHO_SUMMARY_COLS}
                  percentCols={ECHO_SUMMARY_PERCENT_COLS}
                  maxRows={200}
                />

                <Table
                  title="Echo Module Table"
                  rows={echoModules}
                  columns={ECHO_MODULE_COLS}
                  percentCols={ECHO_MODULE_PERCENT_COLS}
                  maxRows={200}
                />

                <Table
                  title="Gradebook Summary Rows"
                  rows={gradeSummary}
                  columns={
                    gradeSummary?.[0]?.Metric
                      ? ["Metric", ...Object.keys(gradeSummary[0]).filter((k) => k !== "Metric")]
                      : undefined
                  }
                  percentCols={gradeSummaryPercentCols}
                  maxRows={50}
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
                  <div className="text-lg font-semibold text-slate-900 mb-2">Echo Chart</div>
                  <EchoComboChart moduleRows={echoModules as any} />
                </div>

                <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
                  <div className="text-lg font-semibold text-slate-900 mb-2">Gradebook Chart</div>
                  <GradebookComboChart rows={sortedGradeModuleMetrics as any} />
                </div>
              </div>
            )}

            {activeTab === "ai" && (
              <div
                role="tabpanel"
                id="panel-ai"
                aria-labelledby="tab-ai"
                className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
              >
                <div className="text-lg font-semibold text-slate-900 mb-2">AI Analysis</div>
                {result?.analysis?.error ? (
                  <div className="text-sm text-red-700">{result.analysis.error}</div>
                ) : (
                  <pre className="text-sm font-sans whitespace-pre-wrap text-slate-800">
                    {result?.analysis?.text ?? "No AI analysis returned."}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
