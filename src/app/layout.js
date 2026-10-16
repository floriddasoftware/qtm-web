import { Geist, Geist_Mono } from “next/font/google”;
import “./globals.css”;

const geistSans = Geist({
variable: “–font-geist-sans”,
subsets: [“latin”],
display: “swap”,
});

const geistMono = Geist_Mono({
variable: “–font-geist-mono”,
subsets: [“latin”],
display: “swap”,
});

export const metadata = {
title: {
default: “QTM Substrate Console”,
template: “%s | QTM”,
},
description:
“Create and explore QuantPerm substrates, inspect state, and follow transitions and events.”,
applicationName: “QTM”,
};

function QTMMark() {
return (
);
}

function Frame({
id,
title,
children,
defaultOpen = true,
className = “”,
}) {
return (
<details
id={id}
open={defaultOpen}
className={group min-w-0 ${className}}
>
{title}
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition group-open:rotate-180 dark:border-zinc-700 dark:text-zinc-400"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className="h-4 w-4"
      >
        <path
          d="m5 7.5 5 5 5-5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  </summary>
  <div className="min-w-0 px-1 pb-2 pt-1">
    {children}
  </div>
</details>

);
}

export default function RootLayout({ children }) {
return (
<html
lang=“en”
className={${geistSans.variable} ${geistMono.variable} min-h-full antialiased}
>
Skip to content
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.09),_transparent_68%)]"
    />
    <div className="flex min-h-screen w-full flex-col">
      <header className="shrink-0 border-b border-zinc-200/80 bg-[#fdfdfb]/90 backdrop-blur-md dark:border-zinc-800 dark:bg-[#151514]/90">
        <div className="mx-auto w-full max-w-[1920px] px-3 sm:px-5 lg:px-8">
          <Frame
            id="qtm-header-frame"
            title="Workspace identity"
            className="py-1"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-2 pb-2 sm:flex-nowrap">
              <a
                href="/"
                className="group flex min-w-0 items-center gap-3"
                aria-label="QTM home"
              >
                <span className="text-zinc-800 dark:text-zinc-100">
                  <QTMMark />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold tracking-[-0.035em]">
                    QTM
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                    Substrate workspace
                  </span>
                </span>
              </a>
              <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="hidden md:inline">
                  Create, explore, and transition
                </span>
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
                />
                <span>QTM</span>
              </div>
            </div>
          </Frame>
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto w-full max-w-[1920px] min-w-0 flex-1 px-3 py-3 sm:px-5 sm:py-5 lg:px-8 lg:py-7"
      >
        <Frame
          id="qtm-main-frame"
          title="Substrate console"
          className="w-full rounded-2xl border border-zinc-200/80 bg-white/60 p-2 shadow-sm shadow-zinc-900/[0.02] sm:p-3 dark:border-zinc-800 dark:bg-zinc-900/30"
        >
          <div className="mx-auto w-full min-w-0 max-w-none">
            {children}
          </div>
        </Frame>
      </main>
      <footer className="mt-auto w-full shrink-0 border-t border-zinc-200/80 bg-[#fdfdfb]/75 dark:border-zinc-800 dark:bg-[#151514]/75">
        <div className="mx-auto w-full max-w-[1920px] px-3 py-3 sm:px-5 lg:px-8">
          <Frame
            id="qtm-footer-frame"
            title="Workspace navigation"
            defaultOpen={false}
          >
            <div className="flex flex-col gap-2 px-2 pb-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:text-zinc-400">
              <span>QTM Substrate Workspace</span>
              <nav
                aria-label="Workspace sections"
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <a className="transition hover:text-indigo-600 dark:hover:text-indigo-400" href="#main-content">
                  Create
                </a>
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                <a className="transition hover:text-indigo-600 dark:hover:text-indigo-400" href="#main-content">
                  Open
                </a>
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                <a className="transition hover:text-indigo-600 dark:hover:text-indigo-400" href="#main-content">
                  Transit
                </a>
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                <a className="transition hover:text-indigo-600 dark:hover:text-indigo-400" href="#main-content">
                  Exile
                </a>
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