"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Usage {
  queries: number;
  serpapi_calls: number;
  calls_per_query: number;
  failed_calls: number;
  calls_by_tool: Record<string, number>;
  uptime_seconds: number;
}

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    import("../../lib/api").then(({ api }) =>
      api.usage().then(setUsage).catch(() => setUsage(null))
    );
  }, []);
  return (
    <main className="max-w-[760px] mx-auto p-4">
      <p className="text-sm"><Link href="/">← Back to research</Link></p>
      <h1 className="text-3xl font-bold">Usage</h1>
      <p className="text-sm text-[var(--ink-2)]">Operator view. Aggregates only; no query text is stored or shown.</p>
      {!usage ? (
        <p className="text-sm text-[var(--ink-2)]">Loading…</p>
      ) : (
        <>
          <div className="grid gap-2 my-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            {[
              ["Queries", usage.queries],
              ["Searches", usage.serpapi_calls],
              ["Per query", usage.calls_per_query],
              ["Failed", usage.failed_calls],
            ].map(([k, v]) => (
              <div key={k} className="surface p-3">
                <div className="text-2xl font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{v}</div>
                <div className="text-[13px] text-[var(--ink-2)]">{k}</div>
              </div>
            ))}
          </div>
          <h2 className="text-xl font-semibold mt-6">Calls by tool</h2>
          <table className="border-collapse w-full text-sm mt-2" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr><th scope="col" className="text-left border border-[var(--rule)] p-2">Tool</th><th scope="col" className="text-left border border-[var(--rule)] p-2">Calls</th></tr>
            </thead>
            <tbody>
              {Object.entries(usage.calls_by_tool).map(([t, n]) => (
                <tr key={t}><td className="border border-[var(--rule)] p-2">{t}</td><td className="border border-[var(--rule)] p-2">{n}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
