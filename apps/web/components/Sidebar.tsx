"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtInt } from "../lib/format";

export interface HistItem { q: string; kind: string; }

/** Stitch navigational rail: 248px persistent column, fog wash, paper cards. */
export function Sidebar({
  open, hist, onPick, onNew, savedTick, onOpenSaved,
}: {
  open: boolean;
  hist: HistItem[];
  onPick: (q: string, kind: string) => void;
  onNew: () => void;
  savedTick: number;
  onOpenSaved: (s: { title?: string; query?: string; url?: string }) => void;
}) {
  const [saved, setSaved] = useState<{ title?: string; query?: string; url?: string }[]>([]);
  const [usage, setUsage] = useState<{ queries: number; serpapi_calls: number; failed_calls: number } | null>(null);

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem("serp_saved") || "[]").slice(0, 12)); }
    catch { setSaved([]); }
  }, [savedTick]);

  useEffect(() => {
    api.usage()
      .then((u) => setUsage({ queries: u.queries, serpapi_calls: u.serpapi_calls, failed_calls: u.failed_calls }))
      .catch(() => setUsage(null));
  }, [hist.length, savedTick]);

  return (
    <nav aria-label="Library" className={`${open ? "block" : "hidden"} lg:block`}>
      <div className="space-y-4 lg:sticky lg:top-[84px]">
        <button
          type="button" onClick={onNew}
          className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--primary-container)] px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[var(--primary)]"
        >
          <span aria-hidden="true" className="text-[18px] leading-none">+</span> New research
        </button>

        <section aria-label="Collections">
          <h2 className="mb-1 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">Collections</h2>
          <ul className="m-0 list-none space-y-0.5 p-0">
            <li>
              <Link href="/saved" className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] text-[var(--ink-2)] transition hover:bg-[var(--surface-high)] hover:text-[var(--ink)]">
                <span aria-hidden="true">◆</span> Saved research
              </Link>
            </li>
            <li>
              <a href="#sources" className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[13px] text-[var(--ink-2)] transition hover:bg-[var(--surface-high)] hover:text-[var(--ink)]">
                <span aria-hidden="true">▤</span> Primary sources
              </a>
            </li>
          </ul>
        </section>

        <section aria-label="Today">
          <h2 className="mb-1 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">Today</h2>
          {!hist.length && (
            <p className="rounded-[12px] border border-dashed border-[var(--line)] bg-[var(--paper)] p-3 text-[13px] text-[var(--ink-3)]">
              Nothing yet. Your threads land here.
            </p>
          )}
          <ul className="m-0 list-none space-y-0.5 p-0">
            {hist.slice(0, 7).map((h, i) => (
              <li key={`${h.q}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPick(h.q, h.kind)}
                  className="flex w-full items-center gap-2 truncate rounded-[6px] px-2 py-1.5 text-left text-[13px] text-[var(--ink-2)] transition hover:bg-[var(--surface-high)] hover:text-[var(--ink)]"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: h.kind === "agent" ? "var(--status-success)" : "var(--fam-web)" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{h.q.slice(0, 64)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Collections saved">
          <h2 className="mb-1 px-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">
            Earlier {saved.length > 0 && <span className="tnum">({saved.length})</span>}
          </h2>
          {!saved.length ? (
            <p className="rounded-[12px] border border-dashed border-[var(--line)] bg-[var(--paper)] p-3 text-[13px] text-[var(--ink-3)]">
              Nothing saved yet. Save a result to find it here.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-0.5 p-0">
              {saved.map((s, i) => (
                <li key={i}>
                  <button
                    type="button" onClick={() => onOpenSaved(s)}
                    className="block w-full truncate rounded-[6px] px-2 py-1.5 text-left text-[13px] text-[var(--ink-2)] transition hover:bg-[var(--surface-high)] hover:text-[var(--ink)]"
                  >
                    {(s.title || s.query || "saved").slice(0, 64)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 px-1 text-[12px] text-[var(--ink-3)]">Saved on this device only.</p>
        </section>

        <section aria-label="Operator" className="rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">Operator</h2>
            <Link href="/usage" className="text-[12.5px] font-semibold text-[var(--fam-web)]">Usage</Link>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-2 text-[13px]">
            <div><dt className="text-[var(--ink-3)]">Queries</dt><dd className="tnum m-0 font-semibold">{usage ? fmtInt(usage.queries) : "—"}</dd></div>
            <div><dt className="text-[var(--ink-3)]">Searches</dt><dd className="tnum m-0 font-semibold">{usage ? fmtInt(usage.serpapi_calls) : "—"}</dd></div>
          </dl>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="img" aria-label="Search load">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(6, Math.min(100, ((usage?.serpapi_calls || 0) % 200) / 2))}%`,
                background: "var(--status-success)",
              }}
            />
          </div>
          <p className="tnum mt-1.5 text-[12px] text-[var(--ink-3)]">Failed: {usage ? fmtInt(usage.failed_calls) : "—"}</p>
        </section>

        <p className="flex items-center gap-2 px-1 text-[12px] text-[var(--ink-2)]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" />
          Reads and compares. Never buys, applies or books.
        </p>
      </div>
    </nav>
  );
}
