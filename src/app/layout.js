import { Geist, Geist_Mono } from “next/font/google”;
import “./globals.css”;

const sans = Geist({ variable: “–font-geist-sans”, subsets: [“latin”], display: “swap” });
const mono = Geist_Mono({ variable: “–font-geist-mono”, subsets: [“latin”], display: “swap” });

export const metadata = {
title: { default: “QTM Substrate Console”, template: “%s | QTM” },
description: “Create and explore QuantPerm substrates, inspect state, and follow transitions and events.”,
applicationName: “QTM”,
};

function QTMMark() {
return (
);
}

function Frame({ id, title, children, defaultOpen = true, className = “” }) {
return (
<details id={id} open={defaultOpen} className={group min-w-0 ${className}}>
{title}
{children}
);
}

export default function RootLayout({ children }) {
return (
<html lang=“en” className={${sans.variable} ${mono.variable} min-h-full antialiased}>
Skip to content
    <div className="flex min-h-screen w-full flex-col">
      <header className="shrink-0 border-b border-zinc-200/80 bg-[#fdfdfb]/90 backdrop-blur-md dark:border-zinc-800 dark:bg-[#151514]/90">
        <div className="mx-auto w-full max-w-[1920px] px-3 sm:px-5 lg:px-8">
          <Frame id="qtm-header-frame" title="Workspace identity" className="py-1">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-2 pb-2 sm:flex-nowrap">
              <a href="/" className="group flex min-w-0 items-center gap-3" aria-label="QTM home">
                <span><QTMMark /></span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold tracking-tight">QTM</span>
                  <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">Substrate workspace</span>
                </span>
              </a>
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="hidden md:inline">Create, explore, and transition</span>
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                <span>QTM</span>
              </div>
            </div>
          </Frame>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-[1920px] min-w-0 flex-1 px-3 py-3 sm:px-5 sm:py-5 lg:px-8 lg:py-7">
        <Frame id="qtm-main-frame" title="Substrate console" className="w-full rounded-2xl border border-zinc-200/80 bg-white/60 p-2 shadow-sm sm:p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
          <div className="w-full min-w-0">{children}</div>
        </Frame>
      </main>
      <footer className="mt-auto w-full shrink-0 border-t border-zinc-200/80 bg-[#fdfdfb]/75 dark:border-zinc-800 dark:bg-[#151514]/75">
        <div className="mx-auto w-full max-w-[1920px] px-3 py-3 sm:px-5 lg:px-8">
          <Frame id="qtm-footer-frame" title="Workspace navigation" defaultOpen={false}>
            <div className="flex flex-col gap-2 px-2 pb-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:text-zinc-400">
              <span>QTM Substrate Workspace</span>
              <nav aria-label="Workspace sections" className="flex flex-wrap items-center gap-2">
                {["Create", "Open", "Transit", "Exile"].map((label, i) => (
                  <span key={label} className="inline-flex items-center gap-2">
                    {i > 0 && <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>}
                    <a className="hover:text-indigo-600 dark:hover:text-indigo-400" href="#main-content">{label}</a>
                  </span>
                ))}
              </nav>
            </div>
          </Frame>
        </div>
      </footer>
    </div>
  </body>
</html>

);
}