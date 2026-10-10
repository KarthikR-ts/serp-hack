"use client";

import { useState } from "react";

const SLOT_LABELS: Record<string, string> = {
  origin: "Flying from",
  destination: "Flying to",
  dates: "Dates",
  budget: "Budget",
  travelers: "Travelers",
  role: "Role",
  location: "Location",
  remote: "Remote / onsite",
  product: "Product",
  brand: "Brand",
  place: "Place",
};

const labelFor = (slot: string) =>
  SLOT_LABELS[slot] || slot.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Structured slot-filling: missing choices become editable fields instead
 *  of a free-text question. Values submit as agent filters/constraints. */
export function SlotPrompt({
  question,
  missing,
  known,
  onSubmit,
  onSkip,
}: {
  question: string;
  missing: string[];
  known?: Record<string, string>;
  onSubmit: (slots: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = missing.length ? missing : ["details"];
  const canGo = fields.some((f) => (values[f] || "").trim());

  return (
    <div className="surface border-l-2 !border-l-[var(--ink)] p-4" aria-label="Add missing details">
      <p className="m-0 text-[14.5px]"><strong>Almost there: </strong>{question}</p>
      <form
        className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const filled = Object.fromEntries(
            Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
          );
          if (Object.keys(filled).length) onSubmit({ ...(known || {}), ...filled });
        }}
      >
        {fields.map((f) => (
          <label key={f} className="flex flex-col gap-1 text-[13px] font-semibold text-[var(--ink-2)]">
            {labelFor(f)}
            <input
              type="text"
              value={values[f] || ""}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              placeholder={labelFor(f)}
              maxLength={120}
              aria-label={labelFor(f)}
              className="min-h-[40px] rounded-[8px] border border-[var(--control)] bg-[var(--surface)] px-3 py-2 text-[14px] font-normal text-[var(--ink)]"
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={!canGo}>
            Continue research
          </button>
          <button type="button" className="btn" onClick={onSkip}>Skip, use best guess</button>
        </div>
      </form>
    </div>
  );
}
