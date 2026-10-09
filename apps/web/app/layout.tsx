import type { Metadata } from "next";
import { Literata, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const ui = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const read = Literata({
  subsets: ["latin"],
  variable: "--font-read",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Serp Intelligence — Universal Web Intelligence",
  description: "Ask in plain language. The agent chooses where to research and shows its work.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="system" suppressHydrationWarning>
      <body className={`${ui.variable} ${read.variable}`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("serp_theme");if(t)document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
