"use client";

import Image from "next/image";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ApiResult, WhyItem } from "../lib/types";
import { safeHttp, safeImg } from "../lib/api";
import { fmtDate, fmtInt, fmtViews } from "../lib/format";
import { ActionButton } from "./ActionButton";
import { Reveal } from "./Reveal";

function Outbound({ r }: { r: ApiResult }) {
  const url = safeHttp(r.url || r.application_url || r.link);
  if (!url) return null;
  const label =
    r.company || r.salary || r.application_url ? "Open application"
    : r.price && (r.seller || r.reviews != null || r.image) ? "View on site"
    : r.authors || r.abstract ? "Read paper"
    : r.length || r.channel ? "Watch"
    : "Open";
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1 border-b border-[var(--line)] pb-px text-[13px] font-semibold text-[var(--ink)] hover:border-[var(--ink)]"
    >
      {label} <ArrowSquareOut size={13} />
    </a>
  );
}

export function Why({ items }: { items?: WhyItem[] }) {
  if (!items?.length) return null;
  return (
    <details className="mt-1.5 text-[13.5px]">
      <summary className="inline-flex min-h-[32px] cursor-pointer items-center font-semibold text-[var(--fam-web)]">
        Why this result?
      </summary>
      <ul className="m-1 list-none space-y-1 p-0">
        {items.map((w, i) => (
          <li key={i} className="flex gap-2 text-[var(--ink-2)]">
            <span aria-hidden="true" className="font-bold" style={{ color: w.met ? "var(--success)" : "var(--error)" }}>
              {w.met ? "✓" : "✕"}
            </span>
            {w.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Facts({ pairs }: { pairs: [string, string][] }) {
  const shown = pairs.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13.5px] text-[var(--ink-2)]">
      {shown.map(([k, v]) => (
        <li key={k}><strong className="font-semibold text-[var(--ink)]">{k}: </strong>{v}</li>
      ))}
    </ul>
  );
}

function CardActions({ r, index, onSelect, onDismiss, onSave }: {
  r: ApiResult; index: number;
  onSelect?: (r: ApiResult, i: number, on: boolean) => void;
  onDismiss?: (r: ApiResult) => void;
  onSave?: (r: ApiResult) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      {r.action?.url ? <ActionButton action={r.action} compact /> : <Outbound r={r} />}
      {onSelect && (
        <label className="inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 text-[var(--ink-2)]">
          <input type="checkbox" aria-label="Select for compare" className="h-4 w-4 accent-[var(--accent)]"
            onChange={(e) => onSelect(r, index, e.target.checked)} />
          Compare
        </label>
      )}
      {onDismiss && (
        <button type="button" className="btn !min-h-[32px] !px-2.5 !py-1 !text-[12.5px]" onClick={() => onDismiss(r)}>
          Not interested
        </button>
      )}
      {onSave && (
        <button type="button" className="btn !min-h-[32px] !px-2.5 !py-1 !text-[12.5px]" onClick={() => onSave(r)}>
          Save
        </button>
      )}
    </div>
  );
}

function KindTag({ label, family }: { label: string; family: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-[var(--surface-low)] px-2 py-0.5 text-[12px] font-semibold" style={{ color: `var(--fam-${family})` }}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: `var(--fam-${family})` }} />
      {label}
    </span>
  );
}

/** Job: scannable row (page, not object). Deadline + pay always explicit. */
export function JobRow({ r, index, ...rest }: {
  r: ApiResult; index: number;
} & Omit<Parameters<typeof CardActions>[0], "r" | "index">) {
  const soon = /day|tomorrow|closes/i.test(String(r.posted_at || "")) || /deadline/i.test(String(r.description || ""));
  return (
    <Reveal as="article" index={index % 6}>
      <div className="border-t border-[var(--line)] py-3.5 first:border-t-0" data-vertical="google_jobs" data-eids={(r.evidence_ids || []).join(" ")}>
        <KindTag label="Job" family="career" />
        <h3 className="mb-0 mt-1.5 text-[16px] font-semibold tracking-tight">{String(r.title || "Role").slice(0, 120)}</h3>
        <div className="mt-0.5 text-[13.5px] text-[var(--ink-2)]">
          {[r.company, r.location, r.employment_type].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-1.5">
          <Facts pairs={[
            ["Pay", r.salary ? `${r.salary} (listed)` : "not listed"],
            ["Posted", fmtDate(String(r.posted_at || r.date || ""))],
            ["Via", String(r.source || "")],
          ]} />
        </div>
        {soon && <p className="mt-1 text-[13px] font-semibold text-[var(--caution)]">Closing soon, check deadline at source.</p>}
        {r.description && <p className="mt-1.5 max-w-[70ch] text-[14px] text-[var(--ink-2)]">{String(r.description).slice(0, 260)}</p>}
        <CardActions r={r} index={index} {...rest} />
        <Why items={r.why} />
      </div>
    </Reveal>
  );
}

/** Product: tile with image. Featured pick spans two columns. */
export function ProductTile({ r, index, featured, ...rest }: {
  r: ApiResult; index: number; featured?: boolean;
} & Omit<Parameters<typeof CardActions>[0], "r" | "index">) {
  const url = safeHttp(r.url);
  const img = safeImg(r.image);
  return (
    <Reveal as="article" index={index % 6} className={featured ? "sm:col-span-2" : ""}>
      <article
        onMouseMove={(e) => {
          const t = e.currentTarget, rect = t.getBoundingClientRect();
          t.style.setProperty("--mx", `${e.clientX - rect.left}px`);
          t.style.setProperty("--my", `${e.clientY - rect.top}px`);
        }}
        className={`rounded-[12px] border border-[var(--line)] bg-[var(--paper)] shadow-sm overflow-hidden ${featured ? "!border-[var(--primary-container)]" : ""}`}
        data-vertical="google_shopping" data-eids={(r.evidence_ids || []).join(" ")}
      >
        {url && img && (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`View on site: ${r.title || "product"}`}
            className="block aspect-[4/3] overflow-hidden bg-[var(--surface-2)]">
            <Image src={img} alt={String(r.title || "product").slice(0, 100)} width={640} height={480}
              loading="lazy" className="h-full w-full object-cover" />
          </a>
        )}
        <div className="flex flex-col gap-1 p-4">
          {featured && (
            <span className="self-start rounded bg-[var(--primary-container)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
              Primary pick · Best match
            </span>
          )}
          <h3 className="text-[15px] font-semibold tracking-tight">{String(r.title || "Product").slice(0, 110)}</h3>
          <Facts pairs={[
            ["Price", String(r.price || "")],
            ["Rating", r.rating != null ? `★ ${r.rating}${r.reviews ? ` (${fmtInt(r.reviews)})` : ""}` : ""],
            ["Seller", String(r.seller || "")],
          ]} />
          <CardActions r={r} index={index} {...rest} />
          <Why items={r.why} />
        </div>
      </article>
    </Reveal>
  );
}

/** Paper: bibliographic entry, serif title. */
export function PaperEntry({ r, index, ...rest }: {
  r: ApiResult; index: number;
} & Omit<Parameters<typeof CardActions>[0], "r" | "index">) {
  return (
    <Reveal as="article" index={index % 6}>
      <div className="border-t border-[var(--line)] py-3.5 first:border-t-0" data-vertical="google_scholar" data-eids={(r.evidence_ids || []).join(" ")}>
        <KindTag label="Paper" family="research" />
        <h3 className="font-reading mb-0 mt-1.5 text-[18px] font-medium leading-snug">{String(r.title || "Paper").slice(0, 140)}</h3>
        <div className="mt-0.5 text-[13.5px] text-[var(--ink-2)]">
          {String(r.authors || "").slice(0, 120)}{r.published_date ? ` · ${r.published_date}` : ""}
          {typeof r.citations === "number" ? ` · Cited by ${fmtInt(r.citations)}` : ""}
        </div>
        {(r.abstract || r.snippet) && (
          <p className="font-reading mt-1.5 max-w-[70ch] text-[15px] leading-relaxed">{String(r.abstract || r.snippet).slice(0, 300)}</p>
        )}
        <CardActions r={r} index={index} {...rest} />
        <Why items={r.why} />
      </div>
    </Reveal>
  );
}

/** News: date-led rail row. */
export function NewsItem({ r, index, ...rest }: {
  r: ApiResult; index: number;
} & Omit<Parameters<typeof CardActions>[0], "r" | "index">) {
  const url = safeHttp(r.url || r.link);
  return (
    <Reveal as="article" index={index % 6}>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-t border-[var(--line)] py-3 first:border-t-0"
        data-vertical="google_news" data-eids={(r.evidence_ids || []).join(" ")}>
        <time className="tnum font-mono text-[11px] leading-tight text-[var(--ink-3)]">
          {fmtDate(String(r.date || r.published_date || ""))}
        </time>
        <div>
          <KindTag label="News" family="live" />
          <h3 className="mb-0 mt-1 text-[15.5px] font-semibold tracking-tight">
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--ink)] no-underline hover:underline">
                {String(r.title || url).slice(0, 120)}
              </a>
            ) : String(r.title || "Story").slice(0, 120)}
          </h3>
          <div className="text-[12.5px] text-[var(--ink-3)]">{String(r.source || "").slice(0, 60)}</div>
          {(r.snippet || r.description) && <p className="mt-1 text-[14px] text-[var(--ink-2)]">{String(r.snippet || r.description).slice(0, 220)}</p>}
          <CardActions r={r} index={index} {...rest} />
        </div>
      </div>
    </Reveal>
  );
}

export function VideoCard({ r }: { r: ApiResult }) {
  const url = safeHttp(r.url);
  const img = safeImg(r.thumbnail);
  return (
    <Reveal as="article">
      <article className="spot surface overflow-hidden !rounded-[14px]" data-vertical="youtube" data-eids={(r.evidence_ids || []).join(" ")}>
        {url && img && (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Watch: ${r.title || "video"}`}
            className="block aspect-[16/9] bg-[var(--surface-2)]">
            <Image src={img} alt={String(r.title || "video").slice(0, 100)} width={640} height={360}
              loading="lazy" className="h-full w-full object-cover" />
          </a>
        )}
        <div className="p-3">
          <h3 className="text-[15px] font-semibold">{String(r.title || "Video").slice(0, 110)}</h3>
          <div className="tnum text-[12.5px] text-[var(--ink-2)]">
            {[r.channel, r.length, fmtViews(typeof r.views === "number" ? r.views : null)].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-2"><Outbound r={r} /></div>
        </div>
      </article>
    </Reveal>
  );
}

/** Web page: plainest form on purpose. */
export function PageRow({ r, index, ...rest }: {
  r: ApiResult; index: number;
} & Omit<Parameters<typeof CardActions>[0], "r" | "index">) {
  const url = safeHttp(r.url || r.link);
  return (
    <Reveal as="article" index={index % 6}>
      <div className="border-t border-[var(--line)] py-3 first:border-t-0"
        data-vertical={String(r._engine || "google_search")} data-eids={(r.evidence_ids || []).join(" ")}>
        <h3 className="m-0 text-[15.5px] font-semibold tracking-tight">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--ink)] no-underline hover:underline">
              {String(r.title || url).slice(0, 115)}
            </a>
          ) : String(r.title || "Result").slice(0, 115)}
        </h3>
        <div className="tnum mt-0.5 font-mono text-[11px] text-[var(--ink-3)]">
          {[r.source && String(r.source).slice(0, 48), r.date ? fmtDate(String(r.date)) : ""].filter(Boolean).join(" · ")}
        </div>
        {(r.snippet || r.description) && <p className="mt-1 max-w-[70ch] text-[14px] text-[var(--ink-2)]">{String(r.snippet || r.description).slice(0, 240)}</p>}
        <CardActions r={r} index={index} {...rest} />
        <Why items={r.why} />
      </div>
    </Reveal>
  );
}

export function detectKind(r: ApiResult): string {
  if (r.company || r.salary || r.application_url) return "job";
  if (r.price && (r.seller || r.reviews != null || r.image)) return "product";
  if (r.authors || r.citations != null || r.abstract) return "paper";
  if (r.length || (r.channel && r.thumbnail)) return "video";
  if (r.symbol || r.stock_name) return "finance";
  if (r.airline) return "flight";
  if (r.source && r.date) return "news";
  if (r.address || (r.rating != null && !r.price)) return "place";
  return "page";
}
