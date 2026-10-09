"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, streamChat } from "../lib/api";
import type { AgentResponse, ApiResult, ApiSource, ChatResponse } from "../lib/types";
import { Composer } from "../components/Composer";
import { RouteMap } from "../components/RouteMap";
import { CompareTray } from "../components/CompareTray";
import { ClarifyCard, PlanCard } from "../components/PlanClarify";
import { Margin } from "../components/Margin";
import { JobRow, PageRow, PaperEntry, ProductTile, VideoCard, detectKind } from "../components/ResultCards";

const GOALS = [
  { label: "Compare products", template: "Compare products: ___ vs ___" },
  { label: "Find roles or internships", template: "Find roles or internships in ___" },
  { label: "Research a topic", template: "Research ___" },
  { label: "Build a learning plan", template: "Build a learning plan for ___" },
  { label: "Plan a trip", template: "Plan a trip to ___" },
  { label: "Check what's changed", template: "What changed in ___ recently?" },
];

const TRY = [
  "Find three good laptops under ₹80,000 for machine learning",
  "Find software engineering internships in Bengaluru",
  "Teach me CRISPR gene editing from beginner to papers",
];

const SUFFIX: Record<string, string> = {
  cheaper: " cheaper options",
  recent_reviews: " with recent reviews",
  brands: " other brands",
  wider: " wider search",
  remote: " including remote",
  recent: " posted this week",
  pay: " higher pay",
  cities: " other cities",
  academic: " academic sources",
  counter: " counter-arguments",
  beginner: " beginner friendly",
  projects: " with projects",
  papers: " with papers",
};

type RunData = { kind: "chat"; data: ChatResponse } | { kind: "agent"; data: AgentResponse };

export default function Workspace() {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "planning" | "running" | "done">("idle");
  const [progress, setProgress] = useState("");
  const [run, setRun] = useState<RunData | null>(null);
  const [planPreview, setPlanPreview] = useState<{ plan: { id: number; action: string; tool: string; query: string }[]; estimated_calls: number; estimated_seconds: number } | null>(null);
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [visible, setVisible] = useState(10);
  const [selected, setSelected] = useState<Map<number, ApiResult>>(new Map());
  const [filterVertical, setFilterVertical] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const [theme, setTheme] = useState("system");
  const [hist, setHist] = useState<{ q: string; kind: string }[]>([]);
  const [savedTick, setSavedTick] = useState(0);
  const [online, setOnline] = useState(true);
  const [flashEid, setFlashEid] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const aborter = useRef<AbortController | null>(null);
  const pending = useRef<{ q: string; mode: string; deep: boolean } | null>(null);

  const say = useCallback((msg: string) => setToast({ msg, key: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    try {
      setHist(JSON.parse(sessionStorage.getItem("serp_hist") || "[]"));
    } catch { /* empty */ }
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  const cycleTheme = () => {
    const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("serp_theme", next); } catch { /* ignore */ }
  };

  const pushHist = (q: string, kind: string) => {
    const next = [{ q, kind }, ...hist].slice(0, 20);
    setHist(next);
    try { sessionStorage.setItem("serp_hist", JSON.stringify(next)); } catch { /* ignore */ }
  };

  const saveItem = (item: Record<string, unknown>) => {
    try {
      const saved = JSON.parse(localStorage.getItem("serp_saved") || "[]");
      saved.unshift({ ...item, at: new Date().toISOString() });
      localStorage.setItem("serp_saved", JSON.stringify(saved.slice(0, 50)));
      setSavedTick((t) => t + 1);
      say("Saved");
    } catch { say("Couldn't save on this device"); }
  };

  const startRun = async (q: string, kind: "chat" | "agent", mode = "auto", deep = false, flt: Record<string, unknown> = {}) => {
    const query = q.trim().slice(0, 500);
    if (!query) { say("Type a query first"); return; }
    aborter.current?.abort();
    aborter.current = new AbortController();
    setRun(null); setPlanPreview(null); setVisible(10);
    setSelected(new Map()); setFilterVertical(null); setFilters(flt);
    setDismissed(new Set());
    setPhase("running"); setProgress("Understanding your question…");
    pushHist(query, kind);
    try {
      if (kind === "agent") {
        const data = await api.agent(query, { filters: flt, signal: aborter.current.signal });
        setRun({ kind, data });
      } else {
        try {
          const preview = await api.intents(query, aborter.current.signal);
          if ((preview.requires_confirmation || deep) && sessionStorage.getItem("serp_skip_plan") !== "1") {
            setPlanPreview(preview);
            setPhase("planning");
            pending.current = { q: query, mode, deep };
            return;
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
        await doChat(query, mode, deep, flt);
      }
      setPhase("done");
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") { setProgress("Stopped by you."); return; }
      setPhase("idle");
      if (err.message === "LIMIT") say("You've reached the limit for now. Try again in a minute.");
      else if (err.message === "NOKEY") say("LLM key missing. Set OPENROUTER_API_KEY in .env and restart.");
      else say("Request failed. Backend running?");
    }
  };

  const doChat = async (query: string, mode: string, deep: boolean, flt: Record<string, unknown>) => {
    const signal = aborter.current?.signal;
    setPhase("running");
    setProgress("Searching relevant sources…");
    await streamChat(
      query, { mode, deep, filters: flt, signal },
      (p) => {
        if (p.stage === "intent") setProgress(`Understood as ${p.detail}`);
        else if (p.stage === "plan") setProgress(`Plan: ${p.detail} steps.`);
        else if (p.stage === "tool") setProgress(`Searching: ${p.detail}…`);
        else if (p.stage === "synthesis") setProgress("Writing the answer…");
      }
    ).catch((e) => { if ((e as Error).name === "AbortError") throw e; });
    const data = await api.chat(query, { mode, deep, filters: flt, signal });
    setRun({ kind: "chat", data });
  };

  const onSelect = (r: ApiResult, i: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) {
        if (next.size >= 4) { say("Compare holds 4 at most"); return prev; }
        next.set(i, r);
      } else next.delete(i);
      return next;
    });
  };

  const resultKey = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  const dismiss = (r: ApiResult) => {
    setDismissed((prev) => new Set(prev).add(resultKey(r)));
    say("Removed from this view");
  };
  const flash = (eid: string | null) => {
    setFlashEid(eid);
    if (!eid) return;
    const node = document.querySelector(`[data-eids~="${eid}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const data = run?.data as ChatResponse & AgentResponse | undefined;
  const sources: ApiSource[] = data?.sources || [];
  const route = data?.route || [];
  const constraints = (data as ChatResponse)?.constraints || (data as AgentResponse)?.constraints || {};
  const refinementClick = (id: string) => {
    const q = data?.query ?? query;
    if (id === "__chat__") { startRun(q, "chat", "auto", false, filters); return; }
    if (id === "followup") { document.getElementById("q")?.focus(); return; }
    if (id === "deep") startRun(q, run?.kind || "chat", "auto", true, filters);
    else startRun(q + (SUFFIX[id] || ""), run?.kind || "chat", "auto", false, filters);
  };

  return (
    <>
      <a href="#answer" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2 focus:z-[60]">Skip to answer</a>
      <header className="sticky top-0 z-20 bg-[var(--surface)] border-b border-[var(--rule)]">
        <div className="max-w-[1280px] mx-auto px-4 py-2.5 flex gap-3 items-center">
          <div className="font-bold text-[18px] tracking-tight">Serp Intelligence<small className="block font-normal text-xs text-[var(--ink-3)]">You ask. The agent chooses how to research it.</small></div>
          <div className="ml-auto flex gap-2 items-center">
            <a href="#sources" className="btn !min-h-[44px]">Sources ({sources.length})</a>
            <button type="button" className="btn" onClick={cycleTheme}>Theme: {theme}</button>
          </div>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-4 py-4 grid gap-8 lg:grid-cols-[248px_minmax(0,760px)_minmax(0,1fr)] grid-cols-1">
        <nav aria-label="Library" className="hidden lg:block">
          <div className="sticky top-[76px] space-y-4">
            <div>
              <h2 className="text-[13px] text-[var(--ink-2)] font-semibold my-2">Research</h2>
              <button type="button" className="btn btn-primary w-full" onClick={() => { setQuery(""); setRun(null); }}>New research</button>
            </div>
            <div>
              <h2 className="text-[13px] text-[var(--ink-2)] font-semibold my-2">Conversations</h2>
              {!hist.length && <p className="text-[13px] text-[var(--ink-2)]">Nothing yet. Ask above.</p>}
              {hist.slice(0, 8).map((h, i) => (
                <button key={i} type="button" className="chip block w-full text-left mb-1.5 truncate" onClick={() => startRun(h.q, (h.kind as "chat" | "agent") || "chat")}>
                  {h.q.slice(0, 60)}
                </button>
              ))}
            </div>
            <div>
              <h2 className="text-[13px] text-[var(--ink-2)] font-semibold my-2">Saved research</h2>
              <SavedList tick={savedTick} onOpen={(s) => { if (s.query) startRun(s.query, "chat"); else if (s.url) window.open(s.url, "_blank", "noopener"); }} />
              <p className="text-[13px] text-[var(--ink-3)]">Saved on this device only.</p>
              <div className="flex gap-2 mt-1">
                <Link href="/saved" className="btn !min-h-[44px]">Open saved</Link>
                <Link href="/usage" className="btn !min-h-[44px]">Usage</Link>
              </div>
            </div>
          </div>
        </nav>

        <main className="min-w-0" id="main">
          <section aria-label="Ask" className="py-6">
            <h1 className="m-0 mb-3 font-bold tracking-tight" style={{ fontSize: "clamp(26px, 4vw, 39px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>
              What do you want to find out?
            </h1>
            <p className="text-[var(--ink-2)] mt-0 mb-4 max-w-[60ch]">Ask in your own words. The assistant chooses where to look.</p>
            <Composer
              value={query} onChange={setQuery}
              onResearch={(o) => startRun(query, "chat", o.mode, o.deep, filters)}
              onAgent={() => startRun(query, "agent", "auto", false, filters)}
              onStop={() => aborter.current?.abort()}
              running={phase === "running" || phase === "planning"}
            />
            <FilterChips constraints={constraints} onRemove={(k) => {
              const next = { ...filters }; delete next[k];
              startRun((data?.query ?? query), run?.kind || "chat", "auto", false, next);
            }} />
            <div className="flex flex-wrap gap-2 mt-3" aria-label="Start from a goal">
              {GOALS.map((g) => (
                <button key={g.label} type="button" className="chip" onClick={() => {
                  setQuery(g.template);
                  document.getElementById("q")?.focus();
                }}>{g.label}</button>
              ))}
            </div>
            {!hist.length && (
              <div className="mt-3 text-[13px] text-[var(--ink-2)]">
                <span>Try: </span>
                {TRY.map((t) => (
                  <button key={t} type="button" className="chip mr-1.5 mb-1.5" onClick={() => startRun(t, "agent")}>{t}</button>
                ))}
              </div>
            )}
          </section>

          {!online && <div className="surface p-3 my-3">You&apos;re offline. Your question will send when you reconnect.</div>}

          {phase === "planning" && planPreview && (
            <PlanCard
              steps={planPreview.plan} estimatedCalls={planPreview.estimated_calls} estimatedSeconds={planPreview.estimated_seconds}
              onStart={(skip) => { if (skip) { try { sessionStorage.setItem("serp_skip_plan", "1"); } catch { /* ignore */ } } const p = pending.current; pending.current = null; setPlanPreview(null); if (p) doChat(p.q, p.mode, p.deep, filters); }}
              onCancel={() => { pending.current = null; setPlanPreview(null); setPhase("idle"); }}
            />
          )}

          {(phase === "running" || phase === "planning") && !data && (
            <div aria-busy="true" className="my-4">
              <p>{progress}</p>
              <span className="skel" style={{ width: "70%" }} />
              <span className="skel" style={{ width: "90%" }} />
              <span className="skel" style={{ width: "55%" }} />
            </div>
          )}

          {data && <RunView data={data} kind={run!.kind} filterVertical={filterVertical} onFilter={setFilterVertical} flashEid={flashEid} onSelect={onSelect} onSave={saveItem} onRefine={refinementClick} onRetry={() => startRun(data.query, run!.kind, "auto", false, filters)} dismissed={dismissed} onDismiss={dismiss} />}

          <CompareTray selected={selected} onClear={() => setSelected(new Map())} />
        </main>

        <div id="sources">
          <Margin sources={sources} onFlash={flash} />
        </div>
      </div>

      <footer className="max-w-[1280px] mx-auto px-4 pb-8 text-[13px] text-[var(--ink-3)]">
        <p>This assistant reads and compares. It doesn&apos;t buy, apply or book for you. Results are live web data: check important claims at the source. Anonymous use: conversations stay in this browser unless you save them.</p>
      </footer>

      <div aria-live="polite" role="status" className="sr-only">{phase === "done" ? "Answer ready." : progress}</div>
      {toast && <div role="status" className="toast-show fixed bottom-4 left-1/2 -translate-x-1/2 bg-[var(--ink)] text-[var(--bg)] px-4 py-2.5 rounded-full text-sm z-[60]">{toast.msg}</div>}
    </>
  );
}

function SavedList({ tick, onOpen }: { tick: number; onOpen: (s: { title?: string; query?: string; url?: string }) => void }) {
  const [items, setItems] = useState<{ title?: string; query?: string; url?: string }[]>([]);
  useEffect(() => {
    try { setItems(JSON.parse(localStorage.getItem("serp_saved") || "[]").slice(0, 20)); }
    catch { setItems([]); }
  }, [tick]);
  if (!items.length) return <p className="text-[13px] text-[var(--ink-2)]">Nothing saved yet.</p>;
  return (
    <div>
      {items.map((s, i) => (
        <button key={i} type="button" className="chip block w-full text-left mb-1.5 truncate" onClick={() => onOpen(s)}>
          {(s.title || s.query || "saved").slice(0, 60)}
        </button>
      ))}
    </div>
  );
}

const FILTER_LABELS: Record<string, string> = {
  budget: "Budget", currency: "Currency", min_rating: "Min rating", rating: "Min rating",
  location: "Location", remote: "Remote", salary_min: "Min pay", min_salary: "Min pay",
};

function FilterChips({ constraints, onRemove }: { constraints: Record<string, unknown>; onRemove: (k: string) => void }) {
  const keys = Object.keys(constraints || {}).filter((k) => FILTER_LABELS[k] && String(constraints[k]) !== "");
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2 items-center" aria-label="Understood filters">
      <span className="text-[13px] text-[var(--ink-2)]">Understood:</span>
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--rule)] rounded-full px-2.5 py-1.5 text-[13px]">
          {FILTER_LABELS[k]}: {String(constraints[k])}
          <button type="button" aria-label={`Remove filter ${FILTER_LABELS[k]}`} onClick={() => onRemove(k)} className="min-w-[32px] min-h-[32px] text-[var(--ink-2)]">✕</button>
        </span>
      ))}
    </div>
  );
}

function RunView({ data, kind, filterVertical, onFilter, flashEid, onSelect, onSave, onRefine, onRetry, dismissed, onDismiss }: {
  data: ChatResponse & AgentResponse;
  kind: "chat" | "agent";
  filterVertical: string | null;
  onFilter: (v: string | null) => void;
  flashEid: string | null;
  onSelect: (r: ApiResult, i: number, on: boolean) => void;
  onSave: (r: Record<string, unknown>) => void;
  onRefine: (id: string) => void;
  onRetry: () => void;
  dismissed: Set<string>;
  onDismiss: (r: ApiResult) => void;
}) {
  const pres = (data as AgentResponse).presentation;
  const route = data.route || [];
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [data]);

  const summary = data.summary || "";
  const conf = data.confidence as Confidence | string | undefined;
  const intents = ((data as ChatResponse).analysis?.intent || (data as AgentResponse).legacy_intents || []).join(" ");
  const leadResults = /SHOPPING|JOB_SEARCH|LOCAL_DISCOVERY|EVENTS|TRAVEL|shopping|jobs|travel/.test(intents + " " + (((data as AgentResponse).classification?.use_case) || ""));

  return (
    <div id="answer">
      {route.length > 0 && <RouteMap route={route} budget={data.budget} onFilter={onFilter} activeVertical={filterVertical} />}

      <StepsList data={data} />

      <div className="my-4">
        {summary && <p className="font-read text-[17px] leading-[1.65] max-w-[66ch]">{summary}</p>}
        {typeof conf === "object" && conf && (
          <p className="text-sm text-[var(--ink-2)]">Confidence: {conf.level}. {(conf.reasons || []).join("; ")}.</p>
        )}
        {typeof conf === "string" && <p className="text-sm text-[var(--ink-2)]">Confidence: {conf}.</p>}
        {(data as ChatResponse).completeness?.state === "partial" && (
          <p className="text-sm text-[var(--caution)]">
            {(data as ChatResponse).completeness.message} <button type="button" className="btn !min-h-[32px] !py-1 ml-2" onClick={onRetry}>Retry</button>
          </p>
        )}
        {(data as ChatResponse).completeness && (data as ChatResponse).completeness.state !== "partial" && (
          <p className="text-sm text-[var(--ink-2)]">{(data as ChatResponse).completeness.message}</p>
        )}
        {/FINANCE|finance_snapshot/.test(intents + " " + (pres?.type || "")) && (
          <p className="text-[13px] text-[var(--ink-3)]">Information only, not financial advice.</p>
        )}
        {/apply to|book (me|us|a |my)|buy .* for me|\bpurchase\b/i.test(data.query || "") && (
          <div className="surface p-3 my-3" style={{ borderColor: "var(--fam-place)" }}>
            <p className="m-0 text-sm">This assistant reads and compares. It doesn&apos;t buy, apply or book for you. Open the listings instead.</p>
          </div>
        )}
      </div>

      {kind === "agent" && (data as AgentResponse).status === "clarify" ? (
        <ClarifyInline question={(data as AgentResponse).clarifying_question || ""} onSkip={() => onRefine("__chat__")} />
      ) : pres ? (
        <PresentationView pres={pres} onSelect={onSelect} onSave={onSave} filterVertical={filterVertical} flashEid={flashEid} dismissed={dismissed} onDismiss={onDismiss} />
      ) : (
        <ResultsList results={(data as ChatResponse).results || []} showAll={showAll} setShowAll={setShowAll} leadResults={leadResults} filterVertical={filterVertical} flashEid={flashEid} onSelect={onSelect} onSave={onSave} dismissed={dismissed} onDismiss={onDismiss} />
      )}

      {(data.refinements || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 items-center" aria-label="Refine">
          <span className="text-[13px] text-[var(--ink-2)]">Refine:</span>
          {(data.refinements || []).map((c) => (
            <button key={c.id} type="button" className="chip" data-cost={c.estimated_calls} onClick={() => onRefine(c.id)}>
              {c.label}{c.estimated_calls ? <span className="text-[var(--ink-3)]"> · ~{c.estimated_calls}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClarifyInline({ question, onSkip }: { question: string; onSkip: () => void }) {
  return (
    <div className="surface p-4 my-4" style={{ borderLeft: "4px solid var(--ink)" }}>
      <p className="m-0"><strong>One quick question: </strong>{question}</p>
      <div className="mt-2"><button type="button" className="btn" onClick={onSkip}>Skip, use best guess</button></div>
    </div>
  );
}

function ResultsList({ results, showAll, setShowAll, leadResults, filterVertical, flashEid, onSelect, onSave, dismissed, onDismiss }: {
  results: ApiResult[]; showAll: boolean; setShowAll: (v: boolean) => void;
  leadResults: boolean; filterVertical: string | null; flashEid: string | null;
  onSelect: (r: ApiResult, i: number, on: boolean) => void; onSave: (r: Record<string, unknown>) => void;
  dismissed: Set<string>; onDismiss: (r: ApiResult) => void;
}) {
  const key = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  const visible = results.filter((r) => !dismissed.has(key(r)) && (!filterVertical || (r._engine || "google_search") === filterVertical));
  const shown = showAll ? visible.slice(0, 30) : visible.slice(0, 10);
  const render = (r: ApiResult, i: number) => {
    const k = detectKind(r);
    const flash = flashEid && (r.evidence_ids || []).includes(flashEid) ? " flash" : "";
    const wrap = (node: React.ReactNode) => <div key={i} className={flash}>{node}</div>;
    if (k === "job") return wrap(<JobRow r={r} index={i} onSelect={onSelect} onDismiss={() => onSave({ dismissed: true, title: r.title })} onSave={() => onSave({ title: r.title, url: r.application_url || r.url })} />);
    if (k === "product") return wrap(<ProductTile r={r} index={i} featured={leadResults && i === 0} onSelect={onSelect} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />);
    if (k === "paper") return wrap(<PaperEntry r={r} index={i} onSelect={onSelect} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />);
    if (k === "video") return wrap(<VideoCard r={r} />);
    return wrap(<PageRow r={r} index={i} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />);
  };
  return (
    <>
      {leadResults || results.some((r) => detectKind(r) === "product") ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {shown.map(render)}
        </div>
      ) : (
        <div className="grid gap-3">{shown.map(render)}</div>
      )}
      {visible.length > 10 && !showAll && (
        <button type="button" className="btn mt-2" onClick={() => setShowAll(true)}>Show more ({visible.length - 10})</button>
      )}
    </>
  );
}

import type { AgentPresentation } from "../lib/types";
import type { Confidence } from "../lib/types";

function PresentationView({ pres, onSelect, onSave, filterVertical, flashEid, dismissed, onDismiss }: {
  pres: AgentPresentation; onSelect: (r: ApiResult, i: number, on: boolean) => void;
  onSave: (r: Record<string, unknown>) => void; filterVertical: string | null; flashEid: string | null;
  dismissed: Set<string>; onDismiss: (r: ApiResult) => void;
}) {
  const key = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  if (pres.type === "shopping_top2") {
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {(pres.picks || []).slice(0, 2).filter((item) => !dismissed.has(key(item))).map((item, i) => (
          <ProductTile key={i} r={{ ...item, seller: item.seller || "", _engine: "google_shopping" }} index={i} featured={i === 0} onSelect={onSelect} onDismiss={onDismiss} onSave={() => onSave({ title: item.title, url: item.url })} />
        ))}
      </div>
    );
  }
  if (pres.type === "youtube_path") {
    const order: [string, string][] = [["beginner", "Start here"], ["intermediate", "Go deeper"], ["advanced", "Master it"]];
    return (
      <>
        {order.map(([lvl, label]) => {
          const vids = (pres.levels?.[lvl] || []).filter((v) => !filterVertical || filterVertical === "youtube");
          if (!vids.length) return null;
          return (
            <div key={lvl}>
              <h2 className="text-xl mt-6 mb-2">{label} ({vids.length})</h2>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
                {vids.map((v, i) => <VideoCard key={i} r={v} />)}
              </div>
            </div>
          );
        })}
      </>
    );
  }
  if (pres.type === "finance_snapshot") {
    const qd = pres.quote || {};
    return (
      <div>
        <article className="border-t border-[var(--rule)] py-3">
          <h3 className="text-[17px]">{String(qd.stock_name || qd.symbol || "Quote").slice(0, 120)}</h3>
          <ul className="list-none m-1.5 p-0 text-sm text-[var(--ink-2)] flex flex-wrap gap-x-4 gap-y-1">
            {( [["Symbol", qd.symbol], ["Price", qd.price], ["Change", [qd.price_change, qd.percent_change].filter(Boolean).join(" ") || ""], ["Exchange", qd.exchange]] as [string, unknown][] ).filter(([, v]) => v).map(([k, v]) => (
              <li key={k}><strong className="text-[var(--ink)]">{k}: </strong>{String(v)}</li>
            ))}
          </ul>
          {qd.summary && <p className="text-sm">{String(qd.summary).slice(0, 280)}</p>}
        </article>
        {(pres.headlines || []).map((h, i) => (
          <article key={i} className="border-t border-[var(--rule)] py-3">
            <h3 className="text-[17px] m-0"><a href={h.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--ink)]">{h.title.slice(0, 120)}</a></h3>
            {h.date && <div className="text-[13px] text-[var(--ink-3)]">{h.date}</div>}
          </article>
        ))}
        {pres.disclaimer && <p className="text-[13px] text-[var(--ink-3)]">{pres.disclaimer}</p>}
      </div>
    );
  }
  if (pres.type === "deep_dive") {
    return (
      <div>
        {pres.summary && <p className="font-read text-[17px] leading-[1.65] max-w-[66ch]">{pres.summary}</p>}
        {(pres.findings || []).length > 0 && (
          <>
            <h2 className="text-xl mt-6 mb-2">Key findings</h2>
            <ol>{(pres.findings || []).map((f, i) => (
              <li key={i} className="my-1 text-[15px]">{String(f.claim || f.title || "").slice(0, 280)} <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm">source</a></li>
            ))}</ol>
          </>
        )}
        {(pres.papers || []).length > 0 && (
          <>
            <h2 className="text-xl mt-6 mb-2">Papers</h2>
            {(pres.papers || []).map((r, i) => <PaperEntry key={i} r={r} index={i} onSelect={onSelect} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />)}
          </>
        )}
      </div>
    );
  }
  if (pres.type === "travel_choices") {
    return (
      <div>
        <p className="text-sm text-[var(--ink-2)]">{pres.note || "Planned and ready — no booking performed."}</p>
        {( [["Flights", pres.flights], ["Hotels", pres.hotels], ["Places", pres.places]] as [string, ApiResult[] | undefined][] ).map(([label, list]) => {
          const arr = list || [];
          if (!arr.length) return null;
          return (
            <div key={label}>
              <h2 className="text-xl mt-6 mb-2">{label}</h2>
              {arr.map((r, i) => <PageRow key={i} r={r} index={i} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />)}
            </div>
          );
        })}
      </div>
    );
  }
  if (pres.type === "learning_plan") {
    return (
      <div>
        {pres.goal && <p className="font-read text-[17px] leading-[1.65] max-w-[66ch]">{pres.goal}</p>}
        <ol className="list-none m-0 p-0">
          {(pres.stages || []).map((s) => (
            <li key={s.stage} className="relative pl-7 pb-4">
              <span aria-hidden="true" className="absolute left-0 top-[2px] w-[18px] h-[18px] rounded-full border-2 border-[var(--control)] bg-[var(--surface)]" />
              <strong>{s.stage}: </strong>
              {(s.topics || []).map((t, i) => (
                <span key={i}> <a href={t.url} target="_blank" rel="noopener noreferrer nofollow">{t.title.slice(0, 80)}</a>;</span>
              ))}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const list = (pres.jobs || pres.places || pres.results || []).filter((r) => !dismissed.has(key(r)));
  return (
    <div className="grid gap-3">
      {list.slice(0, 10).map((r, i) => {
        const k = detectKind(r);
        if (k === "job") return <JobRow key={i} r={r} index={i} onSelect={onSelect} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.application_url || r.url })} />;
        if (k === "product") return <ProductTile key={i} r={r} index={i} onSelect={onSelect} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />;
        if (k === "paper") return <PaperEntry key={i} r={r} index={i} onSelect={onSelect} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />;
        if (k === "video") return <VideoCard key={i} r={r} />;
        return <PageRow key={i} r={r} index={i} onDismiss={onDismiss} onSave={() => onSave({ title: r.title, url: r.url })} />;
      })}
    </div>
  );
}

function StepsList({ data }: { data: ChatResponse & AgentResponse }) {
  const a = (data as ChatResponse).analysis || (data as AgentResponse).classification || {};
  const intents = (a as { intent?: string[] }).intent || ((a as { use_case?: string }).use_case ? [(a as { use_case?: string }).use_case as string] : []);
  const steps = ((a as { steps?: { engine: string; query: string }[] }).steps || (data as ChatResponse).plan || []).filter((s) => (s as { tool?: string }).tool || (s as { engine?: string }).engine);
  const f = data.funnel;
  return (
    <details className="my-3">
      <summary className="cursor-pointer min-h-[44px] inline-flex items-center font-semibold text-sm">Research steps</summary>
      <dl className="text-sm">
        <dt className="font-semibold text-[var(--ink-2)] mt-2">Understood as</dt>
        <dd className="m-0">{intents.join(" · ") || "—"}</dd>
        {steps.length > 0 && (
          <>
            <dt className="font-semibold text-[var(--ink-2)] mt-2">Searches</dt>
            <dd className="m-0">
              {steps.map((s, i) => {
                const tool = (s as { tool?: string }).tool || (s as { engine?: string }).engine || "";
                const line = (data.route || []).find((l) => l.vertical === tool);
                return <div key={i}>{tool}: &ldquo;{String(s.query).slice(0, 80)}&rdquo;{line ? ` — ${line.result_count} found` : ""}</div>;
              })}
            </dd>
          </>
        )}
        {f && (
          <>
            <dt className="font-semibold text-[var(--ink-2)] mt-2">Results</dt>
            <dd className="m-0">
              {f.discovered} found · {f.matched} matched · {f.set_aside} set aside
              {f.reasons?.length > 0 && (
                <details className="text-[13px] text-[var(--ink-2)]">
                  <summary className="cursor-pointer min-h-[44px] inline-flex items-center">Why set aside: {f.reasons.map((r) => `${r.label} (${r.count})`).join(", ")}</summary>
                  {(f.set_aside_results || []).map((r, i) => (
                    <div key={i}>{String(r.title || r.name || "item")} — {r.set_aside_reason}</div>
                  ))}
                </details>
              )}
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
