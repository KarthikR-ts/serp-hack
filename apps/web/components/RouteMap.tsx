"use client";

import type { Budget, RouteLine } from "../lib/types";

const FAM_VAR: Record<string, string> = {
  web: "var(--fam-web)",
  research: "var(--fam-research)",
  live: "var(--fam-live)",
  career: "var(--fam-career)",
  commerce: "var(--fam-commerce)",
  place: "var(--fam-place)",
};

function Terminal({ line, x, y }: { line: RouteLine; x: number; y: number }) {
  const color = FAM_VAR[line.family] || FAM_VAR.web;
  if (line.status === "ok")
    return (
      <g>
        <circle cx={x} cy={y} r={9} fill={color} />
        <text x={x + 16} y={y + 4} fontSize={12} fill="var(--ink-2)" style={{ fontVariantNumeric: "tabular-nums" }}>
          {line.result_count}
        </text>
      </g>
    );
  if (line.status === "empty")
    return (
      <g>
        <circle cx={x} cy={y} r={9} fill="none" stroke={color} strokeWidth={2} />
        <text x={x + 16} y={y + 4} fontSize={12} fill="var(--ink-2)">0</text>
      </g>
    );
  if (line.status === "failed")
    return (
      <text x={x} y={y + 5} fontSize={14} fill="var(--error)" aria-label="failed">
        ✕
      </text>
    );
  return (
    <text x={x} y={y + 4} fontSize={12} fill="var(--ink-3)">
      … skipped
    </text>
  );
}

export function RouteMap({
  route,
  budget,
  onFilter,
  activeVertical,
}: {
  route: RouteLine[];
  budget?: Budget;
  onFilter: (v: string | null) => void;
  activeVertical: string | null;
}) {
  const H = 44 + route.length * 38;
  const okN = route.filter((l) => l.status === "ok").length;
  const bad = route.filter((l) => l.status === "failed").length;
  return (
    <section aria-label="Route" className="surface p-4 my-4">
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <h2 className="text-[15px] m-0 font-semibold">Route</h2>
        <span className="text-[13px] text-[var(--ink-2)]">
          {okN} of {route.length} sources loaded{bad ? ` · ${bad} didn&apos;t load` : ""}
        </span>
        {budget && (
          <span className="text-[13px] text-[var(--ink-2)]" style={{ fontVariantNumeric: "tabular-nums" }}>
            {budget.calls_used} of {budget.calls_limit} searches · {budget.seconds_used}s
          </span>
        )}
      </div>
      <svg viewBox={`0 0 640 ${H}`} role="img" aria-hidden="true" className="block w-full h-auto">
        <circle cx={24} cy={H / 2} r={10} fill="none" stroke="var(--ink)" strokeWidth={2} />
        {route.map((line, i) => {
          const y = 44 + i * 38;
          const color = FAM_VAR[line.family] || FAM_VAR.web;
          const dim = activeVertical && activeVertical !== line.vertical;
          return (
            <g
              key={line.id}
              className={`route-line-g${dim ? " dim" : ""}`}
              onClick={() => onFilter(activeVertical === line.vertical ? null : line.vertical)}
            >
              <line
                x1={40} x2={500} y1={y} y2={y}
                stroke={color} strokeWidth={2}
                strokeDasharray={line.status === "failed" ? "2 8" : undefined}
                className="route-draw" style={{ "--i": i } as React.CSSProperties}
              />
              <circle cx={150} cy={y} r={4} fill={color}><title>{line.query || line.name}</title></circle>
              <circle cx={300} cy={y} r={4} fill={color}><title>{line.query || line.name}</title></circle>
              <Terminal line={line} x={516} y={y} />
              <text x={40} y={y - 8} fontSize={13} fill="var(--ink-2)">{line.name}</text>
            </g>
          );
        })}
        <g className="route-merge">
          <circle cx={590} cy={H / 2} r={14} fill="var(--ink)" />
          <text x={590} y={H / 2 + 5} textAnchor="middle" fill="var(--bg)" fontSize={12}>≡</text>
          <title>Answer</title>
        </g>
      </svg>
      <ol aria-label="Sources used, text version" className="md:hidden list-none m-0 p-0 mt-2">
        {route.map((line) => (
          <li key={line.id} className="my-1">
            <button
              type="button" onClick={() => onFilter(activeVertical === line.vertical ? null : line.vertical)}
              className="w-full text-left text-sm p-2 min-h-[44px] rounded-md border border-transparent hover:border-[var(--rule)]"
            >
              {line.name}: {line.status === "ok" ? `${line.result_count} results` : line.status === "failed" ? "didn't load" : line.status}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
