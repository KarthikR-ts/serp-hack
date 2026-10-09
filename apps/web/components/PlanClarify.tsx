"use client";

import { useState } from "react";
import type { PlanStep } from "../lib/types";

export function PlanCard({
  steps,
  estimatedCalls,
  estimatedSeconds,
  onStart,
  onCancel,
}: {
  steps: PlanStep[];
  estimatedCalls: number;
  estimatedSeconds: number;
  onStart: (skipNext: boolean) => void;
  onCancel: () => void;
}) {
  const [skip, setSkip] = useState(false);
  return (
    <div role="group" aria-label="Research plan" className="surface p-4 my-4" style={{ borderColor: "var(--control)" }}>
      <h2 className="text-[15px] m-0">Plan</h2>
      <p className="text-sm text-[var(--ink-2)] m-0">
        {steps.length} steps · about {estimatedCalls} searches · up to ~{estimatedSeconds} s
      </p>
      <ol className="my-2 pl-6">
        {steps.map((s) => (
          <li key={s.id} className="my-1 text-sm">
            {s.tool}: &ldquo;{String(s.query).slice(0, 90)}&rdquo;
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" className="btn btn-primary" autoFocus onClick={() => onStart(skip)}>
          Start research <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <label className="text-[13px] text-[var(--ink-2)] inline-flex items-center gap-1.5 min-h-[44px]">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          Skip plan next time
        </label>
      </div>
    </div>
  );
}

export function ClarifyCard({ question, onSkip }: { question: string; onSkip: () => void }) {
  return (
    <div className="surface p-4 my-4" style={{ borderLeft: "4px solid var(--ink)" }}>
      <p className="m-0"><strong>One quick question: </strong>{question}</p>
      <div className="flex flex-wrap gap-2 mt-2">
        <button type="button" className="btn" onClick={onSkip}>Skip, use best guess</button>
      </div>
      <p className="text-[13px] text-[var(--ink-3)] m-0 mt-2">Or refine your query above and press Agent again.</p>
    </div>
  );
}
