"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Sparkle, Stop } from "@phosphor-icons/react";

const MODES = [
  { id: "auto", label: "Auto" },
  { id: "research", label: "Research" },
  { id: "shopping", label: "Shopping" },
  { id: "jobs", label: "Jobs" },
  { id: "learning", label: "Learn" },
  { id: "travel", label: "Travel" },
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

  return (
    <div className="bezel" id="composer">
      <div className="bezel-core p-3.5 sm:p-4">
        <label htmlFor="q" className="sr-only">Your question</label>
        <textarea
          id="q" ref={ref} rows={2} maxLength={2000} value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(onResearch);
            }
          }}
          placeholder="Describe what you want to find, decide or learn"
          className="max-h-[200px] min-h-[56px] w-full resize-none border-0 bg-transparent text-[16px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
        />
        <p className="mt-1 text-[12px] text-[var(--ink-3)]">The assistant chooses where to look. No modes to learn.</p>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line-soft)] pt-3" role="toolbar" aria-label="Research options">
          <div className="flex flex-wrap gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)] p-1" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => {
              const on = mode === m.id;
              return (
                <button
                  key={m.id} type="button" role="radio" aria-checked={on}
                  onClick={() => onMode(m.id)}
                  className={`min-h-[34px] rounded-full px-3 text-[13px] font-medium transition ${
                    on ? "bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-sm ring-1 ring-[var(--line)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]"
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
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition ${
              deep ? "border-[var(--fam-commerce)] bg-[color-mix(in_srgb,var(--fam-commerce)_10%,var(--surface-2))]" : "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]"
            }`}
          >
            <span
              aria-hidden="true"
              className="relative h-[18px] w-[30px] rounded-full transition"
              style={{ background: deep ? "var(--fam-commerce)" : "var(--control)" }}
            >
              <span
                className="absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform"
                style={{ transform: deep ? "translateX(12px)" : "none" }}
              />
            </span>
            Deep
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
                className="btn group island-btn !border-[var(--line)] !bg-transparent !text-[var(--ink)]"
                aria-label="Run autonomous agent"
              >
                <Sparkle size={15} /> Agent
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
