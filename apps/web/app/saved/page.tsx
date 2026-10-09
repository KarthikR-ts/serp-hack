"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, BookmarkSimple, Trash } from "@phosphor-icons/react";

interface SavedItem { title?: string; query?: string; url?: string; at?: string; }

export default function SavedPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  useEffect(() => {
    try { setItems(JSON.parse(localStorage.getItem("serp_saved") || "[]")); }
    catch { setItems([]); }
  }, []);

  const clear = () => {
    try { localStorage.removeItem("serp_saved"); setItems([]); } catch { /* ignore */ }
  };

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-6">
      <p className="text-sm">
        <Link href="/" className="inline-flex items-center gap-1.5 font-medium text-[var(--ink-2)] hover:text-[var(--ink)]">
          <ArrowLeft size={15} /> Back to research
        </Link>
      </p>
      <h1 className="mt-2 text-balance text-[clamp(28px,4vw,40px)] font-bold leading-tight tracking-[-0.03em]">
        Saved research
      </h1>
      <p className="mt-1 text-[14px] text-[var(--ink-2)]">
        Collections live on this device only. Export by opening each source.
      </p>

      {!items.length ? (
        <div className="surface mt-5 grid gap-2 p-6 text-center">
          <BookmarkSimple size={22} className="mx-auto text-[var(--ink-3)]" />
          <p className="m-0 text-[15px] font-semibold">Nothing saved yet</p>
          <p className="m-0 text-[14px] text-[var(--ink-2)]">Save results, plans and runs to find them here.</p>
          <p className="m-0"><Link href="/" className="btn btn-primary">Start researching</Link></p>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <span className="tnum font-mono text-[12px] text-[var(--ink-3)]">{items.length} saved</span>
            <span className="flex-1" />
            <button type="button" onClick={clear} className="btn !min-h-[36px]">
              <Trash size={14} /> Clear all
            </button>
          </div>
          <ul className="m-0 mt-2 list-none p-0">
            {items.map((s, i) => (
              <li key={i} className="border-t border-[var(--line)] py-3">
                <div className="text-[15px] font-semibold tracking-tight">{s.title || s.query || "saved"}</div>
                <div className="tnum mt-0.5 font-mono text-[12px] text-[var(--ink-3)]">
                  {s.at ? new Date(s.at).toLocaleString() : ""}
                </div>
                <div className="mt-1.5 flex gap-3">
                  {s.query && <Link href={`/?q=${encodeURIComponent(s.query)}`} className="text-[13px] font-semibold">Re-run</Link>}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[13px] font-semibold">
                      Open <ArrowSquareOut size={13} />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
