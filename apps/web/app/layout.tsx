import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Newsreader } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
// Reading serif justified: long evidence answers need sustained on-screen reading.
// Editorial trust register, not decoration. Pairs on contrast axis with grotesk UI.
const reading = Newsreader({
  subsets: ["latin"],
  variable: "--font-reading",
  display: "swap",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Serp Intelligence — Ask anything, see the research",
  description:
    "Plain-language research across jobs, products, papers, news and places. Agent shows route, sources and confidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} ${reading.variable}`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("serp_theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}else if(matchMedia("(prefers-color-scheme: light)").matches){document.documentElement.dataset.theme="light";}}catch(e){}})();`,
          }}
        />
        <a
          href="#answer"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-[var(--surface)] focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to answer
        </a>
        {children}
      </body>
    </html>
  );
}
