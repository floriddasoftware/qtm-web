
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
    template: "%s | QTM",
  },
  description:
    "Create and explore QuantPerm substrates, inspect state, and follow transitions and events.",
  applicationName: "QTM",
};

function QTMMark() {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-8 w-8"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width="34"
        height="34"
        rx="5"
        stroke="currentColor"
        strokeOpacity="0.18"
      />
      <path
        d="M18 5.5L29 12V24L18 30.5L7 24V12L18 5.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M18 5.5V18M7 12L18 18L29 12M18 18V30.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.65"
      />
      <circle cx="18" cy="18" r="2.5" fill="currentColor" />
    </svg>
  );
}

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} min-h-full antialiased`}
    >
      <body className="min-h-screen bg-[#f8f8f6] font-sans text-zinc-900 selection:bg-indigo-100 selection:text-indigo-950 dark:bg-[#111110] dark:text-zinc-100 dark:selection:bg-indigo-900 dark:selection:text-white">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-zinc-300 focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-sm dark:focus:border-zinc-700 dark:focus:bg-zinc-900"
        >
          Skip to content
        </a>

        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.07),_transparent_68%)]"
        />

        <div className="flex min-h-screen flex-col">
          <header className="shrink-0 border-b border-zinc-200/80 bg-[#fdfdfb]/90 dark:border-zinc-800 dark:bg-[#151514]/90">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
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

              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="hidden sm:inline">
                  Create, explore, and transition
                </span>
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-indigo-500"
                />
                <span>QTM</span>
              </div>
            </div>
          </header>

          <main
            id="main-content"
            className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-7 lg:px-8"
          >
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>

          <footer className="mt-auto shrink-0">
            <div className="mx-auto w-full max-w-7xl px-4 pb-4 sm:px-6 lg:px-8">
              <div className="flex flex-col gap-2 border-t border-zinc-200/80 pt-3 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
                <span>QTM Substrate Workspace</span>
                <nav
                  aria-label="Workspace sections"
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <span>Create</span>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span>Open</span>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span>Transit</span>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span>Exile</span>
                </nav>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
