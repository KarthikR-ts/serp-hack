"use client";

import Link from "next/link";
import { Clock, Plus, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtInt } from "../lib/format";

export interface HistItem { q: string; kind: string; }

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

  const clearSaved = () => {
    try { localStorage.removeItem("serp_saved"); setSaved([]); } catch { /* ignore */ }
  };

  return (
    <nav
      aria-label="Library"
      className={`${open ? "block" : "hidden"} lg:block`}
    >
      <div className="space-y-5 lg:sticky lg:top-[84px]">
        <button type="button" onClick={onNew} className="btn btn-primary group island-btn w-full !justify-between">
          <span className="inline-flex items-center gap-2">
            <Plus size={15} weight="bold" /> New research
          </span>
          <span className="trail" aria-hidden="true"><Plus size={14} weight="bold" /></span>
        </button>

        <section aria-label="Recent threads">
          <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]">
            <Clock size={13} /> Recent
          </h2>
          {!hist.length && (
            <p className="rounded-[14px] border border-dashed border-[var(--line)] p-3 text-[13px] text-[var(--ink-3)]">
              Nothing yet. Your threads land here.
            </p>
          )}
          <ul className="m-0 list-none space-y-1 p-0">
            {hist.slice(0, 7).map((h, i) => (
              <li key={`${h.q}-${i}`}>
                <button
                  type="button"
                  onClick={() => onPick(h.q, h.kind)}
                  className="flex w-full items-center gap-2 rounded-full border border-transparent px-3 py-2 text-left text-[13px] text-[var(--ink-2)] transition hover:border-[var(--line)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: h.kind === "agent" ? "var(--live)" : "var(--fam-web)" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{h.q.slice(0, 64)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Collections">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]">
            Collections {saved.length > 0 && <span className="tnum">({saved.length})</span>}
          </h2>
          {!saved.length ? (
            <p className="rounded-[14px] border border-dashed border-[var(--line)] p-3 text-[13px] text-[var(--ink-3)]">
              Nothing saved yet. Save a result to find it here.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-1 p-0">
              {saved.map((s, i) => (
                <li key={i}>
                  <button
                    type="button" onClick={() => onOpenSaved(s)}
                    className="block w-full truncate rounded-full border border-transparent px-3 py-2 text-left text-[13px] text-[var(--ink-2)] transition hover:border-[var(--line)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                  >
                    {(s.title || s.query || "saved").slice(0, 64)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Link href="/saved" className="chip !min-h-[36px] !text-[12.5px]">Open saved</Link>
            <button type="button" onClick={clearSaved} className="iconbtn !min-h-[36px]" aria-label="Clear saved">
              <Trash size={15} />
            </button>
          </div>
          <p className="mt-2 text-[12px] text-[var(--ink-3)]">Saved on this device only.</p>
        </section>

        <section aria-label="Operator" className="surface p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-3)]">Operator</h2>
            <Link href="/usage" className="text-[12.5px] font-semibold text-[var(--accent)]">Usage</Link>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-2 text-[13px]">
            <div><dt className="text-[var(--ink-3)]">Queries</dt><dd className="tnum m-0 font-semibold">{usage ? fmtInt(usage.queries) : "—"}</dd></div>
            <div><dt className="text-[var(--ink-3)]">Searches</dt><dd className="tnum m-0 font-semibold">{usage ? fmtInt(usage.serpapi_calls) : "—"}</dd></div>
          </dl>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-soft)]" role="img" aria-label="Search load">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(6, Math.min(100, ((usage?.serpapi_calls || 0) % 200) / 2))}%`,
                background: "var(--live)",
              }}
            />
          </div>
          <p className="tnum mt-1.5 text-[12px] text-[var(--ink-3)]">Failed: {usage ? fmtInt(usage.failed_calls) : "—"}</p>
        </section>

        <p className="flex items-center gap-2 text-[12px] text-[var(--ink-3)]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--live)" }} />
          Reads and compares. Never buys, applies or books.
        </p>
      </div>
    </nav>
  );
}
