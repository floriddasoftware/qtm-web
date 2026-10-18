"use client";
import { useCallback, useEffect, useRef, useState } from "react";
const API_BASE = "https://qtm-api.onrender.com";
const REFRESH_INTERVAL = 5000;
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
function normalizeEntries(result, keys = []) {
  if (Array.isArray(result)) return result;
  for (const key of keys) {
    if (Array.isArray(result?.[key])) return result[key];
  }
  if (result && typeof result === "object") {
    for (const value of Object.values(result)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}
function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function getDepth(entry) {
  const direct =
    entry?.depth ??
    entry?.Depth ??
    entry?.coordinate?.depth ??
    entry?.structure?.depth;
  if (direct !== undefined && direct !== null) {
    return displayValue(direct);
  }
  const path = String(entry?.path ?? entry?.identifier ?? "");
  const match = path.match(/(?:^|[/.:_-])depth[/.:_-]?(\d+)/i);
  return match?.[1] ?? "—";
}
function getPathIdentifier(entry) {
  return String(
    entry?.path ??
      entry?.identifier ??
      entry?.network_path ??
      entry?.name ??
      entry?.id ??
      "",
  );
}
function getEventIdentifier(entry, index) {
  return String(
    entry?.event_id ??
      entry?.eventId ??
      entry?.activation ??
      entry?.heritage?.state?.activation_count ??
      entry?.id ??
      index + 1,
  );
}
function isWalletPayloadPath(entry) {
  const identifier = [
    getPathIdentifier(entry),
    entry?.name,
    entry?.kind,
    entry?.type,
    entry?.identifier,
  ]
    .filter(Boolean)
    .join(" ");
  return /qp\/wallet/i.test(identifier) ||
    /BitcoinPayload/i.test(identifier);
}
function formatTimestamp(value) {
  if (value === undefined || value === null || value === "") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
export default function NetworkPage() {
  const [networks, setNetworks] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventsError, setEventsError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const requestRef = useRef(null);
  const eventRequestRef = useRef(null);
  const loadNetworks = useCallback(async ({ silent = false } = {}) => {
    if (requestRef.current) requestRef.current.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!silent) setLoading(true);
    setError("");
    try {
      const result = await apiRequest("/networks", controller.signal);
      const entries = normalizeEntries(result, ["networks", "paths", "items"]);
      setNetworks(entries);
      setLastUpdated(new Date());
      setSelectedNetwork((current) => {
        if (!current) return null;
        return (
          entries.find(
            (entry) =>
              getPathIdentifier(entry) === getPathIdentifier(current),
          ) ?? null
        );
      });
    } catch (err) {
      if (err?.name !== "AbortError") {
        setError(
          err instanceof Error ? err.message : "Unable to load networks.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  const loadEvents = useCallback(
    async (network, { silent = false } = {}) => {
      if (!network) return;
      if (eventRequestRef.current) eventRequestRef.current.abort();
      const controller = new AbortController();
      eventRequestRef.current = controller;
      if (!silent) setEventsLoading(true);
      setEventsError("");
      const identifier = getPathIdentifier(network);
      const params = new URLSearchParams({
        path: identifier,
        id: displayValue(network.id),
        network: displayValue(network.name),
      });
      const endpoints = [
        `/events?${params.toString()}`,
        `/networks/${encodeURIComponent(identifier)}/events`,
      ];
      try {
        let result;
        let lastError;
        for (const endpoint of endpoints) {
          try {
            result = await apiRequest(endpoint, controller.signal);
            lastError = null;
            break;
          } catch (err) {
            if (err?.name === "AbortError") throw err;
            lastError = err;
          }
        }
        if (lastError) throw lastError;
        setEvents(
          normalizeEntries(result, ["events", "items", "entries", "results"]),
        );
        setLastUpdated(new Date());
      } catch (err) {
        if (err?.name !== "AbortError") {
          setEventsError(
            err instanceof Error ? err.message : "Unable to load events.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setEventsLoading(false);
      }
    },
    [],
  );
  const openNetwork = useCallback(
    (network) => {
      setSelectedNetwork(network);
      setEvents([]);
      setEventsError("");
      loadEvents(network);
    },
    [loadEvents],
  );
  useEffect(() => {
    loadNetworks();
    return () => {
      requestRef.current?.abort();
      eventRequestRef.current?.abort();
    };
  }, [loadNetworks]);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const interval = setInterval(() => {
      loadNetworks({ silent: true });
      if (selectedNetwork) {
        loadEvents(selectedNetwork, { silent: true });
      }
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [autoRefresh, loadNetworks, loadEvents, selectedNetwork]);
  const closeEvents = () => {
    eventRequestRef.current?.abort();
    setSelectedNetwork(null);
    setEvents([]);
    setEventsError("");
    setEventsLoading(false);
  };
  return (
    <main className="min-h-screen bg-zinc-50 px-2.5 py-5 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-4 sm:py-7 md:px-5 md:py-9 lg:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-5 sm:mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400 sm:text-xs">
            QuantPerm · QTM
          </p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl">
            Network
          </h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-600 dark:text-zinc-400 sm:text-sm sm:leading-6">
            Select any network path to inspect its event history and depth
            structure. Paths identified by qp/wallet or BitcoinPayload are
            treated as wallet payload paths. The tables refresh automatically.
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => loadNetworks()}
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300 sm:text-sm"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => setAutoRefresh((value) => !value)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 sm:text-sm"
            >
              Live updates: {autoRefresh ? "On" : "Off"}
            </button>
            <a
              href="/"
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 sm:text-sm"
            >
              Back to QTM
            </a>
          </div>
          <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
            {lastUpdated
              ? `Last updated ${lastUpdated.toLocaleTimeString()}`
              : "Waiting for API data"}
            {" · "}
            {REFRESH_INTERVAL / 1000}s refresh interval
          </p>
        </header>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300 sm:text-sm"
          >
            {error}
          </p>
        )}
        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
            <h2 className="text-sm font-semibold sm:text-base">
              Registered paths
            </h2>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
              {networks.length} path{networks.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs sm:text-sm">
              <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 sm:text-xs">
                <tr>
                  <th className="px-3 py-2.5 sm:px-4">Network</th>
                  <th className="px-3 py-2.5 sm:px-4">ID</th>
                  <th className="px-3 py-2.5 sm:px-4">Purpose</th>
                  <th className="px-3 py-2.5 sm:px-4">Path</th>
                  <th className="px-3 py-2.5 sm:px-4">Retained mass</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {networks.map((net, index) => {
                  const isSelected =
                    selectedNetwork &&
                    getPathIdentifier(selectedNetwork) ===
                      getPathIdentifier(net);
                  const isPayload = isWalletPayloadPath(net);
                  return (
                    <tr
                      key={`${net.id ?? getPathIdentifier(net)}-${index}`}
                      className={`cursor-pointer align-top transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        isSelected ? "bg-zinc-100 dark:bg-zinc-800" : ""
                      }`}
                      onClick={() => openNetwork(net)}
                    >
                      <td className="px-3 py-2.5 font-medium sm:px-4">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openNetwork(net);
                          }}
                          className="text-left underline decoration-zinc-300 underline-offset-4 hover:decoration-current"
                        >
                          {displayValue(net.name)}
                        </button>
                        {isPayload && (
                          <span className="mt-1 block text-[10px] text-zinc-500 dark:text-zinc-400">
                            Wallet payload
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400 sm:px-4 sm:text-xs">
                        {displayValue(net.id)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums sm:px-4">
                        {displayValue(net.purpose)}
                      </td>
                      <td className="break-all px-3 py-2.5 font-mono text-[10px] sm:px-4 sm:text-xs">
                        <span className="underline decoration-zinc-300 underline-offset-4">
                          {displayValue(net.path)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums sm:px-4">
                        {displayValue(net.coin)}
                      </td>
                    </tr>
                  );
                })}
                {!loading && networks.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:px-4 sm:text-sm"
                    >
                      No networks were returned by the API.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {selectedNetwork && (
          <section
            className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:mt-5"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Selected path · Event history
                </p>
                <h2 className="mt-1 break-all text-sm font-semibold sm:text-base">
                  {getPathIdentifier(selectedNetwork)}
                </h2>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                  <span>
                    ID: {displayValue(selectedNetwork.id)}
                  </span>
                  <span>·</span>
                  <span>
                    Depth: {getDepth(selectedNetwork)}
                  </span>
                  {isWalletPayloadPath(selectedNetwork) && (
                    <>
                      <span>·</span>
                      <span>BitcoinPayload / wallet path</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={eventsLoading}
                  onClick={() => loadEvents(selectedNetwork)}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {eventsLoading ? "Loading…" : "Refresh events"}
                </button>
                <button
                  type="button"
                  onClick={closeEvents}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>
            {eventsError && (
              <div className="px-3 pt-3 sm:px-4">
                <p
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                >
                  {eventsError}
                </p>
                <p className="mt-2 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                  The API must expose an event-list endpoint for this path.
                  Tried /events with path parameters and the
                  /networks/:path/events route.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:px-4">
              <h3 className="text-xs font-semibold sm:text-sm">
                Events
              </h3>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                {events.length} event{events.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <tr>
                    <th className="px-3 py-2.5 sm:px-4">Event</th>
                    <th className="px-3 py-2.5 sm:px-4">Depth</th>
                    <th className="px-3 py-2.5 sm:px-4">Identifier</th>
                    <th className="px-3 py-2.5 sm:px-4">Type</th>
                    <th className="px-3 py-2.5 sm:px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {events.map((event, index) => (
                    <tr
                      key={`${getEventIdentifier(event, index)}-${index}`}
                      className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    >
                      <td className="px-3 py-2.5 font-medium sm:px-4">
                        {getEventIdentifier(event, index)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums sm:px-4">
                        {getDepth(event)}
                      </td>
                      <td className="max-w-[260px] break-all px-3 py-2.5 font-mono text-[10px] sm:px-4">
                        {displayValue(
                          event.path ??
                            event.identifier ??
                            event.commitment ??
                            event.id,
                        )}
                      </td>
                      <td className="px-3 py-2.5 sm:px-4">
                        {displayValue(
                          event.type ??
                            event.kind ??
                            event.event_type ??
                            (event.heritage ? "Heritage" : "Event"),
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-500 dark:text-zinc-400 sm:px-4">
                        {formatTimestamp(
                          event.timestamp ??
                            event.created_at ??
                            event.time,
                        )}
                      </td>
                    </tr>
                  ))}
                  {!eventsLoading &&
                    !eventsError &&
                    events.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400 sm:px-4"
                        >
                          No events returned for this path.
                        </td>
                      </tr>
                    )}
                  {eventsLoading && events.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400 sm:px-4"
                      >
                        Loading events…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {events.some(
              (event) =>
                event.depth !== undefined ||
                event.structure !== undefined ||
                event.children !== undefined,
            ) && (
              <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
                <h3 className="mb-2 text-xs font-semibold">
                  Depth structure
                </h3>
                <div className="space-y-1.5">
                  {events.map((event, index) => (
                    <details
                      key={`depth-${getEventIdentifier(event, index)}-${index}`}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800"
                    >
                      <summary className="cursor-pointer px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        Depth {getDepth(event)} · Event{" "}
                        {getEventIdentifier(event, index)}
                      </summary>
                      <div className="space-y-1 border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
                        {Object.entries(event).map(([key, value]) => (
                          <div
                            key={key}
                            className="grid grid-cols-[minmax(90px,0.7fr)_minmax(0,1.5fr)] gap-3"
                          >
                            <span className="break-words text-zinc-500 dark:text-zinc-400">
                              {key}
                            </span>
                            <span className="break-all font-mono">
                              {displayValue(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
        <footer className="mt-6 border-t border-zinc-200 pt-3.5 text-[10px] leading-5 text-zinc-500 dark:border-zinc-800 sm:mt-8 sm:pt-4 sm:text-xs">
          QTM Network · Live read-only diagnostics · qtm-api
        </footer>
      </div>
    </main>
  );
}