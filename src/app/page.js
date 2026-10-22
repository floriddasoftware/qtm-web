"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Substrate state lives in the machine-local ~/.qp/substrates and is operated
// on by the QP runtime. Inside a native shell (for example Tauri) the console
// calls that runtime directly through IPC: no HTTP. A plain browser cannot
// reach the local filesystem, so it uses an optional bridge to a runtime.
// Prefer NEXT_PUBLIC_QTM_API_BASE when set; otherwise fall back to the public
// qtm-api deployment so a Vercel (or similar) host never routes /wallets to
// itself.
// Substrate storage is owned by the server-side QP runtime.
// substrate_root() is resolved by Rust, never by the browser.
const BRIDGE_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api-anwp.onrender.com"
).replace(/\/+$/, "");

const TABS = [
  { id: "create", label: "Create" },
  { id: "open", label: "Open / Receive" },
  { id: "transit", label: "Transit" },
  { id: "exile", label: "Exile" },
];

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const objectAt = (source, keys) => {
  if (!isRecord(source)) return undefined;

  for (const key of keys) {
    if (isRecord(source[key])) return source[key];
  }

  return undefined;
};

const valueAt = (source, keys) => {
  if (!isRecord(source)) return undefined;

  for (const key of keys) {
    if (source[key] !== null && source[key] !== undefined) {
      return source[key];
    }
  }

  return undefined;
};

const formatKey = (key) =>
  String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

function friendlyValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (["string", "number", "bigint"].includes(typeof value)) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.length ? `${value.length} items` : "None";
  }

  return "Details available";
}

function flatten(value, prefix = "", rows = []) {
  if (value === null || value === undefined) {
    if (prefix) rows.push([prefix, "Not provided"]);
  } else if (Array.isArray(value)) {
    if (!value.length && prefix) {
      rows.push([prefix, "None"]);
    }

    value.forEach((item, index) => {
      flatten(item, `${prefix || "Item"} ${index + 1}`, rows);
    });
  } else if (isRecord(value)) {
    const entries = Object.entries(value);

    if (!entries.length && prefix) {
      rows.push([prefix, "No details returned"]);
    }

    entries.forEach(([key, child]) => {
      flatten(
        child,
        prefix ? `${prefix} · ${formatKey(key)}` : formatKey(key),
        rows
      );
    });
  } else {
    rows.push([prefix || "Value", friendlyValue(value)]);
  }

  return rows;
}

function hasContent(value) {
  return (
    value !== null &&
    value !== undefined &&
    (typeof value !== "object" ||
      (Array.isArray(value)
        ? value.length > 0
        : Object.keys(value).length > 0))
  );
}

class RuntimeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RuntimeError";
    this.status = details.status ?? 0;
    this.statusText = details.statusText ?? "";
    this.url = details.url ?? "";
    this.body = details.body;
  }
}

// Native IPC entry point, present only inside a native shell.
function nativeInvoke() {
  if (typeof window === "undefined") return null;

  return (
    window.__TAURI__?.core?.invoke ??
    window.__TAURI_INTERNALS__?.invoke ??
    null
  );
}

const NATIVE_COMMANDS = {
  listSubstrates: "qtm_list_substrates",
  listNetworks: "qtm_list_networks",
  createSubstrate: "qtm_create",
  openSubstrate: "qtm_open",
  receive: "qtm_receive",
  transit: "qtm_transit",
  exile: "qtm_exile",
  listEvents: "qtm_events",
};

// Bridge adapter routes (browser only). Same operations, same payloads.
const BRIDGE_ROUTES = {
  listSubstrates: () => ["GET", "/wallets"],
  listNetworks: () => ["GET", "/networks"],
  createSubstrate: () => ["POST", "/wallets"],
  openSubstrate: ({ name }) => ["GET", `/wallets/${encodeURIComponent(name)}`],
  receive: ({ name }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/receive`,
  ],
  transit: ({ name }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/transit`,
  ],
  exile: ({ name }) => ["POST", `/wallets/${encodeURIComponent(name)}/exile`],
  listEvents: ({ name }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/events`,
  ],
};

// The runtime's own error text, with no transport details added.
function directMessage(cause) {
  if (typeof cause === "string" && cause.trim()) return cause;

  if (cause instanceof Error && cause.message) return cause.message;

  if (isRecord(cause)) {
    const message = valueAt(cause, ["error", "message", "detail"]);
    if (typeof message === "string" && message.trim()) return message;
  }

  return "The QP runtime reported an error.";
}

async function callRuntime(operation, args = {}) {
  const invoke = nativeInvoke();

  if (invoke) {
    try {
      return await invoke(NATIVE_COMMANDS[operation], args);
    } catch (cause) {
      throw new RuntimeError(directMessage(cause));
    }
  }

  if (!BRIDGE_BASE) {
    throw new RuntimeError(
      "The local QP runtime is not available in this browser. Open the console in the native QP app, or set NEXT_PUBLIC_QTM_API_BASE to a running qtm-api."
    );
  }

  const [method, path] = BRIDGE_ROUTES[operation](args);
  const url = `${BRIDGE_BASE}${path}`;

  let response;

  try {
    response = await fetch(url, {
      method,
      headers:
        method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body:
        method === "POST" && args.request !== undefined
          ? JSON.stringify(args.request)
          : undefined,
      cache: "no-store",
    });
  } catch (cause) {
    const reason =
      cause instanceof Error && cause.message ? cause.message : "network error";

    throw new RuntimeError(
      `Could not reach the QTM runtime at ${BRIDGE_BASE} (${reason}). Make sure qtm-api is running at that address, and that this page is allowed to call it (CORS / mixed content). Hosted instances can take about a minute to wake from sleep.`,
      { status: 0, url }
    );
  }

  const bodyText = await response.text();
  let data = {};
  let parsed = false;

  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
      parsed = true;
    } catch {
      data = { response_text: bodyText };
    }
  }

  if (!response.ok) {
    const apiMessage = valueAt(data, ["error", "message", "detail"]);

    const reason =
      typeof apiMessage === "string"
        ? apiMessage
        : apiMessage !== undefined
          ? JSON.stringify(apiMessage)
          : bodyText && !parsed
            ? bodyText.slice(0, 300)
            : "no error body returned";

    throw new RuntimeError(
      `${reason} [HTTP ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      }${response.url ? ` · ${response.url}` : ""}]`,
      {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        body: data,
      }
    );
  }

  return data;
}

function eventMapOf(source) {
  const direct = objectAt(source, ["event", "event_map", "eventMap"]);
  if (direct) return direct;

  const frame = objectAt(source, ["frame"]);
  const frameEvent = objectAt(frame, [
    "event",
    "event_map",
    "eventMap",
  ]);

  if (frameEvent) return frameEvent;

  const transaction = objectAt(frame, [
    "quantum_transaction",
    "quantumTransaction",
  ]);

  return objectAt(transaction, ["event", "event_map", "eventMap"]);
}

function ResultHeading({ eyebrow, title }) {
  return (
    <div className="space-y-1">
      {eyebrow && (
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {eyebrow}
        </p>
      )}

      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}

function KeyValueList({
  value,
  emptyText = "No details were returned.",
}) {
  const rows = flatten(value);

  if (!rows.length) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {emptyText}
      </p>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map(([key, itemValue], index) => (
        <div key={`${key}-${index}`} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {key}
          </dt>

          <dd className="mt-0.5 break-words text-xs text-zinc-800 dark:text-zinc-200">
            {itemValue}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ResultSection({
  title,
  description,
  value,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold">{title}</span>

          {description && (
            <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          )}
        </span>

        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 transition-transform dark:border-zinc-700 ${
            open ? "rotate-180" : ""
          }`}
        >
          ⌄
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          {hasContent(value) ? (
            <KeyValueList value={value} />
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              This information was not returned by the API.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  placeholder = "",
  mono = false,
  type = "text",
  autoComplete,
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>

      <input
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className={`h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function NumberField({ label, value, onChange, min = 0 }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>

      <input
        type="number"
        min={min}
        step="1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
      />
    </label>
  );
}

function ReceiveUnitIdentifiers({ amount }) {
  const count = Number(amount);

  if (!Number.isSafeInteger(count) || count <= 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        A valid positive amount was not returned; unit identifiers cannot be
        listed.
      </p>
    );
  }

  const limit = 200;

  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold">Receive unit ordinals</h4>

        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {count} {count === 1 ? "unit" : "units"} · Ordinals 1–{count}
        </p>
      </div>

      <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
        {Array.from(
          { length: Math.min(count, limit) },
          (_, index) => index + 1
        ).map((id) => (
          <div
            key={id}
            className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-2 text-center dark:border-zinc-700 dark:bg-zinc-950"
          >
            <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
              Unit
            </span>

            <span className="mt-0.5 block font-mono text-xs">{id}</span>
          </div>
        ))}
      </div>

      {count > limit && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Showing the first {limit} of {count} ordinals.
        </p>
      )}

      <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        These are display ordinals from 1 through N, not distinct persisted
        identifiers supplied by the API.
      </p>
    </section>
  );
}

function eventRecordsOf(source) {
  const candidates = [
    source?.events,
    source?.records,
    source?.event_records,
    source?.eventRecords,
    source?.items,
    source?.data?.events,
    source?.data?.records,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }

    if (isRecord(candidate)) {
      for (const key of ["events", "records", "items"]) {
        if (Array.isArray(candidate[key])) {
          return candidate[key].filter(isRecord);
        }
      }
    }
  }

  return [];
}

function recordNameOf(record) {
  for (const key of [
    "record_name",
    "recordName",
    "filename",
    "file_name",
    "fileName",
    "name",
    "record",
    "path",
    "id",
  ]) {
    if (typeof record?.[key] === "string" && record[key].trim()) {
      return record[key];
    }
  }

  return "";
}

function OpenResults({ result }) {
  const directory = result?.directory;
  const receive = result?.receive;
  const frame = objectAt(receive, ["frame"]) ?? receive;

  const transaction = objectAt(frame, [
    "quantum_transaction",
    "quantumTransaction",
  ]);

  const event = eventMapOf(receive);
  const depth = objectAt(event, ["depth"]);
  const objects = Array.isArray(depth?.objects) ? depth.objects : [];

  const amount =
    valueAt(transaction, ["amount"]) ?? result?.requested_amount;

  return (
    <div className="space-y-3">
      <ResultSection
        title="Substrate directory"
        description="Directory metadata returned for the selected substrate."
        value={directory}
        defaultOpen
      />

      <ResultSection
        title="Receive event depth"
        description="Depth data returned by the receive operation."
        value={depth}
        defaultOpen
      />

      {objects.length > 0 && (
        <ResultSection title="Retained objects" value={objects} />
      )}

      <section className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-xs font-semibold">
          QuantumTransaction validation
        </h3>

        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {transaction
            ? "A QuantumTransaction was returned by the receive operation."
            : "The response did not contain the expected QuantumTransaction."}
        </p>

        <div className="mt-3">
          <KeyValueList
            value={{
              transaction_returned: Boolean(transaction),
              amount,
              flow: result?.flow,
              constant: valueAt(transaction, ["constant"]),
              qtm: objectAt(transaction, ["qtm"]),
            }}
          />
        </div>

        <div className="mt-4">
          <ReceiveUnitIdentifiers amount={amount} />
        </div>
      </section>

      {event && (
        <ResultSection title="Receive event fields" value={event} />
      )}
    </div>
  );
}

function EventMapSections({ event, prefix = "" }) {
  const depth = objectAt(event, ["depth"]);

  const heritage = objectAt(event, [
    "heritage",
    "state_heritage",
    "stateHeritage",
  ]);

  const transition = objectAt(event, [
    "transition",
    "transition_heritage",
    "transitionHeritage",
  ]);

  const identifier = valueAt(depth, [
    "identifier",
    "depth_identifier",
    "depthIdentifier",
    "id",
  ]);

  return (
    <div className="space-y-3">
      {depth && (
        <ResultSection
          title={`${prefix}Final depth`}
          description={
            identifier === undefined
              ? "Final depth data returned by the API."
              : `Depth identifier: ${friendlyValue(identifier)}`
          }
          value={depth}
          defaultOpen
        />
      )}

      {heritage && (
        <ResultSection
          title={`${prefix}Heritage state`}
          value={heritage}
        />
      )}

      {transition && (
        <ResultSection
          title={`${prefix}Transition heritage`}
          value={transition}
        />
      )}

      <ResultSection title={`${prefix}Event map`} value={event} />
    </div>
  );
}

function TransitResults({ result, network, path, substrate }) {
  const frame = objectAt(result, ["frame"]);
  const event = eventMapOf(result);

  return (
    <div className="space-y-3">
      <ResultSection
        title="Transition substrate"
        description="Substrate context used for this transit request."
        value={{
          substrate,
          network: network?.name ?? network?.id ?? "Not specified",
          network_identifier: network?.id ?? "Not returned",
          derivation_path: path || network?.path || "Not specified",
        }}
        defaultOpen
      />

      <ResultSection
        title="QTM values"
        value={objectAt(frame, ["qtm", "Qtm"])}
        defaultOpen
      />

      {event ? (
        <EventMapSections event={event} />
      ) : (
        <ResultSection title="Event map" value={undefined} />
      )}

      <ResultSection
        title="Complete transit response"
        description="Additional fields returned by the API."
        value={result}
      />
    </div>
  );
}

function ExileResults({ result, substrate }) {
  const frame = objectAt(result, ["frame"]);
  const event = eventMapOf(result);
  const depth = objectAt(event, ["depth"]);
  const objects = Array.isArray(depth?.objects) ? depth.objects : [];

  return (
    <div className="space-y-3">
      <ResultSection
        title="Substrate"
        value={{ substrate }}
        defaultOpen
      />

      <ResultSection
        title="Stored QTM"
        value={objectAt(frame, ["qtm", "Qtm"])}
        defaultOpen
      />

      {depth && (
        <section className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-xs font-semibold">Exile depth record</h3>

          <p className="mt-2 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {depth.path || "Depth path not returned"}
          </p>

          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            {objects.length} retained{" "}
            {objects.length === 1 ? "object" : "objects"} returned by the API.
          </p>

          {objects.length > 0 && (
            <div className="mt-3">
              <KeyValueList value={objects} />
            </div>
          )}
        </section>
      )}

      {event ? (
        <EventMapSections event={event} prefix="Exile " />
      ) : (
        <ResultSection title="Exile event map" value={undefined} />
      )}

      <ResultSection title="Complete exile response" value={result} />
    </div>
  );
}

function ResultCard({ result, tab, network, path, substrate }) {
  if (result === null || result === undefined) return null;

  return (
    <div className="mt-4 space-y-3">
      {tab === "open" && <OpenResults result={result} />}

      {tab === "transit" && (
        <TransitResults
          result={result}
          network={network}
          path={path}
          substrate={substrate}
        />
      )}

      {tab === "exile" && (
        <ExileResults result={result} substrate={substrate} />
      )}

      {tab === "create" && (
        <section className="space-y-3">
          <ResultHeading
            eyebrow="Create result"
            title="Substrate created"
          />

          <ResultSection
            title="Created substrate"
            value={result}
            defaultOpen
          />
        </section>
      )}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState("create");

  const [substrates, setSubstrates] = useState([]);
  const [selectedSubstrate, setSelectedSubstrate] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [networks, setNetworks] = useState([]);
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const [networkLoading, setNetworkLoading] = useState(true);
  const [networkError, setNetworkError] = useState("");

  const [name, setName] = useState("");
  const [seedSource, setSeedSource] = useState("persistent");
  const [indices, setIndices] = useState("0,0,0,0,0,0,0,0,0,0,0,0");
  const [entropy, setEntropy] = useState("");
  const [phrase, setPhrase] = useState("");
  const [language, setLanguage] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const [path, setPath] = useState("");
  const [purpose, setPurpose] = useState("44");
  const [coin, setCoin] = useState("0");
  const [account, setAccount] = useState("0");
  const [change, setChange] = useState("0");
  const [external, setExternal] = useState("0");
  const [activation, setActivation] = useState("1");

  const [receiveAmount, setReceiveAmount] = useState("1");
  const [receiveFlow, setReceiveFlow] = useState("receive");

  const [exileRecords, setExileRecords] = useState([]);
  const [exileRecordsLoading, setExileRecordsLoading] = useState(false);
  const [exileRecordsError, setExileRecordsError] = useState("");

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState("detecting…");

  useEffect(() => {
    setRuntimeMode(
      nativeInvoke()
        ? "local QP runtime (native)"
        : BRIDGE_BASE
          ? `bridge ${BRIDGE_BASE}`
          : "not available in this browser"
    );
  }, []);

  // Substrate requested by links from /network and /eventstore (?substrate=).
  // Read once (null = not read yet) and consumed by the first resolved load.
  const requestedSubstrateRef = useRef(null);
  const listRequestRef = useRef(0);
  const exileRequestRef = useRef(0);
  const selectedRef = useRef("");
  const [selectionReady, setSelectionReady] = useState(false);

  useEffect(() => {
    selectedRef.current = selectedSubstrate;
  }, [selectedSubstrate]);

  // Do not touch the URL until the first list load has resolved the
  // selection; otherwise the requested ?substrate= would be stripped.
  useEffect(() => {
    if (!selectionReady) return;

    const url = new URL(window.location.href);

    if (selectedSubstrate) {
      url.searchParams.set("substrate", selectedSubstrate);
    } else {
      url.searchParams.delete("substrate");
    }

    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  }, [selectedSubstrate, selectionReady]);

  const loadSubstrates = useCallback(async (preferred = "") => {
    const requestId = ++listRequestRef.current;

    if (requestedSubstrateRef.current === null) {
      requestedSubstrateRef.current =
        new URLSearchParams(window.location.search).get("substrate") || "";
    }

    setListLoading(true);
    setListError("");

    try {
      const data = await callRuntime("listSubstrates");

      if (!Array.isArray(data.substrates)) {
        throw new Error(
          "The API response did not contain a substrates list."
        );
      }

      // A newer list request has started; this response is stale.
      if (requestId !== listRequestRef.current) return;

      const valid = data.substrates.filter(
        (item) => item && typeof item.name === "string"
      );

      const requested = requestedSubstrateRef.current;
      requestedSubstrateRef.current = "";

      setSubstrates(valid);

      // Priority: explicit choice, the user's current selection, the URL
      // request, then the first substrate only if none of those exist.
      setSelectedSubstrate((current) => {
        const wanted = [preferred, current, requested].find(
          (candidate) =>
            candidate && valid.some((item) => item.name === candidate)
        );

        return wanted || valid[0]?.name || "";
      });

      setSelectionReady(true);
    } catch (err) {
      if (requestId !== listRequestRef.current) return;

      setListError(
        err instanceof Error
          ? err.message
          : "Unable to load substrates."
      );
    } finally {
      if (requestId === listRequestRef.current) {
        setListLoading(false);
      }
    }
  }, []);

  const loadNetworks = useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError("");

    try {
      const data = await callRuntime("listNetworks");

      if (!Array.isArray(data.networks)) {
        throw new Error(
          "The API response did not contain a networks list."
        );
      }

      const valid = data.networks.filter(
        (network) =>
          network &&
          typeof network.id === "string" &&
          typeof network.name === "string"
      );

      setNetworks(valid);

      setSelectedNetwork((current) =>
        valid.some((network) => network.id === current)
          ? current
          : valid[0]?.id || ""
      );

      const first = valid[0];

      if (first) {
        if (Number.isFinite(first.purpose)) {
          setPurpose((current) =>
            current === "44" ? String(first.purpose) : current
          );
        }

        if (Number.isFinite(first.coin)) {
          setCoin((current) =>
            current === "0" ? String(first.coin) : current
          );
        }

        if (first.path) {
          setPath((current) => current || first.path);
        }
      }
    } catch (err) {
      setNetworkError(
        err instanceof Error
          ? err.message
          : "Unable to load networks."
      );
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  const loadExileRecords = useCallback(async () => {
    const substrate = selectedSubstrate;
    const requestId = ++exileRequestRef.current;

    // Only the latest request for the still-selected substrate may update state.
    const isCurrent = () =>
      requestId === exileRequestRef.current &&
      selectedRef.current === substrate;

    if (!substrate) {
      setExileRecords([]);
      setExileRecordsLoading(false);
      setExileRecordsError(
        "Select a substrate before loading its persisted events."
      );
      return;
    }

    setExileRecordsLoading(true);
    setExileRecordsError("");

    try {
      const data = await callRuntime("listEvents", { name: substrate });

      if (!isCurrent()) return;

      const records = eventRecordsOf(data);

      const recognizedList =
        Array.isArray(data.events) ||
        Array.isArray(data.records) ||
        Array.isArray(data.event_records) ||
        Array.isArray(data.eventRecords) ||
        Array.isArray(data.items) ||
        Array.isArray(data.data?.events) ||
        Array.isArray(data.data?.records) ||
        isRecord(data.events) ||
        isRecord(data.records);

      if (!records.length && !recognizedList) {
        throw new Error(
          "The events endpoint did not return a recognized persisted event-record list."
        );
      }

      setExileRecords(records);
    } catch (err) {
      if (!isCurrent()) return;

      setExileRecords([]);

      setExileRecordsError(
        err instanceof Error
          ? err.message
          : "Unable to load persisted event records."
      );
    } finally {
      if (requestId === exileRequestRef.current) {
        setExileRecordsLoading(false);
      }
    }
  }, [selectedSubstrate]);

  useEffect(() => {
    loadSubstrates();
  }, [loadSubstrates]);

  useEffect(() => {
    loadNetworks();
  }, [loadNetworks]);

  useEffect(() => {
    if (tab === "exile" && selectedSubstrate) {
      loadExileRecords();
    }
  }, [tab, selectedSubstrate, loadExileRecords]);

  const currentNetwork = useMemo(
    () =>
      networks.find((network) => network.id === selectedNetwork) ?? null,
    [networks, selectedNetwork]
  );

  function handleSubstrateChange(value) {
    selectedRef.current = value;
    // Invalidate in-flight exile-record loads for the previous substrate.
    exileRequestRef.current += 1;
    setExileRecordsLoading(false);
    setSelectedSubstrate(value);
    setResult(null);
    setError("");
    setExileRecords([]);
    setExileRecordsError("");
  }

  function handleNetworkChange(id) {
    const network = networks.find((item) => item.id === id);

    setSelectedNetwork(id);
    setResult(null);
    setError("");

    if (!network) return;

    if (Number.isFinite(network.purpose)) {
      setPurpose(String(network.purpose));
    }

    if (Number.isFinite(network.coin)) {
      setCoin(String(network.coin));
    }

    setPath(network.path || "");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setResult(null);

    if (tab !== "create" && !selectedSubstrate) {
      setError("Select a substrate before performing this operation.");
      return;
    }

    setLoading(true);

    try {
      if (tab === "create") {
        const substrateName = name.trim();

        if (!substrateName) {
          throw new Error("Enter a substrate name.");
        }

        if (!/^[A-Za-z0-9_-]{1,64}$/.test(substrateName)) {
          throw new Error(
            "Substrate name must be 1-64 ASCII letters, digits, hyphens, or underscores."
          );
        }

        let payload;

        if (seedSource === "bip39") {
          if (!phrase.trim()) {
            throw new Error("Enter a BIP39 mnemonic phrase.");
          }

          if (!language) {
            throw new Error("Select a BIP39 language.");
          }

          payload = {
            name: substrateName,
            seed_source: "bip39",
            phrase: phrase.trim(),
            language,
            passphrase,
          };
        } else {
          const parsed = indices.split(",").map((item) => item.trim());

          if (
            parsed.length !== 12 ||
            parsed.some(
              (item) =>
                item === "" ||
                !/^\d+$/.test(item) ||
                !Number.isSafeInteger(Number(item)) ||
                Number(item) < 0 ||
                Number(item) > 2047
            )
          ) {
            throw new Error(
              "Enter exactly 12 indices, each an integer from 0 to 2047."
            );
          }

          payload = {
            name: substrateName,
            seed_source: "persistent",
            indices: parsed.map(Number).join(","),
            entropy: entropy.trim() || substrateName,
          };
        }

        const data = await callRuntime("createSubstrate", {
          request: payload,
        });

        setResult(data);
        setName("");
        setEntropy("");
        setPhrase("");
        setPassphrase("");

        // Background discovery refresh: its failure shows in the substrate
        // card and never affects the Create result or the form.
        void loadSubstrates(substrateName);
        return;
      }

      if (tab === "open") {
        const amount = Number(receiveAmount);

        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new Error(
            "Receive amount must be a positive safe integer."
          );
        }

        if (!["receive", "change"].includes(receiveFlow)) {
          throw new Error("Select a valid receive flow.");
        }

        const directory = await callRuntime("openSubstrate", {
          name: selectedSubstrate,
        });

        const receive = await callRuntime("receive", {
          name: selectedSubstrate,
          request: { amount, flow: receiveFlow },
        });

        setResult({
          directory,
          receive,
          requested_amount: amount,
          flow: receiveFlow,
          substrate: selectedSubstrate,
        });

        return;
      }

      if (tab === "transit") {
        if (!selectedNetwork) {
          throw new Error("Select a network before transit.");
        }

        const numeric = {
          purpose: Number(purpose),
          coin: Number(coin),
          account: Number(account),
          change: Number(change),
          external: Number(external),
          activation: Number(activation),
        };

        for (const [key, value] of Object.entries(numeric)) {
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(
              `${key} must be a non-negative safe integer.`
            );
          }
        }

        // The selected substrate is the state context for this transition.
        // The network/path configure derivation; they do not replace the substrate.
        const data = await callRuntime("transit", {
          name: selectedSubstrate,
          request: {
            network: selectedNetwork,
            path: path.trim() || undefined,
            ...numeric,
          },
        });
        setResult(data);

        await Promise.all([
          loadSubstrates(),
          loadExileRecords(),
        ]);

        return;
      }

      if (tab === "exile") {
        // The Rust API decides eligibility and derives the exile depth from
        // this substrate's persisted event history. The browser neither gates
        // the request nor submits a client-created depth snapshot.
        const data = await callRuntime("exile", {
          name: selectedSubstrate,
        });
        setResult(data);

        await Promise.all([
          loadExileRecords(),
          loadSubstrates(),
        ]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  const substrateRequired = tab !== "create";

  const linkWithSubstrate = (href) => {
    if (!selectedSubstrate) return href;

    const separator = href.includes("?") ? "&" : "?";

    return `${href}${separator}substrate=${encodeURIComponent(
      selectedSubstrate
    )}`;
  };

  return (
    <div
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
      }}
      className="min-h-screen w-full bg-zinc-50 px-1.5 py-2 text-[13px] text-zinc-900 sm:px-2 sm:py-3 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <style jsx global>{`
        html {
          font-size: 14px;
        }

        * {
          min-width: 0;
        }

        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text",
            "Helvetica Neue", Arial, sans-serif;
        }

        a,
        button,
        input,
        select,
        textarea {
          font: inherit;
        }
      `}</style>

      <main className="mx-auto w-full max-w-none">
        <header className="mb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>

          <h1 className="mt-1.5 text-lg font-semibold tracking-tight text-zinc-950 sm:text-xl dark:text-zinc-50">
            QTM substrate console
          </h1>

          <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
            Create and inspect persistent substrates, derive network paths,
            and transition or exile state through the local QP runtime or the
            configured API bridge.
          </p>
        </header>

        <section className="mb-3 rounded-md border border-zinc-200 bg-white p-2.5 shadow-sm sm:p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="substrate" className="text-xs font-semibold">
              Active substrate
            </label>

            <button
              type="button"
              onClick={() => loadSubstrates()}
              disabled={listLoading}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            >
              {listLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <select
            id="substrate"
            value={selectedSubstrate}
            onChange={(event) =>
              handleSubstrateChange(event.target.value)
            }
            disabled={listLoading || loading || !substrates.length}
            className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
          >
            {!substrates.length && (
              <option value="">
                {listLoading
                  ? "Loading substrates…"
                  : "No substrates available"}
              </option>
            )}

            {substrates.map((substrate) => (
              <option key={substrate.name} value={substrate.name}>
                {substrate.name} — dimension{" "}
                {substrate.dimension ?? "not returned"} · activations{" "}
                {substrate.activations ?? "not returned"}
              </option>
            ))}
          </select>

          {selectedSubstrate && (
            <div className="mt-3 space-y-2">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  State context
                </p>

                <p className="mt-1 break-all font-mono text-xs font-semibold">
                  {selectedSubstrate}
                </p>

                <p className="mt-1 text-xs leading-4 text-zinc-500 dark:text-zinc-400">
                  Transit and exile operate against this substrate. Network
                  and derivation path are operation parameters, not separate
                  state hosts.
                </p>
              </div>

              <ResultSection
                title="Selected substrate details"
                description="Fields returned by the API for this substrate."
                value={
                  substrates.find(
                    (item) => item.name === selectedSubstrate
                  ) ?? {}
                }
              />
            </div>
          )}

          {listError && (
            <p
              role="status"
              className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
            >
              Substrate list unavailable: {listError} You can still create a
              substrate in the Create tab.
            </p>
          )}

          {!listLoading && !listError && !substrates.length && (
            <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
              No substrates were found. Create one below.
            </p>
          )}
        </section>

        <section
          aria-label="Substrate tools"
          className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          <a
            href={linkWithSubstrate("/eventstore")}
            className="block rounded-md border border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Persisted state
                </p>

                <h2 className="mt-0.5 text-xs font-semibold">
                  Event Store
                </h2>

                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  Inspect records for the selected substrate
                </p>
              </div>

              <span className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium dark:border-zinc-700">
                Open
              </span>
            </div>
          </a>

          <a
            href={linkWithSubstrate("/network")}
            className="block rounded-md border border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Derivation context
                </p>

                <h2 className="mt-0.5 text-xs font-semibold">
                  Network
                </h2>

                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                  Inspect network paths in this substrate context
                </p>
              </div>

              <span className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium dark:border-zinc-700">
                Open
              </span>
            </div>
          </a>
        </section>

        <nav
          aria-label="Substrate operations"
          className="mb-3 grid grid-cols-4 gap-1 rounded-md border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => {
                setTab(item.id);
                setResult(null);
                setError("");
              }}
              className={`rounded-md px-1.5 py-2 text-xs font-medium transition-colors sm:px-2 ${
                tab === item.id
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm sm:p-3.5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">
              {TABS.find((item) => item.id === tab)?.label}
            </h2>

            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {tab === "create" &&
                "Initialize a persistent substrate using PERM indices or a BIP39 mnemonic."}

              {tab === "open" &&
                "Read the selected substrate directory and perform a receive operation."}

              {tab === "transit" &&
                "Apply a network derivation request in the selected substrate's state context."}

              {tab === "exile" &&
                "Request exile for the selected substrate. The API decides eligibility from its persisted event history."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {tab === "create" && (
              <>
                <Field
                  label="Substrate name"
                  value={name}
                  onChange={setName}
                  required
                  placeholder="mars-lab"
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {["persistent", "bip39"].map((source) => (
                    <button
                      key={source}
                      type="button"
                      aria-pressed={seedSource === source}
                      onClick={() => {
                        setSeedSource(source);
                        setError("");
                      }}
                      className={`rounded-md border px-3 py-3 text-left transition-colors ${
                        seedSource === source
                          ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-800/70"
                          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                      }`}
                    >
                      <span className="block text-xs font-semibold">
                        {source === "bip39"
                          ? "BIP39 mnemonic"
                          : "Persistent indices"}
                      </span>

                      <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                        {source === "bip39"
                          ? "Derive indices and entropy from a mnemonic."
                          : "Enter 12 PERM indices and conditioning entropy."}
                      </span>
                    </button>
                  ))}
                </div>

                {seedSource === "persistent" ? (
                  <>
                    <Field
                      label="12 indices (comma-separated, 0–2047 each)"
                      value={indices}
                      onChange={setIndices}
                      required
                      mono
                    />

                    <Field
                      label="Conditioning entropy"
                      value={entropy}
                      onChange={setEntropy}
                      placeholder="Defaults to the substrate name"
                    />
                  </>
                ) : (
                  <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium">
                        BIP39 language
                      </span>

                      <select
                        value={language}
                        onChange={(event) =>
                          setLanguage(event.target.value)
                        }
                        required
                        className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <option value="">Select language</option>
                        <option value="english">English</option>
                        <option value="chinese_simplified">
                          Chinese (Simplified)
                        </option>
                        <option value="chinese_traditional">
                          Chinese (Traditional)
                        </option>
                        <option value="french">French</option>
                        <option value="italian">Italian</option>
                        <option value="japanese">Japanese</option>
                        <option value="korean">Korean</option>
                        <option value="spanish">Spanish</option>
                        <option value="czech">Czech</option>
                        <option value="portuguese">Portuguese</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium">
                        Mnemonic phrase
                      </span>

                      <textarea
                        value={phrase}
                        onChange={(event) =>
                          setPhrase(event.target.value)
                        }
                        required
                        rows={3}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Enter words in the selected language"
                        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>

                    <Field
                      label="BIP39 passphrase (optional)"
                      value={passphrase}
                      onChange={setPassphrase}
                      type="password"
                      autoComplete="off"
                    />

                    <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      The phrase and passphrase are sent to the API for
                      validation and derivation.
                    </p>
                  </div>
                )}
              </>
            )}

            {tab === "open" && (
              <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                <div>
                  <h3 className="text-xs font-semibold">
                    Open substrate and receive
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    The selected substrate determines which directory is
                    opened and where the receive operation is executed.
                  </p>
                </div>

                <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-xs font-medium">
                    Selected substrate
                  </p>

                  <p className="mt-1 break-all font-mono text-xs">
                    {selectedSubstrate || "No substrate selected"}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Transaction amount (N)"
                    value={receiveAmount}
                    onChange={setReceiveAmount}
                    min={1}
                  />

                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium">
                      Receive flow
                    </span>

                    <select
                      value={receiveFlow}
                      onChange={(event) =>
                        setReceiveFlow(event.target.value)
                      }
                      className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="receive">Receive</option>
                      <option value="change">Change</option>
                    </select>
                  </label>
                </div>

                <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Unit ordinals are display values from 1 through the
                  amount returned by the API, not canonical persisted
                  identifiers unless the backend supplies them.
                </p>
              </div>
            )}

            {tab === "transit" && (
              <>
                <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Transition state context
                  </p>

                  <p className="mt-1 break-all font-mono text-xs font-semibold">
                    {selectedSubstrate || "Select a substrate"}
                  </p>

                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    Transit is sent to this substrate's API route. Network
                    and path specify derivation; they are not a separate
                    state host.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium">Network</span>

                    <select
                      value={selectedNetwork}
                      onChange={(event) =>
                        handleNetworkChange(event.target.value)
                      }
                      disabled={networkLoading || !networks.length}
                      className="h-9 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {!networks.length && (
                        <option value="">
                          {networkLoading ? "Loading…" : "No networks"}
                        </option>
                      )}

                      {networks.map((network) => (
                        <option key={network.id} value={network.id}>
                          {network.name} — {network.id}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Field
                    label="Derivation path"
                    value={path}
                    onChange={setPath}
                    placeholder="m/44'/0'/0'/0/0"
                    mono
                  />

                  <NumberField
                    label="Purpose"
                    value={purpose}
                    onChange={setPurpose}
                  />

                  <NumberField
                    label="Coin"
                    value={coin}
                    onChange={setCoin}
                  />

                  <NumberField
                    label="Account"
                    value={account}
                    onChange={setAccount}
                  />

                  <NumberField
                    label="Change"
                    value={change}
                    onChange={setChange}
                  />

                  <NumberField
                    label="External"
                    value={external}
                    onChange={setExternal}
                  />

                  <NumberField
                    label="Activation"
                    value={activation}
                    onChange={setActivation}
                  />
                </div>

                {networkError && (
                  <p
                    role="alert"
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                  >
                    Networks could not be loaded: {networkError}{" "}
                    <button
                      type="button"
                      onClick={loadNetworks}
                      className="font-semibold underline"
                    >
                      Retry
                    </button>
                  </p>
                )}

                {currentNetwork && (
                  <ResultSection
                    title="Selected network definition"
                    description="Derivation metadata; substrate state remains selected above."
                    value={currentNetwork}
                  />
                )}
              </>
            )}

            {tab === "exile" && (
              <section className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                <div>
                  <h3 className="text-xs font-semibold">
                    Persisted event history
                  </h3>

                  <p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
                    {selectedSubstrate || "No substrate selected"}
                  </p>

                  <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    Exile reads the selected substrate's persisted event
                    history. The Rust API decides eligibility and derives
                    the exile depth; the browser neither gates the request
                    nor submits an in-memory depth snapshot.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-300">
                    {exileRecordsLoading
                      ? "Loading persisted events…"
                      : `${exileRecords.length} persisted record(s)`}
                  </span>

                  <button
                    type="button"
                    onClick={loadExileRecords}
                    disabled={
                      exileRecordsLoading ||
                      !selectedSubstrate ||
                      loading
                    }
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  >
                    {exileRecordsLoading
                      ? "Refreshing…"
                      : "Refresh events"}
                  </button>
                </div>

                {exileRecordsError && (
                  <p
                    role="status"
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                  >
                    {exileRecordsError}
                  </p>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-medium">
                    Persisted event records
                  </p>

                  {!exileRecords.length ? (
                    <p className="rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                      No event records were returned. Record a transit
                      event, then refresh this list.
                    </p>
                  ) : (
                    exileRecords.map((record, index) => {
                      return (
                        <div
                          key={`${recordNameOf(record) || "record"}-${index}`}
                          className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="break-all font-mono text-xs font-medium">
                              {recordNameOf(record) ||
                                `Persisted record ${index + 1}`}
                            </p>

                            <span className="rounded-md border border-zinc-200 px-2 py-1 text-[10px] font-medium dark:border-zinc-700">
                              {formatKey(
                                valueAt(record, ["kind", "type"]) ?? "record"
                              )}
                            </span>
                          </div>

                          <div className="mt-3">
                            <KeyValueList value={record} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            )}

            <button
              type="submit"
              aria-busy={loading}
              disabled={
                loading ||
                (substrateRequired && (listLoading || !selectedSubstrate)) ||
                (tab === "transit" &&
                  (networkLoading || !selectedNetwork))
              }
              className="mt-1 inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading
                ? "Processing…"
                : tab === "open"
                  ? "Open and Receive"
                  : tab === "transit"
                    ? "Transit Selected Substrate"
                    : tab === "exile"
                      ? "Exile Selected Substrate"
                      : "Create Substrate"}
            </button>
          </form>
        </section>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <ResultCard
          result={result}
          tab={tab}
          network={currentNetwork}
          path={path}
          substrate={selectedSubstrate}
        />

        <footer className="mt-5 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
          QTM substrate console · Active substrate:{" "}
          {selectedSubstrate || "none"} · Runtime: {runtimeMode}
        </footer>
      </main>
    </div>
  );
}