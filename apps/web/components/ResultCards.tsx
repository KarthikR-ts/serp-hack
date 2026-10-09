"use client";

import Image from "next/image";
import type { ApiResult, WhyItem } from "../lib/types";
import { Reveal } from "./Reveal";

function safeHttp(url: unknown): string | null {
  try {
    const u = new URL(String(url || ""), "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function Outbound({ r }: { r: ApiResult }) {
  const url = safeHttp(r.url || r.application_url || r.link);
  if (!url) return null;
  const label =
    r.company || r.salary || r.application_url ? "Open application ↗"
    : r.price && (r.seller || r.reviews != null || r.image) ? "View on site ↗"
    : r.authors || r.abstract ? "Read paper ↗"
    : r.length || r.channel ? "Watch ↗"
    : "Open ↗";
  return <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm">{label}</a>;
}

export function Why({ items }: { items?: WhyItem[] }) {
  if (!items || !items.length) return null;
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer min-h-[44px] inline-flex items-center text-[var(--fam-place)]">
        Why this result?
      </summary>
      <ul className="m-1 p-0 list-none">
        {items.map((w, i) => (
          <li key={i} className="my-0.5">
            <span aria-hidden="true">{w.met ? "✓ " : "✕ "}</span>
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
    <ul className="list-none m-1.5 p-0 text-sm text-[var(--ink-2)] flex flex-wrap gap-x-4 gap-y-1">
      {shown.map(([k, v]) => (
        <li key={k}><strong className="text-[var(--ink)] font-semibold">{k}: </strong>{v}</li>
      ))}
    </ul>
  );
}

function Actions({ r, index, onSelect, onDismiss, onSave }: {
  r: ApiResult; index: number;
  onSelect?: (r: ApiResult, i: number, on: boolean) => void;
  onDismiss?: (r: ApiResult) => void;
  onSave?: (r: ApiResult) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center mt-2 text-[13px]">
      <Outbound r={r} />
      {onSelect && (
        <label className="inline-flex items-center gap-1.5 min-h-[32px] cursor-pointer">
          <input
            type="checkbox" aria-label="Select for compare"
            onChange={(e) => onSelect(r, index, e.target.checked)}
          /> Compare
        </label>
      )}
      {onDismiss && (
        <button type="button" className="btn !min-h-[32px] !py-1 !px-2 !text-[13px]" onClick={() => onDismiss(r)}>
          Not interested
        </button>
      )}
      {onSave && (
        <button type="button" className="btn !min-h-[32px] !py-1 !px-2 !text-[13px]" onClick={() => onSave(r)}>
          Save
        </button>
      )}
    </div>
  );
}

export function JobRow({ r, index, ...rest }: { r: ApiResult; index: number } & Omit<Parameters<typeof Actions>[0], "r" | "index">) {
  return (
    <Reveal as="article" index={index % 6}>
      <div className="border-t border-[var(--rule)] py-3" data-vertical="google_jobs" data-eids={(r.evidence_ids || []).join(" ")}>
        <span className="text-xs text-[var(--ink-2)] border border-[var(--rule)] rounded-full px-2 py-0.5">job</span>
        <h3 className="text-[17px] mt-1 mb-0">{String(r.title || "Role").slice(0, 120)}</h3>
        <div className="text-sm text-[var(--ink-2)]">{[r.company, r.location, r.employment_type].filter(Boolean).join(" · ")}</div>
        <Facts pairs={[["Pay", r.salary ? `${r.salary} (listed)` : "not listed"], ["Posted", String(r.posted_at || "")], ["Source", String(r.source || "")]]} />
        {r.description && <p className="text-sm mt-1">{String(r.description).slice(0, 280)}</p>}
        <Actions r={r} index={index} {...rest} />
        <Why items={r.why} />
      </div>
    </Reveal>
  );
}

export function ProductTile({ r, index, featured, ...rest }: {
  r: ApiResult; index: number; featured?: boolean;
} & Omit<Parameters<typeof Actions>[0], "r" | "index">) {
  const url = safeHttp(r.url);
  const img = typeof r.image === "string" && r.image.startsWith("https://") ? r.image : null;
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const t = e.currentTarget;
    const rect = t.getBoundingClientRect();
    t.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    t.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };
  return (
    <Reveal as="article" index={index % 6}>
      <article
        onMouseMove={onMove}
        className={`spot surface p-3 ${featured ? "!border-[var(--ink)]" : ""}`}
        data-vertical="google_shopping" data-eids={(r.evidence_ids || []).join(" ")}
      >
        {url && img && (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`View on site: ${r.title || "product"}`}>
            <Image src={img} alt={String(r.title || "product").slice(0, 120)} width={480} height={360} loading="lazy" className="w-full h-auto rounded-md border border-[var(--rule)]" style={{ aspectRatio: "4/3", objectFit: "cover" }} />
          </a>
        )}
        <h3 className="text-[17px] mt-2 mb-0">{String(r.title || "Product").slice(0, 120)}</h3>
        <Facts pairs={[
          ["Price", String(r.price || "")],
          ["Rating", r.rating != null ? `★ ${r.rating}${r.reviews ? ` (${Number(r.reviews).toLocaleString()})` : ""}` : ""],
          ["Seller", String(r.seller || "")],
        ]} />
        <Actions r={r} index={index} {...rest} />
        <Why items={r.why} />
      </article>
    </Reveal>
  );
}

export function PaperEntry({ r, index, ...rest }: { r: ApiResult; index: number } & Omit<Parameters<typeof Actions>[0], "r" | "index">) {
  return (
    <Reveal as="article" index={index % 6}>
      <div className="border-t border-[var(--rule)] py-3" data-vertical="google_scholar" data-eids={(r.evidence_ids || []).join(" ")}>
        <span className="text-xs text-[var(--ink-2)] border border-[var(--rule)] rounded-full px-2 py-0.5">paper</span>
        <h3 className="font-read text-[19px] mt-1 mb-0">{String(r.title || "Paper").slice(0, 140)}</h3>
        <div className="text-sm text-[var(--ink-2)]">
          {String(r.authors || "").slice(0, 120)}{r.published_date ? ` · ${r.published_date}` : ""}
        </div>
        {(r.abstract || r.snippet) && <p className="font-read text-[15px] mt-1">{String(r.abstract || r.snippet).slice(0, 300)}</p>}
        <Actions r={r} index={index} {...rest} />
        <Why items={r.why} />
      </div>
    </Reveal>
  );
}

export function VideoCard({ r }: { r: ApiResult }) {
  const url = safeHttp(r.url);
  const img = typeof r.thumbnail === "string" && r.thumbnail.startsWith("https://") ? r.thumbnail : null;
  const views = typeof r.views === "number" ? (r.views >= 1e6 ? `${(r.views / 1e6).toFixed(1)}M views` : r.views >= 1e3 ? `${(r.views / 1e3).toFixed(1)}K views` : `${r.views} views`) : "";
  return (
    <Reveal as="article">
      <article className="spot surface p-3" data-vertical="youtube" data-eids={(r.evidence_ids || []).join(" ")}>
        {url && img && (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Watch: ${r.title || "video"}`}>
            <Image src={img} alt={String(r.title || "video").slice(0, 120)} width={480} height={360} loading="lazy" className="w-full h-auto rounded-md border border-[var(--rule)]" style={{ aspectRatio: "4/3", objectFit: "cover" }} />
          </a>
        )}
        <h3 className="text-[17px] mt-2 mb-0">{String(r.title || "Video").slice(0, 120)}</h3>
        <div className="text-[13px] text-[var(--ink-2)]">{[r.channel, r.length, views].filter(Boolean).join(" · ")}</div>
        <div className="flex flex-wrap gap-2 items-center mt-2 text-[13px]">
          {url && <a href={url} target="_blank" rel="noopener noreferrer nofollow">Watch ↗</a>}
        </div>
      </article>
    </Reveal>
  );
}

export function PageRow({ r, index, ...rest }: { r: ApiResult; index: number } & Omit<Parameters<typeof Actions>[0], "r" | "index">) {
  const url = safeHttp(r.url || r.link);
  return (
    <Reveal as="article" index={index % 6}>
      <div className="border-t border-[var(--rule)] py-3" data-vertical={String(r._engine || "google_search")} data-eids={(r.evidence_ids || []).join(" ")}>
        <h3 className="text-[17px] m-0">
          {url ? <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--ink)] no-underline hover:underline">{String(r.title || url).slice(0, 120)}</a> : String(r.title || "Result").slice(0, 120)}
        </h3>
        <div className="text-[13px] text-[var(--ink-3)]">{[r.source && String(r.source).slice(0, 60), r.date].filter(Boolean).join(" · ")}</div>
        {(r.snippet || r.description) && <p className="text-sm mt-1">{String(r.snippet || r.description).slice(0, 280)}</p>}
        <Actions r={r} index={index} {...rest} />
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
