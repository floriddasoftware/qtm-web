
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

  return [];
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "—";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

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

function getSubstrateName(entry) {
  return String(entry?.name ?? "");
}

function formatTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const date =
    typeof value === "number"
      ? new Date(value * 1000)
      : new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
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

function ErrorMessage({ children }) {
  if (!children) return null;

  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {children}
    </p>
  );
}

function getEventKey(event, index) {
  return `${event?.kind ?? "event"}-${event?.activation ?? index}-${event?.record ?? index}`;
}

export default function NetworkPage() {
  const [networks, setNetworks] = useState([]);
  const [substrates, setSubstrates] = useState([]);

  // A registered network path is context, not an independent event store.
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedSubstrate, setSelectedSubstrate] = useState("");

  const [substrateState, setSubstrateState] = useState(null);
  const [eventStore, setEventStore] = useState(null);

  const [networkLoading, setNetworkLoading] = useState(true);
  const [substrateLoading, setSubstrateLoading] = useState(true);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const [networkError, setNetworkError] = useState("");
  const [substrateListError, setSubstrateListError] = useState("");
  const [stateError, setStateError] = useState("");
  const [eventStoreError, setEventStoreError] = useState("");

  const [stateStatus, setStateStatus] = useState("unknown");
  const [eventStoreStatus, setEventStoreStatus] = useState("unknown");

  const [lastNetworkCheck, setLastNetworkCheck] = useState(null);
  const [lastSubstrateCheck, setLastSubstrateCheck] = useState(null);
  const [lastDiagnosticsCheck, setLastDiagnosticsCheck] = useState(null);

  const [autoRefresh, setAutoRefresh] = useState(true);

  const networkRequestRef = useRef(null);
  const substrateRequestRef = useRef(null);
  const diagnosticsRequestRef = useRef(null);

  const loadNetworks = useCallback(async ({ silent = false } = {}) => {
    networkRequestRef.current?.abort();

    const controller = new AbortController();
    networkRequestRef.current = controller;

    if (!silent) setNetworkLoading(true);
    setNetworkError("");

    try {
      const result = await apiRequest("/networks", controller.signal);
      const entries = normalizeEntries(result, ["networks"]);

      if (controller.signal.aborted) return;

      setNetworks(entries);
      setLastNetworkCheck(new Date());

      setSelectedPath((current) => {
        if (current && entries.some((entry) => getPathIdentifier(entry) === current)) {
          return current;
        }

        return entries.length ? getPathIdentifier(entries[0]) : "";
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        setNetworkError(
          error instanceof Error ? error.message : "Unable to load registered paths.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setNetworkLoading(false);
    }
  }, []);

  const loadSubstrates = useCallback(async ({ silent = false } = {}) => {
    substrateRequestRef.current?.abort();

    const controller = new AbortController();
    substrateRequestRef.current = controller;

    if (!silent) setSubstrateLoading(true);
    setSubstrateListError("");

    try {
      const result = await apiRequest("/wallets", controller.signal);
      const entries = normalizeEntries(result, ["substrates"]).filter(
        (entry) => getSubstrateName(entry),
      );

      if (controller.signal.aborted) return;

      setSubstrates(entries);
      setLastSubstrateCheck(new Date());

      setSelectedSubstrate((current) => {
        if (current && entries.some((entry) => getSubstrateName(entry) === current)) {
          return current;
        }

        return entries.length ? getSubstrateName(entries[0]) : "";
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        setSubstrateListError(
          error instanceof Error
            ? error.message
            : "Unable to load substrate hosts.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setSubstrateLoading(false);
    }
  }, []);

  const loadHostDiagnostics = useCallback(
    async (name, { silent = false } = {}) => {
      if (!name) {
        setSubstrateState(null);
        setEventStore(null);
        setStateStatus("unknown");
        setEventStoreStatus("unknown");
        setStateError("");
        setEventStoreError("");
        setDiagnosticsLoading(false);
        return;
      }

      diagnosticsRequestRef.current?.abort();

      const controller = new AbortController();
      diagnosticsRequestRef.current = controller;

      if (!silent) {
        setSubstrateState(null);
        setEventStore(null);
        setStateError("");
        setEventStoreError("");
        setStateStatus("checking");
        setEventStoreStatus("checking");
      } else {
        if (!substrateState) setStateStatus("checking");
        if (!eventStore) setEventStoreStatus("checking");
      }

      setDiagnosticsLoading(true);

      const encodedName = encodeURIComponent(name);

      // These are the actual substrate-scoped API endpoints.
      const [stateResult, eventsResult] = await Promise.allSettled([
        apiRequest(`/wallets/${encodedName}`, controller.signal),
        apiRequest(`/wallets/${encodedName}/events`, controller.signal),
      ]);

      if (controller.signal.aborted) return;

      if (stateResult.status === "fulfilled") {
        setSubstrateState(stateResult.value);
        setStateStatus("live");
        setStateError("");
      } else {
        const error = stateResult.reason;
        const message =
          error instanceof Error
            ? error.message
            : "Persisted substrate state could not be read.";

        setSubstrateState(null);
        setStateStatus("error");
        setStateError(message);
      }

      if (eventsResult.status === "fulfilled") {
        const result = eventsResult.value;

        setEventStore({
          ...result,
          events: normalizeEntries(result, ["events"]),
        });

        // An empty event list is still a successful read of the endpoint.
        setEventStoreStatus("live");
        setEventStoreError("");
      } else {
        const error = eventsResult.reason;
        const message =
          error instanceof Error
            ? error.message
            : "Persistent event store could not be read.";

        setEventStore(null);
        setEventStoreStatus("error");
        setEventStoreError(message);
      }

      setLastDiagnosticsCheck(new Date());
      setDiagnosticsLoading(false);
    },
    [substrateState, eventStore],
  );

  useEffect(() => {
    loadNetworks();
    loadSubstrates();

    return () => {
      networkRequestRef.current?.abort();
      substrateRequestRef.current?.abort();
      diagnosticsRequestRef.current?.abort();
    };
  }, [loadNetworks, loadSubstrates]);

  useEffect(() => {
    if (!selectedSubstrate) {
      setSubstrateState(null);
      setEventStore(null);
      setStateStatus("unknown");
      setEventStoreStatus("unknown");
      setStateError("");
      setEventStoreError("");
      return undefined;
    }

    loadHostDiagnostics(selectedSubstrate);

    return () => {
      diagnosticsRequestRef.current?.abort();
    };
  }, [selectedSubstrate]); // Diagnostics follow the selected host.

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const interval = setInterval(() => {
      loadNetworks({ silent: true });
      loadSubstrates({ silent: true });

      if (selectedSubstrate) {
        loadHostDiagnostics(selectedSubstrate, { silent: true });
      }
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [
    autoRefresh,
    selectedSubstrate,
    loadNetworks,
    loadSubstrates,
    loadHostDiagnostics,
  ]);

  const selectedNetwork =
    networks.find((entry) => getPathIdentifier(entry) === selectedPath) ?? null;

  const persistedEvents = eventStore?.events ?? [];
  const runtime = eventStore?.runtime ?? null;

  const refreshAll = () => {
    loadNetworks();
    loadSubstrates();

    if (selectedSubstrate) {
      loadHostDiagnostics(selectedSubstrate);
    }
  };

  const handleSubstrateChange = (event) => {
    setSelectedSubstrate(event.target.value);
  };

  const handlePathSelect = (identifier) => {
    setSelectedPath(identifier);
  };

  const selectedHostEntry = substrates.find(
    (entry) => getSubstrateName(entry) === selectedSubstrate,
  );

  const hostLive =
    stateStatus === "live" && eventStoreStatus === "live";

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
            Registered network paths are shown as contexts. The selected
            substrate is the host: its persisted state and event store are
            checked independently through the QTM API.
          </p>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshAll}
              disabled={networkLoading || substrateLoading}
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-950 px-3.5 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 sm:text-sm"
            >
              {networkLoading || substrateLoading ? "Loading…" : "Refresh"}
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
            <DiagnosticBadge status="unknown">
              {networks.length} registered paths
            </DiagnosticBadge>

            <DiagnosticBadge status="unknown">
              {substrates.length} substrate hosts
            </DiagnosticBadge>

            <DiagnosticBadge status={hostLive ? "live" : "unknown"}>
              {hostLive ? "Host state and event store reachable" : "Host liveness not confirmed"}
            </DiagnosticBadge>
          </div>

          <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
            {lastNetworkCheck
              ? `Paths checked ${lastNetworkCheck.toLocaleTimeString()}`
              : "Waiting for network data"}
            {" · "}
            {REFRESH_INTERVAL / 1000}s refresh interval
          </p>
        </header>

        {networkError && (
          <div className="mb-3">
            <ErrorMessage>{networkError}</ErrorMessage>
          </div>
        )}

        <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold sm:text-base">
                Substrate host
              </h2>

              <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400 sm:text-xs">
                Choose the substrate whose saved state and persisted event
                directory should be inspected.
              </p>
            </div>

            <DiagnosticBadge
              status={hostLive ? "live" : stateStatus === "error" || eventStoreStatus === "error" ? "error" : diagnosticsLoading ? "checking" : "unknown"}
            >
              {hostLive
                ? "Host live"
                : stateStatus === "error" || eventStoreStatus === "error"
                  ? "Host check failed"
                  : diagnosticsLoading
                    ? "Checking host"
                    : "Not checked"}
            </DiagnosticBadge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Substrate
              </span>

              <select
                value={selectedSubstrate}
                onChange={handleSubstrateChange}
                disabled={substrateLoading || substrates.length === 0}
                className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
              >
                {substrates.length === 0 && (
                  <option value="">
                    {substrateLoading ? "Loading substrates…" : "No substrate hosts found"}
                  </option>
                )}

                {substrates.map((substrate) => {
                  const name = getSubstrateName(substrate);

                  return (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => loadHostDiagnostics(selectedSubstrate)}
                disabled={!selectedSubstrate || diagnosticsLoading}
                className="h-10 w-full rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 sm:w-auto sm:text-sm"
              >
                {diagnosticsLoading ? "Checking…" : "Check host"}
              </button>
            </div>
          </div>

          {substrateListError && (
            <div className="mt-3">
              <ErrorMessage>{substrateListError}</ErrorMessage>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">Persisted system state</p>
                <DiagnosticBadge status={stateStatus}>
                  {stateStatus === "live"
                    ? "Reachable"
                    : stateStatus === "error"
                      ? "Unavailable"
                      : stateStatus === "checking"
                        ? "Checking"
                        : "Not checked"}
                </DiagnosticBadge>
              </div>

              <p className="mt-1 text-[10px] leading-5 text-zinc-500 dark:text-zinc-400">
                GET /wallets/{selectedSubstrate || ":name"}
              </p>

              {stateError && (
                <p className="mt-2 break-words text-xs text-red-700 dark:text-red-300">
                  {stateError}
                </p>
              )}
            </div>

            <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">Persistent event store</p>
                <DiagnosticBadge status={eventStoreStatus}>
                  {eventStoreStatus === "live"
                    ? "Readable"
                    : eventStoreStatus === "error"
                      ? "Unavailable"
                      : eventStoreStatus === "checking"
                        ? "Checking"
                        : "Not checked"}
                </DiagnosticBadge>
              </div>

              <p className="mt-1 text-[10px] leading-5 text-zinc-500 dark:text-zinc-400">
                GET /wallets/{selectedSubstrate || ":name"}/events
              </p>

              {eventStoreError && (
                <p className="mt-2 break-words text-xs text-red-700 dark:text-red-300">
                  {eventStoreError}
                </p>
              )}
            </div>
          </div>

          {lastDiagnosticsCheck && (
            <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              Host diagnostics checked {lastDiagnosticsCheck.toLocaleTimeString()}
            </p>
          )}
        </section>

        {substrateState && (
          <section className="mb-4 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
              <h2 className="text-sm font-semibold sm:text-base">
                Host system state
              </h2>
              <p className="mt-1 break-all text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                {displayValue(substrateState.namespace)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-4">
              <DiagnosticValue
                label="Substrate"
                value={selectedSubstrate}
              />

              <DiagnosticValue
                label="Dimension"
                value={substrateState.dimension}
              />

              <DiagnosticValue
                label="Commitment"
                value={substrateState.commitment}
              />

              <DiagnosticValue
                label="Coordinate"
                value={substrateState.coordinate}
              />

              <DiagnosticValue
                label="Sigma"
                value={substrateState.sigma}
              />

              <DiagnosticValue
                label="Network"
                value={substrateState.network}
              />

              <DiagnosticValue
                label="Indices"
                value={substrateState.indices}
              />

              <DiagnosticValue
                label="Entropy"
                value={
                  substrateState.entropy
                    ? `Present · ${String(substrateState.entropy).length} characters`
                    : "Not available"
                }
              />

              <DiagnosticValue
                label="Registered activations"
                value={selectedHostEntry?.activations}
              />
            </div>

            <p className="px-3 pb-3 text-[10px] leading-5 text-zinc-500 dark:text-zinc-400 sm:px-4">
              Entropy content is intentionally not displayed. The diagnostic
              shows whether the field is present without exposing its value.
            </p>
          </section>
        )}

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
            <div>
              <h2 className="text-sm font-semibold sm:text-base">
                Registered network paths
              </h2>
              <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                Select a row to set the path context for the host diagnostics.
              </p>
            </div>

            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
              {networks.length} paths
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-xs sm:text-sm">
              <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 sm:text-xs">
                <tr>
                  <th className="px-3 py-2.5 sm:px-4">Network</th>
                  <th className="px-3 py-2.5 sm:px-4">ID</th>
                  <th className="px-3 py-2.5 sm:px-4">Coin</th>
                  <th className="px-3 py-2.5 sm:px-4">Purpose</th>
                  <th className="px-3 py-2.5 sm:px-4">Registered path</th>
                  <th className="px-3 py-2.5 sm:px-4">Context</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {networks.map((network, index) => {
                  const identifier = getPathIdentifier(network);
                  const selected = identifier === selectedPath;

                  return (
                    <tr
                      key={`${network.id ?? identifier}-${index}`}
                      className={`align-top transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                        selected ? "bg-zinc-100 dark:bg-zinc-800" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 font-medium sm:px-4">
                        {displayValue(network.name ?? identifier)}
                      </td>

                      <td className="px-3 py-2.5 font-mono text-[10px] text-zinc-500 sm:px-4 sm:text-xs">
                        {displayValue(network.id)}
                      </td>

                      <td className="px-3 py-2.5 sm:px-4">
                        {displayValue(network.coin)}
                      </td>

                      <td className="px-3 py-2.5 sm:px-4">
                        {displayValue(network.purpose)}
                      </td>

                      <td className="break-all px-3 py-2.5 font-mono text-[10px] sm:px-4 sm:text-xs">
                        {identifier}
                      </td>

                      <td className="px-3 py-2.5 sm:px-4">
                        <button
                          type="button"
                          onClick={() => handlePathSelect(identifier)}
                          aria-pressed={selected}
                          className="whitespace-nowrap rounded-md border border-zinc-300 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-700 sm:text-xs"
                        >
                          {selected ? "Selected" : "Select path"}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!networkLoading && networks.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-xs text-zinc-500 sm:px-4 sm:text-sm"
                    >
                      No registered paths were returned by the API.
                    </td>
                  </tr>
                )}

                {networkLoading && networks.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-xs text-zinc-500 sm:px-4 sm:text-sm"
                    >
                      Loading registered paths…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedNetwork && (
            <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Selected path context
              </p>

              <p className="mt-1 break-all text-xs font-medium">
                {getPathIdentifier(selectedNetwork)}
              </p>

              <p className="mt-1 text-[10px] leading-5 text-zinc-500 dark:text-zinc-400 sm:text-xs">
                The current API exposes event history at substrate scope. This
                selection does not imply that this network path has a separate
                event directory.
              </p>
            </div>
          )}
        </section>

        <section className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
            <div>
              <h2 className="text-sm font-semibold sm:text-base">
                Persistent event store
              </h2>
              <p className="mt-1 break-all text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                {eventStore?.events_directory ??
                  (selectedSubstrate
                    ? `Host: ${selectedSubstrate}`
                    : "Select a substrate host")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DiagnosticBadge status={eventStoreStatus}>
                {eventStoreStatus === "live"
                  ? "Readable"
                  : eventStoreStatus === "error"
                    ? "Unavailable"
                    : eventStoreStatus === "checking"
                      ? "Checking"
                      : "Not checked"}
              </DiagnosticBadge>

              <DiagnosticBadge status="unknown">
                {persistedEvents.length} records
              </DiagnosticBadge>
            </div>
          </div>

          {eventStoreError && (
            <div className="p-3 sm:p-4">
              <ErrorMessage>{eventStoreError}</ErrorMessage>
            </div>
          )}

          {eventStore && (
            <>
              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:p-4">
                <DiagnosticValue
                  label="Substrate"
                  value={eventStore.substrate}
                />

                <DiagnosticValue
                  label="Event directory"
                  value={eventStore.events_directory}
                />

                <DiagnosticValue
                  label="Substrate directory"
                  value={eventStore.directory}
                />

                <DiagnosticValue
                  label="Runtime time"
                  value={
                    runtime?.unix_seconds !== undefined
                      ? formatTimestamp(runtime.unix_seconds)
                      : "—"
                  }
                />

                <DiagnosticValue
                  label="Runtime nanoseconds"
                  value={runtime?.subsec_nanos}
                />

                <DiagnosticValue
                  label="Persistent records"
                  value={persistedEvents.length}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
                <h3 className="text-xs font-semibold sm:text-sm">
                  Persisted event records
                </h3>

                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                  {lastDiagnosticsCheck
                    ? `Checked ${lastDiagnosticsCheck.toLocaleTimeString()}`
                    : "Not checked"}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-left text-xs">
                  <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    <tr>
                      <th className="px-3 py-2.5 sm:px-4">Kind</th>
                      <th className="px-3 py-2.5 sm:px-4">Record</th>
                      <th className="px-3 py-2.5 sm:px-4">Activation</th>
                      <th className="px-3 py-2.5 sm:px-4">Dimension</th>
                      <th className="px-3 py-2.5 sm:px-4">Structural value</th>
                      <th className="px-3 py-2.5 sm:px-4">Depth objects</th>
                      <th className="px-3 py-2.5 sm:px-4">Retained mass</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {persistedEvents.map((event, index) => (
                      <tr
                        key={getEventKey(event, index)}
                        className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      >
                        <td className="px-3 py-2.5 font-medium sm:px-4">
                          {displayValue(event.kind)}
                        </td>

                        <td className="max-w-[220px] break-all px-3 py-2.5 font-mono text-[10px] sm:px-4">
                          {displayValue(event.record)}
                        </td>

                        <td className="px-3 py-2.5 tabular-nums sm:px-4">
                          {displayValue(event.activation)}
                        </td>

                        <td className="px-3 py-2.5 tabular-nums sm:px-4">
                          {displayValue(event.dimension)}
                        </td>

                        <td className="px-3 py-2.5 tabular-nums sm:px-4">
                          {displayValue(event.structural_value)}
                        </td>

                        <td className="px-3 py-2.5 tabular-nums sm:px-4">
                          {displayValue(event.depth_objects)}
                        </td>

                        <td className="px-3 py-2.5 tabular-nums sm:px-4">
                          {displayValue(event.retained_mass)}
                        </td>
                      </tr>
                    ))}

                    {diagnosticsLoading && persistedEvents.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400"
                        >
                          Reading the persistent event store…
                        </td>
                      </tr>
                    )}

                    {!diagnosticsLoading &&
                      eventStoreStatus === "live" &&
                      persistedEvents.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400"
                          >
                            The event endpoint is reachable, but no persisted
                            event records were returned for this substrate.
                          </td>
                        </tr>
                      )}

                    {!diagnosticsLoading &&
                      !selectedSubstrate &&
                      persistedEvents.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-3 py-8 text-center text-zinc-500 dark:text-zinc-400"
                          >
                            Select a substrate host to inspect its event store.
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!eventStore && eventStoreStatus !== "error" && !diagnosticsLoading && (
            <p className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:px-4 sm:text-sm">
              Select a substrate to load its persisted event records.
            </p>
          )}
        </section>

        <footer className="mt-6 border-t border-zinc-200 pt-3.5 text-[10px] leading-5 text-zinc-500 dark:border-zinc-800 sm:mt-8 sm:pt-4 sm:text-xs">
          QTM Network · Substrate-host diagnostics · Persistent event-store
          liveness · qtm-api
        </footer>
      </div>
    </main>
  );
}
