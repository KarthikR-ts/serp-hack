"use client";

import type { ApiSource } from "../lib/types";

function safeHttp(url: unknown): string | null {
  try {
    const u = new URL(String(url || ""), "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function Margin({
  sources,
  onFlash,
}: {
  sources: ApiSource[];
  onFlash: (eid: string | null) => void;
}) {
  return (
    <aside aria-label="Sources and evidence" className="surface p-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-auto">
      <h2 className="text-[15px] m-0 mb-2">Sources ({sources.length})</h2>
      <ol className="list-none m-0 p-0">
        {sources.map((s) => {
          const url = safeHttp(s.url);
          return (
            <li
              key={s.id || s.url} data-eid={s.id}
              className="py-2.5 border-t border-[var(--rule)] text-sm"
              onMouseEnter={() => onFlash(s.id)}
              onMouseLeave={() => onFlash(null)}
            >
              <strong className="block">{(s.title || s.url || "source").slice(0, 90)}</strong>
              <div className="text-[13px] text-[var(--ink-3)]">{s.domain}{s.date ? ` · ${s.date}` : ""}</div>
              {s.claim && <blockquote className="my-1.5 pl-2 border-l-2 border-[var(--rule)] text-[var(--ink-2)] text-[13px]">{s.claim.slice(0, 200)}</blockquote>}
              <div className="text-[13px] text-[var(--ink-3)]">
                {s.type && <span>[{s.type}] </span>}
                {s.claim_type && s.claim_type !== "fact" && (
                  <span className="text-xs border border-[var(--rule)] rounded-full px-2 py-0.5 ml-1">{s.claim_type}</span>
                )}
              </div>
              <div className="flex gap-2 mt-1 text-[13px]">
                {url && <a href={url} target="_blank" rel="noopener noreferrer nofollow">Open source ↗</a>}
                <button type="button" className="btn !min-h-[32px] !py-1 !px-2 !text-[13px]" onClick={() => onFlash(s.id)}>
                  Show in results
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
