"use client";

import { useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { ApiSource, Budget, Confidence, Funnel } from "../lib/types";
import { safeHttp } from "../lib/api";
import { fmtDate, fmtInt } from "../lib/format";

function Quality({ type }: { type: string }) {
  const t = type.toLowerCase();
  const label =
    /peer|scholar/.test(t) ? "Peer-reviewed"
    : /official|government/.test(t) ? "Official"
    : /retailer|seller/.test(t) ? "Retailer"
    : /community|forum|discussion/.test(t) ? "Community opinion"
    : /generated|ai/.test(t) ? "Generated summary"
    : type || "Source";
  return (
    <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--ink-2)]">
      {label}
    </span>
  );
}

/** Right inspector. Tabs: Sources / Steps / Detail. Sticky desktop, drawer mobile. */
export function EvidenceMargin({
  sources, onFlash, funnel, budget, confidence, planSteps,
}: {
  sources: ApiSource[];
  onFlash: (eid: string | null) => void;
  funnel?: Funnel;
  budget?: Budget;
  confidence?: Confidence | string;
  planSteps?: { tool?: string; engine?: string; query: string }[];
}) {
  const [tab, setTab] = useState<"sources" | "steps" | "detail">("sources");
  return (
    <aside id="sources" aria-label="Sources and evidence" className="lg:sticky lg:top-[84px] lg:max-h-[calc(100dvh-104px)] lg:overflow-auto">
      <div className="surface overflow-hidden !rounded-[14px]">
        <div role="tablist" aria-label="Evidence tabs" className="flex border-b border-[var(--line)] px-2 pt-2">
          {(
            [
              ["sources", `Sources · ${sources.length}`],
              ["steps", "Steps"],
              ["detail", "Detail"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
              className={`flex-1 border-b-2 px-2 py-2.5 text-[13px] font-semibold transition ${
                tab === id ? "border-[var(--ink)] text-[var(--ink)]" : "border-transparent text-[var(--ink-3)] hover:text-[var(--ink-2)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[50dvh] overflow-auto p-3 lg:max-h-none">
          {tab === "sources" && (
            <div role="tabpanel" aria-label="Sources">
              {!sources.length && (
                <p className="p-1 text-[13px] text-[var(--ink-3)]">
                  Evidence appears here as the agent reads. Select any claim to trace it.
                </p>
              )}
              <ol className="m-0 list-none space-y-2 p-0">
                {sources.map((s) => {
                  const url = safeHttp(s.url);
                  return (
                    <li
                      key={s.id || s.url} data-eid={s.id}
                      onMouseEnter={() => onFlash(s.id)} onMouseLeave={() => onFlash(null)}
                      className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-2.5 text-sm transition hover:border-[var(--control)]"
                    >
                      <strong className="block text-[13.5px] font-semibold leading-snug">
                        {(s.title || s.url || "source").slice(0, 100)}
                      </strong>
                      <div className="tnum mt-0.5 font-mono text-[11px] text-[var(--ink-3)]">
                        {s.domain}{s.date ? ` · ${fmtDate(s.date)}` : ""}
                      </div>
                      {s.claim && (
                        <blockquote className="my-1.5 border-l-2 border-[var(--line)] pl-2 text-[12.5px] italic text-[var(--ink-2)]">
                          {s.claim.slice(0, 200)}
                        </blockquote>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Quality type={s.type} />
                        {s.claim_type && s.claim_type !== "fact" && (
                          <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--ink-2)]">
                            {s.claim_type}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex gap-2">
                        {url && (
                          <a
                            href={url} target="_blank" rel="noopener noreferrer nofollow"
                            className="inline-flex min-h-[32px] items-center gap-1 text-[12.5px] font-semibold text-[var(--ink)]"
                          >
                            Open source <ArrowSquareOut size={13} />
                          </a>
                        )}
                        <button
                          type="button" onClick={() => onFlash(s.id)}
                          className="btn !min-h-[32px] !px-2.5 !py-1 !text-[12.5px]"
                        >
                          Show in results
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {tab === "steps" && (
            <div role="tabpanel" aria-label="Research steps" className="text-[13px]">
              {!funnel && !(planSteps?.length) && (
                <p className="p-1 text-[var(--ink-3)]">Plan, funnel and filter reasons appear here during a run.</p>
              )}
              {planSteps && planSteps.length > 0 && (
                <>
                  <h3 className="px-1 text-[12px] font-semibold text-[var(--ink-2)]">Searches</h3>
                  <ul className="m-0 list-none space-y-1 p-1">
                    {planSteps.slice(0, 8).map((s, i) => (
                      <li key={i} className="tnum font-mono text-[11.5px] text-[var(--ink-2)]">
                        {s.tool || s.engine}: {String(s.query).slice(0, 72)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {funnel && (
                <dl className="m-0 p-1">
                  <dt className="text-[12px] font-semibold text-[var(--ink-2)]">Funnel</dt>
                  <dd className="tnum m-0 font-mono text-[12px]">
                    {fmtInt(funnel.discovered)} found · {fmtInt(funnel.matched)} matched · {fmtInt(funnel.set_aside)} set aside
                  </dd>
                  {funnel.reasons.length > 0 && (
                    <>
                      <dt className="mt-2 text-[12px] font-semibold text-[var(--ink-2)]">Set aside</dt>
                      <dd className="m-0 text-[12.5px] text-[var(--ink-2)]">
                        {funnel.reasons.map((r) => `${r.label} (${r.count})`).join(", ")}
                      </dd>
                    </>
                  )}
                </dl>
              )}
            </div>
          )}

          {tab === "detail" && (
            <div role="tabpanel" aria-label="Run detail" className="text-[13px]">
              {!budget && !confidence && <p className="p-1 text-[var(--ink-3)]">Budget and confidence appear here.</p>}
              {budget && (
                <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-2 gap-y-1.5 p-1">
                  <dt className="text-[var(--ink-3)]">Budget</dt>
                  <dd className="tnum m-0 font-mono text-[12px]">
                    {budget.calls_used} of {budget.calls_limit} searches · {budget.seconds_used}s
                  </dd>
                </dl>
              )}
              {confidence && (
                <dl className="m-0 grid grid-cols-[96px_1fr] gap-x-2 gap-y-1.5 p-1">
                  <dt className="text-[var(--ink-3)]">Confidence</dt>
                  <dd className="m-0">
                    {typeof confidence === "string" ? confidence : `${confidence.level}. ${(confidence.reasons || []).join("; ")}`}
                  </dd>
                </dl>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
