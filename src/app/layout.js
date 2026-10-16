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
default: “QTM | Substrate Console”,
template: “%s · QTM”,
},
description:
“A QuantPerm substrate interface for creating substrates, receiving QuantumTransactions, traversing QP44 events, and inspecting state and transition heritage.”,
applicationName: “QTM Substrate Console”,
};

export default function RootLayout({ children }) {
return (
<html
lang=“en”
className={${geistSans.variable} ${geistMono.variable} h-full antialiased}
>
    <div className="relative z-10 min-h-screen">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-50 rounded-md bg-white px-4 py-2 text-sm font-semibold text-zinc-950 shadow-lg focus:not-sr-only dark:bg-zinc-900 dark:text-white"
      >
        Skip to content
      </a>
      <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-5 sm:px-6 sm:pt-8 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 border-b border-zinc-200/80 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-white text-indigo-700 shadow-sm dark:border-indigo-900 dark:bg-zinc-900 dark:text-indigo-300"
            >
              <svg
                viewBox="0 0 40 40"
                fill="none"
                className="size-7"
              >
                <path
                  d="M20 4.5 33.4 12.25v15.5L20 35.5 6.6 27.75v-15.5L20 4.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="m20 11 7.5 4.5v9L20 29l-7.5-4.5v-9L20 11Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="20" cy="20" r="2.5" fill="currentColor" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-700 dark:text-indigo-300">
                QuantPerm · QTM
              </p>
              <p className="mt-1 truncate text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                Substrate Console
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300">
              <span className="size-1.5 rounded-full bg-indigo-500" />
              State
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Transition
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Event
            </span>
          </div>
        </header>
        <main id="main-content" className="min-w-0">
          {children}
        </main>
        <footer className="mt-12 border-t border-zinc-200/80 pt-5 dark:border-zinc-800">
          <div className="flex flex-col gap-2 text-xs leading-5 text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:text-zinc-500">
            <p>
              QTM Substrate Console
              <span className="mx-2 text-zinc-300 dark:text-zinc-700">
                /
              </span>
              QuantPerm state and event inspection
            </p>
            <p className="font-mono">
              CREATE · OPEN · TRANSIT · EXILE
            </p>
          </div>
        </footer>
      </div>
    </div>
  </body>
</html>

);
}