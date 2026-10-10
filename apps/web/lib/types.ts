// Shared contracts. Backend remains source of truth; Zod-free, narrow types.
export type RouteStatus =
  | "planned" | "running" | "ok" | "empty" | "failed" | "skipped" | "cached";

export interface RouteLine {
  id: string;
  vertical: string;
  name: string;
  family: "web" | "research" | "live" | "career" | "commerce" | "place" | string;
  status: RouteStatus;
  result_count: number;
  latency_ms: number;
  query: string;
  error?: string | null;
}

export interface WhyItem { criterion: string; met: boolean; text: string; }

/** Agentic handoff: one outbound button per pick. Read-only — the
 *  transaction happens on the provider site, never in this app. */
export interface Action {
  id: string;
  kind: "book_flight" | "book_hotel" | "buy" | "apply" | "watch" | "read" | "directions" | "tickets" | "open" | string;
  label: string;
  url: string;
  external: boolean;
  result_ref?: number;
  provider?: string;
  note?: string;
}

export interface ApiResult {
  title?: string; name?: string;
  url?: string; application_url?: string; link?: string;
  image?: string; thumbnail?: string;
  price?: string; numeric_price?: number | null;
  seller?: string; rating?: number | null; reviews?: number | null;
  company?: string; salary?: string; location?: string;
  employment_type?: string; posted_at?: string; source?: string;
  authors?: string | string[]; citations?: number | null;
  abstract?: string; snippet?: string; description?: string; summary?: string;
  date?: string; published_date?: string;
  channel?: string; length?: string; views?: number | null;
  airline?: string; symbol?: string; stock_name?: string;
  address?: string; availability?: string;
  why?: WhyItem[]; evidence_ids?: string[];
  action?: Action | null;
  set_aside_reason?: string; _engine?: string;
  [key: string]: unknown;
}

export interface ApiSource {
  id: string; title: string; url: string; domain: string;
  type: string; claim: string; claim_type: string; tool: string;
  date?: string | null;
}

export interface Funnel {
  discovered: number; matched: number; set_aside: number;
  reasons: { label: string; count: number }[];
  set_aside_results?: (ApiResult & { set_aside_reason?: string })[];
}

export interface Confidence { level: string; reasons: string[]; }
export interface Completeness { state: string; message: string; }
export interface Budget {
  calls_used: number; calls_limit: number;
  seconds_used: number; seconds_limit: number;
}
export interface Refinement { id: string; label: string; estimated_calls?: number; }
export interface PlanStep { id: number; action: string; tool: string; query: string; }

export interface ChatResponse {
  query: string; mode: string;
  analysis: {
    intent: string[]; entities: string[]; constraints: Record<string, unknown>; tools: string[];
    steps?: { tool?: string; engine?: string; query: string }[];
  };
  plan: PlanStep[];
  constraints: Record<string, unknown>;
  results: ApiResult[]; results_count: number;
  sources: ApiSource[]; route: RouteLine[];
  funnel: Funnel; confidence: Confidence | string;
  completeness: Completeness; budget: Budget;
  refinements: Refinement[];
  research_trace: Record<string, unknown>;
  summary: string;
}

export interface AgentPresentation {
  type: string;
  picks?: ApiResult[];
  levels?: Record<string, ApiResult[]>;
  quote?: ApiResult;
  headlines?: { title: string; url: string; date?: string; source?: string }[];
  disclaimer?: string; summary?: string;
  findings?: { claim: string; url: string; title: string }[];
  papers?: ApiResult[];
  flights?: ApiResult[]; hotels?: ApiResult[]; places?: ApiResult[];
  note?: string; jobs?: ApiResult[]; results?: ApiResult[];
  goal?: string; actions?: Action[];
  stages?: { stage: string; topics: { title: string; url: string }[] }[];
}

export interface AgentResponse {
  status: "ok" | "clarify";
  query: string; model?: string;
  constraints?: Record<string, unknown>;
  classification: {
    use_case: string; presentation: string;
    steps: { engine: string; query: string; num_results: number }[];
    reasoning: string;
  };
  legacy_intents?: string[];
  clarifying_question?: string;
  slots?: Record<string, string>;
  missing_slots?: string[];
  presentation?: AgentPresentation;
  sources?: ApiSource[]; results_count?: number;
  funnel?: Funnel; route?: RouteLine[];
  confidence?: Confidence | string;
  refinements?: Refinement[]; budget?: Budget;
  research_trace?: Record<string, unknown>;
  summary?: string;
}

export type RunData =
  | { kind: "chat"; data: ChatResponse }
  | { kind: "agent"; data: AgentResponse };
