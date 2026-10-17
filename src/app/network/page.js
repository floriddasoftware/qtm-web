"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
const API_BASE = "https://qtm-api.onrender.com";
async function apiRequest(path, signal) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      body?.error || `Request failed with HTTP ${response.status}`,
    );
  }
  return body;
}
function formatValue(value, fallback = "—") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return JSON.stringify(value);
}
function getNetworkId(network) {
  return formatValue(network?.id, "");
}
function getNetworkKey(network, index) {
  return getNetworkId(network) || `${network?.name || "network"}-${index}`;
}
function getNetworkName(network) {
  return formatValue(network?.name, "Unnamed network");
}
function getNetworkDescription(network) {
  const parts = [];
  if (network?.coin !== undefined) {
    parts.push(`Coin type: ${formatValue(network.coin)}`);
  }
  if (network?.purpose !== undefined) {
    parts.push(`Purpose: ${formatValue(network.purpose)}`);
  }
  if (network?.path) {
    parts.push(`Path: ${formatValue(network.path)}`);
  }
  return parts.join(" · ");
}
function NetworkCard({ network, index }) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold">
            {getNetworkName(network)}
          </h3>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {getNetworkId(network) || `Network ${index + 1}`}
          </p>
        </div>
        <span className="shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
          Registered
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-md bg-zinc-50 p-3 dark:bg-zinc-950">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            Purpose
          </dt>
          <dd className="mt-1 break-words text-sm font-medium">
            {formatValue(network?.purpose)}
          </dd>
        </div>
        <div className="min-w-0 rounded-md bg-zinc-50 p-3 dark:bg-zinc-950">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            Coin type / retained mass
          </dt>
          <dd className="mt-1 break-words font-mono text-sm font-medium">
            {formatValue(network?.coin)}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            Derivation path
          </dt>
          <dd className="mt-1 break-all font-mono text-sm">
            {formatValue(network?.path)}
          </dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            Network ID
          </dt>
          <dd className="mt-1 break-all font-mono text-sm">
            {formatValue(network?.id)}
          </dd>
        </div>
      </dl>
    </article>
  );
}
export default function NetworkPage() {
  const [networks, setNetworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [view, setView] = useState("cards");
  const [search, setSearch] = useState("");
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const loadNetworks = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest("/networks", signal);
      const entries = Array.isArray(result?.networks)
        ? result.networks
        : [];
      setNetworks(entries);
      setSelectedNetworkId((current) => {
        if (entries.some((network) => getNetworkId(network) === current)) {
          return current;
        }
        return getNetworkId(entries[0]) || "";
      });
      setLastUpdated(new Date());
    } catch (err) {
      if (err?.name === "AbortError") return;
      setError(
        err instanceof Error ? err.message : "Unable to load networks.",
      );
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadNetworks(controller.signal);
    return () => controller.abort();
  }, [loadNetworks]);
  const filteredNetworks = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return networks;
    return networks.filter((network) =>
      [
        network?.name,
        network?.id,
        network?.coin,
        network?.purpose,
        network?.path,
      ].some((value) => String(value ?? "").toLowerCase().includes(term)),
    );
  }, [networks, search]);
  const selectedNetwork = useMemo(
    () =>
      networks.find(
        (network) => getNetworkId(network) === selectedNetworkId,
      ) || null,
    [networks, selectedNetworkId],
  );
  const countsByCoin = useMemo(() => {
    const counts = new Map();
    for (const network of networks) {
      const coin = formatValue(network?.coin, "Unknown");
      counts.set(coin, (counts.get(coin) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [networks]);
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-7">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                QuantPerm · QTM
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Network registry
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Inspect the registered coin and derivation-path combinations
                returned by the Rust API. This is registry metadata, not live
                blockchain balances or a transaction feed.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => loadNetworks()}
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
          </div>
        </header>
        {error && (
          <div
            role="alert"
            className="mb-5 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="break-words">{error}</p>
            <button
              type="button"
              onClick={() => loadNetworks()}
              disabled={loading}
              className="h-9 shrink-0 rounded-md border border-red-300 px-3 font-medium hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900"
            >
              Try again
            </button>
          </div>
        )}
        <section
          aria-label="Network summary"
          className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Registered networks
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {loading && networks.length === 0 ? "…" : networks.length}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Distinct coin values
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {loading && networks.length === 0 ? "…" : countsByCoin.length}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              API status
            </p>
            <p className="mt-2 flex items-center gap-2 text-base font-semibold">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  error
                    ? "bg-red-500"
                    : loading
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
              />
              {error ? "Unavailable" : loading ? "Connecting" : "Connected"}
            </p>
            {lastUpdated && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Updated {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
        </section>
        <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="network-search"
                className="mb-2 block text-sm font-medium"
              >
                Search networks
              </label>
              <input
                id="network-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, ID, coin type, purpose, or path"
                className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:w-64">
              <label
                htmlFor="network-selector"
                className="text-sm font-medium"
              >
                Inspect a network
              </label>
              <select
                id="network-selector"
                value={selectedNetworkId}
                onChange={(event) => setSelectedNetworkId(event.target.value)}
                disabled={networks.length === 0}
                className="h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
              >
                {networks.length === 0 && <option value="">No networks</option>}
                {networks.map((network, index) => (
                  <option
                    key={getNetworkKey(network, index)}
                    value={getNetworkId(network)}
                  >
                    {getNetworkName(network)} · {getNetworkId(network) || "No ID"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedNetwork && (
            <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Selected network
              </p>
              <h2 className="mt-1 break-words text-lg font-semibold">
                {getNetworkName(selectedNetwork)}
              </h2>
              <p className="mt-2 break-words text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {getNetworkDescription(selectedNetwork) || "No additional metadata returned."}
              </p>
            </div>
          )}
        </section>
        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-base font-semibold">Registered networks</h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Showing {filteredNetworks.length} of {networks.length}
              </p>
            </div>
            <div
              aria-label="Network display mode"
              className="inline-flex self-start rounded-md border border-zinc-200 p-1 dark:border-zinc-700"
            >
              <button
                type="button"
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
                className={`rounded px-3 py-2 text-xs font-medium ${
                  view === "cards"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                Cards
              </button>
              <button
                type="button"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
                className={`rounded px-3 py-2 text-xs font-medium ${
                  view === "table"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                Table
              </button>
            </div>
          </div>
          {loading && networks.length === 0 ? (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-48 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800"
                />
              ))}
            </div>
          ) : filteredNetworks.length === 0 ? (
            <div className="px-4 py-12 text-center sm:px-6">
              <p className="text-sm font-medium">
                {networks.length === 0
                  ? "No networks were returned by the API."
                  : "No networks match your search."}
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {networks.length === 0
                  ? "Refresh to try loading the network registry again."
                  : "Try a different name, ID, coin type, purpose, or path."}
              </p>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-4 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : view === "cards" ? (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredNetworks.map((network, index) => (
                <NetworkCard
                  key={getNetworkKey(network, index)}
                  network={network}
                  index={index}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <tr>
                    <th scope="col" className="px-4 py-3">Network</th>
                    <th scope="col" className="px-4 py-3">ID</th>
                    <th scope="col" className="px-4 py-3">Purpose</th>
                    <th scope="col" className="px-4 py-3">Derivation path</th>
                    <th scope="col" className="px-4 py-3">Coin type / retained mass</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredNetworks.map((network, index) => (
                    <tr
                      key={getNetworkKey(network, index)}
                      className={`align-top ${
                        getNetworkId(network) === selectedNetworkId
                          ? "bg-zinc-50 dark:bg-zinc-800/50"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium">
                        {getNetworkName(network)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {formatValue(network?.id)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {formatValue(network?.purpose)}
                      </td>
                      <td className="break-all px-4 py-3 font-mono text-xs">
                        {formatValue(network?.path)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {formatValue(network?.coin)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
          <h2 className="text-sm font-semibold">Coin type reference</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            The API&apos;s <code>coin</code> value represents the registered
            coin type&apos;s numeric identifier, not a wallet balance.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Bitcoin", "0"],
              ["Ethereum", "60"],
              ["Tron", "195"],
              ["Solana", "501"],
            ].map(([name, id]) => (
              <div
                key={name}
                className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-950"
              >
                <p className="text-sm font-medium">{name}</p>
                <p className="mt-1 font-mono text-sm text-zinc-500 dark:text-zinc-400">
                  {id}
                </p>
              </div>
            ))}
          </div>
        </section>
        <footer className="mt-8 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          QTM Network · Read-only diagnostics · Source: qtm-api <code>/networks</code>
        </footer>
      </div>
    </main>
  );
}