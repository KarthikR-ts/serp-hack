"use client";

import { useEffect, useRef } from "react";

/** Adds .in when visible; once. Respects reduced motion via CSS. */
export function Reveal({
  children,
  index = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
  as?: "div" | "article" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      node.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.disconnect();
          }
        }
      },
      { threshold: 0.05 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return (
    // @ts-expect-error dynamic tag with ref
    <Tag ref={ref} className={`reveal ${className}`} style={{ "--i": index } as React.CSSProperties}>
      {children}
    </Tag>
  );
}
