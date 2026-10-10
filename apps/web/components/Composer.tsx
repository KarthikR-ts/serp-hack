"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Stop } from "@phosphor-icons/react";

const MODES = [
  { id: "auto", label: "Auto Mode", hint: "Agent detects best vertical combination" },
  { id: "research", label: "Pure Research", hint: "Scholarly journals & technical whitepapers" },
  { id: "shopping", label: "Shopping", hint: "Products, specs, prices" },
  { id: "jobs", label: "Jobs", hint: "Roles and internships" },
  { id: "learning", label: "Learn", hint: "Courses and papers" },
  { id: "travel", label: "Live Temporal", hint: "Strict last 24-hour real-time synthesis" },
] as const;

export interface ComposerOpts { mode: string; deep: boolean; }

export function Composer({
  value, onChange, mode, onMode, deep, onDeep, running, onResearch, onAgent, onStop,
}: {
  value: string; onChange: (v: string) => void;
  mode: string; onMode: (m: string) => void;
  deep: boolean; onDeep: (d: boolean) => void;
  running: boolean;
  onResearch: (o: ComposerOpts) => void;
  onAgent: () => void;
  onStop: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(200, ta.scrollHeight) + "px";
  }, [value]);

  const submit = (fn: (o: ComposerOpts) => void) => {
    if (!value.trim() || running) return;
    fn({ mode, deep });
  };
  const active = MODES.find((m) => m.id === mode) || MODES[0];

  return (
    <div className="bezel" id="composer">
      <div className="bezel-core p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">
            Query Focus: <span className="text-[var(--primary)]">{active.label}</span>
          </p>
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--ink-3)]">
            Retrieval-mode: high-precision
          </span>
        </div>
        <label htmlFor="q" className="sr-only">Your question</label>
        <textarea
          id="q" ref={ref} rows={3} maxLength={2000} value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(onResearch); return; }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(onResearch);
            }
          }}
          placeholder="Find three good laptops under ₹80,000 for machine learning..."
          className="font-reading mt-3 max-h-[200px] min-h-[72px] w-full resize-none rounded-[6px] bg-[var(--surface-low)] p-4 text-[17px] leading-[28px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
        />
        <p className="mt-2 text-right font-mono text-[11px] text-[var(--ink-3)]">⌘+Enter to research</p>

        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--line-soft)] pt-3" role="toolbar" aria-label="Research options">
          <div className="flex flex-wrap gap-1 rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)] p-1" role="radiogroup" aria-label="Mode">
            {MODES.slice(0, 6).map((m) => {
              const on = mode === m.id;
              return (
                <button
                  key={m.id} type="button" role="radio" aria-checked={on}
                  onClick={() => onMode(m.id)}
                  title={m.hint}
                  className={`min-h-[34px] rounded-[6px] px-3 text-[13px] font-medium transition ${
                    on ? "bg-[var(--paper)] font-semibold text-[var(--primary)] shadow-sm" : "text-[var(--ink-2)] hover:text-[var(--primary)]"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <span className="flex-1" />

          <button
            type="button" aria-pressed={deep} onClick={() => onDeep(!deep)}
            title="Deep research uses more searches and cross-checks sources"
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-[6px] border px-3 text-[13px] font-semibold transition ${
              deep ? "border-[var(--primary-container)] bg-[var(--secondary-container)] text-[var(--primary)]" : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]"
            }`}
          >
            Deep research
            <span className="rounded bg-[var(--primary-container)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
              Depth {deep ? 3 : 1}
            </span>
          </button>

          {running ? (
            <button type="button" className="btn" onClick={onStop}>
              <Stop size={14} weight="fill" /> Stop
            </button>
          ) : (
            <>
              <button
                type="button" onClick={() => submit(onResearch)}
                className="btn btn-primary group island-btn" aria-label="Start research"
              >
                Research
                <span className="trail" aria-hidden="true"><ArrowRight size={15} weight="bold" /></span>
              </button>
              <button
                type="button" onClick={onAgent} title="Autonomous agent: classify, call exact endpoints, rank picks"
                className="btn group island-btn !bg-[var(--paper)]"
                aria-label="Run autonomous agent"
              >
                Agent
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
