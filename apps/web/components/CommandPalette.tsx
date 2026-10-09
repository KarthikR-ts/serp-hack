"use client";

import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export interface PaletteCmd { id: string; label: string; hint?: string; run: () => void; }

export function CommandPalette({
  open, onClose, commands, onAsk,
}: {
  open: boolean; onClose: () => void;
  commands: PaletteCmd[];
  onAsk: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  const reduce = useReducedMotion();

  useEffect(() => {
    if (open) setQ("");
  }, [open ]);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(needle));
  }, [q, commands]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[50] flex justify-center bg-black/50 p-3"
          initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label="Command palette"
            className="surface mt-[10dvh] h-fit max-h-[68dvh] w-full max-w-[580px] overflow-hidden !rounded-[16px]"
            initial={reduce ? false : { opacity: 0, transform: "translateY(-8px) scale(0.99)" }}
            animate={{ opacity: 1, transform: "none" }}
            exit={reduce ? undefined : { opacity: 0, transform: "translateY(-6px)" }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="flex items-center gap-2 border-b border-[var(--line)] p-3.5 text-[var(--ink-3)]">
              <MagnifyingGlass size={16} />
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = q.trim();
                    if (!v) return;
                    if (hits.length) { hits[0].run(); onClose(); }
                    else { onAsk(v); onClose(); }
                  }
                  if (e.key === "Escape") onClose();
                }}
                placeholder="Type a command or ask anything"
                aria-label="Command palette"
                className="w-full bg-transparent text-[15px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
              />
              <kbd className="rounded-md border border-[var(--line)] px-1.5 font-mono text-[10.5px]">esc</kbd>
            </div>
            <div role="listbox" aria-label="Commands" className="max-h-[52dvh] overflow-auto p-1.5">
              {hits.map((c) => (
                <button
                  key={c.id} role="option" aria-selected="false" type="button"
                  onClick={() => { c.run(); onClose(); }}
                  className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[14px] hover:bg-[var(--surface-2)]"
                >
                  {c.label}
                  {c.hint && <span className="tnum ml-auto font-mono text-[11px] text-[var(--ink-3)]">{c.hint}</span>}
                </button>
              ))}
              {!hits.length && (
                <p className="px-3 py-2 text-[13px] text-[var(--ink-3)]">
                  No command matches. Press Enter to research “{q.trim().slice(0, 60)}”.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
