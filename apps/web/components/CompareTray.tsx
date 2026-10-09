"use client";

import { useState } from "react";
import type { ApiResult } from "../lib/types";

export function CompareTray({
  selected,
  onClear,
}: {
  selected: Map<number, ApiResult>;
  onClear: () => void;
}) {
  const [diffOnly, setDiffOnly] = useState(false);
  if (!selected.size) return null;
  const items = [...selected.values()].slice(0, 4);
  const rows: [string, (r: ApiResult) => string][] = [
    ["Title", (r) => String(r.title || r.name || "")],
    ["Price / Pay", (r) => String(r.price || r.salary || "-")],
    ["Rating", (r) => (r.rating != null ? `${r.rating}${r.reviews ? ` (${Number(r.reviews).toLocaleString()})` : ""}` : "-")],
    ["Source", (r) => String(r.company || r.seller || r.source || r.channel || "-")],
  ];
  return (
    <div className="sticky bottom-0 surface p-3 my-4" style={{ borderColor: "var(--control)", boxShadow: "var(--shadow-overlay)" }}>
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <span className="text-sm">{selected.size} selected</span>
        <label className="text-[13px] text-[var(--ink-2)] inline-flex items-center gap-1.5">
          <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />
          Differences only
        </label>
        <span className="flex-1" />
        <button type="button" className="btn" onClick={onClear}>Clear</button>
      </div>
      {selected.size >= 2 ? (
        <div className="overflow-x-auto">
          <table className="border-collapse w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            <caption className="sr-only">Comparison</caption>
            <thead>
              <tr>
                <th className="text-left border border-[var(--rule)] p-2">Field</th>
                {items.map((_, i) => (
                  <th key={i} scope="col" className="text-left border border-[var(--rule)] p-2">Option {i + 1}</th>
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
                  vals.forEach((v, i) => { const n = parseFloat(v); if (!isNaN(n) && n > m) { m = n; best = i; } });
                }
                return (
                  <tr key={label}>
                    <th scope="row" className="text-left border border-[var(--rule)] p-2 bg-[var(--bg)]">{label}</th>
                    {vals.map((v, i) => (
                      <td key={i} className="border border-[var(--rule)] p-2">
                        {v}{i === best && <span className="font-bold"> · best</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-2)] m-0">Select 2 or more cards to compare.</p>
      )}
    </div>
  );
}
