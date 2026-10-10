"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import type { Action } from "../lib/types";
import { safeHttp } from "../lib/api";

/** Primary handoff button: "Book ticket" opens the provider site in a new
 *  tab. The app never books/buys/applies itself — the caption says so. */
export function ActionButton({ action, compact }: { action: Action; compact?: boolean }) {
  const url = safeHttp(action.url);
  if (!url) return null;
  const kind = String(action.kind || "");
  const where = `Opens ${action.provider || "provider site"}`;
  const caption = /^buy/.test(kind) ? `${where} · purchase happens there`
    : /^apply/.test(kind) ? `${where} · application happens there`
    : /^(book_|tickets|directions)/.test(kind) ? `${where} · booking happens there`
    : where;
  return (
    <span className="inline-flex flex-col gap-1">
      <a
        href={url} target="_blank" rel="noopener noreferrer nofollow"
        aria-label={`${action.label} (opens provider site in a new tab)`}
        className={`btn btn-primary inline-flex items-center gap-1.5 no-underline ${compact ? "!min-h-[36px] !text-[13.5px]" : ""}`}
      >
        {action.label} <ArrowSquareOut size={15} aria-hidden="true" />
      </a>
      <span className="text-[11.5px] text-[var(--ink-3)]">
        {caption}
      </span>
    </span>
  );
}
