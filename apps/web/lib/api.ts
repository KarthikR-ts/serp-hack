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

export function safeHttp(url: unknown): string | null {
  try {
    const u = new URL(String(url || ""), "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}

export function safeImg(url: unknown): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}
