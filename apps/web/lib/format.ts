// Locale-aware formatting. Prices never silently converted.

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  try { return new Intl.NumberFormat(undefined).format(n); }
  catch { return String(n); }
}

export function fmtViews(v: number | null | undefined): string {
  if (v == null) return "";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M views`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K views`;
  return `${v} views`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 24);
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days < 7 && days >= 0) {
    try {
      const r = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
      if (days < 1) {
        const h = Math.max(1, Math.round(days * 24));
        return r.format(-h, "hour");
      }
      return r.format(-Math.round(days), "day");
    } catch { /* fall through */ }
  }
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}
