"use client";

import { Command, MoonStars, SidebarSimple, Sun } from "@phosphor-icons/react";

/** Stitch: thin operational header, fog wash, hairline rule, harbour ink. */
export function TopBar({
  status, sourceCount, onPalette, onToggleRail, onToggleInspector, theme, onTheme, inspectorOpen,
}: {
  status: { busy: boolean; error: boolean; text: string };
  sourceCount: number;
  onPalette: () => void;
  onToggleRail: () => void;
  onToggleInspector: () => void;
  theme: string;
  onTheme: () => void;
  inspectorOpen?: boolean;
}) {
  return (
    <header className="sticky top-0 z-[30] border-b border-[var(--line)] bg-[var(--surface-low)]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1340px] items-center gap-2 px-4 lg:px-8">
        <button type="button" className="iconbtn" onClick={onToggleRail} aria-label="Toggle library">
          <SidebarSimple size={18} weight="regular" />
        </button>
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid h-8 w-8 flex-none place-items-center rounded-[6px] bg-[var(--primary-container)]">
            <span className="block h-3.5 w-3.5 rounded-full border-2 border-white/90" />
          </span>
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <strong className="truncate text-[13px] font-bold tracking-tight text-[var(--primary)]">
              Intellect Engine
            </strong>
            <span className="truncate font-mono text-[12px] text-[var(--ink-2)]">SerpApi × Haystack</span>
          </span>
        </div>

        <div className="flex flex-1 justify-center px-2">
          <span
            role="status"
            className="hidden max-w-[46vw] items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--paper)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--ink-2)] md:inline-flex"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 flex-none rounded-full ${status.busy ? "pulse-dot" : ""}`}
              style={{ background: status.busy ? "var(--status-caution)" : status.error ? "var(--status-error)" : "var(--status-success)" }}
            />
            {status.text}
          </span>
        </div>

        <button type="button" className="iconbtn !gap-2 !px-3" onClick={onPalette} aria-label="Command palette">
          <Command size={17} weight="regular" />
          <kbd className="hidden rounded border border-[var(--line)] px-1.5 font-mono text-[10.5px] text-[var(--ink-3)] lg:inline">
            ⌘K
          </kbd>
        </button>
        <a href="#sources" className="chip hidden !min-h-[36px] sm:inline-flex" aria-label="Jump to sources">
          Sources · <span className="tnum font-semibold">{sourceCount}</span>
        </a>
        <button
          type="button" className="iconbtn" onClick={onToggleInspector}
          aria-label="Toggle evidence panel" aria-pressed={inspectorOpen ?? undefined}
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
