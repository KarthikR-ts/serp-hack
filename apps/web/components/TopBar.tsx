"use client";

import { Command, MoonStars, SidebarSimple, Sun } from "@phosphor-icons/react";

/** Floating island nav. Detached pill, blur only here (fixed element). */
export function TopBar({
  status, sourceCount, onPalette, onToggleRail, onToggleInspector, theme, onTheme,
}: {
  status: { busy: boolean; error: boolean; text: string };
  sourceCount: number;
  onPalette: () => void;
  onToggleRail: () => void;
  onToggleInspector: () => void;
  theme: string;
  onTheme: () => void;
}) {
  return (
    <header className="sticky top-0 z-[30] px-3 pt-3 sm:px-5">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)]/85 px-2 pl-3 pr-2 shadow-[var(--shadow-float)] backdrop-blur-xl">
        <button type="button" className="iconbtn" onClick={onToggleRail} aria-label="Toggle library">
          <SidebarSimple size={18} weight="regular" />
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--ink)]">
            <span className="block h-3.5 w-3.5 rounded-full border-2 border-[var(--bg)]" />
            <span className="absolute block h-1.5 w-1.5 rounded-full bg-[var(--live)]" />
          </span>
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <strong className="truncate text-[14px] font-700 tracking-tight" style={{ fontWeight: 700 }}>
              Serp Intelligence
            </strong>
            <span className="truncate text-[11px] text-[var(--ink-3)]">Ask anything, see the research</span>
          </span>
        </div>

        <div className="flex flex-1 justify-center px-2">
          <span
            role="status"
            className="hidden max-w-[46vw] items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 py-1.5 text-[12.5px] text-[var(--ink-2)] md:inline-flex"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 flex-none rounded-full ${status.busy ? "pulse-dot bg-[var(--fam-commerce)]" : status.error ? "bg-[var(--error)]" : "bg-[var(--live)]"}`}
              style={{ background: status.busy ? "var(--fam-commerce)" : status.error ? "var(--error)" : "var(--live)" }}
            />
            {status.text}
          </span>
        </div>

        <button type="button" className="iconbtn !gap-2 !px-3" onClick={onPalette} aria-label="Command palette">
          <Command size={17} weight="regular" />
          <kbd className="hidden rounded-md border border-[var(--line)] px-1.5 font-mono text-[10.5px] text-[var(--ink-3)] lg:inline">
            ⌘K
          </kbd>
        </button>
        <a href="#sources" className="chip hidden !min-h-[36px] sm:inline-flex" aria-label="Jump to sources">
          Sources · <span className="tnum font-semibold">{sourceCount}</span>
        </a>
        <button
          type="button" className="iconbtn" onClick={onToggleInspector}
          aria-label="Toggle evidence panel" aria-pressed="true"
        >
          <SidebarSimple size={18} weight="regular" style={{ transform: "scaleX(-1)" }} />
        </button>
        <button type="button" className="iconbtn" onClick={onTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={17} weight="regular" /> : <MoonStars size={17} weight="regular" />}
        </button>
      </div>
    </header>
  );
}
