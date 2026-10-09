"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { fmtInt } from "../../lib/format";

interface Usage {
  queries: number; serpapi_calls: number; calls_per_query: number;
  failed_calls: number; calls_by_tool: Record<string, number>; uptime_seconds: number;
}

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.usage().then(setUsage).catch(() => setFailed(true));
  }, []);

  const max = Math.max(1, ...Object.values(usage?.calls_by_tool || { _: 1 }));

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-6">
      <p className="text-sm">
        <Link href="/" className="inline-flex items-center gap-1.5 font-medium text-[var(--ink-2)] hover:text-[var(--ink)]">
          <ArrowLeft size={15} /> Back to research
        </Link>
      </p>
      <h1 className="mt-2 text-balance text-[clamp(28px,4vw,40px)] font-bold leading-tight tracking-[-0.03em]">Usage</h1>
      <p className="mt-1 max-w-[60ch] text-[14px] text-[var(--ink-2)]">
        Operator view. Aggregates only. No query text stored or shown.
      </p>

      {failed && (
        <div role="alert" className="surface mt-4 !border-[var(--error)] p-4 text-[14px]">
          Usage unavailable. Check the backend is running.
        </div>
      )}

      {!usage && !failed && <p className="mt-4 text-[14px] text-[var(--ink-2)]">Loading…</p>}

      {usage && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Queries", usage.queries],
              ["Searches", usage.serpapi_calls],
              ["Per query", usage.calls_per_query],
              ["Failed", usage.failed_calls],
            ].map(([k, v]) => (
              <div key={k as string} className="surface p-3.5">
                <div className="tnum text-[24px] font-bold tracking-tight">{fmtInt(v as number)}</div>
                <div className="text-[12.5px] text-[var(--ink-2)]">{k}</div>
              </div>
            ))}
          </div>

          <h2 className="mt-6 text-[16px] font-semibold">Calls by tool</h2>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {Object.entries(usage.calls_by_tool).map(([t, n]) => (
              <li key={t} className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12.5px]">{t}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--line-soft)]" aria-hidden="true">
                    <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                </div>
                <span className="tnum text-right font-mono text-[13px] font-semibold">{fmtInt(n)}</span>
              </li>
            ))}
          </ul>
          <p className="tnum mt-4 font-mono text-[12px] text-[var(--ink-3)]">
            Uptime {Math.round(usage.uptime_seconds / 60)} min
          </p>
        </>
      )}
    </main>
  );
}
