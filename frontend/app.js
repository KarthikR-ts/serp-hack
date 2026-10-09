/* Serp Intelligence — research workspace. XSS-safe: textContent only for API data. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const q = $("#q"), go = $("#go"), agentGo = $("#agentGo"), stopBtn = $("#stopBtn"),
    cards = $("#cards"), answerBox = $("#answer"), planSlot = $("#planSlot"),
    srcEl = $("#sources"), srcCount = $("#srcCount"), srcCountTop = $("#srcCountTop"),
    status = $("#status"), srStatus = $("#srStatus"), toast = $("#toast"),
    cmpWrap = $("#cmpWrap"), margin = $("#margin"), filterRow = $("#filterRow");
  let last = null, lastKind = "chat", selected = new Map(), aborter = null,
      skipPlan = sessionStorage.getItem("serp_skip_plan") === "1";

  /* ---------- tiny helpers ---------- */
  function say(m) { toast.textContent = m; toast.classList.add("show"); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove("show"), 2400); }
  function announce(m) { srStatus.textContent = ""; setTimeout(() => { srStatus.textContent = m; }, 50); }
  function mode() { const r = document.querySelector('input[name="mode"]:checked'); return r ? r.value : "auto"; }
  function deep() { return $("#deep").checked; }
  function el(tag, text, cls) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function link(url, label) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.textContent = label; return a; }
  function extLink(url, label) { const a = link(url, label); a.className = "ext"; return a; }
  function safeHttp(url) {
    try { const u = new URL(String(url), location.origin); return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null; }
    catch { return null; }
  }
  function safeImg(src) {
    try { const u = new URL(String(src), location.origin); return u.protocol === "https:" ? u.href : null; }
    catch { return null; }
  }
  function fmtViews(v) {
    if (v == null) return "";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M views";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + "K views";
    return v + " views";
  }
  const num = (n) => new Intl.NumberFormat(undefined).format(n);

  /* ---------- theme ---------- */
  const themeBtn = $("#themeBtn");
  function applyThemeLabel() {
    const t = document.documentElement.dataset.theme || "system";
    themeBtn.textContent = "Theme: " + t;
  }
  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || "system";
    const next = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("serp_theme", next); } catch {}
    applyThemeLabel();
  });
  try {
    const saved = localStorage.getItem("serp_theme");
    if (saved) document.documentElement.dataset.theme = saved;
  } catch {}
  applyThemeLabel();

  /* ---------- rail: conversations, saved, usage ---------- */
  function renderRail() {
    const convs = $("#convs"); convs.textContent = "";
    const hist = JSON.parse(sessionStorage.getItem("serp_hist") || "[]");
    if (!hist.length) convs.appendChild(el("p", "Nothing yet. Ask above.", "meta"));
    hist.slice(0, 8).forEach(h => {
      const b = el("button", String(h.q || "").slice(0, 60), "chip");
      b.style.display = "block"; b.style.marginBottom = "6px";
      b.addEventListener("click", () => { q.value = h.q; run(h.q, { kind: h.kind || "chat" }); });
      convs.appendChild(b);
    });
    const box = $("#saved"); box.textContent = "";
    const saved = JSON.parse(localStorage.getItem("serp_saved") || "[]");
    if (!saved.length) box.appendChild(el("p", "Nothing saved yet.", "meta"));
    saved.slice(0, 20).forEach((s, i) => {
      const b = el("button", String(s.title || s.query || "saved").slice(0, 60), "chip");
      b.style.display = "block"; b.style.marginBottom = "6px";
      b.addEventListener("click", () => {
        if (s.query) { q.value = s.query; run(s.query, { kind: "chat" }); }
        else if (s.url) window.open(s.url, "_blank", "noopener");
      });
      box.appendChild(b);
      void i;
    });
  }
  $("#newBtn").addEventListener("click", () => { q.value = ""; cards.textContent = ""; answerBox.textContent = ""; planSlot.textContent = ""; srcEl.textContent = ""; srcCount.textContent = "0"; srcCountTop.textContent = "0"; status.textContent = ""; q.focus(); });
  $("#clearSaved").addEventListener("click", () => { localStorage.removeItem("serp_saved"); renderRail(); });
  fetch("api/usage").then(r => r.ok ? r.json() : null).then(u => {
    if (!u) return;
    $("#usage").textContent = `${num(u.queries)} queries · ${num(u.serpapi_calls)} searches (${u.calls_per_query}/query) · ${num(u.failed_calls)} failed`;
  }).catch(() => { $("#usage").textContent = "Unavailable"; });
  function pushHist(query, kind) {
    const hist = JSON.parse(sessionStorage.getItem("serp_hist") || "[]");
    hist.unshift({ q: query, kind });
    sessionStorage.setItem("serp_hist", JSON.stringify(hist.slice(0, 20)));
    renderRail();
  }
  function saveItem(item) {
    const saved = JSON.parse(localStorage.getItem("serp_saved") || "[]");
    saved.unshift({ ...item, at: new Date().toISOString() });
    localStorage.setItem("serp_saved", JSON.stringify(saved.slice(0, 50)));
    renderRail(); say("Saved");
  }

  /* ---------- hero: goals, recent, first run ---------- */
  document.querySelectorAll("#goals button").forEach(b => b.addEventListener("click", () => {
    q.value = b.dataset.t;
    const i = q.value.indexOf("___");
    q.focus();
    if (i >= 0) q.setSelectionRange(i, i + 3);
    autoGrow();
  }));
  function renderRecent() {
    const box = $("#recent"); box.textContent = "";
    const hist = JSON.parse(sessionStorage.getItem("serp_hist") || "[]");
    if (!hist.length) { box.appendChild(el("span", "Try: ")); ["Find three good laptops under ₹80,000 for machine learning", "Find software engineering internships in Bengaluru", "Teach me CRISPR gene editing from beginner to papers"].forEach(t => {
      const b = el("button", t, "chip"); b.style.marginRight = "6px";
      b.addEventListener("click", () => { q.value = t; run(t, {}); });
      box.appendChild(b);
    }); return; }
    box.appendChild(el("span", "Recent: "));
    hist.slice(0, 4).forEach(h => {
      const b = el("button", String(h.q).slice(0, 50), "chip"); b.style.marginRight = "6px";
      b.addEventListener("click", () => { q.value = h.q; run(h.q, { kind: h.kind || "chat" }); });
      box.appendChild(b);
    });
  }
  function autoGrow() { q.style.height = "auto"; q.style.height = Math.min(200, q.scrollHeight) + "px"; }
  q.addEventListener("input", autoGrow);

  /* ---------- filters ---------- */
  const FILTER_LABELS = { budget: "Budget", currency: "Currency", min_rating: "Min rating", rating: "Min rating", location: "Location", remote: "Remote", salary_min: "Min pay", min_salary: "Min pay" };
  let activeFilters = {};
  function renderFilters(constraints) {
    filterRow.textContent = ""; filterRow.style.display = "none";
    const keys = Object.keys(constraints || {}).filter(k => FILTER_LABELS[k] && String(constraints[k]) !== "");
    if (!keys.length) return;
    filterRow.style.display = "flex";
    filterRow.appendChild(el("span", "Understood:", "meta"));
    keys.forEach(k => {
      const chip = el("span", null, "fchip");
      const label = el("button", `${FILTER_LABELS[k]}: ${constraints[k]} ✕`, null);
      label.setAttribute("aria-label", `Remove filter ${FILTER_LABELS[k]}`);
      label.addEventListener("click", () => {
        delete activeFilters[k];
        run(lastQuery, { kind: lastKind, mode: lastMode, deep: lastDeep, filters: { ...activeFilters } });
      });
      chip.appendChild(label);
      filterRow.appendChild(chip);
    });
  }

  /* ---------- run orchestration ---------- */
  let lastQuery = "", lastMode = "auto", lastDeep = false;
  go.addEventListener("click", () => run(q.value, {}));
  agentGo.addEventListener("click", () => run(q.value, { kind: "agent" }));
  q.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(q.value, {}); } });
  stopBtn.addEventListener("click", () => { if (aborter) aborter.abort(); });
  window.addEventListener("offline", () => say("You're offline. Your question will send when you reconnect."));

  async function run(rawQuery, opts) {
    const query = (rawQuery || "").trim().slice(0, 500);
    if (!query) return say("Type a query first");
    if (!navigator.onLine) say("You're offline. Your question will send when you reconnect.");
    lastQuery = query; lastKind = opts.kind || "agent";
    lastMode = opts.mode || mode(); lastDeep = opts.deep != null ? opts.deep : deep();
    activeFilters = opts.filters || activeFilters;
    resetView();
    pushHist(query, lastKind);
    status.textContent = "";
    const t = el("p", "Understanding your question…"); t.setAttribute("aria-busy", "true");
    status.appendChild(t); announce("Research started");
    aborter = new AbortController();
    stopBtn.hidden = false;
    try {
      if (lastKind === "agent") {
        const r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, num_results: 8, filters: activeFilters }), signal: aborter.signal });
        if (r.status === 503) { setStatus(""); return say("LLM key missing. Set OPENROUTER_API_KEY in .env and restart."); }
        if (r.status === 429) { setStatus(""); return say("You've reached the limit for now. Try again in a minute."); }
        if (!r.ok) throw new Error("HTTP " + r.status);
        paintAgent(await r.json());
      } else {
        // Plan preview for complex runs.
        let plan = null;
        try {
          const pr = await fetch("api/intents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }), signal: aborter.signal });
          if (pr.ok) plan = await pr.json();
        } catch (e) { if (e.name === "AbortError") return stopped(); }
        if (plan && (plan.requires_confirmation || lastDeep) && !skipPlan) {
          const goAhead = await showPlan(plan, query);
          if (!goAhead) { setStatus(""); stopBtn.hidden = true; return; }
        }
        const streamOk = await tryStream(query);
        if (!streamOk) {
          const r = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode: lastMode, deep_research: lastDeep, filters: activeFilters }), signal: aborter.signal });
          if (r.status === 429) { setStatus(""); return say("You've reached the limit for now. Try again in a minute."); }
          if (!r.ok) throw new Error("HTTP " + r.status);
          paintChat(await r.json());
        }
      }
    } catch (e) {
      if (e.name === "AbortError") return stopped();
      setStatus(""); say("Request failed. Backend running?");
    } finally { stopBtn.hidden = true; }
  }
  function stopped() { setStatus(""); status.appendChild(el("p", "Stopped by you. Partial results (if any) are kept below.", "meta")); announce("Research stopped"); }
  function setStatus() { status.textContent = ""; }
  function resetView() {
    cards.textContent = ""; answerBox.textContent = ""; planSlot.textContent = "";
    srcEl.textContent = ""; srcCount.textContent = "0"; srcCountTop.textContent = "0";
    cmpWrap.textContent = ""; selected.clear();
  }

  function showPlan(plan, query) {
    return new Promise(resolve => {
      planSlot.textContent = "";
      const box = el("div", null, "plan"); box.setAttribute("role", "group"); box.setAttribute("aria-label", "Research plan");
      box.appendChild(el("h2", "Plan"));
      box.appendChild(el("p", `${(plan.plan || []).length} steps · about ${plan.estimated_calls} searches · up to ~${plan.estimated_seconds} s`, "meta"));
      const ol = document.createElement("ol");
      (plan.plan || []).forEach(s => {
        const li = document.createElement("li");
        li.appendChild(el("span", `${s.tool}: ${String(s.query).slice(0, 90)}`));
        ol.appendChild(li);
      });
      box.appendChild(ol);
      const row = el("div", null, "btn-row");
      const start = el("button", "Start research", "btn btn-primary"); start.type = "button";
      const direct = el("button", "Run directly", "btn"); direct.type = "button";
      const skip = document.createElement("label"); skip.className = "meta";
      const cb = document.createElement("input"); cb.type = "checkbox";
      skip.append(cb, document.createTextNode(" Skip plan next time"));
      start.addEventListener("click", () => { planSlot.textContent = ""; resolve(true); });
      direct.addEventListener("click", () => {
        if (cb.checked) { skipPlan = true; try { sessionStorage.setItem("serp_skip_plan", "1"); } catch {} }
        planSlot.textContent = ""; resolve(true);
      });
      const cancel = el("button", "Cancel", "btn"); cancel.type = "button";
      cancel.addEventListener("click", () => { planSlot.textContent = ""; resolve(false); });
      row.append(start, direct, cancel, skip);
      box.appendChild(row);
      planSlot.appendChild(box);
      announce("Plan ready. Review and start research.");
      start.focus();
    });
  }

  async function tryStream(query) {
    try {
      const r = await fetch("api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ query, mode: lastMode, deep_research: lastDeep, filters: activeFilters }), signal: aborter.signal });
      if (!r.ok || !r.body) return false;
      const reader = r.body.getReader(); const dec = new TextDecoder();
      let buf = "", events = 0;
      setStatus();
      const live = el("p", "Searching relevant sources…"); status.appendChild(live);
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop();
        for (const p of parts) {
          const m = p.match(/event: (\w+)\ndata: ([\s\S]*)/); if (!m) continue;
          events++;
          try {
            const j = JSON.parse(m[2]);
            if (m[1] === "intent_detected") { live.textContent = "Understood as " + (j.intent || []).join(", "); announce("Classified: " + (j.intent || []).join(", ")); }
            if (m[1] === "plan_created") live.textContent = "Plan: " + j.length + " steps.";
            if (m[1] === "tool_started") live.textContent = "Searching: " + j.tool + "…";
            if (m[1] === "synthesis_started") live.textContent = "Writing the answer…";
          } catch {}
        }
      }
      if (!events) return false;
      const r2 = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode: lastMode, deep_research: lastDeep, filters: activeFilters }), signal: aborter.signal });
      if (!r2.ok) return false;
      paintChat(await r2.json());
      return true;
    } catch (e) { if (e.name === "AbortError") throw e; return false; }
  }

  /* ---------- shared painters ---------- */
  function paintRoute(route, budget) {
    if (!route || !route.length) return null;
    const box = el("section", null, "route"); box.setAttribute("aria-label", "Route");
    const head = el("div", null, "route-head");
    head.appendChild(el("h2", "Route"));
    const okN = route.filter(l => l.status === "ok").length;
    const bad = route.filter(l => l.status === "failed").length;
    head.appendChild(el("span", `${okN} of ${route.length} sources loaded` + (bad ? ` · ${bad} didn't load` : ""), "route-meta"));
    if (budget) head.appendChild(el("span", `${budget.calls_used} of ${budget.calls_limit} searches · ${budget.seconds_used}s`, "route-meta"));
    box.appendChild(head);
    const NS = "http://www.w3.org/2000/svg";
    const H = 40 + route.length * 36;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 640 ${H}`); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Diagram of sources used");
    svg.setAttribute("aria-hidden", "true");
    const q0 = document.createElementNS(NS, "circle");
    q0.setAttribute("cx", "24"); q0.setAttribute("cy", String(H / 2)); q0.setAttribute("r", "10");
    q0.setAttribute("fill", "none"); q0.setAttribute("stroke", "var(--ink)"); q0.setAttribute("stroke-width", "2");
    svg.appendChild(q0);
    route.forEach((line, i) => {
      const y = 40 + i * 36;
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "route-line"); g.dataset.vertical = line.vertical;
      const color = `var(--fam-${line.family || "web"})`;
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", "40"); ln.setAttribute("x2", "500"); ln.setAttribute("y1", String(y)); ln.setAttribute("y2", String(y));
      ln.setAttribute("stroke", color); ln.setAttribute("stroke-width", "2");
      if (line.status === "failed") ln.setAttribute("stroke-dasharray", "2 8");
      g.appendChild(ln);
      const n1 = document.createElementNS(NS, "circle");
      n1.setAttribute("cx", "150"); n1.setAttribute("cy", String(y)); n1.setAttribute("r", "4"); n1.setAttribute("fill", color);
      const tip = document.createElementNS(NS, "title"); tip.textContent = line.query || line.name;
      n1.appendChild(tip); g.appendChild(n1);
      const n2 = document.createElementNS(NS, "circle");
      n2.setAttribute("cx", "300"); n2.setAttribute("cy", String(y)); n2.setAttribute("r", "4"); n2.setAttribute("fill", color);
      n2.appendChild(tip.cloneNode(true)); g.appendChild(n2);
      const term = document.createElementNS(NS, "text");
      term.setAttribute("x", "516"); term.setAttribute("y", String(y + 4)); term.setAttribute("class", "route-count");
      term.textContent = line.status === "ok" ? `● ${line.result_count}` : line.status === "empty" ? "○ 0" : line.status === "failed" ? "✕ didn't load" : "… skipped";
      if (line.status === "failed") term.setAttribute("fill", "var(--error)");
      g.appendChild(term);
      const lab = document.createElementNS(NS, "text");
      lab.setAttribute("x", "40"); lab.setAttribute("y", String(y - 8)); lab.setAttribute("class", "route-label");
      lab.textContent = line.name;
      g.appendChild(lab);
      g.addEventListener("click", () => filterByVertical(line.vertical));
      svg.appendChild(g);
    });
    const merge = document.createElementNS(NS, "g"); merge.setAttribute("class", "route-merge");
    const mc = document.createElementNS(NS, "circle");
    mc.setAttribute("cx", "590"); mc.setAttribute("cy", String(H / 2)); mc.setAttribute("r", "14");
    mc.setAttribute("fill", "var(--ink)");
    const mt = document.createElementNS(NS, "text");
    mt.setAttribute("x", "590"); mt.setAttribute("y", String(H / 2 + 5)); mt.setAttribute("text-anchor", "middle");
    mt.setAttribute("fill", "var(--bg)"); mt.setAttribute("font-size", "12"); mt.textContent = "≡";
    merge.append(mc, mt);
    const mtitle = document.createElementNS(NS, "title"); mtitle.textContent = "Answer"; merge.appendChild(mtitle);
    svg.appendChild(merge);
    box.appendChild(svg);
    // collapsed chip summary
    const chips = el("div", null, "route-chips");
    chips.appendChild(el("span", "Route", "meta"));
    route.forEach(line => {
      const c = el("span", null, "route-chip");
      const d = el("span", null, "dot"); d.style.background = `var(--fam-${line.family || "web"})`;
      c.append(d, document.createTextNode(`${line.name} ${line.status === "ok" ? line.result_count : line.status === "failed" ? "✕" : line.status === "empty" ? "0" : "…"}`));
      chips.appendChild(c);
    });
    const expand = el("button", "Expand", "btn"); expand.type = "button"; expand.style.minHeight = "32px";
    const twin = routeTwin(route);
    twin.hidden = true;
    expand.addEventListener("click", () => { twin.hidden = !twin.hidden; expand.textContent = twin.hidden ? "Expand" : "Collapse"; });
    chips.appendChild(expand);
    box.append(chips, twin);
    const anyBad = route.some(l => l.status === "failed" || l.status === "empty");
    if (anyBad) { twin.hidden = false; expand.textContent = "Collapse"; }
    return box;
  }
  function routeTwin(route) {
    const ol = document.createElement("ol"); ol.className = "route-twin as-rows"; ol.setAttribute("aria-label", "Sources used, text version");
    route.forEach(line => {
      const li = document.createElement("li");
      const b = document.createElement("button"); b.type = "button";
      b.textContent = `${line.name}: ${line.status === "ok" ? line.result_count + " results" : line.status === "failed" ? "didn't load" : line.status}`;
      b.addEventListener("click", () => filterByVertical(line.vertical));
      li.appendChild(b); ol.appendChild(li);
    });
    return ol;
  }
  function filterByVertical(v) {
    document.querySelectorAll("#cards [data-vertical]").forEach(n => {
      n.style.display = (!v || n.dataset.vertical === v) ? "" : "none";
    });
    if (v) say("Filtered to " + v + ". Run again to clear.");
  }

  function paintSteps(data) {
    const wrap = el("details", null, "steps-wrap");
    const sum = el("summary", "Research steps");
    sum.style.minHeight = "44px"; sum.style.cursor = "pointer";
    wrap.appendChild(sum);
    const dl = document.createElement("dl"); dl.className = "steps";
    const a = data.analysis || data.classification || {};
    const intents = a.intent || (a.use_case ? [a.use_case] : []);
    dl.append(dt("Understood as"), dd(intents.join(" · ") || "—"));
    if (a.entities && a.entities.length) dl.append(dt("Entities"), dd(a.entities.slice(0, 8).join(", ")));
    const searches = (a.steps || data.plan || []).filter(s => s.tool || s.engine);
    if (searches.length) {
      dl.append(dt("Searches"));
      const d = el("dd", "");
      searches.forEach(s => {
        const line = (data.route || []).find(l => l.vertical === (s.tool || s.engine));
        d.appendChild(el("div", `${s.tool || s.engine}: "${String(s.query).slice(0, 80)}"${line ? ` — ${line.result_count} found` : ""}`));
      });
      dl.append(d);
    }
    const f = data.funnel;
    if (f) {
      dl.append(dt("Results"));
      const d = el("dd", `${num(f.discovered)} found · ${num(f.matched)} matched · ${num(f.set_aside)} set aside`);
      if (f.reasons && f.reasons.length) {
        const det = document.createElement("details"); det.className = "setaside";
        det.appendChild(el("summary", "Why set aside: " + f.reasons.map(r => `${r.label} (${r.count})`).join(", ")));
        (f.set_aside_results || []).forEach(r => det.appendChild(el("div", `${r.title || r.name || "item"} — ${r.set_aside_reason}`)));
        d.appendChild(det);
      }
      dl.append(d);
    }
    wrap.appendChild(dl);
    return wrap;
    function dt(t) { return el("dt", t); }
    function dd(t) { return el("dd", t); }
  }

  function paintHeader(data) {
    const head = el("div", null, "answer-head");
    if (data.summary) head.appendChild(el("p", data.summary, "verdict"));
    const c = data.confidence;
    if (c && typeof c === "object") {
      head.appendChild(el("p", `Confidence: ${c.level}. ${(c.reasons || []).join("; ")}.`, "conf-line"));
    } else if (c) head.appendChild(el("p", "Confidence: " + c + ".", "conf-line"));
    const comp = data.completeness;
    if (comp) {
      const p = el("p", comp.message, "complete-line" + (comp.state === "partial" || comp.state === "limit_reached" ? " warn" : comp.state === "failed" ? " bad" : ""));
      if (comp.state === "partial") {
        const retry = el("button", "Retry", "btn"); retry.type = "button"; retry.style.minHeight = "32px";
        retry.addEventListener("click", () => run(lastQuery, { kind: lastKind, mode: lastMode, deep: lastDeep }));
        p.append(document.createTextNode(" "), retry);
      }
      head.appendChild(p);
    }
    const intents = ((data.analysis || {}).intent || data.legacy_intents || []).join(" ");
    if (/FINANCE/.test(intents) || (data.presentation || {}).type === "finance_snapshot") {
      head.appendChild(el("p", "Information only, not financial advice.", "meta"));
    }
    if (/apply to|book (me|us|a |my)|buy .* for me|\bpurchase\b/i.test(data.query || "")) {
      const b = el("div", null, "banner info");
      b.appendChild(el("p", "This assistant reads and compares. It doesn't buy, apply or book for you. Open the listings instead."));
      head.appendChild(b);
    }
    return head;
  }

  function paintMargin(sources) {
    srcEl.textContent = "";
    (sources || []).forEach(s => {
      const li = document.createElement("li"); li.dataset.eid = s.id || "";
      const t = el("strong", (s.title || s.url || "source").slice(0, 90));
      li.appendChild(t);
      li.appendChild(el("div", `${s.domain || ""}${s.date ? " · " + s.date : ""}`, "domain"));
      if (s.claim) { const bq = document.createElement("blockquote"); bq.textContent = s.claim.slice(0, 200); li.appendChild(bq); }
      const meta = el("div", null, "meta");
      if (s.type) meta.appendChild(el("span", `[${s.type}] `));
      if (s.claim_type && s.claim_type !== "fact") { const r = el("span", s.claim_type + " ", "rel"); meta.appendChild(r); }
      li.appendChild(meta);
      const row = el("div", null, "actions");
      if (safeHttp(s.url)) row.appendChild(extLink(s.url, "Open source"));
      const show = el("button", "Show in results", "btn"); show.type = "button"; show.style.minHeight = "32px";
      show.addEventListener("click", () => flashResults(s.id));
      row.appendChild(show);
      li.appendChild(row);
      li.addEventListener("mouseenter", () => flashResults(s.id, true));
      li.addEventListener("mouseleave", () => unflash());
      srcEl.appendChild(li);
    });
    srcCount.textContent = String((sources || []).length);
    srcCountTop.textContent = String((sources || []).length);
    if (window.innerWidth < 1024) margin.classList.remove("open");
  }
  function flashResults(eid, soft) {
    if (!eid) return;
    document.querySelectorAll("#cards [data-eids]").forEach(n => {
      const has = (n.dataset.eids || "").split(" ").includes(eid);
      n.classList.toggle("flash", has);
      if (!soft && has) n.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
  function unflash() { document.querySelectorAll(".flash").forEach(n => n.classList.remove("flash")); }
  $("#marginBtn").addEventListener("click", () => {
    const open = margin.classList.toggle("open");
    $("#marginBtn").setAttribute("aria-expanded", String(open));
  });

  /* ---------- result forms ---------- */
  function outbound(r) {
    const url = safeHttp(r.url || r.application_url || r.link);
    if (!url) return null;
    if (r.company || r.salary) return extLink(url, "Open application");
    if (r.price && r.seller) return extLink(url, "View on site");
    if (r.authors) return extLink(url, "Read paper");
    if (r.length || r.channel) return extLink(url, "Watch");
    return extLink(url, "Open");
  }
  function whyBlock(r) {
    if (!r.why || !r.why.length) return null;
    const d = document.createElement("details"); d.className = "why";
    d.appendChild(el("summary", "Why this result?"));
    const ul = el("ul", null, "why-list");
    r.why.forEach(w => {
      const li = document.createElement("li"); li.dataset.met = String(!!w.met); li.textContent = w.text;
      ul.appendChild(li);
    });
    d.appendChild(ul);
    return d;
  }
  function selectBox(r, i, tray) {
    const lab = el("label", null, null);
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.setAttribute("aria-label", "Select for compare");
    cb.addEventListener("change", () => { if (cb.checked) { if (selected.size >= 4) { cb.checked = false; return say("Compare holds 4 at most"); } selected.set(i, r); } else selected.delete(i); renderTray(); });
    lab.append(cb, document.createTextNode(" Compare"));
    return lab;
  }
  function dismissBtn(node) {
    const b = el("button", "Not interested", "btn"); b.type = "button"; b.style.minHeight = "32px";
    b.addEventListener("click", () => { node.remove(); say("Removed from this view"); });
    return b;
  }
  function saveBtn(payload) {
    const b = el("button", "Save", "btn"); b.type = "button"; b.style.minHeight = "32px";
    b.addEventListener("click", () => saveItem(payload));
    return b;
  }
  function tag(kind) { return el("span", kind, "kind-tag"); }

  function jobRow(r, i) {
    const c = el("article", null, "row-card settle"); c.dataset.vertical = "google_jobs";
    if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
    const h = el("h3", String(r.title || "Role").slice(0, 120)); c.appendChild(h);
    c.appendChild(el("div", `${r.company || ""} · ${r.location || ""}${r.employment_type ? " · " + r.employment_type : ""}`.replace(/^ · | · $/g, "")));
    const facts = el("ul", null, "facts");
    const pay = r.salary ? `Pay: ${r.salary} (listed)` : "Pay: not listed";
    facts.append(li(`<b>`, pay), li2("Posted", r.posted_at), li2("Source", r.source));
    c.appendChild(facts);
    if (r.description) c.appendChild(el("p", String(r.description).slice(0, 280)));
    const acts = el("div", null, "actions");
    const o = outbound(r); if (o) acts.appendChild(o);
    acts.append(selectBox(r, i), dismissBtn(c), saveBtn({ title: r.title, url: r.application_url || r.url }));
    c.appendChild(acts);
    const w = whyBlock(r); if (w) c.appendChild(w);
    return c;
    function li(_, t) { const x = document.createElement("li"); x.textContent = t; return x; }
    function li2(k, v) { if (!v) return document.createTextNode(""); const x = document.createElement("li"); const b = document.createElement("b"); b.textContent = k + ": "; x.append(b, document.createTextNode(String(v).slice(0, 80))); return x; }
  }

  function productTile(r, i, featured) {
    const c = el("article", null, "tile settle" + (featured ? " featured" : "")); c.dataset.vertical = "google_shopping";
    if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
    const url = safeHttp(r.url);
    const imgSrc = r.image ? safeImg(r.image) : null;
    if (url && imgSrc) {
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.className = "thumb"; a.setAttribute("aria-label", "View on site: " + (r.title || "product"));
      const img = document.createElement("img"); img.src = imgSrc; img.alt = String(r.title || "product").slice(0, 120); img.loading = "lazy"; img.width = 480; img.height = 360;
      a.appendChild(img); c.appendChild(a);
    }
    const h = el("h3", String(r.title || "Product").slice(0, 120)); c.appendChild(h);
    const facts = el("ul", null, "facts");
    if (r.price) { const x = document.createElement("li"); x.append(el("b", "Price: "), document.createTextNode(r.price)); facts.appendChild(x); }
    if (r.rating != null) facts.appendChild(el("li", `★ ${r.rating}${r.reviews ? ` (${num(r.reviews)})` : ""}`));
    if (r.seller) facts.appendChild(el("li", "Seller: " + r.seller));
    if (r.availability) facts.appendChild(el("li", r.availability));
    c.appendChild(facts);
    const acts = el("div", null, "actions");
    const o = outbound(r); if (o) acts.appendChild(o);
    acts.append(selectBox(r, i), dismissBtn(c), saveBtn({ title: r.title, url: r.url }));
    c.appendChild(acts);
    const w = whyBlock(r); if (w) c.appendChild(w);
    return c;
  }

  function paperEntry(r, i) {
    const c = el("article", null, "row-card paper settle"); c.dataset.vertical = "google_scholar";
    if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
    c.appendChild(el("h3", String(r.title || "Paper").slice(0, 140)));
    c.appendChild(el("div", `${(r.authors || "").toString().slice(0, 120)}${r.publication_date ? " · " + r.publication_date : ""}`, "authors meta"));
    if (r.abstract || r.snippet) c.appendChild(el("p", String(r.abstract || r.snippet).slice(0, 300)));
    const acts = el("div", null, "actions");
    const o = outbound(r); if (o) acts.appendChild(o);
    acts.append(selectBox(r, i), dismissBtn(c), saveBtn({ title: r.title, url: r.url }));
    c.appendChild(acts);
    const w = whyBlock(r); if (w) c.appendChild(w);
    return c;
  }

  function pageRow(r, i) {
    const c = el("article", null, "row-card settle"); c.dataset.vertical = r._engine || "google_search";
    if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
    const h = el("h3", ""); const url = safeHttp(r.url || r.link);
    if (url) h.appendChild(link(url, String(r.title || url).slice(0, 120))); else h.textContent = String(r.title || "Result").slice(0, 120);
    c.appendChild(h);
    c.appendChild(el("div", [r.source && String(r.source).slice(0, 60), r.date].filter(Boolean).join(" · "), "meta"));
    if (r.snippet || r.description) c.appendChild(el("p", String(r.snippet || r.description).slice(0, 280)));
    const acts = el("div", null, "actions");
    if (url && !(h.firstChild instanceof HTMLAnchorElement)) acts.appendChild(extLink(url, "Open"));
    acts.append(dismissBtn(c), saveBtn({ title: r.title, url: r.url }));
    c.appendChild(acts);
    const w = whyBlock(r); if (w) c.appendChild(w);
    return c;
  }

  function videoCard(r) {
    const c = el("article", null, "tile settle"); c.dataset.vertical = "youtube";
    if (r.evidence_ids) c.dataset.eids = r.evidence_ids.join(" ");
    const url = safeHttp(r.url);
    const imgSrc = r.thumbnail ? safeImg(r.thumbnail) : null;
    if (url && imgSrc) {
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; a.className = "thumb"; a.setAttribute("aria-label", "Watch: " + (r.title || "video"));
      const img = document.createElement("img"); img.src = imgSrc; img.alt = String(r.title || "video").slice(0, 120); img.loading = "lazy"; img.width = 480; img.height = 360;
      a.appendChild(img); c.appendChild(a);
    }
    c.appendChild(el("h3", String(r.title || "Video").slice(0, 120)));
    c.appendChild(el("div", [r.channel, r.length, fmtViews(r.views)].filter(Boolean).join(" · "), "meta"));
    if (r.why) c.appendChild(el("p", r.why, "meta"));
    const acts = el("div", null, "actions");
    if (url) acts.appendChild(extLink(url, "Watch"));
    c.appendChild(acts);
    return c;
  }

  function detectKind(r) {
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

  function renderResult(r, i, featured) {
    const k = detectKind(r);
    const node = k === "job" ? jobRow(r, i) : k === "product" ? productTile(r, i, featured) : k === "paper" ? paperEntry(r, i) : k === "video" ? videoCard(r) : pageRow(r, i);
    const t = tag(k); node.insertBefore(t, node.firstChild);
    return node;
  }

  /* ---------- chat paint ---------- */
  function paintChat(data) {
    last = data; lastKind = "chat";
    setStatus("");
    selected.clear();
    renderFilters(data.constraints);
    const route = paintRoute(data.route, data.budget);
    if (route) answerBox.appendChild(route);
    answerBox.appendChild(paintSteps(data));
    answerBox.appendChild(paintHeader(data));
    const intents = (data.analysis.intent || []).join(" ");
    const leadResults = /SHOPPING|JOB_SEARCH|LOCAL_DISCOVERY|EVENTS|TRAVEL/.test(intents);
    if (!leadResults && data.summary) answerBox.appendChild(el("p", data.summary, "narrative"));
    const list = data.results || [];
    const grid = el("div", null, leadResults || /SHOPPING/.test(intents) ? "tile-grid" : "cards");
    list.slice(0, 10).forEach((r, i) => grid.appendChild(renderResult(r, i, leadResults && i === 0)));
    cards.appendChild(grid);
    if (list.length > 10) {
      const more = el("button", `Show more (${list.length - 10})`, "btn"); more.type = "button";
      more.addEventListener("click", () => {
        list.slice(10, 30).forEach((r, i) => grid.appendChild(renderResult(r, i + 10, false)));
        more.remove();
      });
      cards.appendChild(more);
    }
    if (leadResults && data.summary) answerBox.appendChild(el("p", data.summary, "narrative"));
    paintRefinements(data.refinements);
    paintMargin(data.sources);
    status.appendChild(el("p", `${num(data.results_count)} results · ${num((data.funnel || {}).set_aside || 0)} set aside`, "meta"));
    announce("Answer ready. " + data.results_count + " results.");
    animate();
  }

  function paintRefinements(items) {
    if (!items || !items.length) return;
    const row = el("div", null, "btn-row"); row.setAttribute("aria-label", "Refine");
    row.appendChild(el("span", "Refine:", "meta"));
    const SUFFIX = { cheaper: " cheaper options", recent_reviews: " with recent reviews", brands: " other brands", wider: " wider search", remote: " including remote", recent: " posted this week", pay: " higher pay", cities: " other cities", academic: " academic sources", counter: " counter-arguments", beginner: " beginner friendly", projects: " with projects", papers: " with papers" };
    items.forEach(c => {
      const b = el("button", c.label, "chip"); b.type = "button";
      if (c.estimated_calls) b.dataset.cost = c.estimated_calls;
      b.addEventListener("click", () => {
        if (c.id === "followup") { q.focus(); return; }
        if (c.id === "deep") return run(lastQuery, { kind: lastKind, mode: lastMode, deep: true });
        run(lastQuery + (SUFFIX[c.id] || ""), { kind: lastKind, mode: lastMode, deep: lastDeep });
      });
      row.appendChild(b);
    });
    cards.appendChild(row);
  }

  /* ---------- agent paint ---------- */
  function paintAgent(data) {
    last = data; lastKind = "agent";
    setStatus("");
    selected.clear();
    const cls = data.classification || {};
    renderFilters(data.constraints);
    if (data.route) {
      const route = paintRoute(data.route, data.budget);
      if (route) answerBox.appendChild(route);
    }
    if (data.status === "clarify") {
      const box = el("div", null, "banner clarify");
      box.appendChild(el("strong", "One quick question: "));
      box.appendChild(el("span", data.clarifying_question || "Could you add a bit more detail?"));
      const row = el("div", null, "btn-row");
      const skip = el("button", "Skip, use best guess", "btn"); skip.type = "button";
      skip.addEventListener("click", () => run(lastQuery, { kind: "chat" }));
      row.appendChild(skip);
      box.appendChild(row);
      box.appendChild(el("p", "Or refine your query above and press Agent again.", "meta"));
      cards.appendChild(box);
      q.focus();
      return;
    }
    answerBox.appendChild(paintHeader(data));
    const p = data.presentation || { type: "generic", results: [] };
    if (p.type === "shopping_top2") {
      const grid = el("div", null, "tile-grid");
      (p.picks || []).slice(0, 2).forEach((item, i) => grid.appendChild(productTile({ ...item, seller: item.seller || "", _engine: "google_shopping" }, i, i === 0)));
      cards.appendChild(grid);
    } else if (p.type === "youtube_path") {
      const order = [["beginner", "Start here"], ["intermediate", "Go deeper"], ["advanced", "Master it"]];
      order.forEach(([lvl, label]) => {
        const vids = ((p.levels || {})[lvl]) || [];
        if (!vids.length) return;
        cards.appendChild(el("h2", `${label} (${vids.length})`, "section-h"));
        const grid = el("div", null, "tile-grid");
        vids.forEach(v => grid.appendChild(videoCard(v)));
        cards.appendChild(grid);
      });
    } else if (p.type === "finance_snapshot") {
      const qd = p.quote || {};
      const c = el("article", null, "row-card settle");
      c.appendChild(el("h3", String(qd.stock_name || qd.symbol || "Quote").slice(0, 120)));
      const facts = el("ul", null, "facts");
      [["Symbol", qd.symbol], ["Price", qd.price], ["Change", [qd.price_change, qd.percent_change].filter(Boolean).join(" ") || ""], ["Exchange", qd.exchange]].forEach(([k, v]) => {
        if (!v) return; const li = document.createElement("li"); li.append(el("b", k + ": "), document.createTextNode(v)); facts.appendChild(li);
      });
      c.appendChild(facts);
      if (qd.summary) c.appendChild(el("p", String(qd.summary).slice(0, 280)));
      cards.appendChild(c);
      (p.headlines || []).forEach(h => {
        const n = el("article", null, "row-card settle");
        const hh = el("h3", ""); const url = safeHttp(h.url);
        if (url) hh.appendChild(link(url, String(h.title || url).slice(0, 120))); else hh.textContent = String(h.title || "").slice(0, 120);
        n.appendChild(hh);
        if (h.date) n.appendChild(el("div", h.date, "meta"));
        cards.appendChild(n);
      });
      if (p.disclaimer) cards.appendChild(el("p", p.disclaimer, "meta"));
    } else if (p.type === "deep_dive") {
      if (p.summary) cards.appendChild(el("p", p.summary, "narrative"));
      if ((p.findings || []).length) {
        cards.appendChild(el("h2", "Key findings", "section-h"));
        const ol = document.createElement("ol");
        (p.findings || []).forEach(f => {
          const li = document.createElement("li");
          li.appendChild(el("span", String(f.claim || f.title || "").slice(0, 280)));
          const url = safeHttp(f.url);
          if (url) { li.appendChild(document.createTextNode(" ")); li.appendChild(link(url, "source")); }
          ol.appendChild(li);
        });
        cards.appendChild(ol);
      }
      if ((p.papers || []).length) {
        cards.appendChild(el("h2", "Papers", "section-h"));
        p.papers.forEach((r, i) => cards.appendChild(paperEntry(r, i)));
      }
    } else if (p.type === "travel_choices") {
      cards.appendChild(el("p", p.note || "Planned and ready — no booking performed.", "meta"));
      [["Flights", p.flights], ["Hotels", p.hotels], ["Places", p.places]].forEach(([label, list]) => {
        if (!list || !list.length) return;
        cards.appendChild(el("h2", label, "section-h"));
        list.forEach((r, i) => cards.appendChild(renderResult(r, i, false)));
      });
    } else if (p.type === "learning_plan") {
      if (p.goal) cards.appendChild(el("p", p.goal, "narrative"));
      const ol = el("ol", null, "learn-rail");
      (p.stages || []).forEach(s => {
        const li = document.createElement("li");
        li.appendChild(el("span", null, "node"));
        li.appendChild(el("strong", s.stage + ": "));
        (s.topics || []).forEach(t => {
          const url = safeHttp(t.url);
          li.appendChild(document.createTextNode(" "));
          li.appendChild(url ? link(url, String(t.title || url).slice(0, 80)) : el("span", String(t.title || "").slice(0, 80)));
        });
        ol.appendChild(li);
      });
      cards.appendChild(ol);
    } else {
      const list = p.jobs || p.places || p.results || [];
      list.slice(0, 10).forEach((r, i) => cards.appendChild(renderResult(r, i, false)));
    }
    paintRefinements(data.refinements);
    paintMargin(data.sources);
    status.appendChild(el("p", `${num(data.results_count || 0)} results · model ${data.model || "?"}`, "meta"));
    announce("Answer ready.");
    animate();
  }

  /* ---------- compare ---------- */
  function renderTray() {
    cmpWrap.textContent = "";
    if (!selected.size) return;
    const bar = el("div", null, "cmp-wrap");
    bar.appendChild(el("span", `${selected.size} selected · `));
    const goB = el("button", "Compare", "btn btn-primary"); goB.type = "button";
    goB.addEventListener("click", renderCompare);
    const clear = el("button", "Clear", "btn"); clear.type = "button";
    clear.addEventListener("click", () => { selected.clear(); document.querySelectorAll("#cards input[type=checkbox]").forEach(c => { c.checked = false; }); renderTray(); });
    bar.append(goB, clear);
    cmpWrap.appendChild(bar);
  }
  function renderCompare() {
    const items = [...selected.values()].slice(0, 4);
    if (items.length < 2) return say("Select 2 or more cards");
    cmpWrap.textContent = "";
    const t = document.createElement("table"); t.className = "cmp";
    const cap = document.createElement("caption"); cap.textContent = "Comparison"; cap.className = "visually-hidden"; t.appendChild(cap);
    const head = document.createElement("tr");
    head.appendChild(el("th", "Field"));
    items.forEach((_, i) => { const th = document.createElement("th"); th.scope = "col"; th.textContent = "Option " + (i + 1); head.appendChild(th); });
    t.appendChild(head);
    const rows = [
      ["Title", r => (r.title || r.name || "")],
      ["Price / Pay", r => (r.price || r.salary || "-")],
      ["Rating", r => (r.rating != null ? String(r.rating) + (r.reviews ? ` (${num(r.reviews)})` : "") : "-")],
      ["Source", r => (r.company || r.seller || r.source || r.channel || "-")],
    ];
    const diffOnly = document.createElement("label"); diffOnly.className = "meta";
    const dcb = document.createElement("input"); dcb.type = "checkbox";
    diffOnly.append(dcb, document.createTextNode(" Differences only"));
    const tbody = document.createElement("tbody"); t.appendChild(tbody);
    function draw() {
      tbody.textContent = "";
      rows.forEach(([label, fn]) => {
        const vals = items.map(r => String(fn(r)).slice(0, 120));
        if (dcb.checked && new Set(vals).size <= 1) return;
        const tr = document.createElement("tr");
        const th = document.createElement("th"); th.scope = "row"; th.textContent = label; tr.appendChild(th);
        let best = -1;
        if (label === "Rating") { let m = -1; vals.forEach((v, i) => { const n = parseFloat(v); if (!isNaN(n) && n > m) { m = n; best = i; } }); }
        vals.forEach((v, i) => {
          const td = document.createElement("td"); td.textContent = v;
          if (i === best) td.className = "best-mark";
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
    dcb.addEventListener("change", draw); draw();
    cmpWrap.append(t, diffOnly);
    say("Comparison ready");
  }

  /* ---------- motion ---------- */
  let heroPlayed = false;
  function animate() {
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      if (window.gsap) {
        if (!heroPlayed) { heroPlayed = true; gsap.from("#hero", { opacity: 0, y: 12, duration: 0.35, ease: "power1.out", overwrite: true, clearProps: "all" }); }
        gsap.from(".settle", { opacity: 0, y: 8, duration: 0.3, stagger: 0.03, ease: "power1.out", overwrite: true, clearProps: "all" });
      }
    } catch {}
  }

  renderRail();
  renderRecent();
})();
