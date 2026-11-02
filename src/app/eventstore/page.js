"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api-hxcs.onrender.com"
).replace(/\/+$/, "");

const REFRESH_INTERVAL_MS = 8000;
const U128_MAX = 340282366920938463463374607431768211455n;

const INPUT =
  "h-10 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/10 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
const PANEL =
  "min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900";

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;
    throw new Error(
      `Could not reach the QTM API at ${API_BASE}: ${
        cause instanceof Error ? cause.message : "network error"
      }`,
    );
  }

  const raw = await response.text();
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { response_text: raw };
    }
  }
  if (!response.ok) {
    throw new Error(
      body?.error ||
        body?.message ||
        body?.detail ||
        body?.response_text ||
        `Request failed with HTTP ${response.status}`,
    );
  }
  return body;
}

function enc(value) {
  return encodeURIComponent(String(value));
}

function activationFromEvent(event) {
  const value =
    event?.activation ??
    event?.heritage?.state?.activation_count ??
    event?.manifold?.activations;
  return value === undefined || value === null || !/^\d+$/.test(String(value))
    ? null
    : String(value);
}

function normalizeNetwork(network) {
  if (!network || typeof network.id !== "string") return null;
  return {
    id: network.id,
    name: network.name || network.id,
    coin: network.coin,
    purpose: network.purpose,
    path: network.path,
    registered: network.registered,
  };
}

function normalizePayload(entry, fallbackRecord) {
  const network = normalizeNetwork(entry?.network);
  const path = entry?.path ?? entry?.payload_path;
  const depth = entry?.depth_identifier ?? entry?.depthIdentifier ?? entry?.depth_id;
  if (!network || typeof path !== "string" || depth == null) return null;
  const record = String(entry?.record ?? fallbackRecord);
  const rawDirection = String(entry?.direction || "").toLowerCase();
  const direction =
    rawDirection === "transit_inputs" || rawDirection === "transit"
      ? "transit_inputs"
      : rawDirection === "exile_outputs" || rawDirection === "exile"
        ? "exile_outputs"
        : record.startsWith("event_")
          ? "transit_inputs"
          : record.startsWith("exile_")
            ? "exile_outputs"
            : "unclassified";
  const objects = Array.isArray(entry?.objects) ? entry.objects : [];
  return {
    ...entry,
    record,
    network,
    path,
    depth_identifier: String(depth),
    direction,
    objects,
  };
}

function networkKey(network) {
  return network?.id || "";
}

function bitcoinNetwork(network) {
  const coin = String(network?.coin || "").toLowerCase();
  const id = String(network?.id || "").toLowerCase();
  return coin === "bitcoin" || id === "bitcoin" || id === "btc" || id.includes("bitcoin");
}

function money(value) {
  if (value === undefined || value === null || value === "") return "—";
  return String(value);
}

function parseU128(value, label) {
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a non-negative whole number.`);
  const parsed = BigInt(raw);
  if (parsed > U128_MAX) throw new Error(`${label} exceeds u128.`);
  return parsed.toString();
}

function Notice({ children, type = "error" }) {
  const styles = {
    error:
      "border-pink-200 bg-pink-50 text-pink-800 dark:border-pink-900 dark:bg-pink-950 dark:text-pink-300",
    warning:
      "border-pink-200 bg-pink-50 text-pink-800 dark:border-pink-900 dark:bg-pink-950 dark:text-pink-300",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  };
  return (
    <div
      role={type === "error" ? "alert" : "status"}
      className={`break-words rounded-xl border px-3 py-3 text-sm leading-5 ${
        styles[type] ?? styles.error
      }`}
    >
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium leading-5">
        {children ?? "—"}
      </dd>
    </div>
  );
}

function Panel({ title, description, action, children, className = "" }) {
  return (
    <section className={`${PANEL} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight sm:text-base">{title}</h2>
          {description && (
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function BudgetSummary({ budget }) {
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2">
      <Field label="Minimum events">{money(budget?.min_events)}</Field>
      <Field label="Maximum events">{money(budget?.max_events)}</Field>
      <Field label="Maximum retained mass">{money(budget?.max_retained_mass)}</Field>
    </dl>
  );
}

function BudgetEditor({ budget, disabled, onSave }) {
  const [draft, setDraft] = useState({
    min_events: String(budget?.min_events ?? 0),
    max_events: String(budget?.max_events ?? 1024),
    max_retained_mass: String(budget?.max_retained_mass ?? 1048576),
  });

  useEffect(() => {
    setDraft({
      min_events: String(budget?.min_events ?? 0),
      max_events: String(budget?.max_events ?? 1024),
      max_retained_mass: String(budget?.max_retained_mass ?? 1048576),
    });
  }, [budget?.min_events, budget?.max_events, budget?.max_retained_mass]);

  return (
    <form
      className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-3 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      {[
        ["min_events", "Minimum events"],
        ["max_events", "Maximum events"],
        ["max_retained_mass", "Maximum retained mass (u128)"],
      ].map(([key, label]) => (
        <label key={key} className="block min-w-0">
          <span className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {label}
          </span>
          <input
            className={INPUT}
            inputMode="numeric"
            value={draft[key]}
            disabled={disabled}
            onChange={(event) =>
              setDraft((current) => ({ ...current, [key]: event.target.value }))
            }
          />
        </label>
      ))}
      <div className="sm:col-span-3">
        <button className={BUTTON} type="submit" disabled={disabled}>
          Save network budget
        </button>
      </div>
    </form>
  );
}

function PayloadBoard({ board, loading }) {
  if (loading && !board) {
    return <p className="mt-3 text-xs text-zinc-500">Loading network payload board…</p>;
  }
  if (!board) {
    return <p className="mt-3 text-xs text-zinc-500">No payload-board response yet.</p>;
  }
  return (
    <div className="mt-3 space-y-3">
      {board.error && <Notice>{board.error}</Notice>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Board activation">{money(board.activation)}</Field>
        <Field label="Commitment">{money(board.commitment)}</Field>
        <Field label="Network">{money(board.network)}</Field>
        <Field label="Payload kinds">{board.kinds?.length ?? 0}</Field>
      </div>
      {board.message && <p className="text-xs text-zinc-500">{board.message}</p>}
      {board.observation && (
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950">
          <Field label="Miner process">{board.observation.process_running == null ? "Not reported" : board.observation.process_running ? "Running" : "Stopped"}</Field>
          <Field label="Miner PID">{money(board.observation.pid)}</Field>
          <Field label="Miner feature">{board.observation.bit_minner_feature == null ? "Not reported" : String(board.observation.bit_minner_feature)}</Field>
          <Field label="Settlement payload carried">{board.observation.settlement_payload_carried == null ? "Not reported" : String(board.observation.settlement_payload_carried)}</Field>
        </dl>
      )}
      <div className="space-y-2">
        {(board.kinds || []).map((kind, index) => (
          <div key={`${kind.kind}-${index}`} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{kind.kind}</span>
              <span className="text-xs text-zinc-500">
                {kind.available ? "Available" : "Unavailable"} · {kind.in_scope ? "In scope" : "Out of scope"}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Field label="Depth path">{money(kind.depth_path)}</Field>
              <Field label="Depth record">{money(kind.depth_record)}</Field>
              <Field label="Depth objects">{kind.depth_objects?.length ?? 0}</Field>
              <Field label="Authorized payload">{kind.authorized_payload?.carried == null ? "Not reported" : String(kind.authorized_payload.carried)}</Field>
              <Field label="Authorization state">{money(kind.authorized_payload?.authorization_state)}</Field>
              <Field label="Settlement state">{money(kind.authorized_payload?.settlement_state)}</Field>
            </dl>
          </div>
        ))}
        {(board.kinds || []).length === 0 && (
          <p className="text-xs text-zinc-500">No payload kinds were returned for this network.</p>
        )}
      </div>
    </div>
  );
}

function ObservationControl({ substrate, activation, network, status, busy, onAction }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider">Bitcoin observation</h4>
          <p className="mt-1 text-xs text-zinc-500">
            {status?.running === true ? "Miner process running" : status?.running === false ? "Miner process stopped" : "Status not loaded"}
            {status?.pid ? ` · PID ${status.pid}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={busy} onClick={() => onAction("start", network)}>
            {busy ? "Working…" : "Start"}
          </button>
          <button type="button" className={BUTTON} disabled={busy} onClick={() => onAction("stop", network)}>
            Stop
          </button>
        </div>
      </div>
      {status?.error && <p className="mt-2 break-words text-xs text-pink-700 dark:text-pink-300">{status.error}</p>}
      {status?.path && <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">Event path: {status.path}</p>}
      {status?.log_path && <p className="mt-1 break-all font-mono text-[11px] text-zinc-500">Log: {status.log_path}</p>}
      <p className="mt-2 text-[11px] text-zinc-500">
        {substrate} · activation {activation} · {network.id}
      </p>
    </div>
  );
}

function WirePackets({ metadata, loading }) {
  const route = metadata?.file_route;
  const href = route ? `${API_BASE}${route.startsWith("/") ? route : `/${route}`}` : null;
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider">Persisted wirepackets file</h4>
        <span className="text-xs text-zinc-500">
          {loading ? "Loading…" : metadata?.exists ? "File present" : metadata ? "No file" : "Not loaded"}
        </span>
      </div>
      {metadata && (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Scope">{money(metadata.scope)}</Field>
          <Field label="Bytes">{metadata.bytes == null ? "Not reported" : Number(metadata.bytes).toLocaleString()}</Field>
          <Field label="Activation">{money(metadata.activation)}</Field>
          <Field label="Network">{money(metadata.network)}</Field>
        </dl>
      )}
      {metadata?.path && <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">{metadata.path}</p>}
      {href ? (
        <a
          className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          Open persisted wirepackets file
        </a>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">The API has not returned a file route.</p>
      )}
    </div>
  );
}

export default function EventStorePage() {
  const [substrates, setSubstrates] = useState([]);
  const [substrate, setSubstrate] = useState("");
  const [activation, setActivation] = useState("");
  const [events, setEvents] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [payloads, setPayloads] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [boards, setBoards] = useState({});
  const [wirePackets, setWirePackets] = useState({});
  const [observations, setObservations] = useState({});
  const [busyObservation, setBusyObservation] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loadingList, setLoadingList] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingPayloads, setLoadingPayloads] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingWire, setLoadingWire] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [budgetErrors, setBudgetErrors] = useState({});
  const [budgetNotices, setBudgetNotices] = useState({});
  const [store, setStore] = useState(null);

  const selectedSubstrateRef = useRef("");
  const selectedActivationRef = useRef("");
  const payloadRequestRef = useRef(0);
  const scopeRequestRef = useRef(0);
  const eventsRef = useRef([]);

  const selectedEvents = useMemo(
    () => events.filter((event) => activationFromEvent(event) === String(activation)),
    [events, activation],
  );

  const payloadGroups = useMemo(() => {
    const groups = new Map();
    for (const payload of payloads) {
      const id = payload.network.id;
      if (!groups.has(id)) groups.set(id, { transit_inputs: [], exile_outputs: [], unclassified: [] });
      groups.get(id)[payload.direction].push(payload);
    }
    return groups;
  }, [payloads]);

  const networkBudgetById = useMemo(() => {
    const result = new Map();
    for (const row of budgets) {
      const network = normalizeNetwork(row.network);
      if (network) result.set(network.id, row);
    }
    return result;
  }, [budgets]);

  const activationOptions = useMemo(() => {
    const values = new Set(events.map(activationFromEvent).filter(Boolean));
    if (activation) values.add(String(activation));
    if (!values.size) values.add("0");
    return [...values].sort((a, b) => Number(b) - Number(a));
  }, [events, activation]);

  const loadPayloadsForEvents = useCallback(async (name, eventRows, activationValue) => {
    const selectedActivation = String(activationValue);
    const scopedEvents = Array.isArray(eventRows)
      ? eventRows.filter((event) => activationFromEvent(event) === selectedActivation)
      : [];

    if (!name || !/^\d+$/.test(selectedActivation) || scopedEvents.length === 0) {
      payloadRequestRef.current += 1;
      setPayloads([]);
      setLoadingPayloads(false);
      return [];
    }

    const requestId = ++payloadRequestRef.current;
    setLoadingPayloads(true);

    try {
      const records = [
        ...new Set(
          scopedEvents
            .map((event) => event?.record)
            .filter((record) => typeof record === "string" && record.length > 0),
        ),
      ];

      const results = await Promise.allSettled(
        records.map((record) =>
          apiRequest(`/wallets/${enc(name)}/events/${enc(record)}/payloads`),
        ),
      );

      if (
        requestId !== payloadRequestRef.current ||
        selectedSubstrateRef.current !== name ||
        selectedActivationRef.current !== selectedActivation
      ) return null;

      const collected = [];
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const rows = Array.isArray(result.value?.payloads) ? result.value.payloads : [];
        rows.forEach((entry) => {
          const normalized = normalizePayload(entry, records[index]);
          if (normalized) collected.push(normalized);
        });
      });
      setPayloads(collected);
      return collected;
    } catch (err) {
      if (
        requestId === payloadRequestRef.current &&
        selectedSubstrateRef.current === name &&
        selectedActivationRef.current === selectedActivation
      ) {
        setPayloads([]);
        setError(`Unable to load payload render data: ${err instanceof Error ? err.message : "unknown API error"}`);
      }
      return null;
    } finally {
      if (requestId === payloadRequestRef.current) setLoadingPayloads(false);
    }
  }, []);

  const loadEvents = useCallback(async (name, activationValue) => {
    if (!name) return;
    const selected = String(activationValue);
    const requestId = ++scopeRequestRef.current;
    setLoadingEvents(true);
    setError("");
    try {
      const eventBody = await apiRequest(`/wallets/${enc(name)}/events`);
      if (requestId !== scopeRequestRef.current || selectedSubstrateRef.current !== name) return;
      const nextEvents = Array.isArray(eventBody?.events) ? eventBody.events : [];
      setEvents(nextEvents);
      eventsRef.current = nextEvents;
      setStore(eventBody);
      await loadPayloadsForEvents(name, nextEvents, selected);
    } catch (err) {
      if (requestId === scopeRequestRef.current) {
        setEvents([]);
        eventsRef.current = [];
        setPayloads([]);
        setError(err instanceof Error ? err.message : "Unable to load events.");
      }
    } finally {
      if (requestId === scopeRequestRef.current) setLoadingEvents(false);
    }
  }, [loadPayloadsForEvents]);

  const loadBudgets = useCallback(async (name, activationValue) => {
    if (!name || !/^\d+$/.test(String(activationValue))) return;
    const selected = String(activationValue);
    try {
      const body = await apiRequest(`/wallets/${enc(name)}/activations/${enc(selected)}/budgets`);
      if (selectedSubstrateRef.current !== name || selectedActivationRef.current !== selected) return;
      const rows = Array.isArray(body?.budgets) ? body.budgets : [];
      setBudgets(
        rows.filter((row) => row?.activation == null || String(row.activation) === selected),
      );
    } catch (err) {
      if (selectedSubstrateRef.current === name && selectedActivationRef.current === selected) {
        setBudgets([]);
        setError(`Unable to load network budgets: ${err instanceof Error ? err.message : "API error"}`);
      }
    } finally {
      if (selectedSubstrateRef.current === name && selectedActivationRef.current === selected) setLoadingBudgets(false);
    }
  }, []);

  const loadNetworkData = useCallback(async (name, activationValue, networkRows) => {
    if (!name || !/^\d+$/.test(String(activationValue))) return;
    const selected = String(activationValue);
    const requestId = ++scopeRequestRef.current;
    const activeNetworks = (networkRows || []).map(normalizeNetwork).filter(Boolean);
    setLoadingBoards(true);
    setLoadingWire(true);

    const boardResults = await Promise.allSettled(
      activeNetworks.map((network) =>
        apiRequest(`/wallets/${enc(name)}/activations/${enc(selected)}/networks/${enc(network.id)}/payload-board`),
      ),
    );
    if (
      requestId !== scopeRequestRef.current ||
      selectedSubstrateRef.current !== name ||
      selectedActivationRef.current !== selected
    ) return;

    const nextBoards = {};
    boardResults.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const body = result.value;
      if (body?.activation != null && String(body.activation) !== selected) return;
      nextBoards[activeNetworks[index].id] = body;
    });
    setBoards(nextBoards);
    setLoadingBoards(false);

    const btcNetworks = activeNetworks.filter(bitcoinNetwork);
    const wireResults = await Promise.allSettled(
      btcNetworks.map((network) =>
        apiRequest(`/wallets/${enc(name)}/activations/${enc(selected)}/networks/${enc(network.id)}/wirepackets`),
      ),
    );
    if (
      requestId !== scopeRequestRef.current ||
      selectedSubstrateRef.current !== name ||
      selectedActivationRef.current !== selected
    ) return;

    const nextWire = {};
    wireResults.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const metadata = result.value;
      if (metadata?.activation != null && String(metadata.activation) !== selected) return;
      nextWire[btcNetworks[index].id] = metadata;
    });
    setWirePackets(nextWire);
    setLoadingWire(false);
  }, []);

  const loadObservationStatuses = useCallback(async (name, activationValue, networkRows) => {
    if (!name || !/^\d+$/.test(String(activationValue))) return;
    const selected = String(activationValue);
    const btcNetworks = (networkRows || []).map(normalizeNetwork).filter(bitcoinNetwork);
    const results = await Promise.allSettled(
      btcNetworks.map((network) =>
        apiRequest(`/wallets/${enc(name)}/activations/${enc(selected)}/networks/${enc(network.id)}/observation`),
      ),
    );
    if (selectedSubstrateRef.current !== name || selectedActivationRef.current !== selected) return;
    const next = {};
    results.forEach((result, index) => {
      if (result.status === "fulfilled") next[btcNetworks[index].id] = result.value;
    });
    setObservations(next);
  }, []);

  const loadAll = useCallback(async (name, activationValue, networkRows = []) => {
    if (!name || !/^\d+$/.test(String(activationValue))) return;
    const selected = String(activationValue);
    selectedSubstrateRef.current = name;
    selectedActivationRef.current = selected;
    setLoadingBudgets(true);
    setError("");
    await Promise.all([
      loadBudgets(name, selected),
      loadNetworkData(name, selected, networkRows),
      loadObservationStatuses(name, selected, networkRows),
    ]);
  }, [loadBudgets, loadNetworkData, loadObservationStatuses]);

  const loadInitial = useCallback(async () => {
    setLoadingList(true);
    try {
      const [walletBody, networkBody] = await Promise.all([
        apiRequest("/wallets"),
        apiRequest("/networks"),
      ]);
      const walletRows = Array.isArray(walletBody?.substrates) ? walletBody.substrates : [];
      const networkRows = (Array.isArray(networkBody?.networks) ? networkBody.networks : [])
        .map(normalizeNetwork)
        .filter(Boolean);
      setSubstrates(walletRows);
      setNetworks(networkRows);
      const initialName = walletRows[0]?.name || "";
      if (initialName) {
        setSubstrate(initialName);
        selectedSubstrateRef.current = initialName;
        const initialActivation = String(walletRows[0]?.activations ?? "0");
        const safeActivation = /^\d+$/.test(initialActivation) ? initialActivation : "0";
        setActivation(safeActivation);
        selectedActivationRef.current = safeActivation;
        await loadEvents(initialName, safeActivation);
        await loadAll(initialName, safeActivation, networkRows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to initialize Event Store.");
    } finally {
      setLoadingList(false);
    }
  }, [loadAll, loadEvents]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const chooseSubstrate = async (name) => {
    selectedSubstrateRef.current = name;
    selectedActivationRef.current = "";
    scopeRequestRef.current += 1;
    payloadRequestRef.current += 1;
    setSubstrate(name);
    setActivation("");
    setEvents([]);
    setPayloads([]);
    setBudgets([]);
    setBoards({});
    setWirePackets({});
    setObservations({});
    setStore(null);
    setError("");
    setNotice("");
    if (!name) return;
    try {
      const substrateRow = substrates.find((entry) => entry.name === name);
      const rawActivation = String(substrateRow?.activations ?? "0");
      const selected = /^\d+$/.test(rawActivation) ? rawActivation : "0";
      setActivation(selected);
      selectedActivationRef.current = selected;
      await loadEvents(name, selected);
      await loadAll(name, selected, networks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open substrate.");
    }
  };

  function chooseActivation(value) {
    if (!/^\d+$/.test(String(value))) return;
    const selected = String(value);
    selectedActivationRef.current = selected;
    scopeRequestRef.current += 1;
    payloadRequestRef.current += 1;
    setActivation(selected);
    setBudgets([]);
    setWirePackets({});
    setBoards({});
    setObservations({});
    setPayloads([]);
    setError("");
    setNotice("");
    setBudgetErrors({});
    setBudgetNotices({});
    loadPayloadsForEvents(substrate, events, selected);
    loadAll(substrate, selected, networks);
  }

  const refreshAll = async () => {
    if (!substrate) return;
    const selected = String(activation);
    await loadEvents(substrate, selected);
    await loadAll(substrate, selected, networks);
    setNotice("Event Store refreshed from the QTM API.");
  };

  const saveBudget = async (network, draft) => {
    const key = networkKey(network);
    setBudgetErrors((current) => ({ ...current, [key]: "" }));
    setBudgetNotices((current) => ({ ...current, [key]: "" }));
    try {
      const body = {
        min_events: Number(draft.min_events),
        max_events: Number(draft.max_events),
        max_retained_mass: parseU128(draft.max_retained_mass, "Maximum retained mass"),
      };
      if (!Number.isSafeInteger(body.min_events) || body.min_events < 0) throw new Error("Minimum events must be a non-negative safe integer.");
      if (!Number.isSafeInteger(body.max_events) || body.max_events < 0) throw new Error("Maximum events must be a non-negative safe integer.");
      await apiRequest(
        `/wallets/${enc(substrate)}/activations/${enc(activation)}/budgets/${enc(network.id)}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      setBudgetNotices((current) => ({ ...current, [key]: "Network budget saved." }));
      await loadBudgets(substrate, activation);
    } catch (err) {
      setBudgetErrors((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Unable to save network budget.",
      }));
    }
  };

  const observationAction = async (action, network) => {
    const id = network.id;
    setBusyObservation((current) => ({ ...current, [id]: true }));
    setError("");
    try {
      const route = `/wallets/${enc(substrate)}/activations/${enc(activation)}/networks/${enc(id)}/observation`;
      const body = await apiRequest(route, { method: action === "start" ? "POST" : "DELETE" });
      setObservations((current) => ({ ...current, [id]: body }));
      setNotice(body?.message || `Bitcoin observation ${action} request completed.`);
      const status = await apiRequest(route);
      setObservations((current) => ({ ...current, [id]: status }));
      // Refresh only the network board and API-owned wire-packet metadata.
      const [board, wire] = await Promise.all([
        apiRequest(`/wallets/${enc(substrate)}/activations/${enc(activation)}/networks/${enc(id)}/payload-board`),
        apiRequest(`/wallets/${enc(substrate)}/activations/${enc(activation)}/networks/${enc(id)}/wirepackets`),
      ]);
      setBoards((current) => ({ ...current, [id]: board }));
      setWirePackets((current) => ({ ...current, [id]: wire }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bitcoin observation request failed.");
    } finally {
      setBusyObservation((current) => ({ ...current, [id]: false }));
    }
  };

  const activationEvents = selectedEvents;
  const retainedMass = activationEvents.reduce((sum, event) => {
    const value = event?.retained_mass ?? event?.heritage?.state?.retained_mass ?? "0";
    if (!/^\d+$/.test(String(value))) return sum;
    return sum + BigInt(value);
  }, 0n);

  const renderedNetworks = useMemo(() => {
    const byId = new Map(networks.map((network) => [network.id, network]));
    for (const payload of payloads) {
      if (!byId.has(payload.network.id)) byId.set(payload.network.id, payload.network);
    }
    return [...byId.values()];
  }, [networks, payloads]);

  const configuredCount = budgets.filter((row) => row.configured && row.budget).length;

  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-5 text-zinc-950 sm:px-6 sm:py-8 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <Panel
          title="QTM Event Store"
          description="Inspect persisted substrate events, activation-scoped payloads, network budgets, payload boards, Bitcoin observation and the API-owned wirepackets file."
          action={
            <button type="button" className={BUTTON} disabled={!substrate || loadingEvents || loadingBudgets || loadingPayloads || loadingBoards || loadingWire} onClick={refreshAll}>
              {loadingEvents || loadingBudgets || loadingPayloads || loadingBoards || loadingWire ? "Refreshing…" : "Refresh"}
            </button>
          }
        >
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium">Persistent substrate</span>
              <select className={INPUT} value={substrate} disabled={loadingList} onChange={(event) => chooseSubstrate(event.target.value)}>
                <option value="">{loadingList ? "Loading substrates…" : "Select substrate"}</option>
                {substrates.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium">Activation</span>
              <select className={INPUT} value={activation} disabled={!substrate} onChange={(event) => chooseActivation(event.target.value)}>
                {activationOptions.map((value) => <option key={value} value={value}>Activation {value}</option>)}
              </select>
            </label>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-4 dark:border-zinc-800">
            <Field label="Substrate">{substrate || "—"}</Field>
            <Field label="Selected activation">{activation || "—"}</Field>
            <Field label="Events in activation">{activationEvents.length}</Field>
            <Field label="Rendered payloads">{payloads.length}</Field>
            <Field label="Configured budgets">{configuredCount} / {networks.length}</Field>
            <Field label="Registered networks">{networks.length}</Field>
            <Field label="Retained mass in activation">{retainedMass.toString()}</Field>
            <Field label="API base">{API_BASE}</Field>
          </dl>
          {store?.directory && <p className="mt-4 break-all border-t border-zinc-200 pt-3 font-mono text-xs text-zinc-500 dark:border-zinc-800">Substrate directory: {store.directory}</p>}
        </Panel>

        {error && <Notice>{error}</Notice>}
        {notice && <Notice type="success">{notice}</Notice>}

        <Panel
          title={`Network hierarchy · activation ${activation || "—"}`}
          description="Budgets and payload boards are available for every registered network. Bitcoin observation and wirepackets are shown only for Bitcoin networks."
          action={<span className="text-xs text-zinc-500">{renderedNetworks.length} networks</span>}
        >
          {loadingPayloads && <p className="mt-3 text-xs text-zinc-500">Rendering payload records for the selected activation…</p>}
          <div className="mt-4 space-y-3">
            {renderedNetworks.map((network) => {
              const id = network.id;
              const budgetRow = networkBudgetById.get(id);
              const budget = budgetRow?.budget || null;
              const group = payloadGroups.get(id) || { transit_inputs: [], exile_outputs: [], unclassified: [] };
              const isExpanded = !!expanded[id];
              return (
                <section key={id} className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold">{network.name}</h3>
                        <p className="mt-1 break-all font-mono text-xs text-zinc-500">{id}</p>
                      </div>
                      <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-[10px] font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                        {budgetRow?.configured && budget ? "Budget configured" : "Budget unconfigured"}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Coin">{money(network.coin)}</Field>
                      <Field label="Purpose">{money(network.purpose)}</Field>
                      <Field label="Derivation path">{money(network.path)}</Field>
                      <Field label="Payload records">{group.transit_inputs.length + group.exile_outputs.length + group.unclassified.length}</Field>
                    </dl>
                    <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/70">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">Network budget · activation {activation}</h4>
                        <button type="button" className={BUTTON} onClick={() => setExpanded((current) => ({ ...current, [id]: !current[id] }))}>
                          {isExpanded ? "Close editor" : "Edit budget"}
                        </button>
                      </div>
                      <BudgetSummary budget={budget} />
                      {isExpanded && (
                        <BudgetEditor budget={budget} disabled={loadingBudgets} onSave={(draft) => saveBudget(network, draft)} />
                      )}
                      {budgetErrors[id] && <div className="mt-3"><Notice>{budgetErrors[id]}</Notice></div>}
                      {budgetNotices[id] && <div className="mt-3"><Notice type="success">{budgetNotices[id]}</Notice></div>}
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-zinc-200 p-3 sm:p-4 dark:border-zinc-800">
                    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                      <h4 className="text-xs font-semibold uppercase tracking-wider">Network payload board</h4>
                      <p className="mt-1 break-all font-mono text-[11px] text-zinc-500">
                        GET /wallets/{substrate}/activations/{activation}/networks/{id}/payload-board
                      </p>
                      <PayloadBoard board={boards[id]} loading={loadingBoards} />
                    </div>

                    {bitcoinNetwork(network) && (
                      <>
                        <ObservationControl
                          substrate={substrate}
                          activation={activation}
                          network={network}
                          status={observations[id]}
                          busy={busyObservation[id] === true}
                          onAction={observationAction}
                        />
                        <WirePackets metadata={wirePackets[id]} loading={loadingWire} />
                      </>
                    )}

                    {[
                      ["transit_inputs", "Payloads rendered from transit event records.", group.transit_inputs],
                      ["exile_outputs", "Payloads rendered from exile event records.", group.exile_outputs],
                      ["Unclassified", "Persisted payloads without a recognized direction.", group.unclassified],
                    ].map(([title, description, rows]) => (
                      <div key={title} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                        <h4 className="text-xs font-semibold uppercase tracking-wider">{title}</h4>
                        <p className="mt-1 text-xs text-zinc-500">{description}</p>
                        <div className="mt-3 space-y-2">
                          {rows.map((payload, index) => (
                            <div key={`${payload.record}-${payload.path}-${payload.depth_identifier}-${index}`} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
                              <div className="flex flex-wrap justify-between gap-2">
                                <span className="text-xs font-semibold">{payload.record}</span>
                                <span className="text-[11px] text-zinc-500">{payload.objects.length} objects</span>
                              </div>
                              <p className="mt-1 break-all font-mono text-[11px] text-zinc-500">{payload.depth_identifier}</p>
                              <p className="mt-1 break-all font-mono text-[10px] text-zinc-400">{payload.path}</p>
                              {payload.objects.length > 0 && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs text-zinc-600 dark:text-zinc-300">Depth objects</summary>
                                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-zinc-500">{JSON.stringify(payload.objects, null, 2)}</pre>
                                </details>
                              )}
                            </div>
                          ))}
                          {rows.length === 0 && <p className="text-xs text-zinc-500">No payload records for this direction.</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            {renderedNetworks.length === 0 && (
              <p className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
                {loadingBudgets ? "Loading registered networks…" : "No registered networks or payload networks were returned."}
              </p>
            )}
          </div>
        </Panel>

        <Panel title="Activation utilization" description="Aggregate measurements from event records belonging to the selected activation.">
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950"><Field label="Selected activation events">{activationEvents.length}</Field></div>
            <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950"><Field label="Retained mass">{retainedMass.toString()}</Field></div>
            <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950"><Field label="All substrate events">{events.length}</Field></div>
          </div>
        </Panel>

        <Panel
          title="Persisted event diagnostics"
          description="Event records returned by GET /wallets/:name/events. Payload rendering is restricted to the selected activation."
          action={<span className="text-xs text-zinc-500">{events.length} records</span>}
          className="p-0"
        >
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 text-[10px] uppercase tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>{["Activation", "Event type", "Record reference", "Dimension", "Structural value (Σ)", "Depth objects", "Retained mass"].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {events.map((event, index) => {
                  const state = event?.heritage?.state;
                  return (
                    <tr key={`${event.record}-${index}`} className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono">{activationFromEvent(event) ?? money(event.activation)}</td>
                      <td className="px-4 py-3">{money(event.kind)}</td>
                      <td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-zinc-500">{money(event.record)}</td>
                      <td className="break-all px-4 py-3 font-mono">{money(event.dimension ?? state?.dimension)}</td>
                      <td className="break-all px-4 py-3 font-mono">{money(event.structural_value ?? state?.structural_value)}</td>
                      <td className="px-4 py-3">{money(event.depth_objects)}</td>
                      <td className="break-all px-4 py-3 font-mono">{money(event.retained_mass ?? state?.retained_mass)}</td>
                    </tr>
                  );
                })}
                {events.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">{loadingEvents ? "Loading persisted events…" : substrate ? "No persisted event records were returned." : "Select a substrate to inspect persisted records."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <footer className="border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
          QTM Event Store · Substrate host · Activation-scoped events and payloads · Network budgets · Network payload boards · Bitcoin observation · API-persisted wirepackets · {API_BASE}
        </footer>
      </div>
    </main>
  );
}
