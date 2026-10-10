"use client";

import { useEffect, useRef } from "react";

/** Live single-liner timeline: pulse dot + text, last ~8 lines, auto-scroll. */
export function ReasoningTrace({ lines, live }: { lines: string[]; live?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const shown = lines.filter(Boolean).slice(-8);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);
  if (!shown.length) return null;
  return (
    <div
      ref={box}
      aria-live="polite"
      aria-label="Agent reasoning"
      className="max-h-[190px] overflow-y-auto rounded-[12px] border border-[var(--line)] bg-[var(--paper)] px-4 py-2.5 shadow-sm"
    >
      <ol className="m-0 list-none space-y-1.5 p-0">
        {shown.map((t, i) => {
          const last = i === shown.length - 1;
          return (
            <li key={`${i}-${t.slice(0, 24)}`} className="flex items-start gap-2.5 text-[13.5px] leading-[20px] text-[var(--ink-2)]">
              <span
                aria-hidden="true"
                className={`mt-[6px] h-2 w-2 flex-none rounded-full ${last && live ? "pulse-dot" : ""}`}
                style={{ background: last && live ? "var(--status-caution)" : "var(--status-success)" }}
              />
              <span className="min-w-0 flex-1">{t.slice(0, 220)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
