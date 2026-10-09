"use client";

import { useEffect, useRef } from "react";

const MODES = ["auto", "research", "shopping", "jobs", "learning", "travel"] as const;

export function Composer({
  value,
  onChange,
  onResearch,
  onAgent,
  onStop,
  running,
}: {
  value: string;
  onChange: (v: string) => void;
  onResearch: (opts: { mode: string; deep: boolean }) => void;
  onAgent: () => void;
  onStop: () => void;
  running: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // mode/deep live in DOM (read at submit) to keep this component light
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(200, ta.scrollHeight) + "px";
  }, [value]);

  const readOpts = () => ({
    mode: (document.querySelector('input[name="mode"]:checked') as HTMLInputElement)?.value || "auto",
    deep: (document.getElementById("deep") as HTMLInputElement)?.checked || false,
  });

  return (
    <div className="surface p-3" style={{ borderColor: "var(--control)" }} id="composer">
      <label htmlFor="q" className="sr-only">Your question</label>
      <textarea
        id="q" ref={ref} rows={2} maxLength={500} value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onResearch(readOpts()); }
        }}
        placeholder="Describe what you want to find, decide or learn"
        className="w-full border-0 resize-none text-base bg-transparent min-h-[56px] focus:outline-none"
      />
      <div className="flex flex-wrap gap-2 items-center mt-2" role="toolbar" aria-label="Research options">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <label key={m} className="mode-pill inline-flex items-center gap-1.5 border border-[var(--rule)] rounded-full px-3 py-2 min-h-[44px] text-[13px] cursor-pointer capitalize">
              <input type="radio" name="mode" value={m} defaultChecked={m === "auto"} />
              {m}
            </label>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-[13px] min-h-[44px]">
          <input type="checkbox" id="deep" aria-label="Deep research" />
          Deep research
        </label>
        <span className="flex-1" />
        {running ? (
          <button type="button" className="btn" onClick={onStop}>Stop</button>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => onResearch(readOpts())}>
              Research <span className="btn-dot" aria-hidden="true">→</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={onAgent}>
              Agent (LLM) <span className="btn-dot" aria-hidden="true">→</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
