"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Scales } from "@phosphor-icons/react";
import type { ApiResult, PlanStep } from "../lib/types";
import { fmtInt } from "../lib/format";

export function PlanCard({
  steps, estimatedCalls, estimatedSeconds, onStart, onCancel,
}: {
  steps: PlanStep[]; estimatedCalls: number; estimatedSeconds: number;
  onStart: (skipNext: boolean) => void; onCancel: () => void;
}) {
  const [skip, setSkip] = useState(false);
  return (
    <div role="group" aria-label="Research plan" className="surface p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">Plan</h2>
      <p className="tnum mt-0.5 font-mono text-[12px] text-[var(--ink-2)]">
        {steps.length} steps · about {estimatedCalls} searches · up to ~{estimatedSeconds}s
      </p>
      <ol className="my-2 space-y-1 pl-5 text-[14px]">
        {steps.map((s) => (
          <li key={s.id}>{s.tool}: &ldquo;{String(s.query).slice(0, 96)}&rdquo;</li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary group island-btn" autoFocus onClick={() => onStart(skip)}>
          Start research
          <span className="trail" aria-hidden="true"><ArrowRight size={14} weight="bold" /></span>
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 text-[13px] text-[var(--ink-2)]">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Skip plan next time
        </label>
      </div>
    </div>
  );
}

export function ClarifyCard({ question, onSkip }: { question: string; onSkip: () => void }) {
  return (
    <div className="surface border-l-2 !border-l-[var(--ink)] p-4">
      <p className="m-0 text-[14.5px]"><strong>One quick question: </strong>{question}</p>
      <div className="mt-2"><button type="button" className="btn" onClick={onSkip}>Skip, use best guess</button></div>
      <p className="m-0 mt-2 text-[13px] text-[var(--ink-3)]">Or refine your query above and run again.</p>
    </div>
  );
}

export function ConfidenceLine({ level, reasons }: { level: string; reasons: string[] }) {
  const lvl = /high/i.test(level) ? 3 : /low/i.test(level) ? 1 : 2;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px]">
      <span aria-hidden="true" className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-5 rounded-full"
            style={{ background: i < lvl ? (lvl === 3 ? "var(--success)" : lvl === 2 ? "var(--caution)" : "var(--error)") : "var(--line)" }}
          />
        ))}
      </span>
      <strong>Confidence: {level}.</strong>
      <span className="text-[var(--ink-2)]">{reasons.join("; ").slice(0, 240)}</span>
    </p>
  );
}

export function SkeletonRun() {
  return (
    <div aria-busy="true" aria-label="Loading results" className="surface space-y-2 p-4">
      <span className="skel" style={{ width: "42%" }} />
      <span className="skel" style={{ width: "88%" }} />
      <span className="skel" style={{ width: "64%" }} />
      <span className="skel" style={{ width: "76%" }} />
    </div>
  );
}

export function EmptyResults({ query, onWiden }: { query: string; onWiden: () => void }) {
  return (
    <div className="surface grid gap-2 p-6 text-center sm:grid-cols-[1fr_auto] sm:items-center sm:text-left">
      <div>
        <h3 className="text-[16px] font-semibold">No matches under these constraints</h3>
        <p className="m-0 mt-1 text-[14px] text-[var(--ink-2)]">
          Nothing hidden for &ldquo;{query.slice(0, 80)}&rdquo;. Loosen a filter or widen the search.
        </p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onWiden}>Search wider</button>
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="surface !border-[var(--error)] p-4">
      <p className="m-0 text-[14.5px]"><strong>Search is not responding.</strong> {message} Nothing was fabricated.</p>
      <div className="mt-2"><button type="button" className="btn" onClick={onRetry}>Retry</button></div>
    </div>
  );
}

/** Compare: bottom-anchored tray + modal sheet. Motion only here (infrequent). */
export function CompareTray({
  selected, onClear,
}: {
  selected: Map<number | string, ApiResult>;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [diffOnly, setDiffOnly] = useState(false);
  const reduce = useReducedMotion();
  if (!selected.size) return null;
  const items = [...selected.values()].slice(0, 4);

  const rows: [string, (r: ApiResult) => string][] = [
    ["Title", (r) => String(r.title || r.name || "")],
    ["Price / Pay", (r) => String(r.price || r.salary || "—")],
    ["Rating", (r) => (r.rating != null ? `${r.rating}${r.reviews ? ` (${fmtInt(r.reviews)})` : ""}` : "—")],
    ["Source", (r) => String(r.company || r.seller || r.source || r.channel || "—")],
  ];

  return (
    <>
      <div className="fixed inset-x-0 bottom-4 z-[40] flex justify-center px-4">
        <div className="flex max-w-[560px] items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-float)]">
          <Scales size={16} aria-hidden="true" />
          <span className="text-[13px] font-semibold">{selected.size} selected</span>
          <span className="flex-1" />
          <button type="button" className="btn !min-h-[34px] !py-1.5" onClick={onClear}>Clear</button>
          <button
            type="button" className="btn btn-primary !min-h-[34px] !py-1.5" disabled={selected.size < 2}
            onClick={() => setOpen(true)} title={selected.size < 2 ? "Select 2 or more to compare" : "Compare"}
          >
            Compare
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[50] flex items-end justify-center bg-black/50 p-3 sm:items-center"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          >
            <motion.div
              role="dialog" aria-modal="true" aria-label="Comparison"
              className="surface flex max-h-[82dvh] w-full max-w-[880px] flex-col overflow-hidden !rounded-[16px]"
              initial={reduce ? false : { opacity: 0, transform: "translateY(24px) scale(0.98)" }}
              animate={{ opacity: 1, transform: "none" }}
              exit={reduce ? undefined : { opacity: 0, transform: "translateY(12px) scale(0.98)" }}
              transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="flex items-center gap-3 border-b border-[var(--line)] p-4">
                <strong>Compare</strong>
                <span className="text-[13px] text-[var(--ink-3)]">{items.length} options</span>
                <span className="flex-1" />
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--ink-2)]">
                  <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                  Differences only
                </label>
                <button type="button" className="btn !min-h-[34px]" onClick={() => setOpen(false)}>Close</button>
              </div>
              <div className="overflow-auto p-4">
                <table className="tnum w-full border-collapse text-[13.5px]">
                  <caption className="sr-only">Comparison</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="border border-[var(--line)] bg-[var(--surface-2)] p-2 text-left">Field</th>
                      {items.map((_, i) => (
                        <th key={i} scope="col" className="border border-[var(--line)] bg-[var(--surface-2)] p-2 text-left">Option {i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, fn]) => {
                      const vals = items.map((r) => fn(r).slice(0, 120));
                      if (diffOnly && new Set(vals).size <= 1) return null;
                      let best = -1;
                      if (label === "Rating") {
                        let m = -1;
                        vals.forEach((v, i) => { const n = parseFloat(v); if (!Number.isNaN(n) && n > m) { m = n; best = i; } });
                      }
                      return (
                        <tr key={label}>
                          <th scope="row" className="border border-[var(--line)] bg-[var(--surface-2)] p-2 text-left">{label}</th>
                          {vals.map((v, i) => (
                            <td key={i} className="border border-[var(--line)] p-2 align-top">
                              <span className={i === best ? "font-bold" : ""}>{v}</span>
                              {i === best && <span className="text-[12px] font-normal text-[var(--ink-3)]"> · best</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
