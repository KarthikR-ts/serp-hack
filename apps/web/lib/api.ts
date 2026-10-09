import type { AgentResponse, ChatResponse } from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
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
  chat: (query: string, opts: { mode?: string; deep?: boolean; filters?: Record<string, unknown>; signal?: AbortSignal } = {}) =>
    post<ChatResponse>("/api/chat", {
      query,
      mode: opts.mode || "auto",
      deep_research: !!opts.deep,
      filters: opts.filters || {},
    }, opts.signal),
  agent: (query: string, opts: { filters?: Record<string, unknown>; signal?: AbortSignal } = {}) =>
    post<AgentResponse>("/api/agent", { query, filters: opts.filters || {} }, opts.signal),
  intents: (query: string, signal?: AbortSignal) =>
    post<{ analysis: ChatResponse["analysis"]; plan: ChatResponse["plan"]; estimated_calls: number; estimated_seconds: number; requires_confirmation: boolean }>(
      "/api/intents", { query }, signal
    ),
  usage: async () => {
    const r = await fetch(`${API_URL}/api/usage`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
};

export interface StreamProgress {
  stage: string;
  detail?: string;
}

/** POST SSE stream; calls onProgress per event. Resolves false when unusable. */
export async function streamChat(
  query: string,
  opts: { mode: string; deep: boolean; filters: Record<string, unknown>; signal?: AbortSignal },
  onProgress: (p: StreamProgress) => void
): Promise<boolean> {
  const r = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ query, mode: opts.mode, deep_research: opts.deep, filters: opts.filters }),
    signal: opts.signal,
  });
  if (!r.ok || !r.body) return false;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", events = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const p of parts) {
      const m = p.match(/event: (\w+)\ndata: ([\s\S]*)/);
      if (!m) continue;
      events++;
      try {
        const j = JSON.parse(m[2]);
        if (m[1] === "intent_detected") onProgress({ stage: "intent", detail: (j.intent || []).join(", ") });
        else if (m[1] === "plan_created") onProgress({ stage: "plan", detail: String(j.length) });
        else if (m[1] === "tool_started") onProgress({ stage: "tool", detail: j.tool });
        else if (m[1] === "synthesis_started") onProgress({ stage: "synthesis" });
      } catch { /* keep going */ }
    }
  }
  return events > 0;
}
