"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bag, Briefcase, Compass, BookOpen, GraduationCap, Newspaper,
} from "@phosphor-icons/react";
import { api, streamChat } from "../lib/api";
import type { AgentPresentation, AgentResponse, ApiResult, ChatResponse, RunData } from "../lib/types";
import { fmtInt } from "../lib/format";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { Composer } from "../components/Composer";
import { RouteMap } from "../components/RouteMap";
import { EvidenceMargin } from "../components/EvidenceMargin";
import { CommandPalette } from "../components/CommandPalette";
import { SlotPrompt } from "../components/SlotPrompt";
import {
  ClarifyCard, CompareTray, ConfidenceLine, EmptyResults, ErrorPanel, PlanCard, SkeletonRun,
} from "../components/States";
import {
  JobRow, NewsItem, PageRow, PaperEntry, ProductTile, VideoCard, detectKind,
} from "../components/ResultCards";

const GOALS = [
  { label: "Compare products", sub: "Price, specs, tradeoffs", template: "Compare products: ___ vs ___", icon: Bag, span: true },
  { label: "Find roles", sub: "Internships and jobs", template: "Find software engineering internships in Bengaluru", icon: Briefcase, span: false },
  { label: "Research a topic", sub: "Papers, news, context", template: "Research ", icon: BookOpen, span: false },
  { label: "Learning plan", sub: "Ordered, with sources", template: "Build a learning plan for ", icon: GraduationCap, span: false },
  { label: "Plan a trip", sub: "Stays, flights, places", template: "Plan a 4 day trip to ", icon: Compass, span: false },
  { label: "What changed", sub: "Fresh news and trends", template: "What changed in  recently?", icon: Newspaper, span: false },
];

const TRY = [
  "Find three good laptops under ₹80,000 for machine learning",
  "Software internships in Bengaluru this summer",
  "Teach me CRISPR from basics to papers",
];

const SUFFIX: Record<string, string> = {
  cheaper: " cheaper options", recent_reviews: " with recent reviews", brands: " other brands",
  wider: " wider search", remote: " including remote", recent: " posted this week",
  pay: " higher pay", cities: " other cities", academic: " academic sources",
  counter: " counter-arguments", beginner: " beginner friendly", projects: " with projects", papers: " with papers",
};

const FILTER_LABELS: Record<string, string> = {
  budget: "Budget", currency: "Currency", min_rating: "Min rating", rating: "Min rating",
  location: "Location", remote: "Remote", salary_min: "Min pay", min_salary: "Min pay",
};

export default function Workspace() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("auto");
  const [deep, setDeep] = useState(false);
  const [phase, setPhase] = useState<"idle" | "planning" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState("Ready");
  const [run, setRun] = useState<RunData | null>(null);
  const [planPreview, setPlanPreview] = useState<{ plan: ChatResponse["plan"]; estimated_calls: number; estimated_seconds: number } | null>(null);
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [visible, setVisible] = useState(10);
  const [selected, setSelected] = useState<Map<string, ApiResult>>(new Map());
  const [filterVertical, setFilterVertical] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);
  const [theme, setTheme] = useState("system");
  const [hist, setHist] = useState<{ q: string; kind: string }[]>([]);
  const [savedTick, setSavedTick] = useState(0);
  const [online, setOnline] = useState(true);
  const [flashEid, setFlashEid] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [railOpen, setRailOpen] = useState(false);
  const [inspOpen, setInspOpen] = useState(false);
  const [palOpen, setPalOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const aborter = useRef<AbortController | null>(null);
  const pending = useRef<{ q: string; mode: string; deep: boolean } | null>(null);

  const say = useCallback((msg: string) => setToast({ msg, key: Date.now() }), []);
  const goHome = useCallback(() => {
    aborter.current?.abort();
    pending.current = null;
    setQuery(""); setRun(null); setPlanPreview(null);
    setPhase("idle"); setProgress("Ready"); setErr(null);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    try {
      setHist(JSON.parse(sessionStorage.getItem("serp_hist") || "[]"));
      const th = localStorage.getItem("serp_theme");
      if (th) { setTheme(th); document.documentElement.dataset.theme = th; }
    } catch { /* private mode */ }
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalOpen((o) => !o); return; }
      if (e.key !== "Escape") return;
      // Esc hierarchy: palette first, then blur an edited field, then home.
      // (Palette handles its own Esc in the capture phase and stops it there.)
      const t = e.target as HTMLElement | null;
      const editing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (editing) { t.blur(); return; }
      goHome();
    };
    window.addEventListener("keydown", keys);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); window.removeEventListener("keydown", keys); };
  }, [goHome]);

  const cycleTheme = () => {
    const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
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
      say("Saved to this device");
    } catch { say("Could not save on this device"); }
  };

  const startRun = async (q: string, kind: "chat" | "agent", m = mode, d = deep, flt: Record<string, unknown> = {}) => {
    const text = q.trim().slice(0, 2000);
    if (!text) { say("Type a question first"); return; }
    if (typeof AbortController !== "undefined") {
      aborter.current?.abort();
      aborter.current = new AbortController();
    } else {
      aborter.current = null;
    }
    setRun(null); setPlanPreview(null); setVisible(10);
    setSelected(new Map()); setFilterVertical(null); setFilters(flt);
    setDismissed(new Set()); setErr(null);
    setPhase("running"); setProgress("Understanding your question");
    pushHist(text, kind);
    document.getElementById("answer")?.scrollIntoView({ block: "start", behavior: "smooth" });
    try {
      if (kind === "agent") {
        const data = await api.agent(text, { filters: flt, signal: aborter.current?.signal });
        setRun({ kind, data });
      } else {
        try {
          const preview = await api.intents(text, aborter.current?.signal);
          if ((preview.requires_confirmation || d) && sessionStorage.getItem("serp_skip_plan") !== "1") {
            setPlanPreview(preview);
            setPhase("planning");
            setProgress("Plan ready for review");
            pending.current = { q: text, mode: m, deep: d };
            return;
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
        await doChat(text, m, d, flt);
      }
      setPhase("done"); setProgress("Done");
    } catch (e) {
      const error = e as Error;
      if (error.name === "AbortError") { setProgress("Stopped by you"); setPhase("idle"); return; }
      setPhase("error");
      if (error.message === "LIMIT") setErr("Rate limited. Try again in a minute.");
      else if (error.message === "NOKEY") setErr("Agent key missing. Set OPENROUTER_API_KEY in .env and restart.");
      else setErr("Request failed. Check the backend is running.");
    }
  };

  const doChat = async (text: string, m: string, d: boolean, flt: Record<string, unknown>) => {
    const signal = aborter.current?.signal;
    setProgress("Searching relevant sources");
    await streamChat(text, { mode: m, deep: d, filters: flt, signal }, (p) => {
      if (p.stage === "intent") setProgress(`Understood as ${p.detail}`);
      else if (p.stage === "plan") setProgress(`Plan: ${p.detail} steps`);
      else if (p.stage === "tool") setProgress(`Searching ${p.detail}`);
      else if (p.stage === "synthesis") setProgress("Writing the answer");
    }).catch((e) => { if ((e as Error).name === "AbortError") throw e; });
    const data = await api.chat(text, { mode: m, deep: d, filters: flt, signal });
    setRun({ kind: "chat", data });
  };

  const onSelect = (r: ApiResult, key: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) {
        if (next.size >= 4) { say("Compare holds 4 at most"); return prev; }
        next.set(key, r);
      } else next.delete(key);
      return next;
    });
  };

  const rkey = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  const dismiss = (r: ApiResult) => {
    setDismissed((prev) => new Set(prev).add(rkey(r)));
    say("Removed from this view");
  };

  const flash = (eid: string | null) => {
    setFlashEid(eid);
    if (!eid) return;
    const safe = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
      ? CSS.escape(eid) : String(eid).replace(/["\\]/g, "");
    requestAnimationFrame(() => {
      document.querySelector(`[data-eids~="${safe}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const data = run?.data as (ChatResponse & AgentResponse) | undefined;
  const sources = data?.sources || [];
  const route = data?.route || [];
  const constraints = (data as ChatResponse)?.constraints || (data as AgentResponse)?.constraints || {};
  const busy = phase === "running" || phase === "planning";

  const refine = (id: string) => {
    const q = data?.query ?? query;
    if (id === "__chat__") { startRun(q, "chat", "auto", false, filters); return; }
    if (id === "followup") { document.getElementById("q")?.focus(); return; }
    if (id === "deep") startRun(q, run?.kind || "chat", "auto", true, filters);
    else startRun(q + (SUFFIX[id] || ""), run?.kind || "chat", "auto", false, filters);
  };

  const paletteCmds = useMemo(() => [
    { id: "new", label: "New research", hint: "N", run: () => { setQuery(""); setRun(null); setPhase("idle"); } },
    { id: "theme", label: "Toggle theme", hint: "T", run: cycleTheme },
    { id: "deep", label: "Toggle deep research", hint: "D", run: () => setDeep((d) => !d) },
    { id: "mode-auto", label: "Mode: Auto", hint: "1", run: () => setMode("auto") },
    { id: "mode-shop", label: "Mode: Shopping", hint: "2", run: () => setMode("shopping") },
    { id: "mode-jobs", label: "Mode: Jobs", hint: "3", run: () => setMode("jobs") },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const hasRun = !!data || busy || phase === "error";

  return (
    <>
      <TopBar
        status={{ busy, error: phase === "error", text: busy ? progress : phase === "error" ? "Needs attention" : phase === "done" ? `Done · ${data?.results_count ?? (data as ChatResponse)?.results_count ?? ""} results`.trim() : "Ready" }}
        sourceCount={sources.length}
        onPalette={() => setPalOpen(true)}
        onToggleRail={() => setRailOpen((o) => !o)}
        onToggleInspector={() => setInspOpen((o) => !o)}
        theme={theme} onTheme={cycleTheme}
      />

      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-6 px-3 pt-4 sm:px-5 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,760px)_minmax(0,1fr)]">
        <div className={`${railOpen ? "block" : "hidden"} lg:block`}>
          <Sidebar
            open
            hist={hist}
            onPick={(q, k) => { setQuery(q); startRun(q, (k as "chat" | "agent") || "chat"); setRailOpen(false); }}
            onNew={() => { setQuery(""); setRun(null); setPhase("idle"); setProgress("Ready"); }}
            savedTick={savedTick}
            onOpenSaved={(s) => {
              if (s.query) { setQuery(s.query); startRun(s.query, "chat"); }
              else if (s.url) window.open(s.url, "_blank", "noopener");
            }}
          />
        </div>

        <main className="min-w-0 pb-24" id="main">
          {!hasRun && (
            <section aria-label="Ask" className="pb-2 pt-4 sm:pt-8">
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-2)]">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--live)]" />
                Universal web intelligence
              </p>
              <h1 className="m-0 max-w-[16ch] text-balance text-[clamp(30px,4.6vw,52px)] font-bold leading-[1.04] tracking-[-0.03em]">
                What do you want to figure out?
              </h1>
              <p className="mb-5 mt-3 max-w-[56ch] text-[15.5px] leading-relaxed text-[var(--ink-2)]">
                Ask in plain words. Agent picks sources and shows each step.
              </p>

              <Composer
                value={query} onChange={setQuery}
                mode={mode} onMode={setMode} deep={deep} onDeep={setDeep}
                running={busy}
                onResearch={(o) => startRun(query, "chat", o.mode, o.deep, {})}
                onAgent={() => startRun(query, "agent")}
                onStop={() => aborter.current?.abort()}
              />

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Start from a goal">
                {GOALS.map((g) => (
                  <button
                    key={g.label} type="button"
                    onClick={() => { setQuery(g.template); document.getElementById("q")?.focus(); }}
                    className={`spot flex items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5 text-left transition hover:border-[var(--control)] active:scale-[0.98] ${g.span ? "sm:col-span-2 sm:p-4" : ""}`}
                  >
                    <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]">
                      <g.icon size={18} weight="regular" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-[14px] font-semibold tracking-tight">{g.label}</strong>
                      <span className="block truncate text-[12.5px] text-[var(--ink-3)]">{g.sub}</span>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" className="ml-auto flex-none text-[var(--ink-3)]" />
                  </button>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Suggestions">
                <span className="text-[12.5px] text-[var(--ink-3)]">{hist.length ? "Recent:" : "Try:"}</span>
                {(hist.length ? hist.slice(0, 3).map((h) => h.q) : TRY).map((t) => (
                  <button key={t} type="button" className="chip !min-h-[36px]" onClick={() => startRun(t, "agent")}>
                    {t.slice(0, 52)}
                  </button>
                ))}
              </div>
            </section>
          )}

          {hasRun && (
            <div className="pt-2">
              <div className="bezel !rounded-full">
                <div className="bezel-core flex items-center gap-2 !rounded-full py-1.5 pl-4 pr-1.5">
                  <label htmlFor="q2" className="sr-only">Ask a follow-up</label>
                  <input
                    id="q2" value={query} onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") startRun(query, run?.kind || "chat"); }}
                    placeholder="Ask a follow-up"
                    className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-[var(--ink-3)]"
                  />
                  <button
                    type="button" aria-label="Send follow-up"
                    onClick={() => startRun(query, run?.kind || "chat")}
                    className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-ink)] transition active:scale-95"
                  >
                    <ArrowRight size={16} weight="bold" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {!online && (
            <div className="surface mt-3 p-3 text-[14px]">You are offline. Your question sends when you reconnect.</div>
          )}

          <FilterChips
            constraints={constraints}
            onRemove={(k) => {
              const next = { ...filters }; delete next[k];
              startRun(data?.query ?? query, run?.kind || "chat", "auto", false, next);
            }}
          />

          {phase === "planning" && planPreview && (
            <div className="mt-4">
              <PlanCard
                steps={planPreview.plan} estimatedCalls={planPreview.estimated_calls} estimatedSeconds={planPreview.estimated_seconds}
                onStart={(skip) => {
                  if (skip) { try { sessionStorage.setItem("serp_skip_plan", "1"); } catch { /* ignore */ } }
                  const p = pending.current; pending.current = null; setPlanPreview(null);
                  if (p) doChat(p.q, p.mode, p.deep, filters).then(() => setPhase("done")).catch(() => setPhase("error"));
                }}
                onCancel={() => { pending.current = null; setPlanPreview(null); setPhase("idle"); setProgress("Ready"); }}
              />
            </div>
          )}

          {phase === "running" && !data && (
            <div className="mt-4 space-y-3" aria-live="polite">
              <p className="text-[14px] text-[var(--ink-2)]">{progress}…</p>
              <SkeletonRun />
            </div>
          )}

          {phase === "error" && err && (
            <div className="mt-4"><ErrorPanel message={err} onRetry={() => startRun(data?.query ?? query, run?.kind || "chat")} /></div>
          )}

          {data && (
            <div id="answer" className="mt-4 space-y-4">
              <RunHeader query={data.query} kind={run!.kind} mode={(data as ChatResponse).mode} />
              {route.length > 0 && (
                <RouteMap route={route} budget={data.budget} onFilter={(v) => setFilterVertical((cur) => (cur === v ? null : v))} activeVertical={filterVertical} />
              )}
              <AnswerBlock data={data} onRetry={() => startRun(data.query, run!.kind)} />
              {(run!.kind === "agent" && (data as AgentResponse).status === "clarify") ? (
                ((data as AgentResponse).missing_slots?.length) ? (
                  <SlotPrompt
                    question={(data as AgentResponse).clarifying_question || "Could you add detail?"}
                    missing={(data as AgentResponse).missing_slots || []}
                    known={(data as AgentResponse).slots || {}}
                    onSubmit={(slots) => startRun(data.query, "agent", mode, false, { ...filters, ...slots })}
                    onSkip={() => startRun(data.query, "chat", "auto", false, filters)}
                  />
                ) : (
                  <ClarifyCard
                    question={(data as AgentResponse).clarifying_question || "Could you add detail?"}
                    onSkip={() => startRun(data.query, "chat", "auto", false, filters)}
                  />
                )
              ) : (data as AgentResponse).presentation ? (
                <PresentationView
                  pres={(data as AgentResponse).presentation!}
                  filterVertical={filterVertical} flashEid={flashEid}
                  onSelect={onSelect} onSave={saveItem} dismissed={dismissed} onDismiss={dismiss}
                />
              ) : (
                <ResultsList
                  results={(data as ChatResponse).results || []}
                  visible={visible} setVisible={setVisible}
                  filterVertical={filterVertical} flashEid={flashEid}
                  onSelect={onSelect} onSave={saveItem} dismissed={dismissed} onDismiss={dismiss}
                  query={data.query}
                />
              )}
              <RefineRow refinements={data.refinements || []} onRefine={refine} />
              <p className="tnum font-mono text-[11.5px] text-[var(--ink-3)]" aria-live="polite">{progress}</p>
            </div>
          )}

          <CompareTray selected={selected} onClear={() => setSelected(new Map())} />
        </main>

        <div className={`${inspOpen ? "block" : "hidden"} xl:block`}>
          <EvidenceMargin
            sources={sources}
            onFlash={flash}
            funnel={(data as ChatResponse)?.funnel || (data as AgentResponse)?.funnel}
            budget={data?.budget}
            confidence={data?.confidence}
            planSteps={(data as ChatResponse)?.analysis?.steps || []}
          />
        </div>
      </div>

      <footer className="mx-auto w-full max-w-[1400px] px-5 pb-8 text-[12.5px] text-[var(--ink-3)]">
        <p className="m-0">Live web data. Check important claims at the source. Anonymous use stays in this browser unless saved.</p>
      </footer>

      <div aria-live="polite" role="status" className="sr-only">
        {phase === "done" ? "Answer ready." : progress}
      </div>
      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[var(--ink)] px-4 py-2.5 text-sm text-[var(--bg)]">
          {toast.msg}
        </div>
      )}

      <CommandPalette
        open={palOpen} onClose={() => setPalOpen(false)}
        commands={paletteCmds}
        onAsk={(q) => { setQuery(q); startRun(q, "chat"); }}
      />
    </>
  );
}

function FilterChips({ constraints, onRemove }: { constraints: Record<string, unknown>; onRemove: (k: string) => void }) {
  const keys = Object.keys(constraints || {}).filter((k) => FILTER_LABELS[k] && String(constraints[k]) !== "");
  if (!keys.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Understood filters">
      <span className="text-[13px] text-[var(--ink-2)]">Understood:</span>
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1 pl-3 pr-1 text-[12.5px]">
          {FILTER_LABELS[k]}: {String(constraints[k]).slice(0, 32)}
          <button
            type="button" aria-label={`Remove filter ${FILTER_LABELS[k]}`} onClick={() => onRemove(k)}
            className="grid h-6 w-6 place-items-center rounded-full text-[var(--ink-3)] hover:text-[var(--error)]"
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

function RunHeader({ query, kind, mode }: { query: string; kind: string; mode?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[13px] text-[var(--ink-2)]">✳</span>
      <div className="min-w-0">
        <p className="tnum m-0 font-mono text-[11px] uppercase tracking-wider text-[var(--ink-3)]">You</p>
        <h2 className="m-0 mt-0.5 text-balance text-[18px] font-semibold tracking-tight">{query.slice(0, 220)}</h2>
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {mode && mode !== "auto" && <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 font-mono text-[11px] capitalize text-[var(--ink-2)]">{mode}</span>}
          <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--ink-2)]">
            {kind === "agent" ? "Autonomous agent" : "Routed research"}
          </span>
        </p>
      </div>
    </div>
  );
}

function AnswerBlock({ data, onRetry }: { data: ChatResponse & AgentResponse; onRetry: () => void }) {
  const conf = data.confidence;
  const comp = (data as ChatResponse).completeness;
  const intents = ((data as ChatResponse).analysis?.intent || (data as AgentResponse).legacy_intents || []).join(" ");
  return (
    <div>
      <p className="tnum font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-3)]">Answer</p>
      {data.summary && (
        <p className="font-reading mt-1 max-w-[68ch] text-[19px] leading-[1.6]">{data.summary.slice(0, 900)}</p>
      )}
      {typeof conf === "object" && conf && <ConfidenceLine level={conf.level} reasons={conf.reasons || []} />}
      {typeof conf === "string" && <p className="mt-2 text-[13.5px] text-[var(--ink-2)]">Confidence: {conf}.</p>}
      {comp?.message && (
        <p className={`mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border p-2.5 text-[13.5px] ${
          comp.state === "partial" ? "border-[var(--caution)]" : comp.state === "failed" ? "border-[var(--error)]" : "border-[var(--line)] text-[var(--ink-2)]"
        }`}>
          {comp.message.slice(0, 300)}
          {comp.state === "partial" && <button type="button" className="btn !min-h-[32px] !py-1" onClick={onRetry}>Retry</button>}
        </p>
      )}
      {/FINANCE|finance_snapshot/.test(`${intents} ${(data as AgentResponse).presentation?.type || ""}`) && (
        <p className="mt-1.5 text-[12.5px] font-semibold text-[var(--caution)]">Information only, not financial advice.</p>
      )}
      {/apply to|book (me|us|a |my)|buy .* for me|\bpurchase\b/i.test(data.query || "") && (
        <p className="surface mt-2 p-3 text-[13.5px]">
          This assistant reads and compares. It does not buy, apply or book. Open the listings instead.
        </p>
      )}
    </div>
  );
}

function ResultsList({ results, visible, setVisible, filterVertical, flashEid, onSelect, onSave, dismissed, onDismiss, query }: {
  results: ApiResult[]; visible: number; setVisible: (n: number) => void;
  filterVertical: string | null; flashEid: string | null;
  onSelect: (r: ApiResult, key: string, on: boolean) => void; onSave: (r: Record<string, unknown>) => void;
  dismissed: Set<string>; onDismiss: (r: ApiResult) => void; query: string;
}) {
  const key = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  const list = results.filter((r) => !dismissed.has(key(r)) && (!filterVertical || (r._engine || "google_search") === filterVertical));
  const shown = list.slice(0, visible);
  const shopping = list.some((r) => detectKind(r) === "product");

  if (!list.length) return <EmptyResults query={query} onWiden={() => {}} />;

  return (
    <section aria-label="Results">
      <h3 className="mb-1 flex items-center gap-2 text-[14.5px] font-semibold">
        Results
        <span className="tnum rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[11px] font-normal text-[var(--ink-3)]">{list.length}</span>
        {filterVertical && <span className="font-mono text-[11px] font-normal text-[var(--ink-3)]">filtered</span>}
      </h3>
      {shopping ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {shown.map((r, i) => {
            const k = `${key(r)}-${i}`;
            const flash = flashEid && (r.evidence_ids || []).includes(flashEid) ? " flash" : "";
            return (
              <div key={k} className={flash}>
                <ProductTile r={r} index={i} featured={i === 0}
                  onSelect={(rr, ii, on) => onSelect(rr, k, on)}
                  onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {shown.map((r, i) => {
            const k = `${key(r)}-${i}`;
            const flash = flashEid && (r.evidence_ids || []).includes(flashEid) ? " flash" : "";
            const kind = detectKind(r);
            return (
              <div key={k} className={flash}>
                {kind === "job" ? (
                  <JobRow r={r} index={i}
                    onSelect={(rr, ii, on) => onSelect(rr, k, on)}
                    onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.application_url || r.url })} />
                ) : kind === "product" ? (
                  <ProductTile r={r} index={i}
                    onSelect={(rr, ii, on) => onSelect(rr, k, on)}
                    onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
                ) : kind === "paper" ? (
                  <PaperEntry r={r} index={i}
                    onSelect={(rr, ii, on) => onSelect(rr, k, on)}
                    onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
                ) : kind === "video" ? (
                  <VideoCard r={r} />
                ) : kind === "news" ? (
                  <NewsItem r={r} index={i}
                    onSelect={(rr, ii, on) => onSelect(rr, k, on)}
                    onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
                ) : (
                  <PageRow r={r} index={i}
                    onSelect={(rr, ii, on) => onSelect(rr, k, on)}
                    onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {list.length > visible && (
        <button type="button" className="btn mt-2" onClick={() => setVisible(visible + 20)}>
          Show {Math.min(20, list.length - visible)} more ({list.length - visible} left)
        </button>
      )}
    </section>
  );
}

function PresentationView({ pres, filterVertical, flashEid, onSelect, onSave, dismissed, onDismiss }: {
  pres: AgentPresentation; filterVertical: string | null; flashEid: string | null;
  onSelect: (r: ApiResult, key: string, on: boolean) => void;
  onSave: (r: Record<string, unknown>) => void;
  dismissed: Set<string>; onDismiss: (r: ApiResult) => void;
}) {
  const key = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  if (pres.type === "shopping_top2") {
    return (
      <section aria-label="Top picks">
        <h3 className="mb-1 text-[14.5px] font-semibold">Top picks <span className="tnum font-mono text-[11px] font-normal text-[var(--ink-3)]">{(pres.picks || []).length}</span></h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {(pres.picks || []).slice(0, 4).filter((p) => !dismissed.has(key(p))).map((item, i) => (
            <ProductTile key={i} r={{ ...item, seller: String(item.seller || ""), _engine: "google_shopping" }} index={i} featured={i === 0}
              onSelect={(r, _ii, on) => onSelect(r, `pick-${i}`, on)}
              onDismiss={() => onDismiss(item)} onSave={() => onSave({ title: item.title, url: item.url })} />
          ))}
        </div>
      </section>
    );
  }
  if (pres.type === "youtube_path") {
    const order: [string, string][] = [["beginner", "Start here"], ["intermediate", "Go deeper"], ["advanced", "Master it"]];
    return (
      <div className="space-y-5">
        {order.map(([lvl, label]) => {
          const vids = ((pres.levels?.[lvl] || []) as ApiResult[]).filter(() => !filterVertical || filterVertical === "youtube");
          if (!vids.length) return null;
          return (
            <section key={lvl} aria-label={label}>
              <h3 className="mb-1 text-[14.5px] font-semibold">{label} <span className="tnum font-mono text-[11px] font-normal text-[var(--ink-3)]">{vids.length}</span></h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {vids.map((v, i) => <VideoCard key={i} r={v} />)}
              </div>
            </section>
          );
        })}
      </div>
    );
  }
  if (pres.type === "finance_snapshot") {
    const qd = (pres.quote || {}) as ApiResult;
    return (
      <section aria-label="Market snapshot" className="space-y-2">
        <article className="surface p-4">
          <p className="tnum font-mono text-[11px] uppercase tracking-wider text-[var(--ink-3)]">Snapshot</p>
          <h3 className="mt-0.5 text-[18px] font-semibold tracking-tight">{String(qd.stock_name || qd.symbol || "Quote").slice(0, 110)}</h3>
          <p className="tnum mt-1 font-mono text-[13px] text-[var(--ink-2)]">
            {[["Price", qd.price], ["Change", [qd.price_change, qd.percent_change].filter(Boolean).join(" ")], ["Exchange", qd.exchange]]
              .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 180)}
          </p>
          {qd.summary && <p className="mt-1.5 text-[14px] text-[var(--ink-2)]">{String(qd.summary).slice(0, 260)}</p>}
        </article>
        {(pres.headlines || []).map((h, i) => (
          <PageRow key={i} r={{ title: h.title, url: h.url, date: h.date, source: h.source || "News" } as ApiResult} index={i}
            onDismiss={() => {}} onSave={() => onSave({ title: h.title, url: h.url })} />
        ))}
        {pres.disclaimer && <p className="text-[12.5px] text-[var(--ink-3)]">{pres.disclaimer}</p>}
      </section>
    );
  }
  if (pres.type === "deep_dive") {
    return (
      <div className="space-y-4">
        {pres.summary && <p className="font-reading max-w-[68ch] text-[17px] leading-[1.65]">{pres.summary.slice(0, 600)}</p>}
        {(pres.findings || []).length > 0 && (
          <section aria-label="Key findings">
            <h3 className="mb-1 text-[14.5px] font-semibold">Key findings</h3>
            <ol className="m-0 space-y-1.5 pl-5 text-[14.5px]">
              {(pres.findings || []).map((f, i) => (
                <li key={i}>{String(f.claim || f.title || "").slice(0, 260)} <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[13px]">source</a></li>
              ))}
            </ol>
          </section>
        )}
        {(pres.papers || []).length > 0 && (
          <section aria-label="Papers">
            <h3 className="mb-1 text-[14.5px] font-semibold">Papers</h3>
            {(pres.papers || []).map((r, i) => (
              <PaperEntry key={i} r={r} index={i}
                onSelect={(rr, _ii, on) => onSelect(rr, `paper-${i}`, on)}
                onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
            ))}
          </section>
        )}
      </div>
    );
  }
  if (pres.type === "travel_choices") {
    return (
      <div className="space-y-4">
        <p className="text-[13.5px] text-[var(--ink-2)]">{pres.note || "Planned and ready. Booking happens on provider sites."}</p>
        {( [["Flights", pres.flights], ["Hotels", pres.hotels], ["Places", pres.places]] as [string, ApiResult[] | undefined][] ).map(([label, list]) => {
          const arr = (list || []).filter((r) => !dismissed.has(key(r)));
          if (!arr.length) return null;
          return (
            <section key={label} aria-label={label}>
              <h3 className="mb-1 text-[14.5px] font-semibold">{label}</h3>
              {arr.map((r, i) => (
                <PageRow key={i} r={r} index={i} onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
              ))}
            </section>
          );
        })}
      </div>
    );
  }
  if (pres.type === "learning_plan") {
    return (
      <section aria-label="Learning path">
        {pres.goal && <p className="font-reading max-w-[68ch] text-[17px] leading-[1.65]">{pres.goal.slice(0, 400)}</p>}
        <ol className="m-0 mt-2 list-none space-y-0 p-0">
          {(pres.stages || []).map((s) => (
            <li key={s.stage} className="relative pb-4 pl-7">
              <span aria-hidden="true" className="absolute left-0 top-[3px] h-[18px] w-[18px] rounded-full border-2 border-[var(--control)] bg-[var(--surface)]" />
              <span aria-hidden="true" className="absolute bottom-0 left-[8px] top-[24px] w-[2px] bg-[var(--line)]" />
              <strong className="text-[14px]">{s.stage}: </strong>
              <span className="text-[14px] text-[var(--ink-2)]">
                {(s.topics || []).map((t, i) => (
                  <span key={i}>{i > 0 && " · "}<a href={t.url} target="_blank" rel="noopener noreferrer nofollow">{t.title.slice(0, 72)}</a></span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  const list = ((pres.jobs || pres.places || pres.results || []) as ApiResult[]).filter((r) => !dismissed.has(key(r)));
  void flashEid;
  return (
    <section aria-label="Results">
      <div className="grid gap-0">
        {list.slice(0, 10).map((r, i) => {
          const kind = detectKind(r);
          if (kind === "job") return <JobRow key={i} r={r} index={i}
            onSelect={(rr, _ii, on) => onSelect(rr, `g-${i}`, on)}
            onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.application_url || r.url })} />;
          if (kind === "product") return <ProductTile key={i} r={r} index={i}
            onSelect={(rr, _ii, on) => onSelect(rr, `g-${i}`, on)}
            onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />;
          if (kind === "paper") return <PaperEntry key={i} r={r} index={i}
            onSelect={(rr, _ii, on) => onSelect(rr, `g-${i}`, on)}
            onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />;
          if (kind === "video") return <VideoCard key={i} r={r} />;
          return <PageRow key={i} r={r} index={i} onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />;
        })}
      </div>
    </section>
  );
}

function RefineRow({ refinements, onRefine }: { refinements: { id: string; label: string; estimated_calls?: number }[]; onRefine: (id: string) => void }) {
  if (!refinements.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Refine">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-3)]">Refine</span>
      {refinements.slice(0, 5).map((c) => (
        <button key={c.id} type="button" className="chip !min-h-[36px]" onClick={() => onRefine(c.id)}>
          {c.label}
          {c.estimated_calls ? <span className="tnum font-mono text-[11px] text-[var(--ink-3)]">~{c.estimated_calls}</span> : null}
        </button>
      ))}
    </div>
  );
}
