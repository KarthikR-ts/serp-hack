"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SavedItem {
  title?: string;
  query?: string;
  url?: string;
  at?: string;
}

export default function SavedPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  useEffect(() => {
    try {
      setItems(JSON.parse(localStorage.getItem("serp_saved") || "[]"));
    } catch {
      setItems([]);
    }
  }, []);
  return (
    <main className="max-w-[760px] mx-auto p-4">
      <p className="text-sm"><Link href="/">← Back to research</Link></p>
      <h1 className="text-3xl font-bold">Saved research</h1>
      <p className="text-sm text-[var(--ink-2)]">Saved on this device only.</p>
      {!items.length ? (
        <p>Nothing saved yet. Save results, plans and runs to find them here.</p>
      ) : (
        <ul className="list-none m-0 p-0">
          {items.map((s, i) => (
            <li key={i} className="border-t border-[var(--rule)] py-3">
              <div className="font-semibold">{s.title || s.query || "saved"}</div>
              <div className="text-[13px] text-[var(--ink-3)]">{s.at ? new Date(s.at).toLocaleString() : ""}</div>
              {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm">Open ↗</a>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
