
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: {
    default: "QTM Substrate Console",
    template: "%s | QTM Substrate Console",
  },
  description:
    "Manage QuantPerm substrates and inspect QTM state, transition heritage, and transit events.",
  applicationName: "QTM Substrate Console",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-50 font-sans text-zinc-950 dark:bg-black dark:text-zinc-50">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-zinc-950 focus:shadow-lg"
        >
          Skip to content
        </a>

        <div className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-80 bg-gradient-to-b from-indigo-100/70 via-violet-50/40 to-transparent dark:from-indigo-950/30 dark:via-violet-950/10" />

        <header className="border-b border-zinc-200/80 bg-white/75 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/70">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <a href="/" className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm dark:bg-white dark:text-zinc-950">
                <svg
                  viewBox="0 0 40 40"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-7 w-7"
                  aria-hidden="true"
                >
                  <path
                    d="M20 4L35 12.5V27.5L20 36L5 27.5V12.5L20 4Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M20 4V20M5 12.5L20 20L35 12.5M20 20V36"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <circle cx="20" cy="20" r="3" fill="currentColor" />
                </svg>
              </span>

              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight">
                  QTM Substrate Console
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                  QuantPerm · State · Transition · Events
                </span>
              </span>
            </a>

            <span className="hidden rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-600 sm:inline-flex dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              Substrate interface
            </span>
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
        >
          {children}
        </main>

        <footer className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6 lg:px-8">
          <div className="border-t border-zinc-200/80 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            QTM Substrate Console
            <span className="mx-2 text-zinc-300 dark:text-zinc-700">·</span>
            Create
            <span className="mx-1.5">/</span>
            Open
            <span className="mx-1.5">/</span>
            Transit
            <span className="mx-1.5">/</span>
            Exile
          </div>
        </footer>
      </body>
    </html>
  );
}
