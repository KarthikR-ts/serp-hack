// API client. Relative /api preferred (Next rewrite proxies to FastAPI).
// Falls back to NEXT_PUBLIC_API_URL for separate deploys.
const BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

const p = (path: string) => (BASE ? `${BASE}${path}` : path);

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(p(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (r.status === 429) throw new Error("LIMIT");
  if (r.status === 503) throw new Error("NOKEY");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const api = {
  chat: (
    query: string,
    opts: { mode?: string; deep?: boolean; filters?: Record<string, unknown>; signal?: AbortSignal } = {},
  ) =>
    post<import("./types").ChatResponse>("/api/chat", {
      query, mode: opts.mode || "auto",
      deep_research: !!opts.deep, filters: opts.filters || {},
    }, opts.signal),
  agent: (query: string, opts: { filters?: Record<string, unknown>; signal?: AbortSignal } = {}) =>
    post<import("./types").AgentResponse>("/api/agent", { query, filters: opts.filters || {} }, opts.signal),
  intents: (query: string, signal?: AbortSignal) =>
    post<{
      analysis: import("./types").ChatResponse["analysis"];
      plan: import("./types").ChatResponse["plan"];
      estimated_calls: number; estimated_seconds: number; requires_confirmation: boolean;
    }>("/api/intents", { query }, signal),
  usage: async () => {
    const r = await fetch(p("/api/usage"));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<{
      queries: number; serpapi_calls: number; calls_per_query: number;
      failed_calls: number; calls_by_tool: Record<string, number>; uptime_seconds: number;
    }>;
  },
};

export interface StreamProgress { stage: string; detail?: string; }

/** POST SSE stream. Returns false when stream unusable (caller falls back). */
export async function streamChat(
  query: string,
  opts: { mode: string; deep: boolean; filters: Record<string, unknown>; signal?: AbortSignal },
  onProgress: (p: StreamProgress) => void,
): Promise<boolean> {
  const r = await fetch(p("/api/chat/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ query, mode: opts.mode, deep_research: opts.deep, filters: opts.filters }),
    signal: opts.signal,
  });
  if (!r.ok || !r.body) return false;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = r.body.getReader();
  } catch { return false; }
  const dec = new TextDecoder();
  let buf = "", events = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const m = part.match(/event: (\w+)\ndata: ([\s\S]*)/);
      if (!m) continue;
      events++;
      try {
        const j = JSON.parse(m[2]);
        if (m[1] === "intent_detected") onProgress({ stage: "intent", detail: (j.intent || []).join(", ") });
        else if (m[1] === "plan_created") onProgress({ stage: "plan", detail: String(j.length ?? "?") });
        else if (m[1] === "tool_started") onProgress({ stage: "tool", detail: j.tool });
        else if (m[1] === "synthesis_started") onProgress({ stage: "synthesis" });
      } catch { /* keep streaming */ }
    }
  }
  return events > 0;
}

export type AgentStreamEvent =
  | { type: "reasoning"; text: string }
  | { type: "task_started"; id: string; label: string }
  | { type: "task_done"; id: string; label: string; count?: number }
  | { type: "tool_started"; tool: string; query?: string }
  | { type: "tool_completed"; tool: string; status?: string; count?: number }
  | { type: "answer_complete"; payload: import("./types").AgentResponse }
  | { type: "error"; code: string }
  | { type: "progress"; stage: string; detail?: string };

/** POST SSE stream for the agent path. Mirrors streamChat; resolves with
 *  the full payload from `answer_complete`. Throws on `error` events. */
export async function streamAgent(
  query: string,
  opts: { filters?: Record<string, unknown>; signal?: AbortSignal } = {},
  onEvent: (e: AgentStreamEvent) => void = () => {},
): Promise<import("./types").AgentResponse | null> {
  const r = await fetch(p("/api/agent/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ query, filters: opts.filters || {} }),
    signal: opts.signal,
  });
  if (!r.ok || !r.body) return null;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = r.body.getReader();
  } catch { return null; }
  const dec = new TextDecoder();
  let buf = "", final: import("./types").AgentResponse | null = null;
  const emit = (name: string, data: Record<string, unknown>) => {
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    const n = (v: unknown) => (typeof v === "number" ? v : undefined);
    switch (name) {
      case "reasoning":
        if (s(data.text)) { onEvent({ type: "reasoning", text: s(data.text) }); onEvent({ type: "progress", stage: "reasoning", detail: s(data.text) }); }
        break;
      case "task_started":
        onEvent({ type: "task_started", id: s(data.id), label: s(data.label) });
        onEvent({ type: "progress", stage: "task", detail: s(data.label) });
        break;
      case "task_done":
        onEvent({ type: "task_done", id: s(data.id), label: s(data.label), count: n(data.count) });
        break;
      case "tool_started":
        onEvent({ type: "tool_started", tool: s((data as Record<string, unknown>).tool), query: s((data as Record<string, unknown>).query) });
        onEvent({ type: "progress", stage: "tool", detail: s((data as Record<string, unknown>).tool) });
        break;
      case "tool_completed":
        onEvent({
          type: "tool_completed",
          tool: s((data as Record<string, unknown>).tool),
          status: s((data as Record<string, unknown>).status) || undefined,
          count: n((data as Record<string, unknown>).count),
        });
        break;
      case "answer_complete": {
        const payload = (data.payload || data) as import("./types").AgentResponse;
        final = payload;
        onEvent({ type: "answer_complete", payload });
        break;
      }
      case "error":
        onEvent({ type: "error", code: s((data as Record<string, unknown>).code) || "FAILED" });
        throw new Error(`AGENT:${s((data as Record<string, unknown>).code) || "FAILED"}`);
      default:
        break;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const ev = part.match(/^event:\s*([A-Za-z_]+)\s*\ndata:\s*([\s\S]*)\s*$/m);
      if (!ev) continue;
      try { emit(ev[1], JSON.parse(ev[2])); }
      catch (e) {
        const msg = (e as Error)?.message || "";
        if (msg.startsWith("AGENT:")) throw new Error(msg.slice(6));
        /* keep streaming */
      }
    }
  }
  // Flush trailing buffered event (no trailing blank line).
  if (buf.trim()) {
    const ev = buf.match(/^event:\s*([A-Za-z_]+)\s*\ndata:\s*([\s\S]*)\s*$/m);
    if (ev) {
      try { emit(ev[1], JSON.parse(ev[2])); } catch (_e) { /* ignore */ }
    }
  }
  return final;
}

export function safeHttp(url: unknown): string | null {
  try {
    const u = new URL(String(url || ""), "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch (_e) { return null; }
}

export function safeImg(url: unknown): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}
