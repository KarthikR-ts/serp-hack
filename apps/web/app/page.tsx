"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bag, Briefcase, Compass, BookOpen, GraduationCap, Newspaper,
} from "@phosphor-icons/react";
import { api, streamAgent, streamChat } from "../lib/api";
import type { AgentPresentation, AgentResponse, ApiResult, ChatResponse, RunData, TaskSection } from "../lib/types";
import { fmtInt } from "../lib/format";
import { TopBar } from "../components/TopBar";
import { Sidebar } from "../components/Sidebar";
import { Composer } from "../components/Composer";
import { ActionButton } from "../components/ActionButton";
import { RouteMap } from "../components/RouteMap";
import { ReasoningTrace } from "../components/ReasoningTrace";
import { EvidenceMargin } from "../components/EvidenceMargin";
import { CommandPalette } from "../components/CommandPalette";
import { SlotPrompt } from "../components/SlotPrompt";
import {
  ClarifyCard, CompareTray, ConfidenceLine, EmptyResults, ErrorPanel, PlanCard, SkeletonRun,
} from "../components/States";
import {
  JobRow, NewsItem, PageRow, PaperEntry, ProductTile, VideoCard, detectKind,
} from "../components/ResultCards";
import SummaryDigest, { digestTakeaways } from "../components/SummaryDigest";

const GOALS = [
  { label: "Compare products", sub: "Spec matrix, teardowns, thermal limits", template: "Compare products: ___ vs ___", icon: Bag, span: false },
  { label: "Find roles or internships", sub: "Direct portals, hiring teams", template: "Find software engineering internships in Bengaluru", icon: Briefcase, span: false },
  { label: "Research a topic", sub: "Patents, arXiv, peer rebuttals", template: "Research ", icon: BookOpen, span: false },
  { label: "Build a learning plan", sub: "Syllabi, papers, exercises", template: "Build a learning plan for ", icon: GraduationCap, span: false },
  { label: "Plan a trip", sub: "Transit, gems, advisories", template: "Plan a 4 day trip to ", icon: Compass, span: false },
  { label: "Check what’s changed", sub: "Delta diffs, filings, mandates", template: "What changed in  recently?", icon: Newspaper, span: false },
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
  const [trace, setTrace] = useState<string[]>([]);
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
    setQuery(""); setRun(null); setPlanPreview(null); setTrace([]);
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
      if (th === "light" || th === "dark") {
        setTheme(th);
        document.documentElement.dataset.theme = th;
      } else {
        setTheme("system");
        delete document.documentElement.dataset.theme;
      }
    } catch { /* private mode */ }
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const follow = () => {
      try {
        if ((localStorage.getItem("serp_theme") || "system") === "system") {
          if (mq?.matches) document.documentElement.dataset.theme = "dark";
          else delete document.documentElement.dataset.theme;
        }
      } catch { /* ignore */ }
    };
    follow();
    mq?.addEventListener?.("change", follow);
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
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); window.removeEventListener("keydown", keys); mq?.removeEventListener?.("change", follow); };
  }, [goHome]);

  const cycleTheme = () => {
    const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    try { localStorage.setItem("serp_theme", next); } catch { /* ignore */ }
    if (next === "system") {
      delete document.documentElement.dataset.theme;
      try {
        if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
          document.documentElement.dataset.theme = "dark";
        }
      } catch { /* ignore */ }
    } else {
      document.documentElement.dataset.theme = next;
    }
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
    setDismissed(new Set()); setErr(null); setTrace([]);
    setPhase("running"); setProgress("Understanding your question");
    pushHist(text, kind);
    document.getElementById("answer")?.scrollIntoView({ block: "start", behavior: "smooth" });
    try {
      if (kind === "agent") {
        const push = (t: string) => setTrace((prev) => [...prev.slice(-30), t].filter(Boolean));
        try {
          const streamed = await streamAgent(text, { filters: flt, signal: aborter.current?.signal }, (e) => {
            if (e.type === "reasoning") push(e.text);
            else if (e.type === "task_started") { push(`Started: ${e.label || e.id}`); if (e.label) setProgress(e.label); }
            else if (e.type === "task_done") push(`Done: ${e.label || e.id}${e.count != null ? ` (${e.count})` : ""}`);
            else if (e.type === "tool_started") setProgress(`Searching ${e.tool}${e.query ? `: ${e.query.slice(0, 80)}` : ""}`);
            else if (e.type === "tool_completed") setProgress(`${e.tool} ${e.status || "done"}${e.count != null ? ` · ${e.count}` : ""}`);
            else if (e.type === "progress" && e.detail) setProgress(e.detail);
          });
          if (streamed) setRun({ kind, data: streamed });
          else {
            const data = await api.agent(text, { filters: flt, signal: aborter.current?.signal });
            if (data.reasoning?.length) setTrace(data.reasoning.filter(Boolean));
            setRun({ kind, data });
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          // SSE error event carries backend code (e.g. LIMIT/NOKEY); fall back once.
          if (["LIMIT", "NOKEY"].includes((e as Error).message)) throw e;
          const data = await api.agent(text, { filters: flt, signal: aborter.current?.signal });
          if (data.reasoning?.length) setTrace(data.reasoning.filter(Boolean));
          setRun({ kind, data });
        }
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
  const agentSections: TaskSection[] = (data as AgentResponse)?.sections || [];
  const agentReasoning = (data as AgentResponse)?.reasoning || [];
  const sources = data?.sources || [];
  const route = data?.route || [];
  const constraints = (data as ChatResponse)?.constraints || (data as AgentResponse)?.constraints || {};
  const busy = phase === "running" || phase === "planning";
  const totalCount = (() => {
    const direct = (data as AgentResponse)?.results_count ?? (data as ChatResponse)?.results_count;
    if (typeof direct === "number") return direct;
    if (agentSections.length) {
      const sum = agentSections.reduce((n, s) => n + (typeof s.results_count === "number" ? s.results_count : 0), 0);
      if (sum > 0) return sum;
      const picks = agentSections.reduce((n, s) => n + (s.presentation?.picks?.length || s.presentation?.papers?.length || 0), 0);
      if (picks > 0) return picks;
    }
    const pres = (data as AgentResponse)?.presentation;
    const fallback = (pres?.picks?.length || pres?.papers?.length || pres?.places?.length || pres?.jobs?.length || pres?.results?.length || 0);
    return fallback > 0 ? fallback : null;
  })();
  const statusText = busy ? progress : phase === "error" ? "Needs attention" : phase === "done" ? (totalCount != null ? `Done · ${fmtInt(totalCount)} results` : "Done") : "Ready";

  const widen = () => {
    const q = `${data?.query ?? query} wider search`;
    startRun(q, run?.kind || "chat", "auto", false, {});
  };

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
        status={{ busy, error: phase === "error", text: statusText }}
        sourceCount={sources.length}
        onPalette={() => setPalOpen(true)}
        onToggleRail={() => setRailOpen((o) => !o)}
        onToggleInspector={() => setInspOpen((o) => !o)}
        theme={theme} onTheme={cycleTheme}
        inspectorOpen={inspOpen}
      />

      <div className="mx-auto grid w-full max-w-[1340px] grid-cols-1 gap-8 px-4 pt-4 lg:px-8 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,760px)_320px]">
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

        <main className="min-w-0 max-w-[760px] pb-24" id="main">
          {!hasRun && (
            <section aria-label="Ask" className="pb-2 pt-4 sm:pt-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h1 className="m-0 text-balance text-[clamp(31px,4vw,39px)] font-bold leading-[44px] tracking-tight text-[var(--primary)]">
                    What do you want to find out?
                  </h1>
                  <p className="font-reading mb-5 mt-2 max-w-xl text-[15px] leading-[24px] text-[var(--ink-2)]">
                    Synthesizing across multi-vertical web indexes, patent vaults, academic archives, and discourse threads.
                  </p>
                </div>
              </div>

              <Composer
                value={query} onChange={setQuery}
                mode={mode} onMode={setMode} deep={deep} onDeep={setDeep}
                running={busy}
                onResearch={(o) => startRun(query, "chat", o.mode, o.deep, {})}
                onAgent={() => startRun(query, "agent")}
                onStop={() => aborter.current?.abort()}
              />

              <div className="mt-4 flex flex-col gap-1 rounded-[12px] border border-[var(--line)] bg-[var(--surface-low)] px-4 py-3 md:flex-row md:items-center md:justify-between" aria-label="Likely route">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">
                  <span>⌁ Likely route:</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--paper)] px-2.5 py-1 text-[12px] font-medium normal-case tracking-normal text-[var(--ink)]"><span className="h-2 w-2 rounded-full bg-[var(--fam-commerce)]" /> Products <span className="text-[11px] text-[var(--ink-3)]">(Commerce API)</span></span>
                  <span aria-hidden="true" className="text-[var(--control)]">--</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--paper)] px-2.5 py-1 text-[12px] font-medium normal-case tracking-normal text-[var(--ink)]"><span className="h-2 w-2 rounded-full bg-[var(--fam-web)]" /> Web <span className="text-[11px] text-[var(--ink-3)]">(Organic Index)</span></span>
                  <span aria-hidden="true" className="text-[var(--control)]">--</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--paper)] px-2.5 py-1 text-[12px] font-medium normal-case tracking-normal text-[var(--ink)]"><span className="h-2 w-2 rounded-full bg-[var(--fam-research)]" /> Discussions <span className="text-[11px] text-[var(--ink-3)]">(Reddit & Forums)</span></span>
                </div>
                <span className="text-[12px] font-medium text-[var(--secondary)]">Customize pipeline</span>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <h2 className="text-[20px] font-bold text-[var(--primary)]">Start from a goal</h2>
                <span className="text-[12px] text-[var(--ink-2)]">Pre-tuned multi-step pipelines</span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Start from a goal">
                {GOALS.map((g) => (
                  <button
                    key={g.label} type="button"
                    onClick={() => { setQuery(g.template); document.getElementById("q")?.focus(); }}
                    className="group flex flex-col justify-between gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-4 text-left shadow-sm transition hover:shadow-md"
                  >
                    <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-[8px] bg-[var(--surface-2)] text-[var(--primary)]">
                      <g.icon size={22} weight="regular" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-[17px] font-bold tracking-tight text-[var(--primary)]">{g.label}</strong>
                      <span className="font-reading block text-[15px] leading-[24px] text-[var(--ink-2)]">{g.sub}</span>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" className="text-[var(--ink-3)] transition group-hover:translate-x-1" />
                  </button>
                ))}
              </div>

              <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <h2 className="text-[20px] font-bold text-[var(--primary)]">Recent research</h2>
                  <div className="mt-2 space-y-1 rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-2 shadow-sm">
                    {(hist.length ? hist.slice(0, 3).map((h) => ({ t: h.q, s: h.kind })) : TRY.map((t) => ({ t, s: "recent" }))).map((x, i) => (
                      <button key={i} type="button" className="flex w-full items-center justify-between rounded-[6px] p-3 text-left transition hover:bg-[var(--surface-2)]" onClick={() => startRun(x.t, "agent")}>
                        <span className="min-w-0"><strong className="block truncate text-[15px] text-[var(--primary)]">{x.t.slice(0, 52)}</strong>
                        <span className="block truncate text-[12px] text-[var(--ink-2)]">{x.s} · citations linked</span></span>
                        <span className="font-mono text-[12px] text-[var(--secondary)]">›</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-[12px] bg-[var(--primary)] p-6 text-white shadow-md lg:col-span-5">
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-medium text-[var(--inverse-primary)]">✓ Epistemic Provenance Guarantee</p>
                  <h3 className="mt-2 text-[25px] font-bold leading-[32px]">Autonomous, not unaccountable.</h3>
                  <p className="mt-1 text-[15px] leading-[22px] text-[var(--on-primary-container)]">Every assertion is backed by immutable web-archived snapshots and exact character-range highlights.</p>
                  <p className="mt-3 font-mono text-[12px] text-[var(--on-primary-container)]">Haystack 2.0 Graph Operator · Inspect active graph →</p>
                </div>
              </div>

              <div className="mt-6 flex items-start gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-low)] p-4">
                <span aria-hidden="true">🛡</span>
                <p className="font-reading m-0 text-[15px] leading-[24px] text-[var(--ink-2)]">
                  Ask in your own words. The agent chooses where to look. <strong className="text-[var(--primary)]">Read-only:</strong> reads and compares, never purchases or applies.
                  <span className="ml-3 font-mono text-[12px] text-[var(--ink-2)]">ZERO-TRANSACTION GUARD ●</span>
                </p>
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
              {trace.length > 0 && <ReasoningTrace lines={trace} live />}
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
              {agentReasoning.length > 0 && (
                <ReasoningTrace lines={agentReasoning} live={phase === "running"} />
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
              ) : agentSections.length > 1 ? (
                <div className="space-y-6">
                  {agentSections.map((sec, i) => (
                    <section key={`${sec.task_id || i}-${sec.title.slice(0, 32)}`} aria-label={sec.title} className="space-y-3">
                      <h3 className="text-[16px] font-bold tracking-tight text-[var(--primary)]">
                        {sec.title.slice(0, 140)}
                        {sec.results_count != null && (
                          <span className="tnum ml-2 rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[11px] font-normal text-[var(--ink-3)]">{sec.results_count}</span>
                        )}
                      </h3>
                      <SummaryDigest
                        summary={i === 0 ? data.summary : undefined}
                        takeaways={digestTakeaways(sec.presentation, [])}
                        counts={`${fmtInt(sec.results_count ?? 0)} results · ${fmtInt(sec.sources?.length ?? 0)} sources · ${fmtInt(sec.route?.length ?? route.length)} searches`}
                        compact
                      />
                      {sec.presentation ? (
                        <PresentationView
                          pres={sec.presentation}
                          filterVertical={filterVertical} flashEid={flashEid}
                          onSelect={onSelect} onSave={saveItem} dismissed={dismissed} onDismiss={dismiss}
                          query={data.query} onWiden={widen}
                        />
                      ) : (
                        <p className="text-[14px] text-[var(--ink-2)]">No results in this section.</p>
                      )}
                      <RefineRow refinements={data.refinements || []} onRefine={refine} />
                    </section>
                  ))}
                </div>
              ) : (data as AgentResponse).presentation ? (
                <>
                  <SummaryDigest
                    summary={data.summary}
                    takeaways={digestTakeaways((data as AgentResponse).presentation, (data as ChatResponse).results || [])}
                    counts={`${fmtInt(totalCount ?? 0)} results · ${fmtInt(sources.length)} sources · ${fmtInt(route.length > 0 ? route.length : (data?.budget?.calls_used ?? 0))} searches`}
                  />
                  <PresentationView
                    pres={(data as AgentResponse).presentation!}
                    filterVertical={filterVertical} flashEid={flashEid}
                    onSelect={onSelect} onSave={saveItem} dismissed={dismissed} onDismiss={dismiss}
                    query={data.query} onWiden={widen}
                  />
                </>
              ) : (
                <>
                  <SummaryDigest
                    summary={data.summary}
                    takeaways={digestTakeaways(undefined, (data as ChatResponse).results || [])}
                    counts={`${fmtInt(totalCount ?? 0)} results · ${fmtInt(sources.length)} sources · ${fmtInt(route.length > 0 ? route.length : (data?.budget?.calls_used ?? 0))} searches`}
                  />
                  <ResultsList
                    results={(data as ChatResponse).results || []}
                    visible={visible} setVisible={setVisible}
                    filterVertical={filterVertical} flashEid={flashEid}
                    onSelect={onSelect} onSave={saveItem} dismissed={dismissed} onDismiss={dismiss}
                    query={data.query} onWiden={widen}
                  />
                </>
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
    <header className="flex items-start gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm">
      <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-[6px] bg-[var(--surface-2)] text-[var(--secondary)]">◉</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-2)]">Inquest · Analytical Dossier</p>
        <h2 className="m-0 mt-0.5 text-balance text-[20px] font-bold leading-[28px] tracking-tight text-[var(--primary)]">“{query.slice(0, 220)}”</h2>
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {mode && mode !== "auto" && <span className="rounded bg-[var(--surface-2)] px-2 py-0.5 text-[12px] capitalize text-[var(--ink-2)]">{mode}</span>}
          <span className="rounded bg-[var(--surface-2)] px-2 py-0.5 text-[12px] text-[var(--ink-2)]">
            {kind === "agent" ? "Autonomous agent" : "Routed research"}
          </span>
        </p>
      </div>
    </header>
  );
}

function stripDigest(summary?: string): string {
  if (!summary) return "";
  const lines = summary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[.+\]$/.test(l));
  return lines.slice(0, 3).join(" ").slice(0, 500);
}

function AnswerBlock({ data, onRetry }: { data: ChatResponse & AgentResponse; onRetry: () => void }) {
  const conf = data.confidence;
  const comp = (data as ChatResponse).completeness;
  const intents = ((data as ChatResponse).analysis?.intent || (data as AgentResponse).legacy_intents || []).join(" ");
  return (
    <div className="rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--primary-container)] px-2 py-0.5 text-[12px] font-bold uppercase text-white">Executive Verdict</span>
        {typeof conf === "object" && conf && <span className="rounded bg-[var(--surface-2)] px-2 py-0.5 text-[12px] font-semibold text-[var(--status-caution)]">Confidence: {conf.level}</span>}
      </div>
      {((data as AgentResponse).summary_short || stripDigest(data.summary)) && (
        <p className="font-reading mt-2 max-w-[66ch] text-left text-[19px] leading-[30px] text-[var(--primary)]">
          {(data as AgentResponse).summary_short || stripDigest(data.summary)}
        </p>
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
      {/apply to|book\s+(me|us|a|my|the|flight|hotel|ticket|trip)|\bbuy\b|\bpurchase\b/i.test(data.query || "") && (
        <p className="surface mt-2 p-3 text-[13.5px]">
          This assistant reads and compares. It does not buy, apply or book. Open the listings instead.
        </p>
      )}
    </div>
  );
}

function ResultsList({ results, visible, setVisible, filterVertical, flashEid, onSelect, onSave, dismissed, onDismiss, query, onWiden }: {
  results: ApiResult[]; visible: number; setVisible: (n: number) => void;
  filterVertical: string | null; flashEid: string | null;
  onSelect: (r: ApiResult, key: string, on: boolean) => void; onSave: (r: Record<string, unknown>) => void;
  dismissed: Set<string>; onDismiss: (r: ApiResult) => void; query: string; onWiden?: () => void;
}) {
  const key = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  const list = results.filter((r) => !dismissed.has(key(r)) && (!filterVertical || (r._engine || "google_search") === filterVertical));
  const shown = list.slice(0, visible);
  const shopping = list.some((r) => detectKind(r) === "product");

  if (!list.length) return <EmptyResults query={query} onWiden={onWiden || (() => setVisible(20))} />;

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

function PresentationView({ pres, filterVertical, flashEid, onSelect, onSave, dismissed, onDismiss, query, onWiden }: {
  pres: AgentPresentation; filterVertical: string | null; flashEid: string | null;
  onSelect: (r: ApiResult, key: string, on: boolean) => void;
  onSave: (r: Record<string, unknown>) => void;
  dismissed: Set<string>; onDismiss: (r: ApiResult) => void;
  query?: string; onWiden?: () => void;
}) {
  const key = (r: ApiResult) => `${r.url || r.application_url || ""}|${r.title || r.name || ""}`;
  const flashCls = (r: ApiResult) => (flashEid && (r.evidence_ids || []).includes(flashEid) ? " flash" : "");
  if (pres.type === "shopping_top2") {
    const picks = (pres.picks || []).slice(0, 5).filter((p) => !dismissed.has(key(p)));
    return (
      <section aria-label="Top picks">
        <h3 className="mb-1 text-[14.5px] font-semibold">Top picks <span className="tnum font-mono text-[11px] font-normal text-[var(--ink-3)]">{picks.length}</span></h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {picks.map((item, i) => (
            <div key={i} className={flashCls(item)}>
              <ProductTile r={{ ...item, seller: String(item.seller || ""), _engine: "google_shopping" }} index={i} featured={i === 0}
                onSelect={(r, _ii, on) => onSelect(r, `pick-${i}`, on)}
                onDismiss={() => onDismiss(item)} onSave={() => onSave({ title: item.title, url: item.url })} />
            </div>
          ))}
        </div>
        {pres.deals_note && <p className="mt-2 text-[13.5px] text-[var(--ink-2)]">{pres.deals_note.slice(0, 400)}</p>}
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
    const topPicks = (pres.top_picks || []).slice(0, 3);
    return (
      <div className="space-y-4">
        {pres.summary && <p className="font-reading max-w-[68ch] text-[17px] leading-[1.65]">{pres.summary.slice(0, 600)}</p>}
        {topPicks.length > 0 && (
          <section aria-label="Top picks">
            <h3 className="mb-1 text-[14.5px] font-semibold">Top picks <span className="tnum font-mono text-[11px] font-normal text-[var(--ink-3)]">{topPicks.length}</span></h3>
            <ol className="m-0 list-none space-y-2.5 p-0">
              {topPicks.map((p, i) => (
                <li key={i} className="rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm">
                  <p className="tnum m-0 font-mono text-[11px] uppercase tracking-wider text-[var(--ink-3)]">Pick {i + 1}{typeof p.citations === "number" ? ` · Cited by ${fmtInt(p.citations)}` : ""}</p>
                  <h4 className="m-0 mt-1 text-[15.5px] font-semibold tracking-tight">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--ink)] no-underline hover:underline">{p.title.slice(0, 140)}</a>
                    ) : p.title.slice(0, 140)}
                  </h4>
                  {p.pick_reason && <p className="mt-1 max-w-[70ch] text-[14px] text-[var(--ink-2)]">{p.pick_reason.slice(0, 300)}</p>}
                  {p.url && (
                    <p className="m-0 mt-2">
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--ink)]">Read paper →</a>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
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
    const bookActions = (pres.actions || []).filter((a) => /^(book_flight|book_hotel|tickets)/.test(String(a.kind || "")));
    const topPlaces = (pres.top_places || []).slice(0, 5);
    return (
      <div className="space-y-4">
        <p className="text-[13.5px] text-[var(--ink-2)]">{pres.note || "Planned and ready. Booking happens on provider sites."}</p>
        {(pres.itinerary || []).length > 0 && (
          <section aria-label="Day by day itinerary">
            <h3 className="mb-1 text-[14.5px] font-semibold">Day by day</h3>
            <ol className="m-0 list-none space-y-2.5 p-0">
              {(pres.itinerary || []).map((d, i) => (
                <li key={i} className="rounded-[12px] border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm">
                  <p className="tnum m-0 font-mono text-[11px] uppercase tracking-wider text-[var(--ink-3)]">{d.day.slice(0, 40)}</p>
                  <h4 className="m-0 mt-0.5 text-[15px] font-semibold tracking-tight">{d.title.slice(0, 120)}</h4>
                  <ul className="m-2 list-none space-y-1 p-0 text-[14px]">
                    {(d.items || []).map((it, j) => (
                      <li key={j} className="text-[var(--ink-2)]">
                        {it.url ? (
                          <a href={it.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-[var(--ink)]">{it.name.slice(0, 100)}</a>
                        ) : <strong className="font-semibold text-[var(--ink)]">{it.name.slice(0, 100)}</strong>}
                        {it.note && <span> — {it.note.slice(0, 160)}</span>}
                      </li>
                    ))}
                  </ul>
                  {d.note && <p className="m-0 mt-1 text-[13.5px] text-[var(--ink-2)]">{d.note.slice(0, 240)}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}
        {topPlaces.length > 0 && (
          <section aria-label="Top places">
            <h3 className="mb-1 text-[14.5px] font-semibold">Top places <span className="tnum font-mono text-[11px] font-normal text-[var(--ink-3)]">{topPlaces.length}</span></h3>
            <ol className="m-0 space-y-1.5 pl-5 text-[14.5px]">
              {topPlaces.map((pl, i) => (
                <li key={i}>
                  {pl.url ? (
                    <a href={pl.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold">{pl.name.slice(0, 100)}</a>
                  ) : <strong>{pl.name.slice(0, 100)}</strong>}
                  {pl.why && <span className="text-[var(--ink-2)]"> — {pl.why.slice(0, 200)}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}
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
        {bookActions.length > 0 && (
          <div className="flex flex-wrap items-center gap-3" aria-label="Book">
            {bookActions.map((a) => (
              <ActionButton key={a.id} action={a} compact />
            ))}
          </div>
        )}
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
  const all = ((pres.jobs || pres.places || pres.results || []) as ApiResult[]).filter((r) => !dismissed.has(key(r)));
  const list = all.filter((r) => !filterVertical || String(r._engine || "") === filterVertical || detectKind(r) === filterVertical);
  if (!list.length) {
    return <EmptyResults query={query || ""} onWiden={onWiden || (() => {})} />;
  }
  return (
    <section aria-label="Results">
      <div className="grid gap-0">
        {list.slice(0, 10).map((r, i) => {
          const kind = detectKind(r);
          const flash = flashCls(r);
          const inner = kind === "job" ? (
            <JobRow r={r} index={i}
              onSelect={(rr, _ii, on) => onSelect(rr, `g-${i}`, on)}
              onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.application_url || r.url })} />
          ) : kind === "product" ? (
            <ProductTile r={r} index={i}
              onSelect={(rr, _ii, on) => onSelect(rr, `g-${i}`, on)}
              onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
          ) : kind === "paper" ? (
            <PaperEntry r={r} index={i}
              onSelect={(rr, _ii, on) => onSelect(rr, `g-${i}`, on)}
              onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
          ) : kind === "video" ? (
            <VideoCard r={r} />
          ) : (
            <PageRow r={r} index={i} onDismiss={() => onDismiss(r)} onSave={() => onSave({ title: r.title, url: r.url })} />
          );
          return <div key={i} className={flash}>{inner}</div>;
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
