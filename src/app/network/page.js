
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

function getDepth(entry) {
  const direct =
    entry?.depth ??
    entry?.Depth ??
    entry?.coordinate?.depth ??
    entry?.structure?.depth;

  if (direct !== undefined && direct !== null) {
    return displayValue(direct);
  }

  const match = getPathIdentifier(entry).match(
    /(?:^|[/.:_-])depth[/.:_-]?(\d+)/i,
  );

  return match?.[1] ?? "—";
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
  if (value === undefined || value === null || value === "") {
    return "—";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

function getEventTimestamp(event) {
  return (
    event?.timestamp ??
    event?.created_at ??
    event?.time ??
    event?.persisted_at ??
    null
  );
}

function getEventType(event) {
  return (
    event?.type ??
    event?.kind ??
    event?.event_type ??
    (event?.heritage ? "Heritage" : "Event")
  );
}

function getEventIdentifierValue(event) {
  return (
    event?.path ??
    event?.identifier ??
    event?.commitment ??
    event?.id ??
    "—"
  );
}

function diagnosticClass(status) {
  if (status === "live") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300";
  }

  if (status === "error") {
    return "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
  }

  if (status === "checking") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";
  }

  return "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

function DiagnosticBadge({ status, children }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-medium ${diagnosticClass(status)}`}
    >
      {children}
    </span>
  );
}

function DiagnosticValue({ label, value }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 break-all text-xs font-medium">
        {displayValue(value)}
      </p>
    </div>
  );
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
  const [eventsUpdated, setEventsUpdated] = useState(null);

  const [autoRefresh, setAutoRefresh] = useState(true);

  // Per-path diagnostics are keyed by path identity, never table position.
  const [pathDiagnostics, setPathDiagnostics] = useState({});
  const [systemDiagnostics, setSystemDiagnostics] = useState(null);

  const requestRef = useRef(null);
  const eventRequestRef = useRef(null);
  const diagnosticRequestRef = useRef(null);

  const selectedPathRef = useRef(null);
  const diagnosticInFlightRef = useRef(new Set());

  const loadNetworks = useCallback(async ({ silent = false } = {}) => {
    requestRef.current?.abort();

    const controller = new AbortController();
    requestRef.current = controller;

    if (!silent) setLoading(true);
    setError("");

    try {
      const result = await apiRequest("/networks", controller.signal);
      const entries = normalizeEntries(result, [
        "networks",
        "paths",
        "items",
      ]);

      if (controller.signal.aborted) return;

      setNetworks(entries);
      setLastUpdated(new Date());

      setSelectedNetwork((current) => {
        if (!current) return null;

        const identifier = getPathIdentifier(current);

        return (
          entries.find(
            (entry) => getPathIdentifier(entry) === identifier,
          ) ?? current
        );
      });

      // Remove diagnostic entries for paths no longer registered.
      const registered = new Set(entries.map(getPathIdentifier));

      setPathDiagnostics((current) => {
        const next = {};

        for (const [identifier, diagnostic] of Object.entries(current)) {
          if (registered.has(identifier)) {
            next[identifier] = diagnostic;
          }
        }

        return next;
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

      const identifier = getPathIdentifier(network);

      if (!identifier) {
        setEventsError("This registration has no usable path identifier.");
        return;
      }

      eventRequestRef.current?.abort();

      const controller = new AbortController();
      eventRequestRef.current = controller;

      if (!silent) setEventsLoading(true);
      setEventsError("");

      const params = new URLSearchParams({
        path: identifier,
      });

      if (network.id !== undefined && network.id !== null) {
        params.set("id", String(network.id));
      }

      if (network.name) {
        params.set("network", String(network.name));
      }

      // Prefer a path-scoped persistent event endpoint.
      // The query endpoint is a compatibility fallback.
      const endpoints = [
        `/networks/${encodeURIComponent(identifier)}/events`,
        `/events?${params.toString()}`,
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
        if (controller.signal.aborted) return;

        const entries = normalizeEntries(result, [
          "events",
          "items",
          "entries",
          "results",
        ]);

        setEvents(entries);
        setEventsUpdated(new Date());

        // Liveness means the registered path's event store was reachable.
        setPathDiagnostics((current) => ({
          ...current,
          [identifier]: {
            ...current[identifier],
            eventStore: "live",
            eventCount: entries.length,
            latestEvent: entries.length
              ? getEventTimestamp(entries[entries.length - 1])
              : null,
            eventsCheckedAt: new Date().toISOString(),
            eventError: null,
          },
        }));
      } catch (err) {
        if (err?.name !== "AbortError") {
          const message =
            err instanceof Error ? err.message : "Unable to load events.";

          setEventsError(message);

          setPathDiagnostics((current) => ({
            ...current,
            [identifier]: {
              ...current[identifier],
              eventStore: "error",
              eventsCheckedAt: new Date().toISOString(),
              eventError: message,
            },
          }));
        }
      } finally {
        if (!controller.signal.aborted) setEventsLoading(false);
      }
    },
    [],
  );

  const loadPathDiagnostics = useCallback(
    async (network, { silent = false } = {}) => {
      if (!network) return;

      const identifier = getPathIdentifier(network);
      if (!identifier) return;

      // Avoid overlapping diagnostics for the same path.
      if (diagnosticInFlightRef.current.has(identifier)) return;

      diagnosticInFlightRef.current.add(identifier);

      setPathDiagnostics((current) => ({
        ...current,
        [identifier]: {
          ...current[identifier],
          registration: "live",
          diagnostics: "checking",
          eventStore: current[identifier]?.eventStore ?? "unknown",
          checkedAt: current[identifier]?.checkedAt ?? null,
        },
      }));

      try {
        const params = new URLSearchParams({ path: identifier });

        // These endpoints must be implemented by the API to return
        // authoritative system diagnostics for a specific registration.
        const endpoints = [
          `/networks/${encodeURIComponent(identifier)}/diagnostics`,
          `/diagnostics?${params.toString()}`,
        ];

        let result;
        let lastError;

        for (const endpoint of endpoints) {
          try {
            result = await apiRequest(endpoint);
            lastError = null;
            break;
          } catch (err) {
            if (err?.name === "AbortError") throw err;
            lastError = err;
          }
        }

        if (lastError) throw lastError;

        const diagnostic = result?.diagnostics ?? result;

        setPathDiagnostics((current) => ({
          ...current,
          [identifier]: {
            ...current[identifier],
            registration: "live",
            diagnostics: "live",
            system: diagnostic,
            checkedAt: new Date().toISOString(),
            diagnosticError: null,
          },
        }));
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Path diagnostics are unavailable.";

        setPathDiagnostics((current) => ({
          ...current,
          [identifier]: {
            ...current[identifier],
            registration: "live",
            diagnostics: "error",
            checkedAt: new Date().toISOString(),
            diagnosticError: message,
          },
        }));

        if (!silent) {
          setEventsError((current) => current || message);
        }
      } finally {
        diagnosticInFlightRef.current.delete(identifier);
      }
    },
    [],
  );

  const openNetwork = useCallback(
    (network) => {
      const identifier = getPathIdentifier(network);

      selectedPathRef.current = identifier;
      setSelectedNetwork(network);
      setEvents([]);
      setEventsError("");
      setEventsUpdated(null);
      setSystemDiagnostics(null);

      loadEvents(network);
      loadPathDiagnostics(network);
    },
    [loadEvents, loadPathDiagnostics],
  );

  useEffect(() => {
    loadNetworks();

    return () => {
      requestRef.current?.abort();
      eventRequestRef.current?.abort();
      diagnosticRequestRef.current?.abort();
    };
  }, [loadNetworks]);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const interval = setInterval(() => {
      loadNetworks({ silent: true });

      const identifier = selectedPathRef.current;

      if (identifier) {
        const network = networks.find(
          (entry) => getPathIdentifier(entry) === identifier,
        );

        if (network) {
          loadEvents(network, { silent: true });
          loadPathDiagnostics(network, { silent: true });
        }
      }
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [
    autoRefresh,
    loadNetworks,
    loadEvents,
    loadPathDiagnostics,
    networks,
  ]);

  useEffect(() => {
    if (!selectedNetwork) {
      setSystemDiagnostics(null);
      return;
    }

    const identifier = getPathIdentifier(selectedNetwork);

    setSystemDiagnostics(
      pathDiagnostics[identifier]?.system ?? null,
    );
  }, [selectedNetwork, pathDiagnostics]);

  const closeEvents = () => {
    eventRequestRef.current?.abort();
    diagnosticRequestRef.current?.abort();

    selectedPathRef.current = null;

    setSelectedNetwork(null);
    setEvents([]);
    setEventsError("");
    setEventsLoading(false);
    setEventsUpdated(null);
    setSystemDiagnostics(null);
  };

  const selectedIdentifier = selectedNetwork
    ? getPathIdentifier(selectedNetwork)
    : "";

  const selectedDiagnostic = selectedIdentifier
    ? pathDiagnostics[selectedIdentifier] ?? {}
    : {};

  const liveCount = networks.filter(
    (network) =>
      pathDiagnostics[getPathIdentifier(network)]?.eventStore === "live",
  ).length;

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
            Each registered path is an entry point to its system diagnostics
            and persistent event history. Event-store access, not registration
            alone, establishes path liveness.
          </p>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => loadNetworks()}
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 sm:text-sm"
            >
              {loading ? "Loading…" : "Refresh network"}
            </button>

            <button
              type="button"
              onClick={() => setAutoRefresh((value) => !value)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3.5 text-xs font-medium dark:border-zinc-700 sm:text-sm"
            >
              Live updates: {autoRefresh ? "On" : "Off"}
            </button>

            <a
              href="/"
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-300 px-3.5 text-xs font-medium dark:border-zinc-700 sm:text-sm"
            >
              Back to QTM
            </a>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <DiagnosticBadge status="live">
              {liveCount} event stores reachable
            </DiagnosticBadge>

            <DiagnosticBadge status="unknown">
              {networks.length} registered paths
            </DiagnosticBadge>
          </div>

          <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
            {lastUpdated
              ? `Network checked ${lastUpdated.toLocaleTimeString()}`
              : "Waiting for API data"}
            {" · "}
            {REFRESH_INTERVAL / 1000}s refresh interval
          </p>
        </header>

        {error && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
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
              Select a path to open its diagnostics
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs sm:text-sm">
              <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 sm:text-xs">
                <tr>
                  <th className="px-3 py-2.5 sm:px-4">Network</th>
                  <th className="px-3 py-2.5 sm:px-4">ID</th>
                  <th className="px-3 py-2.5 sm:px-4">Depth</th>
                  <th className="px-3 py-2.5 sm:px-4">Path</th>
                  <th className="px-3 py-2.5 sm:px-4">Persistent store</th>
                  <th className="px-3 py-2.5 sm:px-4">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {networks.map((net, index) => {
                  const identifier = getPathIdentifier(net);
                  const diagnostic = pathDiagnostics[identifier] ?? {};
                  const isSelected = selectedIdentifier === identifier;

                  return (
                    <tr
                      key={`${net.id ?? identifier}-${index}`}
                      className={`align-top transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        isSelected ? "bg-zinc-100 dark:bg-zinc-800" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-medium sm:px-4">
                        <button
                          type="button"
                          onClick={() => openNetwork(net)}
                          className="break-all text-left underline decoration-zinc-300 underline-offset-4"
                        >
                          {displayValue(net.name ?? identifier)}
                        </button>

                        {isWalletPayloadPath(net) && (
                          <span className="mt-1 block text-[10px] text-zinc-500 dark:text-zinc-400">
                            Wallet payload
                          </span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 font-mono text-[10px] text-zinc-500 sm:px-4 sm:text-xs">
                        {displayValue(net.id)}
                      </td>

                      <td className="px-3 py-2.5 tabular-nums sm:px-4">
                        {getDepth(net)}
                      </td>

                      <td className="break-all px-3 py-2.5 font-mono text-[10px] sm:px-4 sm:text-xs">
                        {identifier}
                      </td>

                      <td className="px-3 py-2.5 sm:px-4">
                        <DiagnosticBadge
                          status={diagnostic.eventStore ?? "unknown"}
                        >
                          {diagnostic.eventStore === "live"
                            ? `${diagnostic.eventCount ?? 0} events`
                            : diagnostic.eventStore === "error"
                              ? "Unavailable"
                              : "Not checked"}
                        </DiagnosticBadge>
                      </td>

                      <td className="px-3 py-2.5 sm:px-4">
                        <button
                          type="button"
                          onClick={() => openNetwork(net)}
                          className="whitespace-nowrap rounded-md border border-zinc-300 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-700 sm:text-xs"
                        >
                          Inspect path →
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!loading && networks.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-xs text-zinc-500 sm:px-4 sm:text-sm"
                    >
                      No registered paths were returned by the API.
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
                  Path diagnostics
                </p>

                <h2 className="mt-1 break-all text-sm font-semibold sm:text-base">
                  {selectedIdentifier}
                </h2>

                <div className="mt-2 flex flex-wrap gap-2">
                  <DiagnosticBadge status="live">
                    Registered
                  </DiagnosticBadge>

                  <DiagnosticBadge
                    status={selectedDiagnostic.diagnostics ?? "unknown"}
                  >
                    System: {selectedDiagnostic.diagnostics ?? "Not checked"}
                  </DiagnosticBadge>

                  <DiagnosticBadge
                    status={selectedDiagnostic.eventStore ?? "unknown"}
                  >
                    Event store: {selectedDiagnostic.eventStore ?? "Not checked"}
                  </DiagnosticBadge>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  disabled={eventsLoading}
                  onClick={() => loadEvents(selectedNetwork)}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                >
                  {eventsLoading ? "Checking…" : "Check event store"}
                </button>

                <button
                  type="button"
                  onClick={() => loadPathDiagnostics(selectedNetwork)}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium dark:border-zinc-700"
                >
                  Check system
                </button>

                <button
                  type="button"
                  onClick={closeEvents}
                  className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium dark:border-zinc-700"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-4">
              <DiagnosticValue
                label="Registration ID"
                value={selectedNetwork.id}
              />

              <DiagnosticValue
                label="Depth"
                value={getDepth(selectedNetwork)}
              />

              <DiagnosticValue
                label="Purpose"
                value={selectedNetwork.purpose}
              />

              <DiagnosticValue
                label="Path"
                value={selectedIdentifier}
              />

              <DiagnosticValue
                label="Persisted event count"
                value={selectedDiagnostic.eventCount}
              />

              <DiagnosticValue
                label="Latest event timestamp"
                value={formatTimestamp(selectedDiagnostic.latestEvent)}
              />

              <DiagnosticValue
                label="Last event-store check"
                value={formatTimestamp(selectedDiagnostic.eventsCheckedAt)}
              />

              <DiagnosticValue
                label="Last system diagnostic"
                value={formatTimestamp(selectedDiagnostic.checkedAt)}
              />
            </div>

            {selectedDiagnostic.diagnosticError && (
              <div className="px-3 pb-3 sm:px-4">
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  System diagnostics unavailable:{" "}
                  {selectedDiagnostic.diagnosticError}
                </p>
              </div>
            )}

            {selectedDiagnostic.eventError && (
              <div className="px-3 pb-3 sm:px-4">
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  Persistent event-store access failed:{" "}
                  {selectedDiagnostic.eventError}
                </p>
              </div>
            )}

            {systemDiagnostics && (
              <details className="mx-3 mb-3 rounded-md border border-zinc-200 dark:border-zinc-800 sm:mx-4">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
                  System diagnostic fields
                </summary>

                <div className="grid grid-cols-1 gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-2">
                  {Object.entries(systemDiagnostics).map(([key, value]) => (
                    <DiagnosticValue
                      key={key}
                      label={key}
                      value={value}
                    />
                  ))}
                </div>
              </details>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
              <h3 className="text-xs font-semibold sm:text-sm">
                Persistent events
              </h3>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                  {events.length} returned
                </span>

                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                  {eventsUpdated
                    ? `Checked ${eventsUpdated.toLocaleTimeString()}`
                    : "Not checked"}
                </span>
              </div>
            </div>

            {eventsError && (
              <div className="px-3 pb-3 sm:px-4">
                <p
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                >
                  {eventsError}
                </p>
              </div>
            )}

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
                        {displayValue(getEventIdentifierValue(event))}
                      </td>

                      <td className="px-3 py-2.5 sm:px-4">
                        {displayValue(getEventType(event))}
                      </td>

                      <td className="px-3 py-2.5 text-zinc-500 dark:text-zinc-400 sm:px-4">
                        {formatTimestamp(getEventTimestamp(event))}
                      </td>
                    </tr>
                  ))}

                  {eventsLoading && events.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center">
                        Checking persistent event store…
                      </td>
                    </tr>
                  )}

                  {!eventsLoading &&
                    !eventsError &&
                    events.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400"
                        >
                          The event endpoint returned no events. An empty
                          response does not establish that events were
                          persisted or that the store is complete.
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
                  Event depth structure
                </h3>

                <div className="space-y-1.5">
                  {events.map((event, index) => (
                    <details
                      key={`depth-${getEventIdentifier(event, index)}-${index}`}
                      className="rounded-md border border-zinc-200 dark:border-zinc-800"
                    >
                      <summary className="cursor-pointer px-3 py-2 text-xs">
                        Depth {getDepth(event)} · Event{" "}
                        {getEventIdentifier(event, index)}
                      </summary>

                      <div className="grid grid-cols-1 gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-2">
                        {Object.entries(event).map(([key, value]) => (
                          <DiagnosticValue
                            key={key}
                            label={key}
                            value={value}
                          />
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
          QTM Network · Path-level system diagnostics · Persistent event-store
          liveness · qtm-api
        </footer>
      </div>
    </main>
  );
}
