import type { AgentPresentation, ApiResult } from "../lib/types";

export interface DigestTakeaway {
  title: string;
  url?: string;
  note?: string;
}

function resultTakeaway(r: ApiResult): DigestTakeaway | null {
  const title = String(r.title ?? r.name ?? "").trim();
  if (!title) return null;
  const rawUrl = r.url ?? r.application_url ?? r.link;
  const url = typeof rawUrl === "string" && rawUrl ? rawUrl : undefined;
  const note =
    [r.price, r.seller, r.company, r.source]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" · ")
      .slice(0, 120) || undefined;
  return { title: title.slice(0, 140), url, note };
}

export function digestTakeaways(
  pres?: AgentPresentation | null,
  fallback: ApiResult[] = []
): DigestTakeaway[] {
  const out: DigestTakeaway[] = [];
  const push = (t: DigestTakeaway | null) => {
    if (t && t.title && out.length < 3) out.push(t);
  };
  if (pres) {
    for (const f of pres.findings || []) {
      if (out.length >= 3) break;
      const claim = String(f.claim || f.title || "").trim();
      if (!claim) continue;
      const note =
        f.title && f.title !== f.claim ? String(f.title).slice(0, 120) : undefined;
      push({ title: claim.slice(0, 140), url: f.url || undefined, note });
    }
    for (const p of pres.picks || []) {
      if (out.length >= 3) break;
      push(resultTakeaway(p));
    }
    for (const p of pres.top_picks || []) {
      if (out.length >= 3) break;
      const title = String(p.title || "").trim();
      if (!title) continue;
      push({
        title: title.slice(0, 140),
        url: p.url || undefined,
        note: p.pick_reason?.slice(0, 120) || undefined,
      });
    }
    for (const p of pres.papers || []) {
      if (out.length >= 3) break;
      push(resultTakeaway(p));
    }
    for (const pl of pres.top_places || []) {
      if (out.length >= 3) break;
      const name = String(pl.name || "").trim();
      if (!name) continue;
      push({
        title: name.slice(0, 140),
        url: pl.url || undefined,
        note: pl.why?.slice(0, 120) || undefined,
      });
    }
    if (out.length < 3 && pres.levels) {
      for (const lvl of ["beginner", "intermediate", "advanced"]) {
        for (const v of pres.levels[lvl] || []) {
          if (out.length >= 3) break;
          push(resultTakeaway(v));
        }
        if (out.length >= 3) break;
      }
    }
    if (out.length < 3) {
      for (const d of pres.itinerary || []) {
        for (const it of d.items || []) {
          if (out.length >= 3) break;
          const name = String(it.name || "").trim();
          if (!name) continue;
          push({
            title: name.slice(0, 140),
            url: it.url || undefined,
            note: it.note?.slice(0, 120) || undefined,
          });
        }
        if (out.length >= 3) break;
      }
    }
    if (out.length < 3) {
      for (const s of pres.stages || []) {
        for (const t of s.topics || []) {
          if (out.length >= 3) break;
          const title = String(t.title || "").trim();
          if (!title) continue;
          push({ title: title.slice(0, 140), url: t.url || undefined });
        }
        if (out.length >= 3) break;
      }
    }
    if (out.length < 3) {
      for (const h of pres.headlines || []) {
        if (out.length >= 3) break;
        const title = String(h.title || "").trim();
        if (!title) continue;
        push({
          title: title.slice(0, 140),
          url: h.url || undefined,
          note: h.source?.slice(0, 60) || undefined,
        });
      }
    }
    if (out.length < 3) {
      const rest: ApiResult[] = [
        ...(pres.flights || []),
        ...(pres.hotels || []),
        ...(pres.places || []),
        ...(pres.jobs || []),
        ...(pres.results || []),
      ];
      for (const r of rest) {
        if (out.length >= 3) break;
        push(resultTakeaway(r));
      }
    }
  }
  if (out.length < 3) {
    for (const r of fallback) {
      if (out.length >= 3) break;
      push(resultTakeaway(r));
    }
  }
  return out;
}

interface SummaryDigestProps {
  summary?: string;
  takeaways: DigestTakeaway[];
  counts: string;
  compact?: boolean;
}

function renderRichSummary(summary: string) {
  const blocks: { head?: string; lines: string[] }[] = [];
  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^\[(.+)\]$/);
    if (head) {
      blocks.push({ head: head[1].slice(0, 60), lines: [] });
    } else if (blocks.length === 0) {
      blocks.push({ lines: [line] });
    } else {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  if (!blocks.some((b) => b.head)) {
    return (
      <p className="font-reading mt-2 max-w-[66ch] whitespace-pre-line text-left text-[17px] leading-[28px] text-[var(--ink)]">
        {summary}
      </p>
    );
  }
  return (
    <div className="mt-3 max-w-[68ch]">
      {blocks.map((b, i) => (
        <div key={i} className={i > 0 ? "mt-5 border-t border-[var(--line-soft)] pt-4" : ""}>
          {b.head && (
            <p className="m-0 mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--primary)]">
              <span aria-hidden="true" className="inline-block h-3 w-[3px] rounded-full bg-[var(--primary-container)]" />
              {b.head}
            </p>
          )}
          {b.lines.map((l, j) =>
            l.startsWith("- ") ? (
              <p key={j} className="font-reading m-0 mb-1.5 flex gap-2.5 text-left text-[15px] leading-[26px] text-[var(--ink)]">
                <span aria-hidden="true" className="mt-[11px] h-1 w-1 flex-none rounded-full bg-[var(--control)]" />
                <span>{l.slice(2)}</span>
              </p>
            ) : (
              <p key={j} className="font-reading m-0 mb-1.5 text-left text-[15px] leading-[26px] text-[var(--ink-2)]">
                {l}
              </p>
            )
          )}
        </div>
      ))}
    </div>
  );
}

export default function SummaryDigest({ summary, takeaways, counts, compact }: SummaryDigestProps) {
  if (!summary && takeaways.length === 0 && !counts) return null;
  return (
    <section
      aria-label="Summary"
      className={`rounded-[12px] border border-[var(--line)] bg-[var(--paper)] shadow-sm ${compact ? "p-4" : "p-6"}`}
    >
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-3)]">
        Summary
      </p>
      {summary && renderRichSummary(summary)}
      {takeaways.length > 0 && (
        <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
          {takeaways.map((t, i) => (
            <li
              key={i}
              className={`truncate text-[14px] leading-[22px] ${
                i === 0
                  ? "border-l-2 border-[var(--primary-container)] pl-3"
                  : "border-l-2 border-transparent pl-3"
              }`}
            >
              <span className="tnum mr-2 font-mono text-[11px] text-[var(--ink-3)]">{i + 1}</span>
              {t.url ? (
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="font-semibold text-[var(--ink)] hover:underline"
                >
                  {t.title}
                </a>
              ) : (
                <span className="font-semibold text-[var(--ink)]">{t.title}</span>
              )}
              {t.note && <span className="text-[var(--ink-2)]"> — {t.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {counts && (
        <p className="tnum mt-3 font-mono text-[11.5px] text-[var(--ink-3)]">{counts}</p>
      )}
    </section>
  );
}
