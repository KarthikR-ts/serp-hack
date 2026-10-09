/* Serp Intelligence — Research Desk controller.
   XSS-safe: API data rendered via textContent only. URLs validated. */
(function () {
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const input = $("#composerInput"), sendBtn = $("#sendBtn"), agentBtn = $("#agentBtn"),
  stopBtn = $("#stopBtn"), deepBtn = $("#deepBtn"), thread = $("#thread"),
  statusLine = $("#statusLine"), srStatus = $("#srStatus"), toastEl = $("#toast"),
  statusPill = $("#statusPill"), statusPillText = $("#statusPillText"), statusDot = $("#statusDot"),
  srcList = $("#sources"), srcCount = $("#srcCount"), srcHint = $("#srcHint"),
  stepsPane = $("#stepsPane"), detailPane = $("#detailPane"),
  tray = $("#tray"), trayCount = $("#trayCount"), trayItems = $("#trayItems"),
  filterRow = $("#filterRow"), likeRoute = $("#likeRoute"), likeChips = $("#likeChips"),
  dock = $("#dock"), dockInput = $("#dockInput"), hero = $("#hero"),
  charCount = $("#charCount");

let mode = "auto", deep = false, aborter = null, running = false;
let selected = new Map(), lastQuery = "", lastKind = "agent", activeFilters = {};
let runSeq = 0, threadItems = [];

/* ---------- utilities ---------- */
function say(m) { toastEl.textContent = m; toastEl.classList.add("show"); clearTimeout(say.t); say.t = setTimeout(() => toastEl.classList.remove("show"), 2600); }
function announce(m) { srStatus.textContent = ""; setTimeout(() => { srStatus.textContent = m; }, 60); }
function setPill(state, text) {
  statusPillText.textContent = text;
  statusPill.classList.toggle("is-busy", state === "busy");
  statusPill.classList.toggle("is-error", state === "error");
}
function el(tag, text, cls) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function fmtN(n) { try { return new Intl.NumberFormat(undefined).format(n); } catch { return String(n); } }
function timeNow() { try { return new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date()); } catch { return ""; } }
function safeHttp(u) { try { const x = new URL(String(u), location.origin); return (x.protocol === "https:" || x.protocol === "http:") ? x.href : null; } catch { return null; } }
function safeImg(u) { try { const x = new URL(String(u), location.origin); return x.protocol === "https:" ? x.href : null; } catch { return null; } }
function esc(s) { return String(s == null ? "" : s); }
$("#heroTime").textContent = timeNow();

/* ---------- theme ---------- */
const root = document.documentElement;
try { const s = localStorage.getItem("serp_theme"); if (s) root.dataset.theme = s; } catch {}
$("#themeBtn").addEventListener("click", () => {
  const cur = root.dataset.theme || "dark";
  const next = cur === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("serp_theme", next); } catch {}
  say("Theme: " + next);
});

/* ---------- rail / inspector toggles ---------- */
const shell = $(".shell"), rail = $("#rail"), inspector = $("#inspector");
$("#railToggle").addEventListener("click", () => {
  if (window.innerWidth < 1024) { rail.classList.toggle("open"); return; }
  shell.classList.toggle("rail-hidden");
});
$("#inspectorBtn").addEventListener("click", () => {
  if (window.innerWidth < 1024) { inspector.classList.toggle("open"); return; }
  shell.classList.toggle("insp-hidden");
});
$$(".insp-tab").forEach(t => t.addEventListener("click", () => {
  $$(".insp-tab").forEach(x => { x.classList.toggle("is-on", x === t); x.setAttribute("aria-selected", String(x === t)); });
  $$(".insp-pane").forEach(p => p.classList.toggle("is-on", p.dataset.pane === t.dataset.tab));
  if (window.innerWidth < 1024) inspector.classList.add("open");
}));

/* ---------- mode segmented ---------- */
$("#modeSeg").addEventListener("click", (e) => {
  const b = e.target.closest(".modeseg-btn"); if (!b) return;
  mode = b.dataset.mode;
  $$(".modeseg-btn").forEach(x => { const on = x === b; x.classList.toggle("is-on", on); x.setAttribute("aria-checked", String(on)); });
  previewRoute();
});
deepBtn.addEventListener("click", () => {
  deep = !deep;
  deepBtn.setAttribute("aria-pressed", String(deep));
});

/* ---------- composer behaviors ---------- */
function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(220, input.scrollHeight) + "px"; }
input.addEventListener("input", () => {
  autoGrow();
  const n = input.value.length;
  charCount.textContent = n > 1500 ? (n + " / 2000") : "";
  previewRoute();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(input.value, {}); }
});
sendBtn.addEventListener("click", () => run(input.value, { kind: "chat" }));
agentBtn.addEventListener("click", () => run(input.value, { kind: "agent" }));
stopBtn.addEventListener("click", () => { if (aborter) aborter.abort(); });
dockInput.addEventListener("keydown", (e) => { if (e.key === "Enter") run(dockInput.value, { followup: true }); });
$("#dockSend").addEventListener("click", () => run(dockInput.value, { followup: true }));
$$("#goals .goal").forEach(g => g.addEventListener("click", () => {
  input.value = g.dataset.t; input.focus(); autoGrow();
  const i = input.value.indexOf("___");
  if (i >= 0) input.setSelectionRange(i, i + 3);
  previewRoute();
}));

/* Likely route preview: client heuristics only, zero API cost */
const ROUTE_HINTS = [
  { k: ["buy", "price", "laptop", "vs", "compare", "under", "₹", "best"], chips: [["Products", "commerce"], ["Web", "web"], ["Discussions", "web"]] },
  { k: ["job", "intern", "hiring", "salary", "role"], chips: [["Job listings", "career"], ["Web", "web"]] },
  { k: ["paper", "research", "study", "arxiv", "scholar", "worth learning", "diffusion", "crispr"], chips: [["Papers", "research"], ["Web", "web"], ["News", "live"]] },
  { k: ["news", "recent", "changed", "trend", "election", "market"], chips: [["News", "live"], ["Search interest", "live"], ["Web", "web"]] },
  { k: ["flight", "hotel", "trip", "travel", "itinerary", "places"], chips: [["Flights", "place"], ["Hotels", "place"], ["Places", "place"]] },
  { k: ["learn", "course", "tutorial", "teach", "plan"], chips: [["Web", "web"], ["Videos", "web"], ["Papers", "research"]] },
];
let previewT = null;
function previewRoute() {
  clearTimeout(previewT);
  previewT = setTimeout(() => {
    const v = input.value.trim().toLowerCase();
    if (v.length < 12) { likeRoute.hidden = true; return; }
    let chips = [["Web", "web"], ["News", "live"]];
    for (const h of ROUTE_HINTS) { if (h.k.some(k => v.includes(k))) { chips = h.chips; break; } }
    likeChips.textContent = "";
    chips.forEach(([label, fam]) => {
      const c = el("span", null, "lr-chip");
      const dot = el("i", null, null); dot.style.background = "var(--fam-" + fam + ")";
      c.append(dot, document.createTextNode(label)); likeChips.appendChild(c);
    });
    likeRoute.hidden = false;
  }, 450);
}

/* ---------- rail data ---------- */
function getHist() { try { return JSON.parse(sessionStorage.getItem("serp_hist") || "[]"); } catch { return []; } }
function getSaved() { try { return JSON.parse(localStorage.getItem("serp_saved") || "[]"); } catch { return []; } }
function renderRail(filter) {
  const convs = $("#convs"); convs.textContent = "";
  const hist = getHist().filter(h => !filter || String(h.q).toLowerCase().includes(filter.toLowerCase()));
  if (!hist.length) convs.appendChild(el("p", filter ? "No matches." : "Nothing yet. Ask above.", "rail-empty"));
  hist.slice(0, 9).forEach((h, idx) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "rail-item" + (idx === 0 ? " is-active" : ""); b.setAttribute("role", "listitem");
    const d = el("span", null, "ri-dot"); d.style.background = h.kind === "agent" ? "var(--live)" : "var(--fam-web)";
    b.append(d, el("span", String(h.q).slice(0, 52), "ri-t"));
    b.addEventListener("click", () => { input.value = h.q; run(h.q, { kind: h.kind || "chat" }); if (window.innerWidth < 1024) rail.classList.remove("open"); });
    convs.appendChild(b);
  });
  const box = $("#saved"); box.textContent = "";
  const saved = getSaved();
  $("#savedCount").textContent = saved.length ? "(" + saved.length + ")" : "";
  if (!saved.length) box.appendChild(el("p", "Nothing saved yet.", "rail-empty"));
  saved.slice(0, 20).forEach(s => {
    const b = document.createElement("button"); b.type = "button"; b.className = "rail-item"; b.setAttribute("role", "listitem");
    const d = el("span", null, "ri-dot"); d.style.background = "var(--fam-commerce)";
    b.append(d, el("span", String(s.title || s.query || "saved").slice(0, 52), "ri-t"));
    b.addEventListener("click", () => { if (s.query) { input.value = s.query; run(s.query, { kind: "chat" }); } else if (s.url && safeHttp(s.url)) window.open(s.url, "_blank", "noopener"); });
    box.appendChild(b);
  });
  renderRecent();
}
$("#railFilter").addEventListener("input", (e) => renderRail(e.target.value));
$("#newBtn").addEventListener("click", () => {
  input.value = ""; dockInput.value = ""; thread.textContent = "";
  threadItems = []; selected.clear(); renderTray();
  srcList.textContent = ""; srcCount.textContent = "0";
  stepsPane.innerHTML = "<p class='insp-hint'>The plan, funnel and filter reasons appear here during a run.</p>";
  detailPane.innerHTML = "<p class='insp-hint'>Budget, confidence and run metadata appear here.</p>";
  setPill("idle", "Ready"); statusLine.textContent = "";
  dock.hidden = true; hero.style.display = ""; input.focus(); autoGrow();
  renderRail($("#railFilter").value);
});
function pushHist(q2, kind) {
  const h = getHist(); h.unshift({ q: q2, kind, at: Date.now() });
  try { sessionStorage.setItem("serp_hist", JSON.stringify(h.slice(0, 24))); } catch {}
  renderRail($("#railFilter").value);
}
function saveItem(item) {
  const s = getSaved(); s.unshift(Object.assign({ at: new Date().toISOString() }, item));
  try { localStorage.setItem("serp_saved", JSON.stringify(s.slice(0, 60))); } catch {}
  renderRail($("#railFilter").value); say("Saved to this device");
}
function renderRecent() {
  const box = $("#recentRow"); box.textContent = "";
  const hist = getHist();
  if (!hist.length) {
    box.appendChild(el("span", "Try:", "recent-label"));
    ["Find three good laptops under ₹80,000 for machine learning", "Software internships in Bengaluru this summer", "Teach me CRISPR from basics to papers"].forEach(t => {
      const b = el("button", t, "sug"); b.type = "button";
      b.addEventListener("click", () => { input.value = t; run(t, { kind: "agent" }); });
      box.appendChild(b);
    });
    return;
  }
  box.appendChild(el("span", "Recent:", "recent-label"));
  hist.slice(0, 3).forEach(h => {
    const b = el("button", String(h.q).slice(0, 46), "sug"); b.type = "button";
    b.addEventListener("click", () => { input.value = h.q; run(h.q, { kind: h.kind || "chat" }); });
    box.appendChild(b);
  });
}
fetch("api/usage").then(r => r.ok ? r.json() : null).then(u => {
  if (!u) return;
  $("#opsQueries").textContent = fmtN(u.queries || 0);
  $("#opsCalls").textContent = fmtN(u.serpapi_calls || 0);
  $("#opsFailed").textContent = fmtN(u.failed_calls || 0);
  $("#usageChip").textContent = fmtN(u.serpapi_calls || 0) + " searches";
  const pct = Math.min(100, ((u.serpapi_calls || 0) % 200) / 2);
  $("#opsMeter").style.width = Math.max(6, pct) + "%";
}).catch(() => {});

/* ---------- run orchestration ---------- */
async function run(raw, opts) {
  opts = opts || {};
  const query = String(raw || (opts.followup ? dockInput.value : "")).trim().slice(0, 2000);
  if (!query) { (opts.followup ? dockInput : input).focus(); return say("Type a question first"); }
  if (running) return say("A run is active. Stop it first.");
  lastQuery = query; lastKind = opts.kind || (opts.followup ? lastKind : "chat");
  if (!opts.followup) activeFilters = opts.filters || {};
  running = true; runSeq++;
  const mySeq = runSeq;
  aborter = new AbortController();
  stopBtn.hidden = false; sendBtn.style.display = "none"; agentBtn.style.display = "none";
  setPill("busy", "Understanding…"); announce("Research started");
  hero.style.display = "none"; dock.hidden = false;
  if (opts.followup) dockInput.value = "";
  const runEl = mountRunShell(query);
  const laneApi = mountRouteSkeleton(runEl);
  try {
    if (lastKind === "agent") {
      statusLine.textContent = "Agent classifying intent and calling exact endpoints…";
      const r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, num_results: 8, filters: activeFilters }), signal: aborter.signal });
      if (mySeq !== runSeq) return;
      if (r.status === 503) { failRun(runEl, "LLM key missing. Set OPENROUTER_API_KEY in .env and restart."); return; }
      if (r.status === 429) { failRun(runEl, "Rate limited. Try again in a minute."); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      paintAgent(runEl, laneApi, await r.json(), query);
    } else {
      let plan = null;
      try {
        const pr = await fetch("api/intents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }), signal: aborter.signal });
        if (pr.ok) plan = await pr.json();
      } catch (e) { if (e && e.name === "AbortError") return stopped(runEl); }
      if (mySeq !== runSeq) return;
      if (plan && (plan.requires_confirmation || deep)) {
        laneApi.setStatus("Plan ready for review");
        const ok = await offerPlan(runEl, plan);
        if (!ok || mySeq !== runSeq) { cleanupRun(); setPill("idle", "Ready"); statusLine.textContent = ""; return; }
      }
      const streamed = await tryStream(runEl, laneApi, query, mySeq);
      if (mySeq !== runSeq) return;
      if (!streamed) {
        const r = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode, deep_research: deep, filters: activeFilters }), signal: aborter.signal });
        if (mySeq !== runSeq) return;
        if (r.status === 429) { failRun(runEl, "Rate limited. Try again in a minute."); return; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        paintChat(runEl, laneApi, await r.json(), query);
      }
    }
    pushHist(query, lastKind);
  } catch (e) {
    if (e && e.name === "AbortError") return stopped(runEl);
    failRun(runEl, "Request failed. Is the backend running?");
  } finally {
    if (mySeq === runSeq) cleanupRun();
  }
}
function cleanupRun() { running = false; stopBtn.hidden = true; sendBtn.style.display = ""; agentBtn.style.display = ""; }
function stopped(runEl) {
  cleanupRun(); setPill("idle", "Stopped"); announce("Research stopped");
  statusLine.textContent = "";
  const b = el("div", null, "banner warn"); b.append(el("p", "Stopped by you. Partial results above are kept."));
  runEl.appendChild(b);
}
function failRun(runEl, msg) {
  cleanupRun(); setPill("error", "Needs attention"); announce(msg);
  statusLine.textContent = "";
  const b = el("div", null, "banner bad");
  b.append(el("strong", "Search is not responding. "), el("span", "Nothing was fabricated. "));
  const row = el("div", null, "plan-row");
  const retry = el("button", "Retry", "btn sm"); retry.type = "button";
  retry.addEventListener("click", () => run(lastQuery, { kind: lastKind }));
  row.appendChild(retry); b.appendChild(row); runEl.appendChild(b);
}

/* ---------- run shell + skeletons ---------- */
function mountRunShell(query) {
  const art = el("article", null, "run");
  const q = el("div", null, "run-q");
  q.append(el("span", "✳", "run-avatar"));
  const qt = el("div", null, "run-qtext");
  qt.append(el("div", "You · " + timeNow(), "who"));
  qt.append(el("h2", query.length > 220 ? query.slice(0, 220) + "…" : query));
  const qm = el("div", null, "run-qmeta");
  qm.append(el("span", mode === "auto" ? "Auto" : mode[0].toUpperCase() + mode.slice(1), "pill"));
  if (deep) qm.append(el("span", "Deep research", "pill"));
  qm.append(el("span", lastKind === "agent" ? "Autonomous agent" : "Routed research", "pill"));
  qt.appendChild(qm); q.append(qt);
  art.appendChild(q);
  thread.prepend(art);
  art.scrollIntoView({ block: "start", behavior: "smooth" });
  threadItems.unshift({ query, node: art });
  return art;
}
function mountRouteSkeleton(runEl) {
  const route = el("section", null, "route"); route.setAttribute("aria-label", "Route");
  const head = el("div", null, "route-head");
  head.append(el("strong", "Route"));
  const meta = el("span", "Starting…", "rmeta"); head.appendChild(meta);
  const sp = el("span", null, "rspacer"); head.appendChild(sp);
  const toggle = el("button", "Details", "route-toggle"); toggle.type = "button";
  head.appendChild(toggle); route.appendChild(head);
  const lanes = el("div", null, "lanes"); route.appendChild(lanes);
  ["Web", "Papers", "News"].forEach(n => {
    const sk = el("div", null, "lane"); sk.dataset.status = "wait";
    sk.append(el("span", null, "lane-ico"), el("div", null, "lane-main"));
    lanes.appendChild(sk);
  });
  const foot = el("div", null, "route-foot");
  const bar = el("div", null, "budgetbar"); bar.appendChild(el("span", null, null));
  foot.append(bar, el("span", "preparing…", "rmeta"));
  route.appendChild(foot);
  const twin = el("ol", null, "routetwin"); route.appendChild(twin);
  toggle.addEventListener("click", () => { twin.classList.toggle("open"); toggle.textContent = twin.classList.contains("open") ? "Hide" : "Details"; });
  runEl.appendChild(route);
  return {
    node: route, lanes, meta, foot,
    setStatus(t) { meta.textContent = t; setPill("busy", t.length > 42 ? t.slice(0, 42) + "…" : t); },
    setBudget(used, limit, secs) {
      foot.lastChild.textContent = used + " of " + limit + " searches · " + secs + "s";
      bar.firstChild.style.width = Math.min(100, (used / Math.max(1, limit)) * 100) + "%";
    }
  };
}
function offerPlan(runEl, plan) {
  return new Promise((resolve) => {
    const box = el("div", null, "plan");
    box.append(el("h3", "Plan"));
    box.append(el("p", (plan.plan || []).length + " steps · about " + plan.estimated_calls + " searches · up to ~" + plan.estimated_seconds + "s", "meta"));
    const ol = document.createElement("ol");
    (plan.plan || []).forEach(s => { const li = document.createElement("li"); li.textContent = (s.tool || s.action || "search") + ": " + String(s.query || "").slice(0, 100); ol.appendChild(li); });
    box.appendChild(ol);
    const row = el("div", null, "plan-row");
    const start = el("button", "Start research", "btn solid"); start.type = "button";
    const cancel = el("button", "Cancel", "btn ghost"); cancel.type = "button";
    start.addEventListener("click", () => { box.remove(); resolve(true); });
    cancel.addEventListener("click", () => { box.remove(); resolve(false); });
    row.append(start, cancel); box.appendChild(row);
    runEl.appendChild(box); announce("Plan ready. Review and start research."); start.focus();
  });
}
async function tryStream(runEl, laneApi, query, mySeq) {
  try {
    const r = await fetch("api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ query, mode, deep_research: deep, filters: activeFilters }), signal: aborter.signal });
    if (!r.ok || !r.body) return false;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", events = 0;
    laneApi.setStatus("Searching relevant sources");
    statusLine.textContent = "Streaming plan and tool activity…";
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      if (mySeq !== runSeq) { try { reader.cancel(); } catch {} return true; }
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n"); buf = parts.pop();
      for (const p of parts) {
        const m = p.match(/event:\s*(\w+)\s*\ndata:\s*([\s\S]*)/); if (!m) continue;
        events++;
        try {
          const j = JSON.parse(m[2]);
          if (m[1] === "intent_detected") laneApi.setStatus("Understood as " + (j.intent || []).join(", "));
          else if (m[1] === "plan_created") laneApi.setStatus("Plan: " + (j.length || (j.plan || []).length || "?") + " steps");
          else if (m[1] === "tool_started") laneApi.setStatus("Searching " + (j.tool || "sources"));
          else if (m[1] === "synthesis_started") { laneApi.setStatus("Writing the answer"); statusLine.textContent = "Synthesizing evidence…"; }
        } catch {}
      }
    }
    if (!events) return false;
    const r2 = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode, deep_research: deep, filters: activeFilters }), signal: aborter.signal });
    if (!r2.ok || mySeq !== runSeq) return events > 0;
    paintChat(runEl, laneApi, await r2.json(), query);
    return true;
  } catch (e) { if (e && e.name === "AbortError") throw e; return false; }
}

/* ---------- shared painters ---------- */
const FAM_OF = (v) => {
  v = String(v || "").toLowerCase();
  if (/scholar|patent/.test(v)) return "research";
  if (/news|trend|finance/.test(v)) return "live";
  if (/job/.test(v)) return "career";
  if (/shop|ads/.test(v)) return "commerce";
  if (/map|flight|hotel|event|local/.test(v)) return "place";
  return "web";
};
const NAME_OF = (v) => {
  const m = { google_search: "Web", web_light: "Web", ai_overview: "Web summaries", forums: "Discussions", images: "Images", google_scholar: "Papers", patents: "Patents", google_news: "News", trends: "Search interest", finance: "Markets", google_jobs: "Job listings", google_shopping: "Products", ads: "Ads", maps: "Places", flights: "Flights", hotels: "Hotels", events: "Events", youtube: "Videos" };
  return m[v] || String(v || "Source").replace(/_/g, " ");
};
const GLYPH = { web: "⌕", research: "◈", live: "〜", career: "▤", commerce: "⬣", place: "◎" };

function paintRoute(laneApi, route, budget) {
  laneApi.lanes.textContent = "";
  (route || []).forEach(line => {
    const fam = line.family || FAM_OF(line.vertical);
    const lane = document.createElement("div"); lane.className = "lane"; lane.tabIndex = 0;
    lane.dataset.status = line.status === "ok" ? "done" : line.status === "running" ? "running" : line.status === "failed" ? "failed" : "wait";
    const ico = el("span", GLYPH[fam] || "•", "lane-ico"); ico.style.background = "var(--fam-" + fam + ")";
    const main = el("div", null, "lane-main");
    main.append(el("div", NAME_OF(line.vertical || line.name), "lane-name"));
    main.append(el("div", esc(line.query || line.name || ""), "lane-query"));
    const st = el("span", null, "lane-state");
    const dot = el("span", null, "st " + (line.status === "ok" ? "ok" : line.status === "failed" ? "fail" : line.status === "empty" ? "empty" : line.status === "running" ? "run" : "wait"));
    st.append(dot, document.createTextNode(line.status === "ok" ? (line.result_count + " found") : line.status === "failed" ? "Did not load" : line.status === "empty" ? "No results" : line.status || ""));
    lane.append(ico, main, st);
    lane.setAttribute("role", "button"); lane.setAttribute("aria-label", NAME_OF(line.vertical) + ": " + (line.status || ""));
    lane.addEventListener("click", () => filterByVertical(line.vertical));
    lane.addEventListener("keydown", (e) => { if (e.key === "Enter") filterByVertical(line.vertical); });
    laneApi.lanes.appendChild(lane);
  });
  const okN = (route || []).filter(l => l.status === "ok").length;
  const bad = (route || []).filter(l => l.status === "failed").length;
  laneApi.meta.textContent = okN + " of " + (route || []).length + " sources" + (bad ? " · " + bad + " did not load" : "");
  if (budget) laneApi.setBudget(budget.calls_used || 0, budget.calls_limit || 12, budget.seconds_used || 0);
  const twin = laneApi.node.querySelector(".routetwin"); twin.textContent = "";
  (route || []).forEach(l => { const li = document.createElement("li"); li.textContent = NAME_OF(l.vertical) + ": " + (l.status === "ok" ? l.result_count + " results" : l.status); twin.appendChild(li); });
  if (bad) twin.classList.add("open");
}
function filterByVertical(v) {
  $$("#thread .rcard, #thread .tile").forEach(n => { n.style.display = (!v || n.dataset.vertical === v) ? "" : "none"; });
  if (v) say("Filtered to " + NAME_OF(v) + ". Run again to clear.");
}
function paintSteps(data) {
  stepsPane.textContent = "";
  const dl = document.createElement("dl"); dl.className = "kv";
  const a = data.analysis || data.classification || {};
  const intents = a.intent || (a.use_case ? [a.use_case] : []) || data.legacy_intents || [];
  dl.append(dt("Understood as"), dd((intents.join(" · ") || "general").slice(0, 120)));
  if (a.entities && a.entities.length) dl.append(dt("Entities"), dd(a.entities.slice(0, 6).join(", ")));
  const f = data.funnel;
  if (f) dl.append(dt("Funnel"), dd(fmtN(f.discovered || 0) + " found · " + fmtN(f.matched || 0) + " matched · " + fmtN(f.set_aside || 0) + " set aside"));
  if (f && f.reasons && f.reasons.length) dl.append(dt("Set aside"), dd(f.reasons.map(r => r.label + " (" + r.count + ")").join(", ")));
  const searches = (a.steps || data.plan || []).filter(s => s.tool || s.engine);
  if (searches.length) dl.append(dt("Searches"), dd(searches.slice(0, 6).map(s => (s.tool || s.engine) + ": " + String(s.query || "").slice(0, 60)).join("  ·  ")));
  stepsPane.appendChild(dl);
  function dt(t) { return el("dt", t); } function dd(t) { return el("dd", t); }
}
function paintDetail(data) {
  detailPane.textContent = "";
  const dl = document.createElement("dl"); dl.className = "kv";
  const b = data.budget || {};
  if (b.calls_limit) dl.append(el("dt", "Budget"), el("dd", (b.calls_used || 0) + " of " + b.calls_limit + " searches · " + (b.seconds_used || 0) + "s"));
  const c = data.confidence;
  if (c) dl.append(el("dt", "Confidence"), el("dd", typeof c === "object" ? c.level + ". " + (c.reasons || []).join("; ") : String(c)));
  const comp = data.completeness;
  if (comp) dl.append(el("dt", "Coverage"), el("dd", comp.message || comp.state));
  dl.append(el("dt", "Model"), el("dd", data.model || (lastKind === "agent" ? "agent" : "routed")));
  detailPane.appendChild(dl);
}
function paintVerdict(runEl, data) {
  const v = el("div", null, "verdict");
  v.append(el("div", "✳ Answer", "verdict-kicker"));
  if (data.summary) v.append(el("p", String(data.summary).slice(0, 900), "verdict-text"));
  const c = data.confidence;
  if (c) {
    const row = el("div", null, "confline");
    const lvl = typeof c === "object" ? c.level : String(c);
    const segs = el("span", null, "confsegs"); segs.dataset.lvl = /high/i.test(lvl) ? "high" : /low/i.test(lvl) ? "low" : "medium";
    segs.append(el("i", null, null), el("i", null, null), el("i", null, null));
    row.append(segs, el("span", "Confidence: " + lvl, "confword"));
    if (typeof c === "object" && c.reasons && c.reasons.length) row.append(el("span", c.reasons.join("; ").slice(0, 220), "confreason"));
    v.appendChild(row);
  }
  runEl.appendChild(v);
  const comp = data.completeness;
  if (comp && comp.message) {
    const p = el("div", comp.message.slice(0, 300), "completeness" + (comp.state === "partial" || comp.state === "limit_reached" ? " warn" : comp.state === "failed" ? " bad" : ""));
    if (comp.state === "partial") {
      const retry = el("button", "Retry", "btn sm"); retry.type = "button";
      retry.addEventListener("click", () => run(lastQuery, { kind: lastKind }));
      p.appendChild(retry);
    }
    runEl.appendChild(p);
  }
  const intents = ((data.analysis || {}).intent || data.legacy_intents || []).join(" ");
  if (/FINANCE/.test(intents) || (data.presentation || {}).type === "finance_snapshot") {
    const n = el("p", "Information only, not financial advice.", "finance-note"); runEl.appendChild(n);
  }
}
function paintMargin(sources) {
  srcList.textContent = "";
  (sources || []).forEach(s => {
    const li = document.createElement("li"); if (s.id) li.dataset.eid = s.id;
    li.appendChild(el("strong", String(s.title || s.url || "source").slice(0, 100)));
    li.appendChild(el("div", ((s.domain || "") + (s.date ? " · " + s.date : "")).slice(0, 90), "srcdom"));
    if (s.claim) li.appendChild(el("div", String(s.claim).slice(0, 200), "srcclaim"));
    const row = el("div", null, "srcrow");
    if (s.type) row.appendChild(el("span", s.type, "srctype"));
    if (safeHttp(s.url)) {
      const a = document.createElement("a"); a.href = s.url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.className = "extlink"; a.textContent = "Open source";
      row.appendChild(a);
    }
    const show = el("button", "Show", "btn sm"); show.type = "button";
    show.addEventListener("click", () => flashResults(s.id));
    row.appendChild(show);
    li.appendChild(row);
    li.addEventListener("mouseenter", () => flashResults(s.id, true));
    li.addEventListener("mouseleave", unflash);
    srcList.appendChild(li);
  });
  srcCount.textContent = String((sources || []).length);
  srcHint.style.display = (sources || []).length ? "none" : "";
}
function flashResults(eid, soft) {
  if (!eid) return;
  $$("#thread .rcard, #thread .tile").forEach(n => {
    const has = (n.dataset.eids || "").split(" ").includes(eid);
    n.classList.toggle("flash", has);
    if (!soft && has) n.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  $$("#sources li").forEach(li => li.classList.toggle("flash", li.dataset.eid === eid));
}
function unflash() { $$(".flash").forEach(n => n.classList.remove("flash")); }

/* ---------- result components ---------- */
function outbound(r) {
  const url = safeHttp(r.url || r.application_url || r.link);
  if (!url) return null;
  const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.className = "extlink";
  if (r.company || r.salary || r.application_url) a.textContent = "Open application ↗";
  else if (r.price && r.seller) a.textContent = "View on site ↗";
  else if (r.authors) a.textContent = "Read paper ↗";
  else if (r.length || r.channel) a.textContent = "Watch ↗";
  else a.textContent = "Open ↗";
  return a;
}
function whyBlock(r) {
  if (!r.why || !r.why.length) return null;
  const d = document.createElement("details"); d.className = "why";
  d.appendChild(el("summary", "Why this result?"));
  const ul = document.createElement("ul");
  r.why.forEach(w => { const li = document.createElement("li"); li.dataset.met = String(!!w.met); li.textContent = w.text; ul.appendChild(li); });
  d.appendChild(ul); return d;
}
function selectLine(r, i) {
  const lab = el("label", null, "checkline");
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.setAttribute("aria-label", "Select for compare");
  cb.addEventListener("change", () => {
    if (cb.checked) { if (selected.size >= 4) { cb.checked = false; return say("Compare holds 4 at most"); } selected.set(i + ":" + (r.title || r.name || i), r); }
    else { const k = Array.from(selected.keys()).find(k => selected.get(k) === r); if (k) selected.delete(k); }
    renderTray();
  });
  lab.append(cb, document.createTextNode("Compare"));
  return lab;
}
function kindTag(k, fam) {
  const t = el("span", k, "kindtag");
  const dot = el("i", null, null); dot.style.background = "var(--fam-" + fam + ")";
  t.prepend(dot); return t;
}
function detectKind(r) {
  if (r.company || r.salary || r.application_url) return "job";
  if (r.price && (r.seller || r.reviews != null || r.image)) return "product";
  if (r.authors || r.abstract) return "paper";
  if (r.length || (r.channel && r.thumbnail)) return "video";
  if (r.symbol || r.stock_name) return "finance";
  if (r.source && r.date) return "news";
  if (r.address || (r.rating != null && !r.price)) return "place";
  return "page";
}
function jobCard(r, i) {
  const c = el("article", null, "rcard"); c.dataset.vertical = "google_jobs";
  if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
  c.appendChild(kindTag("Job", "career"));
  c.appendChild(el("h3", String(r.title || "Role").slice(0, 110)));
  c.appendChild(el("div", [r.company, r.location, r.employment_type].filter(Boolean).join(" · ").slice(0, 120) || "Listing", "rmeta"));
  const meta = el("div", null, "rmeta");
  meta.append(el("span", null, null));
  meta.lastChild.append(el("b", "Pay: "), document.createTextNode(r.salary ? String(r.salary).slice(0, 60) + " (listed)" : "not listed"));
  if (r.posted_at) { const s = el("span", null, null); s.append(el("b", "Posted: "), document.createTextNode(String(r.posted_at).slice(0, 30))); meta.appendChild(s); }
  if (r.source) { const s = el("span", null, null); s.append(el("b", "Via: "), document.createTextNode(String(r.source).slice(0, 40))); meta.appendChild(s); }
  c.appendChild(meta);
  if (r.description) c.appendChild(el("p", String(r.description).slice(0, 260), "rdesc"));
  const acts = el("div", null, "ractions");
  const o = outbound(r); if (o) acts.appendChild(o);
  acts.append(selectLine(r, i));
  const sv = el("button", "Save", "btn sm"); sv.type = "button"; sv.addEventListener("click", () => saveItem({ title: r.title, url: r.application_url || r.url, query: lastQuery }));
  acts.appendChild(sv); c.appendChild(acts);
  const w = whyBlock(r); if (w) c.appendChild(w);
  return c;
}
function productTile(r, i, featured) {
  const c = el("article", null, "tile" + (featured ? " featured" : "")); c.dataset.vertical = "google_shopping";
  if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
  const url = safeHttp(r.url), imgSrc = r.image ? safeImg(r.image) : null;
  if (url && imgSrc) {
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.className = "thumb"; a.setAttribute("aria-label", "View on site");
    const img = document.createElement("img"); img.src = imgSrc; img.alt = String(r.title || "product").slice(0, 100); img.loading = "lazy"; img.width = 480; img.height = 360;
    a.appendChild(img); c.appendChild(a);
  }
  const body = el("div", null, "tile-body");
  if (featured) body.appendChild(el("span", "Top pick", "recflag"));
  body.appendChild(el("h3", String(r.title || "Product").slice(0, 100)));
  if (r.price) body.appendChild(el("div", String(r.price).slice(0, 60), "price"));
  if (r.rating != null) body.appendChild(el("div", "★ " + r.rating + (r.reviews ? " (" + fmtN(r.reviews) + ")" : ""), "rate"));
  if (r.seller) body.appendChild(el("div", String(r.seller).slice(0, 60), "rate"));
  const acts = el("div", null, "ractions");
  const o = outbound(r); if (o) acts.appendChild(o);
  acts.appendChild(selectLine(r, i));
  body.appendChild(acts);
  const w = whyBlock(r); if (w) body.appendChild(w);
  c.appendChild(body);
  return c;
}
function paperCard(r, i) {
  const c = el("article", null, "rcard"); c.dataset.vertical = "google_scholar";
  if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
  c.appendChild(kindTag("Paper", "research"));
  c.appendChild(el("h3", String(r.title || "Paper").slice(0, 130)));
  c.appendChild(el("div", [String(r.authors || "").slice(0, 100), r.publication_date].filter(Boolean).join(" · "), "rmeta"));
  if (r.abstract || r.snippet) c.appendChild(el("p", String(r.abstract || r.snippet).slice(0, 280), "rdesc"));
  const acts = el("div", null, "ractions");
  const o = outbound(r); if (o) acts.appendChild(o);
  acts.appendChild(selectLine(r, i));
  c.appendChild(acts);
  const w = whyBlock(r); if (w) c.appendChild(w);
  return c;
}
function pageCard(r, i) {
  const c = el("article", null, "rcard"); c.dataset.vertical = r._engine || "google_search";
  if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
  c.appendChild(kindTag(detectKind(r), FAM_OF(r._engine)));
  const h = el("h3", null, null);
  const url = safeHttp(r.url || r.link);
  if (url) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.textContent = String(r.title || url).slice(0, 110); h.appendChild(a); }
  else h.textContent = String(r.title || "Result").slice(0, 110);
  c.appendChild(h);
  c.appendChild(el("div", [r.source, r.date].filter(Boolean).join(" · ").slice(0, 100), "rmeta"));
  if (r.snippet || r.description) c.appendChild(el("p", String(r.snippet || r.description).slice(0, 260), "rdesc"));
  const w = whyBlock(r); if (w) c.appendChild(w);
  return c;
}
function videoCard(r) {
  const c = el("article", null, "tile"); c.dataset.vertical = "youtube";
  if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
  const url = safeHttp(r.url), imgSrc = r.thumbnail ? safeImg(r.thumbnail) : null;
  if (url && imgSrc) {
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.className = "thumb";
    const img = document.createElement("img"); img.src = imgSrc; img.alt = String(r.title || "video").slice(0, 100); img.loading = "lazy"; img.width = 480; img.height = 360;
    a.appendChild(img); c.appendChild(a);
  }
  const body = el("div", null, "tile-body");
  body.appendChild(el("h3", String(r.title || "Video").slice(0, 100)));
  body.appendChild(el("div", [r.channel, r.length].filter(Boolean).join(" · ").slice(0, 80), "rate"));
  const acts = el("div", null, "ractions");
  if (url) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.className = "extlink"; a.textContent = "Watch ↗"; acts.appendChild(a); }
  body.appendChild(acts); c.appendChild(body);
  return c;
}
function renderResult(r, i, featured) {
  const k = detectKind(r);
  const wrap = el("div", null, null);
  const node = k === "job" ? jobCard(r, i) : k === "product" ? productTile(r, i, featured) : k === "paper" ? paperCard(r, i) : k === "video" ? videoCard(r) : pageCard(r, i);
  wrap.appendChild(node); return node;
}

/* ---------- chat + agent paint ---------- */
function paintChat(runEl, laneApi, data, query) {
  selected.clear(); renderTray();
  renderFilters(data.constraints);
  paintRoute(laneApi, data.route, data.budget);
  paintSteps(data); paintDetail(data);
  paintVerdict(runEl, data);
  const intents = ((data.analysis || {}).intent || []).join(" ");
  const leadResults = /SHOPPING|JOB_SEARCH|LOCAL_DISCOVERY|EVENTS|TRAVEL/.test(intents);
  const secs = el("div", null, "sections");
  const list = data.results || [];
  if (!list.length) {
    const e = el("div", null, "emptyrun");
    e.append(el("h3", "No matches under these constraints"));
    e.append(el("p", "Loosen a filter or widen the search. Nothing was hidden."));
    const row = el("div", null, "plan-row");
    ["Remove a filter", "Search wider"].forEach(t => { const b = el("button", t, "btn sm"); b.type = "button"; b.addEventListener("click", () => run(query + " wider", { kind: "chat" })); row.appendChild(b); });
    e.appendChild(row); secs.appendChild(e);
  } else {
    const hrow = el("div", null, "sech"); hrow.append(el("span", leadResults ? "Results" : "Sources found"), el("span", String(list.length).slice(0, 8), "count"));
    secs.appendChild(hrow);
    const cards = el("div", null, leadResults && /SHOPPING/.test(intents) ? "tilegrid" : "cards");
    list.slice(0, 10).forEach((r, i) => cards.appendChild(renderResult(r, i, leadResults && i === 0)));
    secs.appendChild(cards);
    if (list.length > 10) {
      const more = el("button", "Show " + (list.length - 10) + " more", "btn sm"); more.type = "button";
      more.addEventListener("click", () => { list.slice(10, 30).forEach((r, i) => cards.appendChild(renderResult(r, i + 10, false))); more.remove(); });
      secs.appendChild(more);
    }
  }
  runEl.appendChild(secs);
  paintRefine(runEl, data.refinements, query);
  paintMargin(data.sources);
  setPill("idle", "Done · " + (data.results_count || list.length) + " results");
  statusLine.textContent = fmtN(data.results_count || list.length) + " results · " + fmtN((data.funnel || {}).set_aside || 0) + " set aside";
  announce("Answer ready. " + (data.results_count || list.length) + " results.");
}
function paintAgent(runEl, laneApi, data, query) {
  selected.clear(); renderTray();
  renderFilters(data.constraints);
  if (data.route) paintRoute(laneApi, data.route, data.budget);
  else { laneApi.lanes.textContent = ""; laneApi.meta.textContent = "Agent synthesis"; }
  paintSteps(data); paintDetail(data);
  if (data.status === "clarify") {
    const b = el("div", null, "banner info");
    b.append(el("strong", "One quick question: "), el("span", String(data.clarifying_question || "Could you add detail?").slice(0, 240)));
    const row = el("div", null, "plan-row");
    const skip = el("button", "Skip, use best guess", "btn sm"); skip.type = "button";
    skip.addEventListener("click", () => run(query, { kind: "chat" }));
    row.appendChild(skip); b.appendChild(row); runEl.appendChild(b);
    setPill("idle", "Needs input"); input.focus(); return;
  }
  paintVerdict(runEl, data);
  const secs = el("div", null, "sections");
  const p = data.presentation || { type: "generic", results: [] };
  const addH = (t, n) => { const h = el("div", null, "sech"); h.append(el("span", t), el("span", String(n), "count")); secs.appendChild(h); };
  if (p.type === "shopping_top2") {
    addH("Top picks", (p.picks || []).length);
    const g = el("div", null, "tilegrid");
    (p.picks || []).slice(0, 4).forEach((item, i) => g.appendChild(productTile(Object.assign({ _engine: "google_shopping" }, item), i, i === 0)));
    secs.appendChild(g);
  } else if (p.type === "youtube_path") {
    [["beginner", "Start here"], ["intermediate", "Go deeper"], ["advanced", "Master it"]].forEach(([lvl, label]) => {
      const vids = ((p.levels || {})[lvl]) || [];
      if (!vids.length) return;
      addH(label, vids.length);
      const g = el("div", null, "tilegrid"); vids.forEach(v => g.appendChild(videoCard(v))); secs.appendChild(g);
    });
  } else if (p.type === "finance_snapshot") {
    const qd = p.quote || {};
    addH("Snapshot", 1);
    const c = el("article", null, "rcard");
    c.appendChild(kindTag("Markets", "live"));
    c.appendChild(el("h3", String(qd.stock_name || qd.symbol || "Quote").slice(0, 100)));
    c.appendChild(el("div", [["Price", qd.price], ["Change", [qd.price_change, qd.percent_change].filter(Boolean).join(" ")], ["Exchange", qd.exchange]].filter(x => x[1]).map(x => x[0] + ": " + x[1]).join(" · ").slice(0, 160), "rmeta"));
    if (qd.summary) c.appendChild(el("p", String(qd.summary).slice(0, 260), "rdesc"));
    secs.appendChild(c);
    if ((p.headlines || []).length) {
      addH("Headlines", p.headlines.length);
      p.headlines.forEach(h => secs.appendChild(pageCard({ title: h.title, url: h.url, date: h.date, source: h.source || "News" }, 0)));
    }
    if (p.disclaimer) secs.appendChild(el("p", String(p.disclaimer).slice(0, 200), "rmeta"));
  } else if (p.type === "deep_dive") {
    if (p.summary) secs.appendChild(el("p", String(p.summary).slice(0, 600), "narrative"));
    if ((p.findings || []).length) {
      addH("Key findings", p.findings.length);
      const ol = document.createElement("ol");
      p.findings.forEach(f => {
        const li = document.createElement("li"); li.textContent = String(f.claim || f.title || "").slice(0, 260);
        const url = safeHttp(f.url);
        if (url) { li.appendChild(document.createTextNode(" ")); const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.textContent = "source"; li.appendChild(a); }
        ol.appendChild(li);
      });
      secs.appendChild(ol);
    }
    if ((p.papers || []).length) { addH("Papers", p.papers.length); p.papers.forEach((r, i) => secs.appendChild(paperCard(r, i))); }
  } else if (p.type === "travel_choices") {
    secs.appendChild(el("p", "Planned and ready. Booking happens on provider sites.", "rmeta"));
    [["Flights", p.flights], ["Hotels", p.hotels], ["Places", p.places]].forEach(([label, list]) => {
      if (!list || !list.length) return;
      addH(label, list.length);
      list.forEach((r, i) => secs.appendChild(renderResult(r, i, false)));
    });
  } else if (p.type === "learning_plan") {
    if (p.goal) secs.appendChild(el("p", String(p.goal).slice(0, 400), "narrative"));
    addH("Learning path", (p.stages || []).length + " stages");
    const ol = el("ol", null, "learnrail");
    (p.stages || []).forEach(s => {
      const li = document.createElement("li");
      li.appendChild(el("span", null, "node"));
      li.appendChild(el("strong", (s.stage || "Stage") + "  "));
      (s.topics || []).forEach(t => {
        li.appendChild(document.createTextNode(" · "));
        const url = safeHttp(t.url);
        if (url) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.textContent = String(t.title || url).slice(0, 70); li.appendChild(a); }
        else li.appendChild(el("span", String(t.title || "").slice(0, 70)));
      });
      ol.appendChild(li);
    });
    secs.appendChild(ol);
  } else {
    const list = p.jobs || p.places || p.results || [];
    addH("Results", list.length);
    const cards = el("div", null, "cards");
    list.slice(0, 10).forEach((r, i) => cards.appendChild(renderResult(r, i, false)));
    secs.appendChild(cards);
  }
  runEl.appendChild(secs);
  paintRefine(runEl, data.refinements, query);
  paintMargin(data.sources);
  setPill("idle", "Done · agent");
  statusLine.textContent = fmtN(data.results_count || 0) + " results · model " + (data.model || "agent");
  announce("Answer ready.");
}

/* ---------- filters + refine ---------- */
const FILTER_LABELS = { budget: "Budget", currency: "Currency", min_rating: "Min rating", rating: "Min rating", location: "Location", remote: "Remote", salary_min: "Min pay", min_salary: "Min pay" };
function renderFilters(constraints) {
  filterRow.textContent = ""; filterRow.hidden = true;
  const keys = Object.keys(constraints || {}).filter(k => FILTER_LABELS[k] && String(constraints[k]) !== "");
  if (!keys.length) return;
  filterRow.hidden = false;
  filterRow.appendChild(el("span", "Understood:", "recent-label"));
  keys.forEach(k => {
    const chip = el("span", null, "fchip");
    chip.append(document.createTextNode(FILTER_LABELS[k] + ": " + String(constraints[k]).slice(0, 30)));
    const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.setAttribute("aria-label", "Remove filter " + FILTER_LABELS[k]);
    x.addEventListener("click", () => { delete activeFilters[k]; run(lastQuery, { kind: lastKind, filters: Object.assign({}, activeFilters) }); });
    chip.appendChild(x); filterRow.appendChild(chip);
  });
}
function paintRefine(runEl, items, query) {
  if (!items || !items.length) return;
  const row = el("div", null, "refine");
  row.appendChild(el("span", "Refine", "refine-label"));
  const SUFFIX = { cheaper: " cheaper options", recent_reviews: " with recent reviews", brands: " other brands", wider: " wider search", remote: " including remote", recent: " posted this week", pay: " higher pay", cities: " other cities", academic: " academic sources", counter: " counter-arguments", beginner: " beginner friendly", projects: " with projects", papers: " with papers" };
  items.slice(0, 5).forEach(c => {
    const b = el("button", c.label, "chipbtn"); b.type = "button";
    if (c.estimated_calls) { const s = el("span", "~" + c.estimated_calls, "cost"); b.append(document.createTextNode(" "), s); }
    b.addEventListener("click", () => {
      if (c.id === "followup") { dock.hidden = false; dockInput.focus(); return; }
      if (c.id === "deep") return run(query, { kind: lastKind });
      run(query + (SUFFIX[c.id] || ""), { kind: lastKind });
    });
    row.appendChild(b);
  });
  runEl.appendChild(row);
}

/* ---------- compare ---------- */
function renderTray() {
  if (!selected.size) { tray.hidden = true; return; }
  tray.hidden = false;
  trayCount.textContent = selected.size + " selected";
  trayItems.textContent = "";
  Array.from(selected.values()).slice(0, 4).forEach(r => trayItems.appendChild(el("span", String(r.title || r.name || "item").slice(0, 22))));
}
$("#trayClear").addEventListener("click", () => { selected.clear(); $$("#thread input[type=checkbox]").forEach(c => { c.checked = false; }); renderTray(); });
$("#trayCompare").addEventListener("click", () => {
  const items = Array.from(selected.values()).slice(0, 4);
  if (items.length < 2) return say("Select 2 or more to compare");
  openCompare(items);
});
function openCompare(items) {
  const veil = $("#cmpVeil"); veil.hidden = false;
  $("#cmpSub").textContent = items.length + " options";
  const body = $("#cmpBody"); body.textContent = "";
  const draw = () => {
    body.textContent = "";
    const diffOnly = $("#diffOnly").checked;
    const rows = [
      ["Title", r => r.title || r.name || "—"],
      ["Price / Pay", r => r.price || r.salary || "—"],
      ["Rating", r => r.rating != null ? String(r.rating) + (r.reviews ? " (" + fmtN(r.reviews) + ")" : "") : "—"],
      ["Source", r => r.company || r.seller || r.source || r.channel || "—"],
    ];
    const t = document.createElement("table"); t.className = "cmp-table";
    const thead = document.createElement("thead"); const hr = document.createElement("tr");
    hr.appendChild(el("th", "Field"));
    items.forEach((_, i) => hr.appendChild(el("th", "Option " + (i + 1))));
    thead.appendChild(hr); t.appendChild(thead);
    const tb = document.createElement("tbody");
    rows.forEach(([label, fn]) => {
      const vals = items.map(r => String(fn(r)).slice(0, 90));
      if (diffOnly && new Set(vals).size <= 1) return;
      const tr = document.createElement("tr");
      tr.appendChild(el("th", label));
      let best = -1;
      if (label === "Rating") { let m = -1; vals.forEach((v, i) => { const n = parseFloat(v); if (!isNaN(n) && n > m) { m = n; best = i; } }); }
      vals.forEach((v, i) => { const td = el("td", v); if (i === best) td.className = "bestcell"; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    t.appendChild(tb); body.appendChild(t);
  };
  $("#diffOnly").onchange = draw; draw();
  $("#cmpClose").focus();
}
$("#cmpClose").addEventListener("click", () => { $("#cmpVeil").hidden = true; });
$("#cmpVeil").addEventListener("click", (e) => { if (e.target.id === "cmpVeil") $("#cmpVeil").hidden = true; });

/* ---------- command palette ---------- */
const COMMANDS = [
  { t: "New research", k: "N", fn: () => $("#newBtn").click() },
  { t: "Toggle theme", k: "T", fn: () => $("#themeBtn").click() },
  { t: "Mode: Auto", k: "1", fn: () => setMode("auto") },
  { t: "Mode: Research", k: "2", fn: () => setMode("research") },
  { t: "Mode: Shopping", k: "3", fn: () => setMode("shopping") },
  { t: "Mode: Jobs", k: "4", fn: () => setMode("jobs") },
  { t: "Toggle deep research", k: "D", fn: () => deepBtn.click() },
  { t: "Focus composer", k: "/", fn: () => input.focus() },
  { t: "Clear saved", k: "", fn: () => { try { localStorage.removeItem("serp_saved"); } catch {} renderRail(""); say("Saved cleared"); } },
];
function setMode(m) { const b = $('.modeseg-btn[data-mode="' + m + '"]'); if (b) b.click(); }
function openPalette() {
  $("#palVeil").hidden = false;
  const inp = $("#palInput"); inp.value = ""; drawPal("");
  setTimeout(() => inp.focus(), 30);
}
function drawPal(f) {
  const list = $("#palList"); list.textContent = "";
  COMMANDS.filter(c => c.t.toLowerCase().includes(f.toLowerCase())).forEach(c => {
    const b = document.createElement("button"); b.type = "button"; b.className = "pal-item"; b.setAttribute("role", "option");
    b.append(el("span", c.t));
    if (c.k) b.appendChild(el("span", c.k, "pk"));
    b.addEventListener("click", () => { $("#palVeil").hidden = true; c.fn(); });
    list.appendChild(b);
  });
  if (!list.children.length) list.appendChild(el("p", "No commands match. Type a question and press Enter to research.", "insp-hint"));
}
$("#paletteBtn").addEventListener("click", openPalette);
$("#palInput").addEventListener("input", (e) => drawPal(e.target.value));
$("#palInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = e.target.value.trim();
    if (!v) return;
    $("#palVeil").hidden = true; input.value = v; run(v, { kind: "chat" });
  }
});
$("#palVeil").addEventListener("click", (e) => { if (e.target.id === "palVeil") $("#palVeil").hidden = true; });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palVeil").hidden ? openPalette() : $("#palVeil").hidden = true; }
  if (e.key === "Escape") { $("#palVeil").hidden = true; $("#cmpVeil").hidden = true; }
  if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && document.activeElement !== input && document.activeElement !== dockInput && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") $("#newBtn").click();
  if (e.key === "/" && document.activeElement !== input && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); (dock.hidden ? input : dockInput).focus(); }
});
window.addEventListener("offline", () => say("You are offline. Questions queue until reconnect."));

/* ---------- init ---------- */
autoGrow(); renderRail(""); renderTray();
if (window.innerWidth < 1024) { shell.classList.add("rail-hidden"); }
})();
