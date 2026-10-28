"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api-anwp.onrender.com"
).replace(/\/+$/, "");

const REFRESH_INTERVAL_MS = 80000;
const SUBSTRATE_QUERY_KEY = "substrate";

// How long a fresh POST/DELETE result is protected from a contradicting
// status read (the runtime can briefly report the old state).
const MUTATION_HOLD_MS = 8000;

// Fields rendered by the curated observation grid. Everything else in the
// response is dropped into the flexible "Additional response fields" area.
const KNOWN_OBSERVATION_KEYS = [
  "running",
  "commitment",
  "listen_port",
  "path",
  "message",
  "runtime",
  "clips",
  "event",
];

async function apiRequest(path, signal, options = {}) {
  const method = options.method || "GET";
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;

    const reason =
      cause instanceof Error && cause.message ? cause.message : "network error";

    throw new Error(
      `Could not reach the QTM runtime at ${API_BASE} (${reason}). Make sure qtm-api is running and that this page is allowed to call it (CORS / mixed content). Hosted instances can take about a minute to wake from sleep.`,
    );
  }

  const bodyText = await response.text();
  let body = null;

  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const apiMessage =
      body &&
      typeof body === "object" &&
      (body.error || body.message || body.detail);

    const reason =
      typeof apiMessage === "string" && apiMessage.trim()
        ? apiMessage
        : bodyText
          ? bodyText.slice(0, 300)
          : `Request failed with HTTP ${response.status}`;

    throw new Error(
      `${reason}${response.status ? ` [HTTP ${response.status}]` : ""}`,
    );
  }

  return body ?? {};
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
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => displayValue(item)).join(", ") : "—";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value) {
  return !isPlainObject(value) && !Array.isArray(value);
}

function isPrimitiveArray(value) {
  return Array.isArray(value) && value.every(isScalar);
}

function humanizeKey(key) {
  return String(key).replace(/[_-]+/g, " ").trim();
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildScopeKey(name, activation, networkId, pathId) {
  if (!name || !networkId || !pathId) return "";

  return `${name}:${activation}:${networkId}:${pathId}`;
}

// Event-focused results: event.qtm.commitment is the authoritative value.
// It is never replaced by the Domain commitment. If it is missing, callers
// show "Unavailable" instead of falling back.
const EVENT_COMMITMENT_UNAVAILABLE = "Unavailable";

function getEventCommitment(event) {
  const commitment = event?.qtm?.commitment ?? null;

  // Only a non-empty string counts. Anything else (null, empty/blank
  // string, number, object) is treated as missing.
  return typeof commitment === "string" && commitment.trim().length > 0
    ? commitment
    : null;
}

function eventCommitmentLabel(event) {
  return getEventCommitment(event) ?? EVENT_COMMITMENT_UNAVAILABLE;
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

function getNetworkId(entry) {
  return String(entry?.id ?? entry?.name ?? "").trim();
}

function getSubstrateName(entry) {
  return String(entry?.name ?? "");
}

function formatTimestamp(value) {
  if (value === null || value === undefined || value === "") return "—";

  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);

  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function parseActivation(value) {
  if (value === null || value === undefined || value === "") return 0;

  const n = Number(value);

  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
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

  if (status === "running") {
    return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300";
  }

  return "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

function DiagnosticBadge({ status, children }) {
  return (
    <span
      className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4 ${diagnosticClass(status)}`}
    >
      {children}
    </span>
  );
}

function DiagnosticValue({ label, value }) {
  return (
    <div className="min-w-0 overflow-hidden">
      <p className="break-words text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 [overflow-wrap:anywhere]">
        {label}
      </p>
      <p className="mt-0.5 min-w-0 break-words text-xs font-medium [overflow-wrap:anywhere]">
        {displayValue(value)}
      </p>
    </div>
  );
}

// Compact, centered, single-line value used inside the observation box.
// Long values truncate (full text in the tooltip and raw response) instead
// of wrapping character by character.
function CompactValue({ label, value, mono = false }) {
  const text = displayValue(value);
  const valueClass = "mt-0.5 block truncate whitespace-nowrap text-xs font-medium";

  return (
    <div className="min-w-0 rounded-lg bg-zinc-50 px-2 py-1.5 text-center dark:bg-zinc-950/60">
      <p className="truncate whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>

      {mono ? (
        <code title={text} className={`${valueClass} font-mono`}>
          {text}
        </code>
      ) : (
        <p title={text} className={valueClass}>
          {text}
        </p>
      )}
    </div>
  );
}

function ErrorMessage({ children }) {
  if (!children) return null;

  return (
    <div className="min-w-0 break-words rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300 [overflow-wrap:anywhere]">
      {children}
    </div>
  );
}

// Responsive table on sm+ screens, stacked cards on narrow screens.
// Columns listed in `columns` come first; any other keys found in the rows
// are appended, so unexpected fields in the runtime response still show up.
function ObjectTable({ rows, columns = [] }) {
  const normalized = rows.map((row) => (isPlainObject(row) ? row : { value: row }));

  const keys = [...columns];

  for (const row of normalized) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }

  const cols = keys.slice(0, 10);

  if (normalized.length === 0 || cols.length === 0) return null;

  const cell = (value) => (
    <span className="[overflow-wrap:anywhere]">{displayValue(value)}</span>
  );

  return (
    <div className="min-w-0">
      <div className="hidden w-full min-w-0 overflow-x-auto sm:block">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <tr>
              {cols.map((key) => (
                <th key={key} className="whitespace-nowrap px-3 py-2 sm:px-4">
                  {humanizeKey(key)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {normalized.map((row, index) => (
              <tr key={index} className="align-top">
                {cols.map((key) => (
                  <td
                    key={key}
                    className="max-w-[260px] px-3 py-2 font-mono text-[10px] sm:px-4"
                  >
                    {cell(row[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:hidden">
        {normalized.map((row, index) => (
          <div
            key={index}
            className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <dl className="grid grid-cols-1 gap-2">
              {cols.map((key) => (
                <div key={key} className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {humanizeKey(key)}
                  </dt>
                  <dd className="mt-0.5 min-w-0 text-xs font-medium">
                    {cell(row[key])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

// Flexible renderer for any JSON object the runtime returns:
// scalars -> auto-fitting grid, nested objects -> expandable details,
// arrays of objects -> responsive table/cards.
function ResponseFields({ data, omit = [], depth = 0 }) {
  if (!isPlainObject(data)) return null;

  const entries = Object.entries(data).filter(([key]) => !omit.includes(key));

  const scalars = entries.filter(
    ([, value]) => isScalar(value) || isPrimitiveArray(value),
  );
  const objects = entries.filter(([, value]) => isPlainObject(value));
  const arrays = entries.filter(
    ([, value]) => Array.isArray(value) && !isPrimitiveArray(value),
  );

  if (entries.length === 0) return null;

  return (
    <div className="min-w-0 space-y-3">
      {scalars.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
          {scalars.map(([key, value]) => (
            <DiagnosticValue key={key} label={humanizeKey(key)} value={value} />
          ))}
        </div>
      )}

      {objects.map(([key, value]) => (
        <details
          key={key}
          open={depth === 0 && Object.keys(value).length <= 6}
          className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
            {humanizeKey(key)}
            <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
              {Object.keys(value).length} fields
            </span>
          </summary>

          <div className="min-w-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
            {depth >= 2 ? (
              <pre className="max-h-60 overflow-auto text-[10px] leading-4">
                {safeJson(value)}
              </pre>
            ) : (
              <ResponseFields data={value} depth={depth + 1} />
            )}
          </div>
        </details>
      ))}

      {arrays.map(([key, value]) => (
        <details
          key={key}
          open
          className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
            {humanizeKey(key)}
            <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
              {value.length} items
            </span>
          </summary>

          <div className="min-w-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
            <ObjectTable rows={value} />
          </div>
        </details>
      ))}
    </div>
  );
}

function getEventKey(event, index) {
  const record = event?.record ?? event?.record_name ?? event?.id ?? "";
  const kind = event?.kind ?? event?.type ?? "event";
  const activation = event?.activation ?? "";
  const dimension = event?.dimension ?? "";

  if (record || activation || dimension) {
    return `${kind}-${activation}-${dimension}-${record}`;
  }

  return `${kind}-${index}`;
}

function updateSubstrateQuery(name) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);

  if (name) url.searchParams.set(SUBSTRATE_QUERY_KEY, name);
  else url.searchParams.delete(SUBSTRATE_QUERY_KEY);

  window.history.replaceState({}, "", url);
}

function getSubstrateQuery() {
  if (typeof window === "undefined") return "";

  return (
    new URLSearchParams(window.location.search).get(SUBSTRATE_QUERY_KEY) ?? ""
  );
}

function electrumEndpoint(listenPort) {
  if (listenPort === null || listenPort === undefined || listenPort === "") {
    return null;
  }

  if (typeof window === "undefined") return `host:${listenPort}`;

  return `${window.location.hostname}:${listenPort}`;
}

function resolvePreferredSubstrate(entries, preferred, current) {
  const names = entries.map(getSubstrateName).filter(Boolean);

  if (preferred && names.includes(preferred)) return preferred;
  if (current && names.includes(current)) return current;

  return names[0] || "";
}

function getRefreshPath(result) {
  const path = result?.refresh_path;

  return typeof path === "string" && path.trim().length > 0
    ? path.trim()
    : "Unavailable";
}

function isUnavailableError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return (
    message.includes("[HTTP 404]") ||
    message.toLowerCase().includes("not found") ||
    message.toLowerCase().includes("unavailable")
  );
}

export default function NetworkPage() {
  const [networks, setNetworks] = useState([]);
  const [substrates, setSubstrates] = useState([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedSubstrate, setSelectedSubstrate] = useState("");
  const [selectedActivation, setSelectedActivation] = useState(0);

  const [substrateState, setSubstrateState] = useState(null);
  const [eventStore, setEventStore] = useState(null);

  // Observation data always travels with the scope it belongs to
  // (substrate:activation:networkId:path). It is only displayed while that
  // scope matches the current selection.
  const [observation, setObservation] = useState(null);
  const [observationList, setObservationList] = useState([]);
  const [observationScope, setObservationScope] = useState("");
  const [observationStale, setObservationStale] = useState(false);
  const [observationNotice, setObservationNotice] = useState("");
  const [observationLoading, setObservationLoading] = useState(false);
  const [observationActionLoading, setObservationActionLoading] =
    useState(false);
  const [observationError, setObservationError] = useState("");
  const [lastObservationCheck, setLastObservationCheck] = useState(null);

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

  const [bitMinerRefresh, setBitMinerRefresh] = useState(null);
  const [bitMinerRefreshLoading, setBitMinerRefreshLoading] = useState(false);
  const [bitMinerRefreshError, setBitMinerRefreshError] = useState("");
  const [lastBitMinerRefreshCheck, setLastBitMinerRefreshCheck] =
    useState(null);

  const networkRequestRef = useRef(null);
  const substrateRequestRef = useRef(null);
  const diagnosticsRequestRef = useRef(null);
  const observationRequestRef = useRef(null);
  const bitMinerRefreshRequestRef = useRef(null);

  const networkRequestIdRef = useRef(0);
  const substrateRequestIdRef = useRef(0);
  const diagnosticsRequestIdRef = useRef(0);
  const observationRequestIdRef = useRef(0);
  const bitMinerRefreshRequestIdRef = useRef(0);

  // Observation bookkeeping used to keep results from racing each other.
  const observationScopeRef = useRef("");
  const observationDataRef = useRef(null);
  const observationMutationRef = useRef(0);
  const observationHoldRef = useRef({ scope: "", until: 0, running: false });

  const diagnosticsSubstrateRef = useRef("");
  const observationContextRef = useRef("");
  const requestedSubstrateRef = useRef(null);
  const selectedSubstrateRef = useRef("");
  const selectedPathRef = useRef("");
  const selectedActivationRef = useRef(0);
  const activationInitializedRef = useRef(false);

  useEffect(() => {
    if (requestedSubstrateRef.current === null) {
      requestedSubstrateRef.current = getSubstrateQuery();
    }
  }, []);

  useEffect(() => {
    selectedSubstrateRef.current = selectedSubstrate;
  }, [selectedSubstrate]);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    selectedActivationRef.current = selectedActivation;
  }, [selectedActivation]);

  const setActivationSynced = useCallback((value) => {
    const next = parseActivation(value);
    selectedActivationRef.current = next;
    setSelectedActivation(next);
  }, []);

  // Drops observation data and re-labels the (empty) state with `scope`.
  const resetObservation = useCallback((scope) => {
    observationScopeRef.current = scope;
    observationDataRef.current = null;
    observationHoldRef.current = { scope: "", until: 0, running: false };

    setObservationScope(scope);
    setObservation(null);
    setObservationList([]);
    setObservationStale(false);
    setObservationNotice("");
  }, []);

  // Switches ownership of the observation box to a new scope. Data from the
  // previous scope is cleared; data of the same scope is never touched.
  const claimObservationScope = useCallback(
    (scope) => {
      if (observationScopeRef.current === scope) return;

      resetObservation(scope);
      setObservationError("");
    },
    [resetObservation],
  );

  const commitObservation = useCallback((scope, value) => {
    observationScopeRef.current = scope;
    observationDataRef.current = value;

    setObservationScope(scope);
    setObservation(value);
  }, []);

  const loadNetworks = useCallback(async ({ silent = false } = {}) => {
    networkRequestRef.current?.abort();

    const requestId = ++networkRequestIdRef.current;
    const controller = new AbortController();

    networkRequestRef.current = controller;

    if (!silent) setNetworkLoading(true);
    setNetworkError("");

    try {
      const result = await apiRequest("/networks", controller.signal);

      if (requestId !== networkRequestIdRef.current) return;

      const entries = normalizeEntries(result, ["networks"]).filter((entry) =>
        getPathIdentifier(entry),
      );

      setNetworks(entries);
      setLastNetworkCheck(new Date());

      const current = selectedPathRef.current;
      const stillValid =
        current &&
        entries.some((entry) => getPathIdentifier(entry) === current);

      const next = stillValid
        ? current
        : entries.length
          ? getPathIdentifier(entries[0])
          : "";

      selectedPathRef.current = next;
      setSelectedPath(next);
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        requestId !== networkRequestIdRef.current
      ) {
        return;
      }

      setNetworkError(
        error instanceof Error
          ? error.message
          : "Unable to load registered network paths.",
      );
    } finally {
      if (requestId === networkRequestIdRef.current) {
        setNetworkLoading(false);
      }
    }
  }, []);

  const loadSubstrates = useCallback(async ({ silent = false } = {}) => {
    substrateRequestRef.current?.abort();

    const requestId = ++substrateRequestIdRef.current;
    const controller = new AbortController();

    substrateRequestRef.current = controller;

    if (!silent) setSubstrateLoading(true);
    setSubstrateListError("");

    try {
      const result = await apiRequest("/wallets", controller.signal);

      if (requestId !== substrateRequestIdRef.current) return;

      const entries = normalizeEntries(result, ["substrates"]).filter(
        (entry) => getSubstrateName(entry),
      );

      setSubstrates(entries);
      setLastSubstrateCheck(new Date());

      const preferred =
        requestedSubstrateRef.current === null
          ? ""
          : requestedSubstrateRef.current;

      const resolved = resolvePreferredSubstrate(
        entries,
        preferred,
        selectedSubstrateRef.current,
      );

      if (requestedSubstrateRef.current !== null) {
        requestedSubstrateRef.current = "";
      }

      selectedSubstrateRef.current = resolved;
      setSelectedSubstrate(resolved);
      updateSubstrateQuery(resolved);
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        requestId !== substrateRequestIdRef.current
      ) {
        return;
      }

      setSubstrateListError(
        error instanceof Error
          ? error.message
          : "Unable to load persisted substrates.",
      );
    } finally {
      if (requestId === substrateRequestIdRef.current) {
        setSubstrateLoading(false);
      }
    }
  }, []);

  const loadHostDiagnostics = useCallback(
    async (name, { silent = false } = {}) => {
      if (!name) {
        diagnosticsRequestRef.current?.abort();
        diagnosticsRequestIdRef.current += 1;
        diagnosticsSubstrateRef.current = "";

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

      const requestId = ++diagnosticsRequestIdRef.current;
      diagnosticsSubstrateRef.current = name;

      const controller = new AbortController();
      diagnosticsRequestRef.current = controller;

      const isCurrent = () =>
        requestId === diagnosticsRequestIdRef.current &&
        diagnosticsSubstrateRef.current === name &&
        selectedSubstrateRef.current === name;

      if (!silent) {
        setSubstrateState(null);
        setEventStore(null);
        setStateError("");
        setEventStoreError("");
        setStateStatus("checking");
        setEventStoreStatus("checking");
      } else {
        setStateStatus((status) =>
          status === "error" ? status : "checking",
        );
        setEventStoreStatus((status) =>
          status === "error" ? status : "checking",
        );
      }

      setDiagnosticsLoading(true);

      const encodedName = encodeURIComponent(name);

      try {
        const [stateResult, eventsResult] = await Promise.allSettled([
          apiRequest(`/wallets/${encodedName}`, controller.signal),
          apiRequest(`/wallets/${encodedName}/events`, controller.signal),
        ]);

        if (!isCurrent()) return;

        const stateAborted =
          stateResult.status === "rejected" &&
          stateResult.reason?.name === "AbortError";

        const eventsAborted =
          eventsResult.status === "rejected" &&
          eventsResult.reason?.name === "AbortError";

        if (stateAborted || eventsAborted) return;

        if (stateResult.status === "fulfilled") {
          setSubstrateState(stateResult.value);
          setStateStatus("live");
          setStateError("");
        } else {
          setSubstrateState(null);
          setStateStatus("error");
          setStateError(
            stateResult.reason instanceof Error
              ? stateResult.reason.message
              : "Persisted substrate state could not be read.",
          );
        }

        if (eventsResult.status === "fulfilled") {
          const result = eventsResult.value;
          const events = normalizeEntries(result, ["events"]);

          setEventStore({ ...result, events });
          setEventStoreStatus("live");
          setEventStoreError("");

          const fromEvents = events.map((event) =>
            parseActivation(event?.activation),
          );

          const unique = Array.from(new Set(fromEvents));
          const current = selectedActivationRef.current;

          if (!activationInitializedRef.current && unique.length > 0) {
            activationInitializedRef.current = true;
            setActivationSynced(Math.max(...unique));
          } else if (!silent && unique.length > 0 && !unique.includes(current)) {
            // Background refreshes must never move the user to another
            // activation; that would swap the observation scope under them.
            setActivationSynced(Math.max(...unique));
          }
        } else {
          setEventStore(null);
          setEventStoreStatus("error");
          setEventStoreError(
            eventsResult.reason instanceof Error
              ? eventsResult.reason.message
              : "Persistent event store could not be read.",
          );
        }

        setLastDiagnosticsCheck(new Date());
      } finally {
        if (isCurrent()) setDiagnosticsLoading(false);
      }
    },
    [setActivationSynced],
  );

  const selectedNetwork = useMemo(
    () =>
      networks.find(
        (entry) => getPathIdentifier(entry) === selectedPath,
      ) ?? null,
    [networks, selectedPath],
  );

  const selectedNetworkId = selectedNetwork ? getNetworkId(selectedNetwork) : "";

  // Network selection supplies context, but is not a Bitcoin-only gate.
  const observationHasNetworkContext = Boolean(selectedNetwork);

  const loadObservation = useCallback(
    async ({ silent = false } = {}) => {
      const name = selectedSubstrateRef.current;
      const networkId = selectedNetworkId;
      const activation = selectedActivationRef.current;
      const pathId = selectedPathRef.current;

      observationRequestRef.current?.abort();

      if (!name || !networkId || !pathId) {
        observationRequestIdRef.current += 1;
        observationContextRef.current = "";

        resetObservation("");
        setObservationError("");
        setObservationLoading(false);

        return;
      }

      const requestId = ++observationRequestIdRef.current;
      const mutationVersion = observationMutationRef.current;
      const contextKey = buildScopeKey(name, activation, networkId, pathId);

      observationContextRef.current = contextKey;

      // Clears data only if it belongs to a different scope. Refreshing the
      // same scope keeps the last known result on screen.
      claimObservationScope(contextKey);

      const controller = new AbortController();
      observationRequestRef.current = controller;

      const isCurrent = () =>
        requestId === observationRequestIdRef.current &&
        mutationVersion === observationMutationRef.current &&
        observationContextRef.current === contextKey &&
        selectedSubstrateRef.current === name &&
        selectedPathRef.current === pathId &&
        selectedActivationRef.current === activation;

      if (!silent) setObservationError("");

      setObservationLoading(true);

      const encodedName = encodeURIComponent(name);
      const encodedNetwork = encodeURIComponent(networkId);
      const basePath = `/wallets/${encodedName}/activations/${activation}`;

      try {
        const [statusResult, listResult] = await Promise.allSettled([
          apiRequest(
            `${basePath}/networks/${encodedNetwork}/observation`,
            controller.signal,
          ),
          apiRequest(`${basePath}/observations`, controller.signal),
        ]);

        if (!isCurrent()) return;

        const statusAborted =
          statusResult.status === "rejected" &&
          statusResult.reason?.name === "AbortError";

        const listAborted =
          listResult.status === "rejected" &&
          listResult.reason?.name === "AbortError";

        if (statusAborted || listAborted) return;

        // A failed list read keeps the previous list instead of blanking it.
        if (listResult.status === "fulfilled") {
          setObservationList(
            normalizeEntries(listResult.value, [
              "pipelines",
              "observations",
            ]),
          );
        }

        const previous = observationDataRef.current;

        if (statusResult.status === "fulfilled") {
          const payload = statusResult.value;
          const hasPayload =
            isPlainObject(payload) && Object.keys(payload).length > 0;

          const hold = observationHoldRef.current;
          const held = hold.scope === contextKey && Date.now() < hold.until;

          const contradictsHold =
            held &&
            hasPayload &&
            payload.running !== undefined &&
            Boolean(payload.running) !== hold.running;

          if (!hasPayload) {
            // Empty status response: keep what we have, just flag it.
            if (previous) setObservationStale(true);
          } else if (!contradictsHold) {
            observationDataRef.current = payload;
            setObservation(payload);
            setObservationStale(false);
            setObservationNotice("");
          }

          setObservationError("");
        } else {
          const error = statusResult.reason;

          const message =
            error instanceof Error
              ? error.message
              : "Observation status unavailable.";

          const notFound =
            message.includes("[HTTP 404]") ||
            message.toLowerCase().includes("no live") ||
            message.toLowerCase().includes("not found");

          // Never wipe a known result because a status read failed.
          if (previous) setObservationStale(true);

          setObservationError(notFound ? "" : message);
        }

        setLastObservationCheck(new Date());
      } catch (error) {
        if (error?.name === "AbortError" || !isCurrent()) return;

        if (observationDataRef.current) setObservationStale(true);

        setObservationError(
          error instanceof Error
            ? error.message
            : "Observation status unavailable.",
        );
      } finally {
        if (isCurrent()) setObservationLoading(false);
      }
    },
    [selectedNetworkId, claimObservationScope, resetObservation],
  );

  // This request checks only the activation-scoped refresh-path endpoint.
  // It does not start, stop, or refresh the miner's internal pipeline.
  const loadBitMinerRefresh = useCallback(
    async ({ silent = false } = {}) => {
      const name = selectedSubstrateRef.current;
      const activation = selectedActivationRef.current;

      bitMinerRefreshRequestRef.current?.abort();

      if (!name) {
        bitMinerRefreshRequestIdRef.current += 1;
        setBitMinerRefresh(null);
        setBitMinerRefreshError("");
        setBitMinerRefreshLoading(false);
        setLastBitMinerRefreshCheck(null);
        return;
      }

      const requestId = ++bitMinerRefreshRequestIdRef.current;
      const controller = new AbortController();

      bitMinerRefreshRequestRef.current = controller;

      const isCurrent = () =>
        requestId === bitMinerRefreshRequestIdRef.current &&
        selectedSubstrateRef.current === name &&
        selectedActivationRef.current === activation;

      if (!silent) {
        setBitMinerRefresh(null);
        setBitMinerRefreshError("");
      }

      setBitMinerRefreshLoading(true);

      try {
        const result = await apiRequest(
          `/wallets/${encodeURIComponent(name)}/activations/${activation}/bit_miner/refresh`,
          controller.signal,
        );

        if (!isCurrent()) return;

        setBitMinerRefresh(result);
        setBitMinerRefreshError("");
      } catch (error) {
        if (error?.name === "AbortError" || !isCurrent()) return;

        setBitMinerRefresh(null);

        const message =
          error instanceof Error
            ? error.message
            : "Refresh-path check unavailable.";

        setBitMinerRefreshError(
          isUnavailableError(error)
            ? `Refresh-path check unavailable: ${message}`
            : message,
        );
      } finally {
        if (isCurrent()) {
          setLastBitMinerRefreshCheck(new Date());
          setBitMinerRefreshLoading(false);
        }
      }
    },
    [],
  );

  const startObservation = useCallback(async () => {
    const name = selectedSubstrateRef.current;
    const activation = selectedActivationRef.current;
    const pathId = selectedPathRef.current;
    const networkId = selectedNetworkId;

    const pathHint = selectedNetwork
      ? getPathIdentifier(selectedNetwork)
      : pathId;

    if (!name || !networkId) return;

    const scope = buildScopeKey(name, activation, networkId, pathId);

    // A new mutation invalidates every status read still in flight, so a
    // stale GET can never overwrite this POST's result.
    observationMutationRef.current += 1;
    const mutationVersion = observationMutationRef.current;

    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;

    setObservationLoading(false);
    claimObservationScope(scope);
    setObservationActionLoading(true);
    setObservationError("");

    const stillSameScope = () =>
      mutationVersion === observationMutationRef.current &&
      selectedSubstrateRef.current === name &&
      selectedActivationRef.current === activation &&
      selectedPathRef.current === pathId;

    try {
      const encodedName = encodeURIComponent(name);
      const encodedNetwork = encodeURIComponent(networkId);

      const basePath =
        `/wallets/${encodedName}/activations/${activation}` +
        `/networks/${encodedNetwork}/observation`;

      const body = pathHint ? { path: pathHint } : {};

      // POST requests observation start. Pipeline execution remains
      // owned by bit-miner/src/main.rs.
      const started = await apiRequest(basePath, undefined, {
        method: "POST",
        body,
      });

      // The selection changed (or another action started) while waiting.
      if (!stillSameScope()) return;

      const hasBody = isPlainObject(started) && Object.keys(started).length > 0;

      const payload = hasBody
        ? started
        : {
            message: "Start request accepted (empty response body).",
            ...(pathHint ? { path: pathHint } : {}),
          };

      commitObservation(scope, payload);
      setObservationStale(false);
      setObservationNotice(
        "Start accepted",
      );

      // Hold every accepted start, even when the response omits `running`
      // (an accepted start implies running). Only an explicit
      // `running: false` in the response skips the hold.
      observationHoldRef.current =
        payload.running === false
          ? { scope: "", until: 0, running: false }
          : { scope, until: Date.now() + MUTATION_HOLD_MS, running: true };

      setLastObservationCheck(new Date());

      // No immediate status read here. The POST response stays on screen
      // until the normal refresh interval or the "Refresh status" button
      // reconciles it with the runtime.
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (!stillSameScope()) return;

      // Keep whatever was already on screen; just report the failure.
      setObservationError(
        error instanceof Error
          ? error.message
          : "Unable to start observation.",
      );
    } finally {
      if (mutationVersion === observationMutationRef.current) {
        setObservationActionLoading(false);
      }
    }
  }, [
    selectedNetwork,
    selectedNetworkId,
    claimObservationScope,
    commitObservation,
  ]);

  const stopObservation = useCallback(async () => {
    const name = selectedSubstrateRef.current;
    const activation = selectedActivationRef.current;
    const pathId = selectedPathRef.current;
    const networkId = selectedNetworkId;

    if (!name || !networkId) return;

    const scope = buildScopeKey(name, activation, networkId, pathId);

    observationMutationRef.current += 1;
    const mutationVersion = observationMutationRef.current;

    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;

    setObservationLoading(false);
    claimObservationScope(scope);
    setObservationActionLoading(true);
    setObservationError("");

    const stillSameScope = () =>
      mutationVersion === observationMutationRef.current &&
      selectedSubstrateRef.current === name &&
      selectedActivationRef.current === activation &&
      selectedPathRef.current === pathId;

    try {
      const encodedName = encodeURIComponent(name);
      const encodedNetwork = encodeURIComponent(networkId);

      const basePath =
        `/wallets/${encodedName}/activations/${activation}` +
        `/networks/${encodedNetwork}/observation`;

      // DELETE requests observation stop.
      const stopped = await apiRequest(basePath, undefined, {
        method: "DELETE",
      });

      if (!stillSameScope()) return;

      const payload = {
        ...(isPlainObject(stopped) ? stopped : {}),
        running: false,
      };

      if (!payload.message) payload.message = "Stop request accepted.";

      commitObservation(scope, payload);
      setObservationList([]);
      setObservationStale(false);
      setObservationNotice("Stop accepted");

      observationHoldRef.current = {
        scope,
        until: Date.now() + MUTATION_HOLD_MS,
        running: false,
      };

      setLastObservationCheck(new Date());
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (!stillSameScope()) return;

      setObservationError(
        error instanceof Error
          ? error.message
          : "Unable to stop observation.",
      );
    } finally {
      if (mutationVersion === observationMutationRef.current) {
        setObservationActionLoading(false);
      }
    }
  }, [selectedNetworkId, claimObservationScope, commitObservation]);

  useEffect(() => {
    loadNetworks();
    loadSubstrates();

    return () => {
      networkRequestRef.current?.abort();
      substrateRequestRef.current?.abort();
      diagnosticsRequestRef.current?.abort();
      observationRequestRef.current?.abort();
      bitMinerRefreshRequestRef.current?.abort();

      networkRequestIdRef.current += 1;
      substrateRequestIdRef.current += 1;
      diagnosticsRequestIdRef.current += 1;
      observationRequestIdRef.current += 1;
      bitMinerRefreshRequestIdRef.current += 1;
    };
  }, [loadNetworks, loadSubstrates]);

  useEffect(() => {
    if (!selectedSubstrate) {
      diagnosticsRequestRef.current?.abort();
      diagnosticsRequestIdRef.current += 1;
      diagnosticsSubstrateRef.current = "";
      activationInitializedRef.current = false;

      setSubstrateState(null);
      setEventStore(null);
      setStateStatus("unknown");
      setEventStoreStatus("unknown");
      setStateError("");
      setEventStoreError("");
      setDiagnosticsLoading(false);

      return undefined;
    }

    activationInitializedRef.current = false;
    loadHostDiagnostics(selectedSubstrate);

    return () => diagnosticsRequestRef.current?.abort();
  }, [selectedSubstrate, loadHostDiagnostics]);

  useEffect(() => {
    loadObservation();

    return () => observationRequestRef.current?.abort();
  }, [
    selectedSubstrate,
    selectedPath,
    selectedActivation,
    selectedNetworkId,
    loadObservation,
  ]);

  useEffect(() => {
    loadBitMinerRefresh();

    return () => bitMinerRefreshRequestRef.current?.abort();
  }, [selectedSubstrate, selectedActivation, loadBitMinerRefresh]);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const interval = setInterval(() => {
      loadNetworks({ silent: true });
      loadSubstrates({ silent: true });

      if (selectedSubstrateRef.current) {
        loadHostDiagnostics(selectedSubstrateRef.current, { silent: true });
      }

      loadObservation({ silent: true });
      loadBitMinerRefresh({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [
    autoRefresh,
    loadNetworks,
    loadSubstrates,
    loadHostDiagnostics,
    loadObservation,
    loadBitMinerRefresh,
  ]);

  const persistedEvents = eventStore?.events ?? [];
  const runtime = eventStore?.runtime ?? null;

  const activationOptions = useMemo(() => {
    const values = new Set();

    const host = substrates.find(
      (entry) => getSubstrateName(entry) === selectedSubstrate,
    );

    values.add(parseActivation(host?.activations));

    for (const event of persistedEvents) {
      values.add(parseActivation(event?.activation));
    }

    values.add(selectedActivation);

    return Array.from(values)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }, [substrates, selectedSubstrate, persistedEvents, selectedActivation]);

  const refreshAll = () => {
    loadNetworks();
    loadSubstrates();

    if (selectedSubstrateRef.current) {
      loadHostDiagnostics(selectedSubstrateRef.current);
    }

    loadObservation();
    loadBitMinerRefresh();
  };

  const handleSubstrateChange = (event) => {
    const name = event.target.value;

    diagnosticsRequestRef.current?.abort();
    diagnosticsRequestIdRef.current += 1;
    diagnosticsSubstrateRef.current = name;

    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;
    observationContextRef.current = "";

    bitMinerRefreshRequestRef.current?.abort();
    bitMinerRefreshRequestIdRef.current += 1;

    requestedSubstrateRef.current = "";
    selectedSubstrateRef.current = name;
    activationInitializedRef.current = false;

    setSelectedSubstrate(name);
    updateSubstrateQuery(name);

    setSubstrateState(null);
    setEventStore(null);
    setStateError("");
    setEventStoreError("");
    setStateStatus(name ? "checking" : "unknown");
    setEventStoreStatus(name ? "checking" : "unknown");

    // The previous observation belongs to the previous substrate.
    resetObservation("");
    setObservationError("");
    setObservationLoading(false);

    setBitMinerRefresh(null);
    setBitMinerRefreshError("");
    setLastBitMinerRefreshCheck(null);
  };

  const handlePathSelect = (identifier) => {
    // Re-selecting the current path must not discard its observation.
    if (identifier === selectedPathRef.current) return;

    selectedPathRef.current = identifier;

    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;
    observationContextRef.current = "";

    setSelectedPath(identifier);

    // The previous observation belongs to the previous path.
    resetObservation("");
    setObservationError("");
    setObservationLoading(false);
  };

  const handleActivationChange = (event) => {
    setActivationSynced(event.target.value);
  };

  const selectedHostEntry = substrates.find(
    (entry) => getSubstrateName(entry) === selectedSubstrate,
  );

  const hostLive = stateStatus === "live" && eventStoreStatus === "live";

  const hostStatus = hostLive
    ? "live"
    : stateStatus === "error" || eventStoreStatus === "error"
      ? "error"
      : diagnosticsLoading
        ? "checking"
        : "unknown";

  // Only show observation data that belongs to the current selection.
  const currentScopeKey = buildScopeKey(
    selectedSubstrate,
    selectedActivation,
    selectedNetworkId,
    selectedPath,
  );

  const scopeMatches = Boolean(
    currentScopeKey && observationScope === currentScopeKey,
  );

  const scopedObservation = scopeMatches ? observation : null;
  const scopedObservationList = scopeMatches ? observationList : [];

  // Rows show event.qtm.commitment only; the row's Domain commitment is
  // dropped, never used as a fallback.
  const observationListRows = scopedObservationList.map((row) => {
    if (!isPlainObject(row)) return row;

    // eslint-disable-next-line no-unused-vars
    const { commitment: _domainCommitment, event, ...rest } = row;

    return { ...rest, event_commitment: eventCommitmentLabel(event) };
  });

  const observationRunning = Boolean(scopedObservation?.running);
  const listenPort = scopedObservation?.listen_port;
  const electrumAddress = electrumEndpoint(listenPort);

  const observationBadge = observationError
    ? { status: "error", label: "Error" }
    : observationRunning
      ? { status: "running", label: "Running" }
      : observationLoading && !scopedObservation
        ? { status: "checking", label: "Checking" }
        : scopedObservation
          ? { status: "live", label: "Idle" }
          : { status: "unknown", label: "Not started" };

  const observationClips = Array.isArray(scopedObservation?.clips)
    ? scopedObservation.clips
    : [];

  const hasExtraObservationFields = scopedObservation
    ? Object.keys(scopedObservation).some(
        (key) => !KNOWN_OBSERVATION_KEYS.includes(key),
      )
    : false;

  const refreshStatus = bitMinerRefreshError
    ? "error"
    : bitMinerRefreshLoading
      ? "checking"
      : bitMinerRefresh
        ? "live"
        : "unknown";

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full min-w-0 max-w-7xl px-3 py-4 sm:px-5 sm:py-7 lg:px-8">
        <header className="mb-5 sm:mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>

          <h1 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl">
            Network
          </h1>

          <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-600 dark:text-zinc-400 sm:text-sm sm:leading-6">
            The substrate is the persistent host. Network paths are derivation
            contexts. Observation is scoped to the selected substrate,
            activation, and path. Electrum listen ports are separate from the
            API transport and can be used by compatible wallet clients.
          </p>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshAll}
              disabled={networkLoading || substrateLoading}
              className="inline-flex min-h-9 items-center justify-center rounded-lg bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 sm:text-sm"
            >
              {networkLoading || substrateLoading ? "Loading…" : "Refresh"}
            </button>

            <button
              type="button"
              onClick={() => setAutoRefresh((value) => !value)}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-medium dark:border-zinc-700 sm:text-sm"
            >
              Live updates: {autoRefresh ? "On" : "Off"}
            </button>

            <a
              href={
                selectedSubstrate
                  ? `/?substrate=${encodeURIComponent(selectedSubstrate)}`
                  : "/"
              }
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-medium dark:border-zinc-700 sm:text-sm"
            >
              Back to QTM
            </a>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <DiagnosticBadge status="unknown">
              {networks.length} registered paths
            </DiagnosticBadge>

            <DiagnosticBadge status="unknown">
              {substrates.length} substrates
            </DiagnosticBadge>

            <DiagnosticBadge status={hostStatus}>
              {hostLive
                ? "Substrate reachable"
                : hostStatus === "error"
                  ? "Substrate check failed"
                  : hostStatus === "checking"
                    ? "Checking substrate"
                    : "Substrate not confirmed"}
            </DiagnosticBadge>

            <DiagnosticBadge status={observationBadge.status}>
              {observationBadge.status === "running"
                ? "Observation running"
                : observationBadge.status === "checking"
                  ? "Observation checking"
                  : observationBadge.status === "error"
                    ? "Observation error"
                    : observationBadge.status === "live"
                      ? "Observation idle"
                      : "Observation not started"}
            </DiagnosticBadge>
          </div>

          <p className="mt-2 break-words text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
            {lastNetworkCheck
              ? `Paths checked ${lastNetworkCheck.toLocaleTimeString()}`
              : "Waiting for network data"}
            {" · "}
            {lastSubstrateCheck
              ? `Substrates checked ${lastSubstrateCheck.toLocaleTimeString()}`
              : "Waiting for substrate data"}
            {" · "}
            {REFRESH_INTERVAL_MS / 1000}s refresh interval
          </p>
        </header>

        {networkError && (
          <div className="mb-3">
            <ErrorMessage>{networkError}</ErrorMessage>
          </div>
        )}

        <section className="mb-4 min-w-0 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold sm:text-base">
                Substrate environment
              </h2>

              <p className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400 sm:text-xs">
                Persistent host for state and events. Shared with the main QTM
                page through the substrate URL parameter.
              </p>
            </div>

            <DiagnosticBadge status={hostStatus}>
              {hostLive
                ? "Reachable"
                : hostStatus === "error"
                  ? "Check failed"
                  : diagnosticsLoading
                    ? "Checking"
                    : "Not checked"}
            </DiagnosticBadge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_auto]">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Substrate
              </span>

              <select
                value={selectedSubstrate}
                onChange={handleSubstrateChange}
                disabled={substrateLoading || substrates.length === 0}
                className="h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
              >
                {substrates.length === 0 && (
                  <option value="">
                    {substrateLoading
                      ? "Loading substrates…"
                      : "No substrates found"}
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

            <label className="block min-w-0">
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Activation
              </span>

              <select
                value={selectedActivation}
                onChange={handleActivationChange}
                disabled={!selectedSubstrate}
                className="h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
              >
                {activationOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <button
                type="button"
                onClick={() => loadHostDiagnostics(selectedSubstrate)}
                disabled={!selectedSubstrate || diagnosticsLoading}
                className="h-10 w-full rounded-lg border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800 sm:text-sm lg:w-auto"
              >
                {diagnosticsLoading ? "Checking…" : "Check substrate"}
              </button>
            </div>
          </div>

          {substrateListError && (
            <div className="mt-3">
              <ErrorMessage>{substrateListError}</ErrorMessage>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
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

              {stateError && (
                <p className="mt-2 break-words text-xs text-red-700 dark:text-red-300 [overflow-wrap:anywhere]">
                  {stateError}
                </p>
              )}
            </div>

            <div className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
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

              {eventStoreError && (
                <p className="mt-2 break-words text-xs text-red-700 dark:text-red-300 [overflow-wrap:anywhere]">
                  {eventStoreError}
                </p>
              )}
            </div>
          </div>

          {lastDiagnosticsCheck && (
            <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              Diagnostics checked {lastDiagnosticsCheck.toLocaleTimeString()}
            </p>
          )}
        </section>

        {substrateState && (
          <section className="mb-4 min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
              <h2 className="text-sm font-semibold sm:text-base">
                Substrate system state
              </h2>

              <p className="mt-1 break-all text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                {displayValue(substrateState.namespace)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 min-[420px]:grid-cols-2 sm:grid-cols-3 sm:p-4 lg:grid-cols-4">
              <DiagnosticValue label="Substrate" value={selectedSubstrate} />
              <DiagnosticValue label="Dimension" value={substrateState.dimension} />
              <DiagnosticValue label="Commitment" value={substrateState.commitment} />
              <DiagnosticValue label="Coordinate" value={substrateState.coordinate} />
              <DiagnosticValue label="Sigma" value={substrateState.sigma} />
              <DiagnosticValue label="Network" value={substrateState.network} />
              <DiagnosticValue label="Indices" value={substrateState.indices} />

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
              Entropy content is not displayed. This report only indicates
              whether the field is present.
            </p>
          </section>
        )}

        <section className="min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold sm:text-base">
                Registered network paths
              </h2>

              <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
                Derivation contexts. Select a path to scope observation.
                Persisted events stay on the substrate.
              </p>
            </div>

            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
              {networks.length} paths
            </span>
          </div>

          <div className="w-full min-w-0 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs sm:text-sm">
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
                          className="whitespace-nowrap rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[10px] font-semibold hover:bg-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-700 sm:text-xs"
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
                      No registered paths were returned.
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
                Derivation context only. Observation controls are available
                for the selected registered network path below; event records
                remain on the selected substrate.
              </p>
            </div>
          )}
        </section>

        <section className="mt-4 min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:mt-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold sm:text-base">
                bit-miner refresh status
              </h2>

              <p className="mt-1 text-[10px] leading-5 text-zinc-500 dark:text-zinc-400 sm:text-xs">
                Activation-scoped status and refresh-path check. This request
                does not start, stop, or refresh the miner&apos;s internal
                pipeline. Execution remains owned by bit-miner/src/main.rs.
              </p>
            </div>

            <DiagnosticBadge status={refreshStatus}>
              {bitMinerRefreshError
                ? "Unavailable"
                : bitMinerRefreshLoading
                  ? "Checking"
                  : bitMinerRefresh
                    ? "Path response received"
                    : "Not checked"}
            </DiagnosticBadge>
          </div>

          <div className="grid grid-cols-1 gap-4 p-3 min-[420px]:grid-cols-2 sm:p-4 lg:grid-cols-3">
            <DiagnosticValue
              label="Substrate"
              value={selectedSubstrate || "—"}
            />

            <DiagnosticValue
              label="Activation"
              value={selectedActivation}
            />

            <DiagnosticValue
              label="Execution owner"
              value="bit-miner/src/main.rs"
            />

            <DiagnosticValue
              label="Refresh path"
              value={getRefreshPath(bitMinerRefresh)}
            />

            <DiagnosticValue
              label="Activation path"
              value={bitMinerRefresh?.activation_path ?? "Unavailable"}
            />

            <DiagnosticValue
              label="Execution status"
              value={
                bitMinerRefresh?.independently_run === true
                  ? "Independent execution reported"
                  : "Not confirmed by runtime"
              }
            />

            <DiagnosticValue
              label="Last path check"
              value={
                lastBitMinerRefreshCheck
                  ? lastBitMinerRefreshCheck.toLocaleTimeString()
                  : "—"
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
            <button
              type="button"
              onClick={() => loadBitMinerRefresh()}
              disabled={!selectedSubstrate || bitMinerRefreshLoading}
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {bitMinerRefreshLoading
                ? "Checking path…"
                : "Check refresh path"}
            </button>

            <span className="min-w-0 text-[10px] leading-5 text-zinc-500 dark:text-zinc-400 sm:text-xs">
              Status/path check only. Does not launch or refresh the miner.
            </span>
          </div>

          {bitMinerRefreshError && (
            <div className="px-3 pb-3 sm:px-4">
              <ErrorMessage>{bitMinerRefreshError}</ErrorMessage>
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------------
            Network observation: ONE stable box. Header, scope, controls,
            live-state strip, result, clips, list and errors all live here.
            ------------------------------------------------------------------ */}
        <section className="mt-4 min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="whitespace-nowrap text-sm font-semibold sm:text-base">
                Network observation
              </h2>

              <DiagnosticBadge status={observationBadge.status}>
                {observationBadge.label}
              </DiagnosticBadge>
            </div>

            <span className="whitespace-nowrap text-[10px] text-zinc-500 dark:text-zinc-400">
              {lastObservationCheck && scopeMatches
                ? `Checked ${lastObservationCheck.toLocaleTimeString()}`
                : autoRefresh
                  ? `Refreshes every ${REFRESH_INTERVAL_MS / 1000}s`
                  : "Live updates off"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 border-b border-zinc-200 p-2 dark:border-zinc-800 sm:grid-cols-4 sm:p-2.5">
            <CompactValue label="Substrate" value={selectedSubstrate || "—"} />
            <CompactValue label="Activation" value={selectedActivation} />
            <CompactValue label="Network ID" value={selectedNetworkId || "—"} />
            <CompactValue
              label="Path"
              value={
                selectedNetwork
                  ? getPathIdentifier(selectedNetwork)
                  : selectedPath || "—"
              }
            />
          </div>

          <div
            className="flex min-h-[2.75rem] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4"
            aria-live="polite"
          >
            {observationHasNetworkContext ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={startObservation}
                  disabled={
                    !selectedSubstrate ||
                    !selectedNetworkId ||
                    observationActionLoading ||
                    observationRunning
                  }
                  className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-lg bg-zinc-950 px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950"
                >
                  {observationActionLoading && !observationRunning
                    ? "Starting…"
                    : "Start"}
                </button>

                <button
                  type="button"
                  onClick={stopObservation}
                  disabled={
                    !selectedSubstrate ||
                    !selectedNetworkId ||
                    observationActionLoading ||
                    !observationRunning
                  }
                  className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-300 px-3 py-1.5 text-center text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {observationActionLoading && observationRunning
                    ? "Stopping…"
                    : "Stop"}
                </button>

                <button
                  type="button"
                  onClick={() => loadObservation()}
                  disabled={
                    !selectedSubstrate ||
                    !selectedNetworkId ||
                    observationLoading ||
                    observationActionLoading
                  }
                  className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-lg border border-zinc-300 px-3 py-1.5 text-center text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {observationLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            ) : (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Select a registered network path to scope observation.
              </span>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {observationActionLoading && (
                <DiagnosticBadge status="checking">Applying…</DiagnosticBadge>
              )}

              {observationLoading && !observationActionLoading && (
                <DiagnosticBadge status="checking">Refreshing…</DiagnosticBadge>
              )}

              {scopedObservation && observationStale && (
                <DiagnosticBadge status="checking">
                  Last known result
                </DiagnosticBadge>
              )}

              {scopedObservation && observationNotice && (
                <DiagnosticBadge status="running">
                  {observationNotice}
                </DiagnosticBadge>
              )}
            </div>
          </div>

          {observationError && (
            <div className="px-3 pb-2 sm:px-4">
              <ErrorMessage>{observationError}</ErrorMessage>
            </div>
          )}

          {scopedObservation && (
            <div className="min-w-0 space-y-2 border-t border-zinc-200 p-2 dark:border-zinc-800 sm:p-2.5">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
                <CompactValue
                  label="Running"
                  value={scopedObservation.running ? "yes" : "no"}
                />

                <CompactValue
                  label="Event commitment"
                  mono
                  value={eventCommitmentLabel(scopedObservation.event)}
                />

                <CompactValue
                  label="Electrum listen port"
                  value={listenPort}
                />

                <CompactValue
                  label="Electrum endpoint"
                  value={electrumAddress}
                />

                <CompactValue
                  label="Path hint"
                  value={scopedObservation.path}
                />

                <CompactValue
                  label="Message"
                  value={scopedObservation.message}
                />

                <CompactValue
                  label="Runtime"
                  value={
                    scopedObservation.runtime?.unix_seconds !== undefined
                      ? formatTimestamp(scopedObservation.runtime.unix_seconds)
                      : "—"
                  }
                />

                <CompactValue
                  label="Clips"
                  value={observationClips.length}
                />
              </div>

              {hasExtraObservationFields && (
                <details className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold">
                    Additional response fields
                  </summary>

                  <div className="min-w-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
                    <ResponseFields
                      data={scopedObservation}
                      omit={KNOWN_OBSERVATION_KEYS}
                    />
                  </div>
                </details>
              )}

              <details className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold">
                  Raw runtime response
                </summary>

                <pre className="max-h-56 overflow-auto border-t border-zinc-200 bg-zinc-50 p-3 text-[10px] leading-4 dark:border-zinc-800 dark:bg-zinc-950">
                  {safeJson(scopedObservation)}
                </pre>
              </details>
            </div>
          )}

          {scopedObservation && observationClips.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800">
              <div className="px-3 py-1.5 sm:px-4">
                <h3 className="text-xs font-semibold sm:text-sm">
                  Observation clips
                </h3>
              </div>

              <div className="min-w-0 px-3 pb-2 sm:px-4">
                <ObjectTable
                  rows={observationClips}
                  columns={["substrate", "active", "direction"]}
                />
              </div>
            </div>
          )}

          {scopedObservationList.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800">
              <div className="px-3 py-1.5 sm:px-4">
                <h3 className="text-xs font-semibold sm:text-sm">
                  Activation observation list
                </h3>
              </div>

              <div className="min-w-0 px-3 pb-2 sm:px-4">
                <ObjectTable
                  rows={observationListRows}
                  columns={[
                    "network",
                    "event_commitment",
                    "listen_port",
                    "running",
                    "path",
                  ]}
                />
              </div>
            </div>
          )}

          {observationHasNetworkContext &&
            !scopedObservation &&
            !observationLoading &&
            !observationActionLoading &&
            !observationError && (
              <p className="px-3 py-3 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:px-4">
                No live observation for this path. Start one to request
                observation through the QTM runtime.
              </p>
            )}

          {observationLoading && !scopedObservation && (
            <p className="px-3 py-3 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:px-4">
              Loading observation status…
            </p>
          )}
        </section>

        <section className="mt-4 min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 sm:mt-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold sm:text-base">
                Persistent event store
              </h2>

              <p className="mt-1 break-all text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs [overflow-wrap:anywhere]">
                {eventStore?.events_directory ??
                  (selectedSubstrate
                    ? `Substrate: ${selectedSubstrate}`
                    : "Select a substrate")}
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
              <div className="grid grid-cols-1 gap-4 p-3 min-[420px]:grid-cols-2 sm:grid-cols-3 sm:p-4 lg:grid-cols-4">
                <DiagnosticValue label="Substrate" value={eventStore.substrate} />
                <DiagnosticValue label="Event directory" value={eventStore.events_directory} />
                <DiagnosticValue label="Substrate directory" value={eventStore.directory} />

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

              <div className="w-full min-w-0 overflow-x-auto">
                <table className="w-full min-w-[740px] border-collapse text-left text-xs">
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
                            Event store is reachable, but no records were
                            returned for this substrate.
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
                            Select a substrate to inspect its event store.
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!eventStore &&
            eventStoreStatus === "error" &&
            !diagnosticsLoading && (
              <p className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:px-4 sm:text-sm">
                Event store is unavailable for this substrate. See the error
                above.
              </p>
            )}

          {!eventStore &&
            eventStoreStatus !== "error" &&
            !diagnosticsLoading && (
              <p className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:px-4 sm:text-sm">
                Select a substrate to load its persisted event records.
              </p>
            )}
        </section>

        <footer className="mt-6 border-t border-zinc-200 pt-3.5 text-[10px] leading-5 text-zinc-500 dark:border-zinc-800 sm:mt-8 sm:pt-4 sm:text-xs">
          QTM Network · Substrate host · Path-scoped observation · Electrum
          endpoints · Event-store diagnostics · qtm-api
        </footer>
      </div>
    </main>
  );
}
