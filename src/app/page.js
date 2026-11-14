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
  "https://qtm-api.onrender.com"
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
  openSubstrate: ({ name, activation }) => [
  "GET",
  `/wallets/${encodeURIComponent(name)}/activations/${activation}/open`,
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

  deriveSubmission: ({ name, activation, submission }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/activations/${activation}/submissions/${submission}/derive`,
  ],

  submissionValue: ({ name, activation, submission, field }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${activation}/submissions/${submission}/${field}`,
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

async function callRuntime(operation, args = {}, bridgeOnly = false) {
  const invoke = bridgeOnly ? null : nativeInvoke();

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

// Controlled ordinal selector. Amount (N) defines the coordinate range 1…N;
// every unit is its own button and button n means ordinal coordinate n.
// The grid is windowed (only visible rows are mounted) inside a scroll
// container, so there is no display cutoff and every ordinal stays reachable.
const ORDINAL_COLUMNS = 8;
const ORDINAL_ROW_HEIGHT = 52;
const ORDINAL_VIEWPORT_HEIGHT = 208;
const ORDINAL_OVERSCAN = 2;

function ReceiveOrdinalSelector({ amount, ordinal, onChange }) {
  const [scrollTop, setScrollTop] = useState(0);

  const count = Number(amount);
  const selected = Number(ordinal);

  if (!Number.isSafeInteger(count) || count <= 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Enter a positive amount to choose an ordinal.
      </p>
    );
  }

  const totalRows = Math.ceil(count / ORDINAL_COLUMNS);
  const firstRow = Math.max(
    0,
    Math.floor(scrollTop / ORDINAL_ROW_HEIGHT) - ORDINAL_OVERSCAN
  );
  const lastRow = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + ORDINAL_VIEWPORT_HEIGHT) / ORDINAL_ROW_HEIGHT) +
      ORDINAL_OVERSCAN
  );

  const rows = [];

  for (let row = firstRow; row <= lastRow; row += 1) {
    const cells = [];

    for (let column = 0; column < ORDINAL_COLUMNS; column += 1) {
      const id = row * ORDINAL_COLUMNS + column + 1;
      if (id > count) break;

      const isSelected = id === selected;

      cells.push(
        <button
          key={id}
          type="button"
          aria-pressed={isSelected}
          aria-label={`Ordinal ${id}`}
          onClick={() => onChange(id)}
          className={`flex h-[46px] flex-col items-center justify-center rounded-md border px-1 text-center transition-colors ${
            isSelected
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
              : "border-zinc-200 bg-zinc-50 hover:border-zinc-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
          }`}
        >
          <span
            className={`text-[10px] ${
              isSelected
                ? "text-zinc-300 dark:text-zinc-600"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            Unit
          </span>

          <span className="font-mono text-sm font-semibold">{id}</span>
        </button>
      );
    }

    rows.push(
      <div
        key={row}
        className="grid gap-1.5 pb-1.5"
        style={{
          height: ORDINAL_ROW_HEIGHT,
          gridTemplateColumns: `repeat(${ORDINAL_COLUMNS}, minmax(0, 1fr))`,
        }}
      >
        {cells}
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold">Receive ordinal</h4>

        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {count} {count === 1 ? "unit" : "units"} · Coordinates 1–{count} ·
          Selected ordinal{" "}
          <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
            {Number.isSafeInteger(selected) ? selected : "none"}
          </span>
        </p>
      </div>

      <div
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="overflow-y-auto rounded-md border border-zinc-200 p-1.5 dark:border-zinc-800"
        style={{ height: ORDINAL_VIEWPORT_HEIGHT }}
      >
        <div
          className="relative"
          style={{ height: totalRows * ORDINAL_ROW_HEIGHT }}
        >
          <div
            className="absolute left-0 right-0"
            style={{ top: firstRow * ORDINAL_ROW_HEIGHT }}
          >
            {rows}
          </div>
        </div>
      </div>

      <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        The selected ordinal is submitted as the receive coordinate. Receive
        or Change applies to it.
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

// ---------------------------------------------------------------------------
// Open / Receive: four presentation-only frames.
//
// Verified against qtm-api src/main.rs (handle_receive_wallet). The response is
//   ReceiveResponse {
//     frame: {
//       quantum_transaction: { amount, qtm: { identifier, qtm }, constant,
//                              constant_delta },
//       event: { scale, runtime, heritage: { state, transition },
//                qtm: { identifier, qtm }, depth },
//     }
//   }
// where qtm = { commitment, coordinate, sigma, network } and
// identifier = qtm.commitment. quantum_transaction.amount is the activation
// (QuantumTransaction::send(name, ordinal)), not the requested amount N.
// There is NO direction field: the flow ("receive" | "change") exists only in
// the request, so it is read from the submitted request (result.flow).
// qtm-api exposes no route that returns scriptPubKey, xpub, zpub, xpriv or
// addresses: the bitblock_* helpers are feature-gated and no handler uses them.
//
// Every frame reads from ONE completed receive result. No frame loads a
// directory, an event-store record, or reconstructs a QTM.
//   Opened QTM            <- frame.quantum_transaction.qtm
//   Network               <- selected network registry entry + QTM inputs
//   Receive derivations   <- frame.quantum_transaction (amount, constant, ...)
//   Immediate heritage    <- frame.event (heritage, depth, scale, runtime)
// ---------------------------------------------------------------------------

// Same 6:3 (2:1) ratio for every frame; stacks and relaxes the ratio on
// narrow screens, scrolling inside the frame when content is taller.
function Frame({ eyebrow, title, tone = "default", actions, children }) {
  const toneClass =
    tone === "sensitive"
      ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-md border sm:aspect-[2/1] ${toneClass}`}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-inherit px-3 py-2">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {eyebrow}
            </p>
          )}

          <h3 className="text-xs font-semibold">{title}</h3>
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {actions}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </section>
  );
}

function FrameButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

// Display safeguard only; it is not access control.
function Blurred({ revealed, children }) {
  return (
    <div
      aria-hidden={!revealed}
      className={
        revealed
          ? ""
          : "pointer-events-none select-none blur-sm transition-[filter]"
      }
    >
      {children}
    </div>
  );
}

function OpenResults({ result }) {
  const [revealReceive, setRevealReceive] = useState(false);
  const [revealNetwork, setRevealNetwork] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyLoading, setPrivateKeyLoading] = useState(false);
  const [privateKeyError, setPrivateKeyError] = useState("");

  const frame = objectAt(result?.receive, ["frame"]);
  const transaction = objectAt(frame, ["quantum_transaction"]);
  const event = objectAt(frame, ["event"]);

  // { identifier, qtm: { commitment, coordinate, sigma, network } }
  const openedQtm = objectAt(transaction, ["qtm"]);
  const qtmValues = objectAt(openedQtm, ["qtm"]);

  const heritage = objectAt(event, ["heritage"]);
  const depth = objectAt(event, ["depth"]);
  const runtime = objectAt(event, ["runtime"]);

  const activation = result?.activation ?? valueAt(transaction, ["amount"]);
  const commitment = valueAt(qtmValues, ["commitment"]);
  const networkOption = result?.network_option;

  const identity = {
    substrate: result?.substrate,
    network: result?.network,
    activation: result?.activation,
    submission: result?.ordinal,
    flow: result?.flow,
    commitment,
  };

  // User-facing receive values: exactly the non-QTM fields of the
  // QuantumTransactionResponse, plus the request values that produced them.
  const receiveValues = transaction
    ? {
        receive_amount: result?.requested_amount,
        activation,
        flow: result?.flow,
        constant: valueAt(transaction, ["constant"]),
        constant_delta: valueAt(transaction, ["constant_delta"]),
      }
    : undefined;

  async function revealPrivateKey() {
    if (privateKey) {
      setPrivateKey("");
      return;
    }

    setPrivateKeyLoading(true);
    setPrivateKeyError("");

    try {
      const value = await callRuntime(
        "submissionValue",
        {
          name: result.substrate,
          activation: result.activation,
          submission: result.ordinal,
          field: "xpriv",
        },
        true
      );

      setPrivateKey(
        typeof value === "string"
          ? value
          : value?.response_text ?? JSON.stringify(value)
      );
    } catch (error) {
      setPrivateKeyError(
        error instanceof Error
          ? error.message
          : "Unable to retrieve the private extended key."
      );
    } finally {
      setPrivateKeyLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-xs font-semibold">Receive event identity</h3>

        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          All four frames below read this one receive response.
        </p>

        <div className="mt-3">
          <KeyValueList value={identity} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Frame eyebrow="Frame 1" title="Opened QTM">
          {hasContent(openedQtm) ? (
            <KeyValueList value={openedQtm} />
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              The receive response did not include
              frame.quantum_transaction.qtm.
            </p>
          )}
        </Frame>

        <Frame
          eyebrow="Frame 2 · Sensitive"
          title="Network"
          tone="sensitive"
          actions={
            <FrameButton
              onClick={() => setRevealNetwork((current) => !current)}
            >
              {revealNetwork ? "Hide inputs" : "Reveal inputs"}
            </FrameButton>
          }
        >
          <div className="space-y-3">
            <KeyValueList
              value={{
                network: result?.network,
                activation: result?.activation,
                submission: result?.ordinal,
                derivation_path: result?.derivation?.derivation_path,
              }}
            />

            {revealNetwork ? (
              <div className="space-y-3 border-t border-amber-200 pt-3 dark:border-amber-900">
                <ResultSection
                  title="ScriptPubKey"
                  value={result?.derivations?.scriptpubkey}
                  defaultOpen
                />

                <ResultSection
                  title="Xpub"
                  value={result?.derivations?.xpub}
                />

                <ResultSection
                  title="Zpub"
                  value={result?.derivations?.zpub}
                />

                <ResultSection
                  title="Address"
                  value={result?.derivations?.address}
                />

                <div className="space-y-2 rounded-md border border-amber-300 p-3 dark:border-amber-800">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold">
                      Private extended key · Xpriv
                    </p>

                    <FrameButton
                      onClick={revealPrivateKey}
                      disabled={privateKeyLoading}
                    >
                      {privateKeyLoading
                        ? "Loading…"
                        : privateKey
                          ? "Clear"
                          : "Reveal Xpriv"}
                    </FrameButton>
                  </div>

                  {privateKeyError && (
                    <p role="alert" className="text-xs text-red-600">
                      {privateKeyError}
                    </p>
                  )}

                  {privateKey && (
                    <p className="break-all rounded-md bg-amber-100 p-2 font-mono text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                      {privateKey}
                    </p>
                  )}

                  {!privateKey && !privateKeyError && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Xpriv is not requested until you explicitly reveal it.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Network derivations are hidden. Reveal to inspect this
                submission&apos;s script, extended public keys and address.
              </p>
            )}
          </div>
        </Frame>

        <Frame
          eyebrow="Frame 3"
          title="Receive derivations"
          actions={
            <FrameButton
              onClick={() => setRevealReceive((current) => !current)}
            >
              {revealReceive ? "Clear" : "Reveal"}
            </FrameButton>
          }
        >
          {receiveValues ? (
            <Blurred revealed={revealReceive}>
              <KeyValueList value={receiveValues} />
            </Blurred>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              The response did not contain the expected QuantumTransaction.
            </p>
          )}
        </Frame>

        <Frame eyebrow="Frame 4" title="Immediate heritage">
          <div className="space-y-3">
            <KeyValueList
              value={{
                flow: result?.flow,
                scale: valueAt(event, ["scale"]),
                runtime_unix_seconds: valueAt(runtime, ["unix_seconds"]),
                runtime_subsec_nanos: valueAt(runtime, ["subsec_nanos"]),
              }}
            />

            {hasContent(heritage) ? (
              <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Heritage
                </p>

                <KeyValueList value={heritage} />
              </div>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The receive event did not include heritage.
              </p>
            )}

            {hasContent(depth) && (
              <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Depth
                </p>

                <KeyValueList value={depth} />
              </div>
            )}
          </div>
        </Frame>
      </div>
    </div>
  );
}

function EventMapSections({ event, prefix = "" }) {
  const depth = objectAt(event, ["depth"]);
  const heritage = objectAt(event, ["heritage"]);
  const state = objectAt(heritage, ["state"]);
  const transition = objectAt(heritage, ["transition"]);
  const depthPath = valueAt(depth, ["path"]);

  return (
    <div className="space-y-3">
      {depth && (
        <ResultSection
          title={`${prefix}Final depth`}
          description={
            depthPath === undefined
              ? "Final depth data returned by the API."
              : `Depth path: ${friendlyValue(depthPath)}`
          }
          value={depth}
          defaultOpen
        />
      )}

      {state && (
        <ResultSection title={`${prefix}Heritage state`} value={state} />
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
  const [receiveOrdinal, setReceiveOrdinal] = useState("1");
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
  setReceiveOrdinal("1");
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

  // Keep the selected ordinal inside the 1…N coordinate range.
  function handleReceiveAmountChange(value) {
    setReceiveAmount(value);
    setResult(null);
    setError("");

    const amount = Number(value);
    const ordinal = Number(receiveOrdinal);

    if (!Number.isSafeInteger(amount) || amount < 1) {
      setReceiveOrdinal("1");
    } else if (ordinal > amount) {
      setReceiveOrdinal(String(amount));
    }
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

        if (!selectedNetwork) {
          throw new Error("Select a coordination network before receiving.");
        }

        if (!["receive", "change"].includes(receiveFlow)) {
          throw new Error("Select a valid receive flow.");
        }

        const ordinal = Number(receiveOrdinal);

        if (
          !Number.isSafeInteger(ordinal) ||
          ordinal < 1 ||
          ordinal > amount
        ) {
          throw new Error(
            "Select a valid ordinal within the receive amount."
          );
        }

        // Step 1: Open the exact persisted event at the selected ordinal.
        const opened = await callRuntime(
          "openSubstrate",
          {
            name: selectedSubstrate,
            activation: ordinal,
          },
          true
        );

        if (!opened || !opened.event) {
          throw new Error(
            `Open did not return the persisted event at ordinal ${ordinal}.`
          );
        }

        // Step 2: Receive using the same selected ordinal.
        const receive = await callRuntime("receive", {
          name: selectedSubstrate,
          request: {
            amount,
            network: selectedNetwork,
            flow: receiveFlow,
            ordinal,
          },
        });

        const frame = objectAt(receive, ["frame"]);
        const transaction = objectAt(frame, ["quantum_transaction"]);
        const event = objectAt(frame, ["event"]);
        const heritage = objectAt(event, ["heritage"]);
        const state = objectAt(heritage, ["state"]);

        if (!transaction || !event || !heritage) {
          throw new Error(
            "Receive succeeded but did not return the expected transaction and event heritage."
          );
        }

        // The submission is always the selected ordinal.
        // Activation comes from the received event's own heritage state.
        const receivedActivation = Number(
          valueAt(state, ["activations"]) ??
            valueAt(transaction, ["amount"])
        );

        if (
          !Number.isSafeInteger(receivedActivation) ||
          receivedActivation < 0
        ) {
          throw new Error(
            "The received event did not return a valid activation."
          );
        }

        // Step 2: Derive and persist values for this exact submission.
        // This is deliberately after successful receive.
        const derivation = await callRuntime(
          "deriveSubmission",
          {
            name: selectedSubstrate,
            activation: receivedActivation,
            submission: ordinal,
            request: {
              network: selectedNetwork,
            },
          },
          true
        );

        // Step 3: Retrieve public derivation values for the same
        // substrate / activation / submission.
        const readValue = (field) =>
          callRuntime(
            "submissionValue",
            {
              name: selectedSubstrate,
              activation: receivedActivation,
              submission: ordinal,
              field,
            },
            true
          );

        const [scriptpubkey, xpub, zpub, address] = await Promise.all([
          readValue("scriptpubkey"),
          readValue("xpub"),
          readValue("zpub"),
          readValue("address"),
        ]);

        // xpriv is intentionally not fetched here.
        // It is requested only after an explicit reveal action.

        setResult({
          receive,
          derivation,
          derivations: {
            scriptpubkey,
            xpub,
            zpub,
            address,
          },
          requested_amount: amount,
          network: selectedNetwork,
          network_option: currentNetwork,
          ordinal,
          activation: receivedActivation,
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
                "Perform a receive operation at a chosen ordinal and view the opened QTM, its network derivations, and its immediate heritage."}

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
                    Select a coordination network before receiving. Its
                    persisted event budget determines the permitted ordinal
                    range for this operation.
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

                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs font-medium">
                    Coordination network
                  </span>

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

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Transaction amount (N)"
                    value={receiveAmount}
                    onChange={handleReceiveAmountChange}
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

                {Number.isSafeInteger(Number(receiveAmount)) &&
                  Number(receiveAmount) > 0 && (
                    <ReceiveOrdinalSelector
                      amount={receiveAmount}
                      ordinal={receiveOrdinal}
                      onChange={(n) => {
                        setReceiveOrdinal(String(n));
                        setResult(null);
                        setError("");
                      }}
                    />
                  )}

                {currentNetwork && (
                  <ResultSection
                    title="Selected coordination network"
                    description="This network is used to load and validate the receive budget."
                    value={currentNetwork}
                  />
                )}
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
                ((tab === "transit" || tab === "open") &&
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
