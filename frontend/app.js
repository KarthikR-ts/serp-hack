/* Phase 7-8 app. XSS-safe: textContent only for API data. No innerHTML with untrusted input. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const q = $("#q"), go = $("#go"), cards = $("#cards"), traceEl = $("#trace"),
    srcEl = $("#sources"), srcCount = $("#srcCount"), status = $("#status"),
    toast = $("#toast"), cmpWrap = $("#cmpWrap");
  let last = null, selected = new Map();

  function say(m) { toast.textContent = m; toast.style.display = "block"; setTimeout(() => toast.style.display = "none", 2200); }
  function mode() { const r = document.querySelector('input[name="mode"]:checked'); return r ? r.value : "auto"; }
  function deep() { return $("#deep").checked; }
  function el(tag, text, cls) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function link(url, label) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label; return a; }

  // Mode filters visibility
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener("change", () => {
    document.querySelectorAll(".filters").forEach(f => f.classList.remove("active"));
    const m = mode(); const f = $("#f-" + m); if (f) f.classList.add("active");
  }));
  document.querySelectorAll(".chip").forEach(c => c.addEventListener("click", () => { q.value = c.dataset.q; run(c.dataset.q); }));
  go.addEventListener("click", () => run(q.value));
  q.addEventListener("keydown", e => { if (e.key === "Enter") run(q.value); });
  const agentGo = $("#agentGo");
  if (agentGo) agentGo.addEventListener("click", () => runAgent(q.value));
  document.querySelectorAll("[data-again]").forEach(b => b.addEventListener("click", () => {
    const base = (q.value || "").trim(); if (!base) return say("Type a query first");
    const k = b.dataset.again;
    const extra = { wider: "", recent: " recent 2026", cheaper: " under budget cheap", academic: " papers academic research" }[k] || "";
    run(base + extra);
  }));
  $("#planBtn").addEventListener("click", async () => {
    const query = q.value.trim(); if (!query) return say("Type a query first");
    try {
      const r = await fetch("api/intents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const j = await r.json();
      renderTrace(j.analysis, j.plan, { result_count: 0, serpapi_calls: 0 });
      say("Plan ready. Press Research to run.");
    } catch { say("Plan failed"); }
  });
  $("#saveBtn").addEventListener("click", () => {
    if (!last) return say("Nothing to save");
    const saved = JSON.parse(localStorage.getItem("serp_saved") || "[]");
    saved.unshift({ query: last.query, at: new Date().toISOString(), n: last.results_count });
    localStorage.setItem("serp_saved", JSON.stringify(saved.slice(0, 20)));
    renderSaved(); say("Saved");
  });
  $("#clearSaved").addEventListener("click", () => { localStorage.removeItem("serp_saved"); renderSaved(); });
  $("#compareBtn").addEventListener("click", renderCompare);

  function renderSaved() {
    const box = $("#saved"); box.textContent = "";
    const saved = JSON.parse(localStorage.getItem("serp_saved") || "[]");
    if (!saved.length) box.appendChild(el("p", "No saved yet.", null)).style.fontSize = "13px";
    saved.forEach(s => {
      const b = el("button", s.query.slice(0, 60), "btn"); b.style.display = "block"; b.style.marginBottom = "6px"; b.style.fontSize = "13px";
      b.addEventListener("click", () => { q.value = s.query; run(s.query); });
      box.appendChild(b);
    });
    const convs = $("#convs"); convs.textContent = "";
    const hist = JSON.parse(sessionStorage.getItem("serp_hist") || "[]");
    hist.slice(0, 8).forEach(h => {
      const p = el("p", h.slice(0, 60), null); p.style.fontSize = "13px"; p.style.margin = "4px 0"; convs.appendChild(p);
    });
  }

  async function run(rawQuery) {
    const query = (rawQuery || "").trim().slice(0, 500);
    if (!query) return say("Type a query first");
    cards.textContent = ""; srcEl.textContent = ""; cmpWrap.textContent = ""; $("#learn").style.display = "none";
    status.textContent = ""; const t = el("p", "Understanding request…"); t.setAttribute("aria-busy", "true");
    const pulse = el("span", null, "typing"); pulse.append(el("span"), el("span"), el("span")); status.append(t, pulse);
    const hist = JSON.parse(sessionStorage.getItem("serp_hist") || "[]"); hist.unshift(query); sessionStorage.setItem("serp_hist", JSON.stringify(hist.slice(0, 20))); renderSaved();
    try {
      // Prefer streaming for progress; fall back to JSON.
      const streamOk = await tryStream(query);
      if (!streamOk) {
        const r = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode: mode(), deep_research: deep() }) });
        if (r.status === 429) return say("Rate limited. Wait a moment.");
        if (!r.ok) throw new Error("HTTP " + r.status);
        last = await r.json();
        paint(last);
      }
    } catch (e) { status.textContent = ""; say("Request failed. Backend running?"); }
  }

  async function tryStream(query) {
    try {
      const r = await fetch("api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "text/event-stream" }, body: JSON.stringify({ query, mode: mode(), deep_research: deep() }) });
      if (!r.ok || !r.body) return false;
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ""; let final = null; let analysis = null, plan = null;
      status.textContent = "";
      const live = el("p", "Searching relevant sources…"); status.appendChild(live);
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop();
        for (const p of parts) {
          const m = p.match(/event: (\w+)\ndata: ([\s\S]*)/); if (!m) continue;
          const [, ev, data] = m;
          try {
            const j = JSON.parse(data);
            if (ev === "intent_detected") { analysis = j; live.textContent = "Classified: " + (j.intent || []).join(", "); }
            if (ev === "plan_created") { plan = j; live.textContent = "Plan: " + j.length + " steps."; }
            if (ev === "tool_started") live.textContent = "Searching: " + j.tool + "…";
            if (ev === "answer_complete") final = j;
          } catch { /* keep going */ }
        }
      }
      if (!final) return false;
      // Fetch full JSON for complete cards (stream truncates evidence for SSE size).
      const r2 = await fetch("api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode: mode(), deep_research: deep() }) });
      last = await r2.json(); paint(last); return true;
    } catch { return false; }
  }

  /* ---- Autonomous LLM agent (api/agent) ---- */
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
  function factsList(pairs) {
    const facts = document.createElement("ul"); facts.className = "facts";
    pairs.forEach(([k, v]) => {
      if (v == null || v === "") return;
      const li = document.createElement("li");
      li.appendChild(el("b", k + ": ")); li.appendChild(el("span", String(v).slice(0, 200)));
      facts.appendChild(li);
    });
    return facts;
  }

  async function runAgent(rawQuery) {
    const query = (rawQuery || "").trim().slice(0, 500);
    if (!query) return say("Type a query first");
    cards.textContent = ""; srcEl.textContent = ""; cmpWrap.textContent = ""; $("#learn").style.display = "none";
    status.textContent = "";
    const t = el("p", "Agent thinking: classifying request…"); t.setAttribute("aria-busy", "true");
    status.appendChild(t);
    try {
      const r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      if (r.status === 503) { status.textContent = ""; return say("LLM key missing. Set OPENROUTER_API_KEY in .env and restart."); }
      if (r.status === 429) { status.textContent = ""; return say("Rate limited. Wait a moment."); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      last = await r.json();
      paintAgent(last);
    } catch (e) { status.textContent = ""; say("Agent request failed. Backend running?"); }
  }

  function paintAgent(data) {
    status.textContent = ""; selected.clear();
    const cls = data.classification || {};
    renderTrace(
      { intent: [cls.use_case || "agent"].concat(data.legacy_intents || []), tools: (cls.steps || []).map(s => s.engine) },
      (cls.steps || []).map(s => ({ tool: s.engine, query: s.query })),
      data.research_trace || {}
    );
    if (data.status === "clarify") {
      const box = el("div", null, "card clarify");
      box.appendChild(el("strong", "One quick question: "));
      box.appendChild(el("span", data.clarifying_question || "Could you add a bit more detail?"));
      box.appendChild(el("p", "Refine your query above and press Agent again.", "meta"));
      cards.appendChild(box);
      q.focus();
      return;
    }
    const p = data.presentation || { type: "generic", results: [] };
    switch (p.type) {
      case "shopping_top2": paintShopping(p); break;
      case "youtube_path": paintVideos(p); break;
      case "finance_snapshot": paintFinance(p); break;
      case "deep_dive": paintDeepDive(p); break;
      case "travel_choices": paintTravel(p); break;
      default: (p.jobs || p.places || p.results || []).slice(0, 24).forEach((r, i) => cards.appendChild(card(r, i)));
    }
    srcEl.textContent = "";
    (data.sources || []).forEach(s => {
      const li = document.createElement("li");
      li.append(link(s.url || "#", (s.title || s.url || "source").slice(0, 90)), " ");
      li.appendChild(el("span", " [" + (s.type || "") + "] " + (s.claim || "").slice(0, 140), "meta"));
      srcEl.appendChild(li);
    });
    srcCount.textContent = String((data.sources || []).length);
    status.appendChild(el("p", (data.summary || "") + " Confidence: " + (data.confidence || "?") + ".", "meta"));
    animate();
  }

  function paintShopping(p) {
    (p.picks || []).slice(0, 2).forEach((item) => {
      const c = el("div", null, "card list-item"); c.setAttribute("data-kind", "product");
      const url = safeHttp(item.url);
      const imgSrc = item.image ? safeImg(item.image) : null;
      if (url && imgSrc) {
        const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "thumb"; a.setAttribute("aria-label", "Open product page");
        const img = document.createElement("img"); img.src = imgSrc; img.alt = String(item.title || "product").slice(0, 120); img.loading = "lazy";
        a.appendChild(img); c.appendChild(a);
      }
      c.appendChild(el("h3", String(item.title || "Product").slice(0, 120)));
      c.appendChild(factsList([
        ["Price", item.price], ["Seller", item.seller],
        ["Rating", item.rating != null ? item.rating + (item.reviews ? " (" + item.reviews + " reviews)" : "") : undefined],
        ["Why this", item.why],
      ]));
      const acts = el("div", null, "actions");
      if (url) acts.appendChild(link(url, "Open product page"));
      c.appendChild(acts);
      cards.appendChild(c);
    });
  }

  function paintVideos(p) {
    const order = [["beginner", "Start here"], ["intermediate", "Go deeper"], ["advanced", "Master it"]];
    order.forEach(([lvl, label]) => {
      const vids = ((p.levels || {})[lvl]) || [];
      if (!vids.length) return;
      cards.appendChild(el("h2", label + " (" + vids.length + ")"));
      vids.forEach((v) => {
        const c = el("div", null, "card list-item"); c.setAttribute("data-kind", "video");
        const url = safeHttp(v.url);
        const imgSrc = v.thumbnail ? safeImg(v.thumbnail) : null;
        if (url && imgSrc) {
          const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "thumb"; a.setAttribute("aria-label", "Watch video");
          const img = document.createElement("img"); img.src = imgSrc; img.alt = String(v.title || "video").slice(0, 120); img.loading = "lazy";
          a.appendChild(img); c.appendChild(a);
        }
        c.appendChild(el("h3", String(v.title || "Video").slice(0, 120)));
        c.appendChild(factsList([
          ["Channel", v.channel],
          ["Length", v.length],
          ["Views", fmtViews(v.views)],
          ["Why this", v.why],
        ]));
        const acts = el("div", null, "actions");
        if (url) acts.appendChild(link(url, "Watch"));
        c.appendChild(acts);
        cards.appendChild(c);
      });
    });
  }

  function paintFinance(p) {
    const qd = p.quote || {};
    const c = el("div", null, "card list-item"); c.setAttribute("data-kind", "finance");
    c.appendChild(el("h3", String(qd.stock_name || qd.symbol || "Quote").slice(0, 120)));
    c.appendChild(factsList([
      ["Symbol", qd.symbol], ["Price", qd.price],
      ["Change", [qd.price_change, qd.percent_change].filter(Boolean).join(" ") || undefined],
      ["Exchange", qd.exchange], ["Currency", qd.currency],
    ]));
    if (qd.summary) c.appendChild(el("p", String(qd.summary).slice(0, 280)));
    cards.appendChild(c);
    if ((p.headlines || []).length) {
      cards.appendChild(el("h2", "Latest headlines"));
      const ol = document.createElement("ol");
      p.headlines.forEach(h => {
        const li = document.createElement("li");
        const url = safeHttp(h.url);
        li.append(url ? link(url, String(h.title || url).slice(0, 120)) : el("span", String(h.title || "").slice(0, 120)));
        if (h.date) li.appendChild(el("span", " (" + h.date + ")", "meta"));
        ol.appendChild(li);
      });
      cards.appendChild(ol);
    }
    if (p.disclaimer) cards.appendChild(el("p", p.disclaimer, "meta"));
  }

  function paintDeepDive(p) {
    if (p.summary) cards.appendChild(el("p", p.summary, "lede"));
    if ((p.findings || []).length) {
      cards.appendChild(el("h2", "Key findings"));
      const ol = document.createElement("ol");
      p.findings.forEach(f => {
        const li = document.createElement("li");
        li.appendChild(el("span", String(f.claim || f.title || "").slice(0, 280)));
        const url = safeHttp(f.url);
        if (url) { li.appendChild(document.createTextNode(" ")); li.appendChild(link(url, "source")); }
        ol.appendChild(li);
      });
      cards.appendChild(ol);
    }
    if ((p.papers || []).length) {
      cards.appendChild(el("h2", "Papers"));
      p.papers.forEach((r, i) => cards.appendChild(card(r, i)));
    }
  }

  function paintTravel(p) {
    const note = el("p", p.note || "Planned and ready — no booking performed.", "meta");
    cards.appendChild(note);
    [["Flights", p.flights], ["Hotels", p.hotels], ["Places", p.places]].forEach(([label, list]) => {
      if (!list || !list.length) return;
      cards.appendChild(el("h2", label));
      list.forEach((r, i) => cards.appendChild(card(r, i)));
    });
  }

  function renderTrace(analysis, plan, summary) {    traceEl.textContent = "";
    const p1 = el("p", "Intent: " + (analysis.intent || []).join(", "));
    const p2 = el("p", "Tools: " + (analysis.tools || []).join(", "));
    const p3 = el("p", "Queries: " + (plan || []).map(s => s.tool + ": " + String(s.query).slice(0, 80)).join(" | "));
    const p4 = el("p", "Results: " + (summary.result_count || 0) + " discovered · calls " + (summary.serpapi_calls || 0));
    traceEl.append(p1, p2, p3, p4);
  }

  function paint(data) {
    status.textContent = "";
    selected.clear();
    renderTrace(data.analysis, data.plan, data.research_trace || {});
    // Learning plan staging (Phase 8)
    if (mode() === "learning" || (data.analysis.intent || []).includes("LEARNING")) paintLearning(data);
    // Cards
    const list = data.results || [];
    list.slice(0, 24).forEach((r, i) => cards.appendChild(card(r, i)));
    // Sources
    srcEl.textContent = "";
    (data.sources || []).forEach(s => {
      const li = document.createElement("li");
      li.append(link(s.url || "#", (s.title || s.url || "source").slice(0, 90)), " ");
      li.appendChild(el("span", " [" + (s.type || "") + "] " + (s.claim || "").slice(0, 140), "meta"));
      srcEl.appendChild(li);
    });
    srcCount.textContent = String((data.sources || []).length);
    // Summary + confidence + why hook
    const note = el("p", data.summary + " Confidence: " + data.confidence + ".", "meta");
    status.appendChild(note);
    animate();
  }

  function paintLearning(data) {
    const box = $("#learn"); box.style.display = "block"; const body = $("#learnBody"); body.textContent = "";
    body.appendChild(el("h2", "Learning path"));
    const stages = ["Goal", "Prerequisites", "Fundamentals", "Resources", "Projects", "Papers", "Advanced"];
    const ol = document.createElement("ol");
    stages.forEach((s, i) => {
      const li = document.createElement("li");
      const picks = (data.results || []).slice(i * 2, i * 2 + 2).map(r => r.title || r.name || "").filter(Boolean).join("; ").slice(0, 160);
      li.appendChild(el("strong", s + ": "));
      li.appendChild(el("span", picks || "See sources below."));
      ol.appendChild(li);
    });
    body.appendChild(ol);
  }

  function card(r, i) {
    const c = el("div", null, "card list-item");
    const kind = detectKind(r);
    if (kind) c.setAttribute("data-kind", kind);
    const title = r.title || r.name || r.airline || r.symbol || r.query || "Result";
    c.appendChild(el("h3", String(title).slice(0, 120)));
    const facts = document.createElement("ul"); facts.className = "facts";
    const add = (k, v) => { if (v == null || v === "") return; const li = document.createElement("li"); li.appendChild(el("b", k + ": ")); li.appendChild(el("span", String(v).slice(0, 160) + (k === "Price" || k === "Rating" ? "" : ""))); facts.appendChild(li); };
    add("Kind", kind || undefined);
    add("Company", r.company);
    add("Price", r.price);
    add("Pay", r.salary);
    add("Place", r.location || r.address);
    if (r.rating != null) add("Rating", r.rating + (r.reviews ? " (" + r.reviews + " reviews)" : ""));
    add("Authors", r.authors ? String(r.authors).slice(0, 100) : undefined);
    add("Date", r.date);
    if (facts.childNodes.length) c.appendChild(facts);
    if (r.snippet || r.description || r.summary) c.appendChild(el("p", String(r.snippet || r.description || r.summary).slice(0, 280)));
    const acts = el("div", null, "actions");
    const url = r.url || r.application_url || r.image_url || r.link;
    if (url) acts.appendChild(link(String(url).slice(0, 500), "Open"));
    const why = el("button", "Why this?", "btn"); why.type = "button";
    why.setAttribute("aria-label", "Why this result ranked");
    why.addEventListener("click", () => say(whyText(r)));
    acts.appendChild(why);
    const lab = el("label", null, null); const cb = document.createElement("input"); cb.type = "checkbox"; cb.setAttribute("aria-label", "Select for compare");
    cb.addEventListener("change", () => { if (cb.checked) selected.set(i, r); else selected.delete(i); });
    lab.append(cb, document.createTextNode(" Compare"));
    acts.appendChild(lab);
    c.appendChild(acts);
    return c;
  }

  function detectKind(r) {
    if (r.company || r.salary) return "job";
    if (r.price && (r.seller || r.reviews != null)) return "product";
    if (r.authors || r.citations != null) return "paper";
    if (r.source && r.date) return "news";
    if (r.address || r.rating) return "place";
    if (r.airline) return "flight";
    if (r.symbol || r.stock_name) return "finance";
    return "";
  }
  function whyText(r) {
    if (r.company) return "Ranked: role/company/location match with listed pay.";
    if (r.price) return "Ranked: price, rating, seller match.";
    if (r.authors) return "Ranked: recency, citations, topic match.";
    return "Ranked: relevance, freshness, source quality.";
  }

  function renderCompare() {
    cmpWrap.textContent = "";
    const items = [...selected.values()].slice(0, 3);
    if (items.length < 2) return say("Select 2-3 cards");
    const t = document.createElement("table"); t.className = "cmp";
    const head = document.createElement("tr");
    ["Field", ...items.map((_, i) => "Option " + (i + 1))].forEach(h => head.appendChild(el("th", h)));
    t.appendChild(head);
    const rows = [["Title", r => (r.title || r.name || "")], ["Price/Pay", r => (r.price || r.salary || "-")], ["Rating", r => String(r.rating ?? "-")], ["Source", r => (r.company || r.seller || r.source || "-")]];
    rows.forEach(([label, fn]) => {
      const tr = document.createElement("tr"); tr.appendChild(el("td", label));
      items.forEach(r => tr.appendChild(el("td", String(fn(r)).slice(0, 120))));
      t.appendChild(tr);
    });
    cmpWrap.appendChild(t); say("Comparison ready");
  }

  let heroPlayed = false;
  function animate() {
    try {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;
      if (window.gsap) {
        // Single orchestrated hero moment, once. Cards answer user action.
        if (!heroPlayed) { heroPlayed = true; gsap.from("#hero", { opacity: 0, y: 12, duration: 0.35, ease: "power1.out", overwrite: true }); }
        gsap.from(".list-item", { opacity: 0, y: 8, duration: 0.3, stagger: 0.03, ease: "power1.out", overwrite: true, clearProps: "all" });
      }
    } catch { /* no animation, content intact */ }
  }
  renderSaved();
})();
