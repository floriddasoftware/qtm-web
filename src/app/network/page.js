"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";

async function apiRequest(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      body?.error || `Request failed with HTTP ${response.status}`,
    );
  }

  return body;
}

export default function NetworkPage() {
  const [networks, setNetworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadNetworks = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const result = await apiRequest("/networks");
      const entries = Array.isArray(result.networks) ? result.networks : [];
      setNetworks(entries);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load networks.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNetworks();
  }, [loadNetworks]);

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Network
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Every registered coin/path combination the Rust API knows about.
            The retained mass column is each network&apos;s{" "}
            <code>CoinType::retained_mass()</code> value — the coin type&apos;s
            own numeric id (Bitcoin 0, Ethereum 60, Tron 195, Solana 501),
            not a live balance.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={loadNetworks}
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>

            <a
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Back to QTM
            </a>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="mb-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-base font-semibold">Registered networks</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {networks.length} network{networks.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th scope="col" className="px-4 py-3">Network</th>
                  <th scope="col" className="px-4 py-3">Id</th>
                  <th scope="col" className="px-4 py-3">Purpose</th>
                  <th scope="col" className="px-4 py-3">Derivation path</th>
                  <th scope="col" className="px-4 py-3">Retained mass</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {networks.map((net) => (
                  <tr key={net.id} className="align-top">
                    <td className="px-4 py-3 font-medium">{net.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {net.id}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{net.purpose}</td>
                    <td className="break-all px-4 py-3 font-mono text-xs">
                      {net.path}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {net.coin}
                    </td>
                  </tr>
                ))}

                {!loading && networks.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      No networks were returned by the API.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-8 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
          QTM Network · Read-only diagnostics · Data from qtm-api /networks
        </footer>
      </div>
    </main>
  );
}
