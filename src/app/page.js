"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

// Substrate state lives in the machine-local ~/.qp/substrates and is operated
// on by the QP runtime. Inside a native shell (for example Tauri) the console
// calls that runtime directly through IPC: no HTTP. A plain browser cannot
// reach the local filesystem, so it uses the qtm-api HTTP server.
// Prefer NEXT_PUBLIC_QTM_API_BASE when set; otherwise fall back to the public
// qtm-api deployment so a Vercel (or similar) host never routes /wallets to
// itself.
// Substrate storage is owned by the server-side QP runtime.
// substrate_root() is resolved by Rust, never by the browser.
const TABS = [
  { id: "create", label: "Create" },
  { id: "receive", label: "Receive" },
  { id: "transit", label: "Transit" },
  { id: "exile", label: "Exile" },
];

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE || "https://qtm-api.onrender.com"
).replace(/\/+$/, "");

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
      (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0))
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
  if (typeof window === "undefined" || !isTauri()) return null;
  return invoke;
}

const NATIVE_COMMANDS = {
  listSubstrates: "qtm_list_substrates",
  listNetworks: "qtm_list_networks",
  createSubstrate: "qtm_create",
  receive: "qtm_receive",
  transit: "qtm_transit",
  exile: "qtm_exile",
  listEvents: "qtm_events",
  submissionValue: "qtm_submission_value",
};

const API_ROUTES = {
  listSubstrates: () => ["GET", "/wallets"],
  listNetworks: () => ["GET", "/networks"],
  createSubstrate: () => ["POST", "/wallets"],
  openSubstrate: ({ name, activation }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(
      activation
    )}/open`,
  ],
  receive: ({ name }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/receive`,
  ],
  transit: ({ name }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/transit`,
  ],
  exile: ({ name }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/exile`,
  ],
  listEvents: ({ name }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/events`,
  ],
  submissionValue: ({ name, activation, network, field }) => [
    "GET",
    `/wallets/${encodeURIComponent(
      name
    )}/activations/${encodeURIComponent(
      activation
    )}/networks/${encodeURIComponent(network)}/${encodeURIComponent(field)}`,
  ],
};

function directMessage(cause) {
  if (typeof cause === "string" && cause.trim()) return cause.trim();
  if (cause instanceof Error && cause.message) return cause.message;
  if (isRecord(cause)) {
    const message = valueAt(cause, ["error", "message", "detail"]);
    if (typeof message === "string" && message.trim()) return message.trim();
    if (message !== undefined) return String(message);
  }
  return "The QP runtime reported an error.";
}

function parseApiResponse(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { response_text: raw };
  }
}

async function apiRequest(path, options = {}) {
  const method = options.method || "GET";
  const url = `${API_BASE}${path}`;
  const startedAt = performance.now();

  let response;

  console.info(`[QTM API] START ${method} ${path}`);

  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });

    console.info(
      `[QTM API] HEADERS ${method} ${path} ` +
        `status=${response.status} ` +
        `elapsed=${Math.round(performance.now() - startedAt)}ms`
    );
  } catch (cause) {
    console.error(
      `[QTM API] FETCH FAILED ${method} ${path}`,
      cause
    );

    throw new RuntimeError(
      `Could not reach the QTM API at ${API_BASE} while calling ${method} ${path}: ${directMessage(cause)}`,
      { status: 0, url }
    );
  }

  let raw;

  try {
    raw = await response.text();

    console.info(
      `[QTM API] BODY COMPLETE ${method} ${path} ` +
        `bytes=${raw.length} ` +
        `elapsed=${Math.round(performance.now() - startedAt)}ms`
    );
  } catch (cause) {
    console.error(
      `[QTM API] BODY FAILED ${method} ${path}`,
      cause
    );

    throw new RuntimeError(
      `The QTM API connection closed before the response was read (${method} ${path}): ${directMessage(cause)}`,
      {
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
      }
    );
  }

  const data = parseApiResponse(raw);

  if (!response.ok) {
    const message = valueAt(data, ["error", "message", "detail"]);

    throw new RuntimeError(
      typeof message === "string" && message.trim()
        ? message.trim()
        : `Request failed with HTTP ${response.status}: ${method} ${path}`,
      {
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
        body: data,
      }
    );
  }

  console.info(
    `[QTM API] SUCCESS ${method} ${path} ` +
      `elapsed=${Math.round(performance.now() - startedAt)}ms`
  );

  return data;
}

async function callRuntime(operation, args = {}) {
  const native = nativeInvoke();

  if (native) {
    const command = NATIVE_COMMANDS[operation];

    if (!command) {
      throw new RuntimeError(
        `Native command is not registered: ${operation}`
      );
    }

    try {
      return await native(command, args || {});
    } catch (cause) {
      throw new RuntimeError(directMessage(cause));
    }
  }

  const route = API_ROUTES[operation];

  if (!route) {
    throw new RuntimeError(
      `Browser API route is not registered: ${operation}`
    );
  }

  const [method, path] = route(args || {});

  const body = ["createSubstrate", "receive", "transit"].includes(operation)
    ? args?.request
    : undefined;

  return apiRequest(path, {
    method,
    ...(body !== undefined ? { body } : {}),
  });
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
    <div className="flex flex-col gap-1">
      {eyebrow && (
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          {eyebrow}
        </p>
      )}
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h3>
    </div>
  );
}

function KeyValueList({ value, emptyText = "No details were returned." }) {
  const rows = flatten(value);

  if (!rows.length) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyText}</p>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
      {rows.map(([key, itemValue], index) => (
        <div key={`${key}-${index}`} className="min-w-0">
          <dt className="truncate font-medium text-zinc-500 dark:text-zinc-400">
            {key}
          </dt>
          <dd className="break-words text-zinc-900 dark:text-zinc-100">
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
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      >
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </span>
        {description && (
          <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {description}
          </span>
        )}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {open ? "▴" : "▾"}
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
    </div>
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
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function NumberField({ label, value, onChange, min = 0 }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
      />
    </label>
  );
}

// Controlled ordinal selector. Amount (N) defines the coordinate range 1…N;
// every unit is its own button and button n means ordinal coordinate n.
// The grid is windowed (only visible rows are mounted) inside a scroll
// container, so there is no display cutoff and every ordinal stays reachable.
// When amount changes to N the frame loads persisted events for that range
// (0..N) and marks every ordinal backed by a persisted transit event with a
const ORDINAL_COLUMNS = 8;
const ORDINAL_ROW_HEIGHT = 38;
const ORDINAL_VIEWPORT_HEIGHT = 190;
const ORDINAL_OVERSCAN = 2;

function ReceiveOrdinalSelector({
  amount,
  ordinal,
  onChange,
  persistedOrdinals = [],
  persistedLoading = false,
  persistedError = "",
}) {
  const [scrollTop, setScrollTop] = useState(0);

  const count = Number(amount);
  const selected = Number(ordinal);
  const persisted = new Set(persistedOrdinals);

  if (!Number.isSafeInteger(count) || count <= 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Enter a positive amount to load persisted ordinals.
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
      const isPersisted = persisted.has(id);

      const cellClass = isPersisted
        ? isSelected
          ? "border-emerald-600 bg-emerald-200 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-900/70 dark:text-emerald-100"
          : "border-emerald-300 bg-emerald-100 text-emerald-950 hover:bg-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-900/70"
        : isSelected
        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
        : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-900";

      cells.push(
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex h-8 min-w-0 items-center justify-center rounded-md border px-0.5 text-center transition-colors ${cellClass}`}
        >
          {id}
        </button>
      );
    }

    rows.push(
      <div
        key={row}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${ORDINAL_COLUMNS}, minmax(0, 1fr))` }}
      >
        {cells}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
          Ordinal units · Range 0–{count}
        </h4>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {persisted.size} persisted transit(s) · {count} available coordinates · Selected{" "}
          {Number.isSafeInteger(selected) ? selected : "none"}
        </p>
      </div>

      {persistedLoading && (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Loading persisted events…
        </p>
      )}
      {persistedError && (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          {persistedError}
        </p>
      )}

      <div
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800"
        style={{ height: ORDINAL_VIEWPORT_HEIGHT }}
      >
        <div className="flex flex-col gap-1">{rows}</div>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Persisted transit
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          No persisted transit
        </span>
      </div>
    </div>
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

// Same 6:3 (2:1) ratio for every frame; stacks and relaxes the ratio on
// narrow screens, scrolling inside the frame when content is taller.
function Frame({ eyebrow, title, tone = "default", actions, children }) {
  const toneClass =
    tone === "sensitive"
      ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

  return (
    <section className={`flex flex-col overflow-hidden rounded-2xl border ${toneClass}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-inherit px-4 py-3">
        <div className="flex flex-col gap-1">
          {eyebrow && (
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              {eyebrow}
            </p>
          )}
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h3>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  );
}

function FrameButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-7 rounded-md border border-zinc-300 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

// Copies the exact underlying value (never a formatted label or a shortened
// display string) to the clipboard.
async function copyValue(value) {
  if (value === null || value === undefined) return;
  try {
    await navigator.clipboard.writeText(String(value));
  } catch {
    // Clipboard access can be denied by the browser; nothing else to do.
  }
}

// Small overlapping-squares copy control. `label` is the accessible name,
// for example "Copy address".
function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  const empty = value === null || value === undefined || value === "";

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    if (empty) return;
    await copyValue(value);
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={empty}
      title={label}
      aria-label={label}
      className="inline-flex h-5 w-5 items-center justify-center rounded border border-zinc-300 text-[10px] text-zinc-500 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      {copied ? (
        <span aria-hidden="true">✓</span>
      ) : (
        <span aria-hidden="true">⧉</span>
      )}
    </button>
  );
}

// One labelled network value with its own copy control.
function NetworkValueRow({ label, value, copyLabel }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-zinc-900 dark:text-zinc-100">
          {value === null || value === undefined || value === ""
            ? "Not provided"
            : String(value)}
        </span>
        <CopyButton value={value} label={copyLabel} />
      </span>
    </div>
  );
}

// Display safeguard only; it is not access control.
function Blurred({ revealed, children }) {
  return (
    <span className={revealed ? "" : "select-none blur-sm"}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Operation 2: Independent Submission Derivation Results
// ---------------------------------------------------------------------------
function DeriveResults({ result }) {
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyLoading, setPrivateKeyLoading] = useState(false);
  const [privateKeyError, setPrivateKeyError] = useState("");

  async function revealPrivateKey() {
    if (privateKey) {
      setPrivateKey("");
      return;
    }

    setPrivateKeyLoading(true);
    setPrivateKeyError("");

    try {
      const value = await callRuntime("submissionValue", {
        name: result.substrate,
        activation: result.activation,
        submission: result.submission,
        network: result.network,
        field: "xpriv",
      });

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
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Submission derivation identity
        </h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Persisted independently under activation {result?.activation}, submission{" "}
          {result?.submission}, network {result?.network}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FrameButton
          onClick={() => setRevealSensitive((current) => !current)}
        >
          {revealSensitive ? "Hide values" : "Reveal values"}
        </FrameButton>
      </div>

      <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        {revealSensitive ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Private extended key · Xpriv
              </span>
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
              <p className="text-xs text-red-600 dark:text-red-400">
                {privateKeyError}
              </p>
            )}

            {privateKey && (
              <p className="break-all font-mono text-xs text-zinc-900 dark:text-zinc-100">
                {privateKey}
              </p>
            )}

            {!privateKey && !privateKeyError && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Xpriv is fetched on demand only when explicitly revealed.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Full scriptPubKey and extended keys are hidden. Reveal to inspect all
            derived values for this submission.
          </p>
        )}
      </div>
    </div>
  );
}

// Frame 4 · Network inputs. Fed by result.receive.derivation (metadata sent
// by the Receive response). Every supported network discovered for the
// activation gets its own section; values are loaded from the persisted
// activation.
function ReceiveNetworkDerivations({ derivation }) {
  const [networkValues, setNetworkValues] = useState({});
  const [privateKeys, setPrivateKeys] = useState({});
  const [loading, setLoading] = useState(false);
  const [privateKeyLoading, setPrivateKeyLoading] = useState({});
  const [error, setError] = useState({});
  const [privateKeyError, setPrivateKeyError] = useState({});

  useEffect(() => {
    let active = true;

    async function loadNetworkValues() {
      const networks = Array.isArray(derivation?.networks)
        ? derivation.networks
        : [];

      if (
        !derivation?.substrate ||
        !Number.isSafeInteger(Number(derivation.activation)) ||
        !networks.length
      ) {
        setNetworkValues({});
        return;
      }

      setLoading(true);
      setError({});

      try {
        const fields = [
          "fingerprint",
          "scriptpubkey",
          "xpub",
          "zpub",
          "address",
        ];

        const failures = {};

        const entries = await Promise.all(
          networks
            .filter(
              (network) =>
                network.supported === true &&
                network.available !== false &&
                typeof network.network === "string"
            )
            .map(async (network) => {
              try {
                const values = await Promise.all(
                  fields.map(async (field) => {
                    const response = await callRuntime("submissionValue", {
                      name: derivation.substrate,
                      activation: Number(derivation.activation),
                      network: network.network,
                      field,
                    });

                    return [
                      field,
                      typeof response === "string"
                        ? response
                        : response?.response_text ?? JSON.stringify(response),
                    ];
                  })
                );

                return [network.network, Object.fromEntries(values)];
              } catch (err) {
                failures[network.network] =
                  err instanceof Error
                    ? err.message
                    : "Unable to retrieve activation network values.";
                return null;
              }
            })
        );

        if (active) {
          setNetworkValues(Object.fromEntries(entries.filter(Boolean)));
          setError(failures);
        }
      } catch (err) {
        if (active) {
          setError({
            general:
              err instanceof Error
                ? err.message
                : "Unable to retrieve activation network values.",
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadNetworkValues();

    return () => {
      active = false;
    };
  }, [derivation]);

  async function revealPrivateKey(networkId) {
    if (privateKeys[networkId]) {
      setPrivateKeys((current) => {
        const next = { ...current };
        delete next[networkId];
        return next;
      });
      return;
    }

    setPrivateKeyLoading((current) => ({
      ...current,
      [networkId]: true,
    }));
    setPrivateKeyError((current) => ({
      ...current,
      [networkId]: "",
    }));

    try {
      const value = await callRuntime("submissionValue", {
        name: derivation.substrate,
        activation: Number(derivation.activation),
        network: networkId,
        field: "xpriv",
      });

      setPrivateKeys((current) => ({
        ...current,
        [networkId]:
          typeof value === "string"
            ? value
            : value?.response_text ?? JSON.stringify(value),
      }));
    } catch (error) {
      setPrivateKeyError((current) => ({
        ...current,
        [networkId]:
          error instanceof Error
            ? error.message
            : "Unable to retrieve the private extended key.",
      }));
    } finally {
      setPrivateKeyLoading((current) => {
        const next = { ...current };
        delete next[networkId];
        return next;
      });
    }
  }

  const networks = Array.isArray(derivation?.networks)
    ? derivation.networks
    : [];

  if (!networks.length) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        No network derivation metadata was returned.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error.general && (
        <p className="text-xs text-red-600 dark:text-red-400">{error.general}</p>
      )}

      {networks.map((network) => {
        const id = network.network;
        const values = networkValues[id] || {};
        const isLoading = loading;
        const sectionError = error[id];
        const pk = privateKeys[id];
        const pkLoading = privateKeyLoading[id];
        const pkError = privateKeyError[id];

        return (
          <ResultSection
            key={id}
            title={id}
            description={
              network.supported === false
                ? "Unsupported"
                : network.available === false
                ? "Unavailable"
                : ""
            }
            defaultOpen={network.supported !== false}
          >
            <div className="flex flex-col gap-3">
              {isLoading && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Loading network values…
                </p>
              )}

              {sectionError && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {sectionError}
                </p>
              )}

              {!isLoading && !sectionError && (
                <>
                  <NetworkValueRow
                    label="Fingerprint"
                    value={values.fingerprint}
                    copyLabel={`Copy fingerprint for ${id}`}
                  />
                  <NetworkValueRow
                    label="ScriptPubKey"
                    value={values.scriptpubkey}
                    copyLabel={`Copy scriptPubKey for ${id}`}
                  />
                  <NetworkValueRow
                    label="Xpub"
                    value={values.xpub}
                    copyLabel={`Copy xpub for ${id}`}
                  />
                  <NetworkValueRow
                    label="Zpub"
                    value={values.zpub}
                    copyLabel={`Copy zpub for ${id}`}
                  />
                  <NetworkValueRow
                    label="Address"
                    value={values.address}
                    copyLabel={`Copy address for ${id}`}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <FrameButton
                      onClick={() => revealPrivateKey(id)}
                      disabled={pkLoading}
                    >
                      {pkLoading
                        ? "Loading…"
                        : pk
                        ? "Clear Xpriv"
                        : "Reveal Xpriv"}
                    </FrameButton>
                  </div>

                  {pkError && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {pkError}
                    </p>
                  )}

                  {pk && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Private extended key
                      </span>
                      <p className="break-all font-mono text-xs text-zinc-900 dark:text-zinc-100">
                        {pk}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </ResultSection>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operation 1: Receive
// ---------------------------------------------------------------------------
function ReceiveResult({ result }) {
  return (
    <div className="flex flex-col gap-4">
      <ResultHeading
        eyebrow="Receive"
        title="Receive result"
      />

      <ResultSection
        title="Summary"
        description="Core response fields"
        value={result}
        defaultOpen
      />

      <ReceiveNetworkDerivations derivation={result?.derivation} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operation 3: Transit
// ---------------------------------------------------------------------------
function TransitResult({ result }) {
  return (
    <div className="flex flex-col gap-4">
      <ResultHeading eyebrow="Transit" title="Transit result" />

      <ResultSection
        title="Summary"
        description="Core response fields"
        value={result}
        defaultOpen
      />

      <ResultSection
        title="Event map"
        description="Decoded event details"
        value={eventMapOf(result)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operation 4: Exile
// ---------------------------------------------------------------------------
function ExileResult({ result }) {
  return (
    <div className="flex flex-col gap-4">
      <ResultHeading eyebrow="Exile" title="Exile result" />

      <ResultSection
        title="Summary"
        description="Core response fields"
        value={result}
        defaultOpen
      />

      <ResultSection
        title="Event map"
        description="Decoded event details"
        value={eventMapOf(result)}
      />
    </div>
  );
}

function CreateForm({ onSubmit, loading }) {
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      request: {
        name: name.trim(),
        passphrase,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Name"
        value={name}
        onChange={setName}
        required
        placeholder="my-substrate"
        autoComplete="off"
      />
      <Field
        label="Passphrase"
        value={passphrase}
        onChange={setPassphrase}
        required
        type="password"
        autoComplete="new-password"
      />
      <div className="flex justify-end">
        <FrameButton
          onClick={handleSubmit}
          disabled={loading || !name.trim()}
        >
          {loading ? "Creating…" : "Create substrate"}
        </FrameButton>
      </div>
    </form>
  );
}

function ReceiveForm({ substrateOptions, onSubmit, loading }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("1");
  const [ordinal, setOrdinal] = useState("1");
  const [persistedOrdinals, setPersistedOrdinals] = useState([]);
  const [persistedLoading, setPersistedLoading] = useState(false);
  const [persistedError, setPersistedError] = useState("");

  useEffect(() => {
    if (!name) {
      setPersistedOrdinals([]);
      return;
    }

    let active = true;

    async function loadPersisted() {
      setPersistedLoading(true);
      setPersistedError("");

      try {
        const data = await callRuntime("listEvents", { name });
        const events = eventRecordsOf(data);

        const ordinals = events
          .map((event) => {
            const map = eventMapOf(event);
            return valueAt(map, ["ordinal", "ordinal_id", "index"]);
          })
          .filter((value) => Number.isSafeInteger(Number(value)))
          .map((value) => Number(value));

        if (active) {
          setPersistedOrdinals(Array.from(new Set(ordinals)));
        }
      } catch (error) {
        if (active) {
          setPersistedError(
            error instanceof Error
              ? error.message
              : "Unable to load persisted events."
          );
        }
      } finally {
        if (active) setPersistedLoading(false);
      }
    }

    loadPersisted();

    return () => {
      active = false;
    };
  }, [name]);

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      request: {
        amount: Number(amount),
        ordinal: Number(ordinal),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Substrate"
        value={name}
        onChange={setName}
        required
        placeholder="my-substrate"
        autoComplete="off"
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Amount"
          value={amount}
          onChange={setAmount}
          min={1}
        />
        <NumberField
          label="Ordinal"
          value={ordinal}
          onChange={setOrdinal}
          min={1}
        />
      </div>
      <ReceiveOrdinalSelector
        amount={amount}
        ordinal={ordinal}
        onChange={setOrdinal}
        persistedOrdinals={persistedOrdinals}
        persistedLoading={persistedLoading}
        persistedError={persistedError}
      />
      <div className="flex justify-end">
        <FrameButton
          onClick={handleSubmit}
          disabled={loading || !name.trim()}
        >
          {loading ? "Receiving…" : "Receive"}
        </FrameButton>
      </div>
    </form>
  );
}

function TransitForm({ substrateOptions, onSubmit, loading }) {
  const [name, setName] = useState("");
  const [ordinal, setOrdinal] = useState("1");
  const [to, setTo] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      request: {
        ordinal: Number(ordinal),
        to: to.trim(),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Substrate"
        value={name}
        onChange={setName}
        required
        placeholder="my-substrate"
        autoComplete="off"
      />
      <NumberField
        label="Ordinal"
        value={ordinal}
        onChange={setOrdinal}
        min={1}
      />
      <Field
        label="To"
        value={to}
        onChange={setTo}
        required
        placeholder="destination"
        autoComplete="off"
      />
      <div className="flex justify-end">
        <FrameButton
          onClick={handleSubmit}
          disabled={loading || !name.trim() || !to.trim()}
        >
          {loading ? "Transiting…" : "Transit"}
        </FrameButton>
      </div>
    </form>
  );
}

function ExileForm({ substrateOptions, onSubmit, loading }) {
  const [name, setName] = useState("");
  const [ordinal, setOrdinal] = useState("1");

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      request: {
        ordinal: Number(ordinal),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field
        label="Substrate"
        value={name}
        onChange={setName}
        required
        placeholder="my-substrate"
        autoComplete="off"
      />
      <NumberField
        label="Ordinal"
        value={ordinal}
        onChange={setOrdinal}
        min={1}
      />
      <div className="flex justify-end">
        <FrameButton
          onClick={handleSubmit}
          disabled={loading || !name.trim()}
        >
          {loading ? "Exiling…" : "Exile"}
        </FrameButton>
      </div>
    </form>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState("create");
  const [substrates, setSubstrates] = useState([]);
  const [substratesLoading, setSubstratesLoading] = useState(false);
  const [substratesError, setSubstratesError] = useState("");
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [operationResult, setOperationResult] = useState(null);

  const substrateOptions = useMemo(
    () =>
      substrates
        .map((item) => (typeof item === "string" ? item : item?.name))
        .filter((name) => typeof name === "string" && name.trim()),
    [substrates]
  );

  const loadSubstrates = useCallback(async () => {
    setSubstratesLoading(true);
    setSubstratesError("");

    try {
      const data = await callRuntime("listSubstrates");
      const list = Array.isArray(data)
        ? data
        : eventRecordsOf(data);
      setSubstrates(list);
    } catch (error) {
      setSubstratesError(
        error instanceof Error
          ? error.message
          : "Unable to load substrates."
      );
    } finally {
      setSubstratesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubstrates();
  }, [loadSubstrates]);

  async function handleOperation(operation, args) {
    setOperationLoading(true);
    setOperationError("");
    setOperationResult(null);

    try {
      const result = await callRuntime(operation, args);
      setOperationResult(result);
      await loadSubstrates();
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "Operation failed."
      );
    } finally {
      setOperationLoading(false);
    }
  }

  function handleCreate(args) {
    return handleOperation("createSubstrate", args);
  }

  function handleReceive(args) {
    return handleOperation("receive", args);
  }

  function handleTransit(args) {
    return handleOperation("transit", args);
  }

  function handleExile(args) {
    return handleOperation("exile", args);
  }

  function renderResult() {
    if (operationError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {operationError}
        </div>
      );
    }

    if (!operationResult) {
      return (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          No result yet. Run an operation to see its output.
        </p>
      );
    }

    switch (activeTab) {
      case "receive":
        return <ReceiveResult result={operationResult} />;
      case "transit":
        return <TransitResult result={operationResult} />;
      case "exile":
        return <ExileResult result={operationResult} />;
      default:
        return (
          <ResultSection
            title="Create result"
            description="Core response fields"
            value={operationResult}
            defaultOpen
          />
        );
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          QTM Web
        </p>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Quantum Transaction Machine
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Create, receive, transit, and exile substrate units.
        </p>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="flex w-full flex-col gap-3 lg:w-72">
          <Frame eyebrow="Substrates" title="Available substrates">
            {substratesLoading && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Loading substrates…
              </p>
            )}

            {substratesError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {substratesError}
              </p>
            )}

            {!substratesLoading && !substratesError && !substrateOptions.length && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                No substrates found. Create one to get started.
              </p>
            )}

            {!!substrateOptions.length && (
              <ul className="flex flex-col gap-1">
                {substrateOptions.map((name) => (
                  <li
                    key={name}
                    className="truncate rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:text-zinc-200"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex justify-end">
              <FrameButton onClick={loadSubstrates} disabled={substratesLoading}>
                Refresh
              </FrameButton>
            </div>
          </Frame>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`h-8 rounded-full px-3 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <Frame
            eyebrow={TABS.find((tab) => tab.id === activeTab)?.label}
            title={
              activeTab === "create"
                ? "Create a substrate"
                : activeTab === "receive"
                ? "Receive units"
                : activeTab === "transit"
                ? "Transit a unit"
                : "Exile a unit"
            }
          >
            {activeTab === "create" && (
              <CreateForm
                onSubmit={handleCreate}
                loading={operationLoading}
              />
            )}
            {activeTab === "receive" && (
              <ReceiveForm
                substrateOptions={substrateOptions}
                onSubmit={handleReceive}
                loading={operationLoading}
              />
            )}
            {activeTab === "transit" && (
              <TransitForm
                substrateOptions={substrateOptions}
                onSubmit={handleTransit}
                loading={operationLoading}
              />
            )}
            {activeTab === "exile" && (
              <ExileForm
                substrateOptions={substrateOptions}
                onSubmit={handleExile}
                loading={operationLoading}
              />
            )}
          </Frame>

          <Frame eyebrow="Result" title="Operation output">
            {renderResult()}
          </Frame>
        </div>
      </div>
    </main>
  );
}