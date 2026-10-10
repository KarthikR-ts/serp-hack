"use client";

import { useState } from "react";
import {
  Bag, Briefcase, CaretDown, ChalkboardTeacher, Compass, BookOpen,
  Globe, Lightning, Newspaper, TrendUp,
} from "@phosphor-icons/react";
import type { Budget, RouteLine } from "../lib/types";

const FAM_COLOR: Record<string, string> = {
  web: "var(--fam-web)", research: "var(--fam-research)", live: "var(--fam-live)",
  career: "var(--fam-career)", commerce: "var(--fam-commerce)", place: "var(--fam-place)",
};

function LaneIcon({ vertical, family }: { vertical: string; family: string }) {
  const v = vertical.toLowerCase();
  const S = 14;
  if (/shop/.test(v)) return <Bag size={S} />;
  if (/job/.test(v)) return <Briefcase size={S} />;
  if (/scholar|patent/.test(v)) return <BookOpen size={S} />;
  if (/news/.test(v)) return <Newspaper size={S} />;
  if (/trend|finance/.test(v)) return <TrendUp size={S} />;
  if (/map|flight|hotel|event|local/.test(v)) return <Compass size={S} />;
  if (/learn|youtube|video/.test(v)) return <ChalkboardTeacher size={S} />;
  void family;
  return <Globe size={S} />;
}

function stateLabel(l: RouteLine): string {
  if (l.status === "ok") return `${l.result_count} found`;
  if (l.status === "failed") return "Did not load";
  if (l.status === "empty") return "No results";
  if (l.status === "running") return "Searching";
  if (l.status === "cached") return `${l.result_count} cached`;
  if (l.status === "skipped") return "Skipped";
  return "Waiting";
}

/** Stitch Route: visual execution graph on paper, hairline rules, family hues only on 2px paths + chips. */
export function RouteMap({
  route, budget, onFilter, activeVertical,
}: {
  route: RouteLine[]; budget?: Budget;
  onFilter: (v: string | null) => void; activeVertical: string | null;
}) {
  const [open, setOpen] = useState(false);
  const okN = route.filter((l) => l.status === "ok").length;
  const bad = route.filter((l) => l.status === "failed").length;
  const autoOpen = bad > 0;
  const showTwin = open || autoOpen;

  return (
    <section aria-label="Route" className="overflow-hidden rounded-[12px] border border-[var(--line)] bg-[var(--paper)] shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--line-soft)] px-4 py-3">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${bad ? "bg-[var(--status-caution)]" : "bg-[var(--status-success)]"}`} />
        <h2 className="text-[13px] font-semibold text-[var(--ink)]">{okN} of {route.length} sources loaded</h2>
        <span className="tnum text-[12px] text-[var(--ink-2)]">
          {bad ? `· ${bad} didn’t load · ` : "· "}
          {budget ? `${budget.calls_used} of ${budget.calls_limit} searches` : ""}
        </span>
        <span className="flex-1" />
        <button
          type="button" onClick={() => setOpen((o) => !o)}
          className="tnum inline-flex min-h-[30px] items-center gap-1.5 self-end rounded-[6px] px-2.5 text-[12px] font-semibold tabular-nums text-[var(--secondary)] hover:text-[var(--primary)]"
          aria-expanded={showTwin}
          aria-label={showTwin ? "Collapse execution trace" : "Expand execution trace"}
        >
          {showTwin ? "Collapse trace" : "Expand trace"}
          <CaretDown size={14} weight="bold" aria-hidden="true" style={{ transform: showTwin ? "rotate(180deg)" : "none" }} />
        </button>
      </div>

      <ol className="m-0 list-none p-2">
        {route.map((line, i) => {
          const color = FAM_COLOR[line.family] || FAM_COLOR.web;
          const dim = !!activeVertical && activeVertical !== line.vertical;
          const failed = line.status === "failed";
          return (
            <li key={line.id}>
              <button
                type="button"
                onClick={() => onFilter(activeVertical === line.vertical ? null : line.vertical)}
                aria-label={`${line.name}: ${stateLabel(line)}. Filter results.`}
                className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border border-transparent px-2 py-2 text-left transition hover:bg-[var(--surface-2)]"
                style={{ opacity: dim ? 0.35 : 1 }}
              >
                <span
                  aria-hidden="true"
                  className="grid h-7 w-7 place-items-center rounded-[9px] text-white"
                  style={{ background: color }}
                >
                  <LaneIcon vertical={line.vertical} family={line.family} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold leading-tight">{line.name}</span>
                  <span className="block truncate font-mono text-[11px] text-[var(--ink-3)]">
                    {line.query || line.vertical}
                  </span>
                  <span
                    aria-hidden="true"
                    className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-[var(--line-soft)]"
                  >
                    <span
                      className={`block h-full rounded-full ${line.status === "running" ? "travel-seg" : "route-draw"}`}
                      style={{
                        // @ts-expect-error css var
                        "--i": i,
                        width: "100%",
                        background: failed
                          ? "repeating-linear-gradient(90deg, var(--error) 0 6px, transparent 6px 12px)"
                          : `linear-gradient(90deg, ${color}, ${color})`,
                        opacity: line.status === "planned" ? 0.35 : 1,
                      }}
                    />
                  </span>
                </span>
                <span className="tnum inline-flex items-center gap-1.5 font-mono text-[11.5px] text-[var(--ink-2)]">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${line.status === "running" ? "pulse-dot" : ""}`}
                    style={{
                      background:
                        line.status === "ok" ? "var(--live)"
                        : failed ? "var(--error)"
                        : line.status === "empty" ? "var(--control)"
                        : line.status === "running" ? "var(--fam-commerce)"
                        : "var(--line)",
                      borderRadius: failed ? 2 : 999,
                    }}
                  />
                  {stateLabel(line)}
                  {line.status === "running" && <Lightning size={12} className="pulse-dot" />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {budget && (
        <div className="flex items-center gap-2 px-4 pb-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--line-soft)]" aria-hidden="true">
            <div
              className="h-full rounded-full bg-[var(--ink)] transition-[width] duration-500"
              style={{ width: `${Math.min(100, (budget.calls_used / Math.max(1, budget.calls_limit)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {showTwin && (
        <ol aria-label="Sources used, text version" className="m-0 list-none border-t border-[var(--line-soft)] px-4 py-2">
          {route.map((l) => (
            <li key={l.id} className="border-t border-dashed border-[var(--line)] py-1.5 text-[13px] text-[var(--ink-2)] first:border-t-0">
              <button
                type="button" onClick={() => onFilter(l.vertical)}
                className="w-full rounded-lg p-1.5 text-left hover:bg-[var(--surface-2)]"
              >
                {l.name}: {l.status === "ok" ? `${l.result_count} results` : stateLabel(l)}
                {l.latency_ms > 0 && <span className="tnum text-[var(--ink-3)]"> · {(l.latency_ms / 1000).toFixed(1)}s</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
