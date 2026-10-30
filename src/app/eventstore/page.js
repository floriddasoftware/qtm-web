"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Substrate is the host. All events and payloads are scoped under it.
// Prefer NEXT_PUBLIC_QTM_API_BASE; fall back to the public qtm-api deployment.
const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api-anwp.onrender.com"
).replace(/\/+$/, "");

const REFRESH_INTERVAL_MS = 8000;
const U128_MAX = "340282366920938463463374607431768211455";

// Direction values returned by qtm-api list_event_payloads (record prefix enum).
const PAYLOAD_DIRECTIONS = {
  transit_inputs: "transit_inputs",
  exile_outputs: "exile_outputs",
};

const INPUT_CLASS =
  "h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/10 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950";

const BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

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
    const reason =
      cause instanceof Error && cause.message ? cause.message : "network error";
    throw new Error(
      `Could not reach the QTM runtime at ${API_BASE} (${reason}).`,
    );
  }

  const raw = await response.text();
  let body = null;

  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { response_text: raw };
    }
  }

  if (!response.ok) {
    const detail =
      body?.error || body?.message || body?.detail || body?.response_text;

    throw new Error(
      detail
        ? String(detail)
        : `Request failed with HTTP ${response.status}.`,
    );
  }

  return body ?? {};
}

function display(value, fallback = "—") {
  if (value === undefined || value === null || value === "") return fallback;

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function parseSafeInteger(value, label) {
  const input = String(value).trim();

  if (!/^\d+$/.test(input)) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }

  const parsed = Number(input);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }

  return parsed;
}

function parseU128(value, label) {
  const input = String(value).trim();

  if (!/^\d+$/.test(input)) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }

  const parsed = BigInt(input);

  if (parsed > BigInt(U128_MAX)) {
    throw new Error(`${label} exceeds the maximum supported u128 value.`);
  }

  return parsed.toString();
}

function budgetValue(budget, key) {
  if (!budget || typeof budget !== "object") return undefined;

  const aliases = {
    min_events: ["min_events", "min_event"],
    max_events: ["max_events", "max_event"],
    max_retained_mass: ["max_retained_mass", "max_retained"],
  };

  for (const name of aliases[key] ?? [key]) {
    if (budget[name] !== undefined && budget[name] !== null) {
      return budget[name];
    }
  }

  return undefined;
}

// Canonical wirepackets location (API-owned, a FILE not a directory):
//   <substrate>/activations/<activation>/event/<commitment>/wirepackets
const WIREPACKETS_CANONICAL = "activations/<activation>/event/wirepackets";

// Tri-state: true / false only when the API sent a real boolean, otherwise
// null ("not reported"). Never coerces a missing field into false.
function reportedBool(value) {
  return typeof value === "boolean" ? value : null;
}

function reportedText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

// Exact byte count from the API; null when it is not a non-negative integer.
function parseByteCount(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "Not reported";
  const exact = `${bytes.toLocaleString("en-US")} byte${bytes === 1 ? "" : "s"}`;
  if (bytes < 1024) return exact;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${exact} (${value.toFixed(value >= 100 ? 0 : 2)} ${units[unit]})`;
}

function isCanonicalWirepacketsPath(path, activation) {
  if (typeof path !== "string") return false;

  const normalized = path.replace(/\\/g, "/");

  return normalized.endsWith(
    `/activations/${activation}/event/wirepackets`,
  );
}

function toU128OrNull(value) {
  if (value === undefined || value === null || value === "") return null;

  const input = String(value);
  if (!/^\d+$/.test(input)) return null;

  try {
    const result = BigInt(input);
    return result <= BigInt(U128_MAX) ? result : null;
  } catch {
    return null;
  }
}

function retainedMass(event) {
  return (
    event?.heritage?.state?.retained_mass ??
    event?.heritage?.state?.retainedMass ??
    event?.retained_mass ??
    event?.retainedMass ??
    null
  );
}

function totalRetainedMass(events) {
  return events.reduce((sum, event) => {
    const amount = toU128OrNull(retainedMass(event));
    return amount === null ? sum : sum + amount;
  }, 0n);
}

function activationFromEvent(event) {
  const value = event?.activation ?? event?.heritage?.state?.activation_count;

  if (value === undefined || value === null || value === "") return null;

  return /^\d+$/.test(String(value)) ? String(value) : null;
}

function emptyDraft() {
  return {
    min_events: "0",
    max_events: "1024",
    max_retained_mass: "1048576",
  };
}

function draftFromBudget(budget) {
  if (!budget || typeof budget !== "object") return emptyDraft();

  return {
    min_events: String(budgetValue(budget, "min_events") ?? "0"),
    max_events: String(budgetValue(budget, "max_events") ?? "1024"),
    max_retained_mass: String(
      budgetValue(budget, "max_retained_mass") ?? "1048576",
    ),
  };
}

function normalizeNetwork(network) {
  if (!network || typeof network.id !== "string") return null;

  return {
    id: network.id,
    name: network.name ?? network.id,
    coin: network.coin,
    purpose: network.purpose,
    path: network.path,
    registered: network.registered,
  };
}

function normalizeNetworkBudgets(result, activationValue) {
  const selected = String(activationValue);

  // Reject a response that belongs to another activation outright.
  if (
    result?.activation !== undefined &&
    result?.activation !== null &&
    String(result.activation) !== selected
  ) {
    return [];
  }

  return Array.isArray(result?.budgets)
    ? result.budgets
        .map((row) => {
          const network = normalizeNetwork(row?.network);
          if (!network) return null;

          // Rows that declare a different activation are not ours.
          if (
            row?.activation !== undefined &&
            row?.activation !== null &&
            String(row.activation) !== selected
          ) {
            return null;
          }

          return { ...row, activation: selected, network };
        })
        .filter(Boolean)
    : [];
}

/*
 * Direction comes from the API render response (record prefix enum):
 *   event_*  → transit_inputs
 *   otherwise → exile_outputs
 * Client heuristics only fill gaps; unknown values stay unclassified.
 */
function normalizeDirection(value, record) {
  const raw = String(value ?? "").toLowerCase().trim();

  if (raw === PAYLOAD_DIRECTIONS.transit_inputs || raw === "transit") {
    return PAYLOAD_DIRECTIONS.transit_inputs;
  }

  if (raw === PAYLOAD_DIRECTIONS.exile_outputs || raw === "exile") {
    return PAYLOAD_DIRECTIONS.exile_outputs;
  }

  const rec = String(record ?? "");
  if (rec.startsWith("event_")) return PAYLOAD_DIRECTIONS.transit_inputs;
  if (rec) return PAYLOAD_DIRECTIONS.exile_outputs;

  return "unclassified";
}

function normalizePayloadEntry(entry, fallbackRecord = "") {
  const network = normalizeNetwork(entry?.network);
  const path = entry?.path ?? entry?.payload_path;
  const depth =
    entry?.depth_identifier ?? entry?.depthIdentifier ?? entry?.depth_id;
  const record = entry?.record ?? fallbackRecord;

  if (
    !network ||
    typeof path !== "string" ||
    path.length === 0 ||
    depth === undefined ||
    depth === null ||
    String(depth).length === 0
  ) {
    return null;
  }

  const objects = Array.isArray(entry?.objects) ? entry.objects : [];

  return {
    ...entry,
    record: String(record),
    network,
    path,
    depth_identifier: String(depth),
    direction: normalizeDirection(entry?.direction, record),
    objects,
    // Extended fields beyond derivation path (render API / depth objects).
    object_count: objects.length,
    retained_object_mass: objects
      .map((obj) => toU128OrNull(obj?.mass))
      .filter((v) => v !== null)
      .reduce((a, b) => a + b, 0n)
      .toString(),
  };
}

/**
 * Normalize GET /wallets/:name/activations/:activation/networks/:network/wirepackets
 *
 * `wirepackets` is a single persisted FILE at
 *   <substrate>/activations/<activation>/event/<commitment>/wirepackets
 * The API returns that file as at most one entry with its exact byte length.
 * Network is request context only; it does not change the path.
 */
function normalizeWireStream(body, name, activationValue, networkId) {
  const requestedActivation = String(activationValue);
  const reportedActivation =
    body?.activation !== undefined && body?.activation !== null
      ? String(body.activation)
      : requestedActivation;

  const commitment = reportedText(body?.commitment);
  const path = reportedText(body?.path);
  const exists = body?.exists === true;

  const entries = Array.isArray(body?.packets) ? body.packets : [];
  const entry = entries.find(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.path === "string" &&
      item.path.length > 0,
  );

  const file = entry
    ? {
        name: typeof entry.name === "string" ? entry.name : "wirepackets",
        path: entry.path,
        bytes: parseByteCount(entry.bytes),
      }
    : null;

  let error = null;
  if (reportedActivation !== requestedActivation) {
    error = `Wirepackets response is for activation ${reportedActivation}, not the selected activation ${requestedActivation}.`;
  } else if (exists && !file) {
    error = "The API reported the wirepackets file as present but returned no file entry.";
  } else if (file && file.bytes === null) {
    error = "The API returned the wirepackets file without a valid byte count.";
  }

  return {
    substrate: body?.substrate ?? name,
    activation: reportedActivation,
    network: body?.network ?? networkId,
    path,
    exists,
    file,
    canonical:
      path !== null &&
      isCanonicalWirepacketsPath(path, reportedActivation),
    error,
  };
}

/**
 * Map GET .../payload-board to display rows.
 * Source of truth: payload.rs PayloadKind + AuthorizedPayload.
 *
 * The client only renders what the API serializes. Every state is tri-state:
 * a real boolean/string is shown, anything absent stays null ("not reported").
 * The derived listen-port candidate is intentionally NOT read: it is computed
 * from the commitment and is not evidence of a listener.
 */
function normalizePayloadBoard(body, name, activationValue, networkId) {
  const kinds = Array.isArray(body?.kinds)
    ? body.kinds
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;

          const kind = typeof entry.kind === "string" ? entry.kind : null;
          if (!kind) return null;

          const authorized =
            entry.authorized_payload && typeof entry.authorized_payload === "object"
              ? entry.authorized_payload
              : null;
          const request =
            authorized?.request && typeof authorized.request === "object"
              ? authorized.request
              : null;
          const authorization =
            request?.authorization && typeof request.authorization === "object"
              ? request.authorization
              : null;

          return {
            kind,
            in_scope: entry.in_scope === true,
            available: entry.available === true,
            network: normalizeNetwork(entry.network),
            depth_path: reportedText(entry.depth_path),
            depth_record: reportedText(entry.depth_record),
            depth_objects: Array.isArray(entry.depth_objects)
              ? entry.depth_objects
              : [],
            // AuthorizedPayload view — display only; never invent carried state.
            authorized_payload: authorized
              ? {
                  carried: reportedBool(authorized.carried),
                  authorization_state: reportedText(
                    authorized.authorization_state,
                  ),
                  settlement_state: reportedText(authorized.settlement_state),
                  request: request
                    ? {
                        carried: reportedBool(request.carried),
                        packet_present: reportedBool(request.packet_present),
                        authorization: authorization
                          ? {
                              commitment: reportedText(authorization.commitment),
                              activation: reportedText(authorization.activation),
                              locked_present: reportedBool(
                                authorization.locked_present,
                              ),
                            }
                          : null,
                      }
                    : null,
                }
              : null,
          };
        })
        .filter(Boolean)
    : [];

  const rawObservation =
    body?.observation && typeof body.observation === "object"
      ? body.observation
      : null;

  const observation = rawObservation
    ? {
        registry_running: reportedBool(rawObservation.registry_running),
        path_hint: reportedText(rawObservation.path_hint),
        bit_minner_feature: reportedBool(rawObservation.bit_minner_feature),
        electrum_listener_bound: reportedBool(
          rawObservation.electrum_listener_bound,
        ),
        settlement_payload_carried: reportedBool(
          rawObservation.settlement_payload_carried,
        ),
      }
    : null;

  const reportedActivation =
    body?.activation !== undefined && body?.activation !== null
      ? String(body.activation)
      : String(activationValue);

  return {
    substrate: body?.substrate ?? name,
    activation: reportedActivation,
    network:
      body?.network !== undefined && body?.network !== null
        ? String(body.network)
        : (networkId ?? null),
    commitment: reportedText(body?.commitment),
    message: reportedText(body?.message),
    observation,
    kinds,
    error:
      reportedActivation !== String(activationValue)
        ? `Payload board is for activation ${reportedActivation}, not the selected activation ${activationValue}.`
        : null,
  };
}

// Budget, draft and editor state are keyed by substrate · activation · network
// so nothing leaks between substrates, activations, or networks.
function networkKey(substrate, activation, networkId) {
  return `network:${substrate}:${activation}:${networkId}`;
}

function payloadRowKey(record, networkId, path, depth) {
  return JSON.stringify([
    "payload",
    String(record),
    String(networkId),
    String(path),
    String(depth),
  ]);
}

function Panel({ title, description, action, children, className = "" }) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/90 p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/80 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight sm:text-base">
            {title}
          </h2>

          {description && (
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-zinc-500 sm:text-sm sm:leading-6 dark:text-zinc-400">
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

function Field({ label, children, hint }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>

      <dd className="mt-1.5 break-words text-sm font-medium leading-5">
        {children ?? "—"}
      </dd>

      {hint && (
        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      )}
    </div>
  );
}

function StatusPill({ configured }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
        configured
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
          : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          configured ? "bg-emerald-500" : "bg-zinc-400"
        }`}
      />
      {configured ? "Configured" : "Unconfigured"}
    </span>
  );
}

function DirectionPill({ direction }) {
  const label =
    direction === PAYLOAD_DIRECTIONS.transit_inputs
      ? "transit_inputs"
      : direction === PAYLOAD_DIRECTIONS.exile_outputs
        ? "exile_outputs"
        : "unclassified";

  return (
    <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-semibold dark:bg-zinc-800">
      {label}
    </span>
  );
}

function BudgetSummary({ budget }) {
  return (
    <dl className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-100 bg-zinc-50/80 p-3 sm:grid-cols-3 sm:gap-2 dark:border-zinc-800 dark:bg-zinc-950/70">
      <Field label="Min events">
        {display(budgetValue(budget, "min_events"))}
      </Field>

      <Field label="Max events">
        {display(budgetValue(budget, "max_events"))}
      </Field>

      <Field label="Max retained mass">
        {display(budgetValue(budget, "max_retained_mass"), "Not configured")}
      </Field>
    </dl>
  );
}

function BudgetFields({ draft, update, disabled, prefix }) {
  const fields = [
    {
      key: "min_events",
      label: "min_events",
      hint: "Minimum event capacity.",
    },
    {
      key: "max_events",
      label: "max_events",
      hint: "Maximum admitted event count.",
    },
    {
      key: "max_retained_mass",
      label: "max_retained_mass",
      hint: "Exact decimal integer, up to u128::MAX.",
      exact: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <label
          key={`${prefix}-${field.key}`}
          className={`block min-w-0 ${field.exact ? "sm:col-span-2" : ""}`}
        >
          <span className="mb-1.5 block text-sm font-medium">{field.label}</span>

          <input
            required
            disabled={disabled}
            type={field.exact ? "text" : "number"}
            inputMode="numeric"
            min={field.exact ? undefined : 0}
            step={field.exact ? undefined : 1}
            pattern={field.exact ? "[0-9]*" : undefined}
            value={draft[field.key]}
            onChange={(event) => update(field.key, event.target.value)}
            className={INPUT_CLASS}
          />

          <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            {field.hint}
          </span>
        </label>
      ))}
    </div>
  );
}

function RuntimeValue({ runtime }) {
  if (!runtime) return <>Not reported</>;

  const seconds = Number(runtime.unix_seconds);
  const nanos = Number(runtime.subsec_nanos ?? 0);

  if (
    !Number.isSafeInteger(seconds) ||
    !Number.isInteger(nanos) ||
    seconds < 0 ||
    nanos < 0 ||
    nanos >= 1_000_000_000
  ) {
    return <>Invalid runtime value</>;
  }

  return (
    <>
      {new Date(seconds * 1000).toISOString()} · {nanos} ns
    </>
  );
}

function Notice({ children, type = "error" }) {
  const styles = {
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  };

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      className={`break-words rounded-xl border px-3 py-3 text-sm leading-5 ${styles[type]}`}
    >
      {children}
    </div>
  );
}

function PayloadCard({ entry }) {
  const [open, setOpen] = useState(false);
  const objects = Array.isArray(entry.objects) ? entry.objects : [];

  return (
    <article className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold">Payload record</h4>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {entry.network.id}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DirectionPill direction={entry.direction} />
          {entry.network.registered === false && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Unregistered network
            </span>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Event record">{entry.record}</Field>
        <Field label="Depth identifier">{entry.depth_identifier}</Field>
        <Field label="Persisted payload path">{entry.path}</Field>
        <Field label="Depth objects">{entry.object_count}</Field>
        <Field label="Object mass sum">{entry.retained_object_mass} bytes</Field>
        <Field label="Network name">{entry.network.name}</Field>
      </dl>

      <button
        type="button"
        className={`${BUTTON_CLASS} mt-3 w-full justify-between`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide depth objects" : "Show depth objects"}
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {objects.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No depth objects were returned for this payload path.
            </p>
          ) : (
            objects.map((obj, index) => (
              <div
                key={`${entry.depth_identifier}-${obj?.identifier ?? index}`}
                className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950"
              >
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Position">{display(obj?.position)}</Field>
                  <Field label="Identifier">{display(obj?.identifier)}</Field>
                  <Field label="Mass">{display(obj?.mass)}</Field>
                  <Field label="From">{display(obj?.from)}</Field>
                </dl>
              </div>
            ))
          )}
        </div>
      )}
    </article>
  );
}

function DirectionSection({ title, description, entries }) {
  const [open, setOpen] = useState(true);

  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-3 text-left sm:p-4"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            {description}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium dark:bg-zinc-800">
            {entries.length}
          </span>
          <span aria-hidden="true" className="text-zinc-500">
            {open ? "−" : "+"}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800 sm:p-4">
          {entries.length === 0 ? (
            <p className="rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              No payload records for this direction were returned by the render
              API for the loaded event records.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {entries.map((entry) => (
                <PayloadCard
                  key={payloadRowKey(
                    entry.record,
                    entry.network.id,
                    entry.path,
                    entry.depth_identifier,
                  )}
                  entry={entry}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function yesNo(value) {
  return value === true ? "yes" : "no";
}

function PayloadBoardPanel({ network, board, loading, activation }) {
  const [open, setOpen] = useState(true);

  const kinds = Array.isArray(board?.kinds) ? board.kinds : [];
  const scoped = kinds.filter((k) => k.in_scope);
  const observation = board?.observation;

  // Only an explicit `true` from the API is shown as a listener/chain state.
  const listenerBound = observation?.electrum_listener_bound === true;
  const payloadCarried = observation?.settlement_payload_carried === true;

  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-3 text-left sm:p-4"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Payload board</span>
          <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            API payload model from payload.rs — PayloadKind and
            AuthorizedPayload for network {network.id} · activation{" "}
            {activation}. Listener and pipeline-chain states appear only when
            the API explicitly reports them. Depth objects are ancillary.
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              payloadCarried
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {loading ? "…" : payloadCarried ? "carried" : "not reported"}
          </span>
          <span aria-hidden="true" className="text-zinc-500">
            {open ? "−" : "+"}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800 sm:p-4">
          {board?.error && <Notice type="warning">{board.error}</Notice>}

          {!board?.error && board?.message && (
            <p className="mb-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {board.message}
            </p>
          )}

          {!board?.error && observation && (
            <dl className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Commitment">{display(board.commitment)}</Field>

              {observation.registry_running !== null && (
                <Field label="Observation registry (control plane)">
                  {observation.registry_running ? "running" : "idle"}
                </Field>
              )}

              {observation.bit_minner_feature !== null && (
                <Field label="bit-minner feature">
                  {observation.bit_minner_feature ? "enabled" : "disabled"}
                </Field>
              )}

              {listenerBound && (
                <Field label="Electrum listener">bound</Field>
              )}

              {payloadCarried && (
                <Field label="Settlement payload">carried</Field>
              )}
            </dl>
          )}

          {!board?.error && observation && !listenerBound && !payloadCarried && (
            <p className="mb-3 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              The API does not report a bound listener or a carried settlement
              payload for this context, so none is shown.
            </p>
          )}

          {loading && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Loading payload board…
            </p>
          )}

          {!loading && !board?.error && scoped.length === 0 && (
            <p className="mt-2 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              No in-scope PayloadKind entries for this network. Poll{" "}
              <span className="font-mono">
                /wallets/…/activations/{activation}/networks/{network.id}
                /payload-board
              </span>
              .
            </p>
          )}

          {!loading &&
            scoped.map((entry) => {
              const ap = entry.authorized_payload;
              const req = ap?.request ?? null;
              const auth = req?.authorization ?? null;
              const apCarried = ap?.carried === true;

              return (
                <article
                  key={entry.kind}
                  className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/70"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold capitalize">
                      PayloadKind · {entry.kind}
                    </p>
                    <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-semibold dark:bg-zinc-800">
                      {entry.available ? "network registered" : "unavailable"}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="In scope">{yesNo(entry.in_scope)}</Field>
                    <Field label="Depth record">
                      {display(entry.depth_record)}
                    </Field>
                    <Field label="Depth path">{display(entry.depth_path)}</Field>
                    <Field label="Depth objects">
                      {entry.depth_objects.length}
                    </Field>
                  </dl>

                  <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      AuthorizedPayload (API-serialized)
                    </p>

                    {!apCarried ? (
                      <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                        No AuthorizedPayload is reported as carried for this
                        kind; authorization and settlement states are not
                        shown.
                      </p>
                    ) : (
                      <dl className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Carried">yes</Field>
                        {ap.authorization_state !== null && (
                          <Field label="Authorization state">
                            {ap.authorization_state}
                          </Field>
                        )}
                        {ap.settlement_state !== null && (
                          <Field label="Settlement state">
                            {ap.settlement_state}
                          </Field>
                        )}
                        {req?.carried === true && (
                          <Field label="SettlementRequest carried">yes</Field>
                        )}
                        {req?.packet_present === true && (
                          <Field label="Wire packet present">yes</Field>
                        )}
                        {auth?.commitment != null && (
                          <Field label="Request commitment">
                            {auth.commitment}
                          </Field>
                        )}
                        {auth?.activation != null && (
                          <Field label="Request activation">
                            {auth.activation}
                          </Field>
                        )}
                        {auth?.locked_present === true && (
                          <Field label="Locked present">yes</Field>
                        )}
                      </dl>
                    )}
                  </div>
                </article>
              );
            })}
        </div>
      )}
    </section>
  );
}

function WirePacketStreamPanel({ network, stream, loading, activation }) {
  const [open, setOpen] = useState(true);

  const file = stream?.file ?? null;
  const bytes = file ? file.bytes : null;

  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-3 text-left sm:p-4"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Wirepackets file</span>
          <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Persisted file for network {network.id} · activation {activation}.
            Canonical path:{" "}
            <span className="break-all font-mono">{WIREPACKETS_CANONICAL}</span>
            . <span className="font-mono">wirepackets</span> is a single file,
            keyed by activation and commitment; the network is request context
            only.
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              stream?.exists && !stream?.error
                ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            {loading
              ? "…"
              : stream?.error
                ? "error"
                : stream?.exists
                  ? formatBytes(bytes).split(" (")[0]
                  : "no file"}
          </span>
          <span aria-hidden="true" className="text-zinc-500">
            {open ? "−" : "+"}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800 sm:p-4">
          {stream?.error && <Notice type="warning">{stream.error}</Notice>}

          {stream && !stream.error && (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Commitment">{display(stream.commitment)}</Field>
              <Field label="File present">{stream.exists ? "yes" : "no"}</Field>
              <Field label="Returned path">{display(file?.path ?? stream.path)}</Field>
              <Field label="File size">
                {stream.exists ? formatBytes(bytes) : "No file"}
              </Field>
            </dl>
          )}

          {stream && !stream.error && stream.path && !stream.canonical && (
            <div className="mt-3">
              <Notice type="warning">
                The returned path does not end with{" "}
                <span className="font-mono">
                  /activations/{activation}/event/{display(stream.commitment)}
                  /wirepackets
                </span>
                .
              </Notice>
            </div>
          )}

          {loading && (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Loading wirepackets file status…
            </p>
          )}

          {!loading && stream && !stream.error && !stream.exists && (
            <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              No wirepackets file exists at the canonical path yet. Poll{" "}
              <span className="font-mono">
                /wallets/…/activations/{activation}/networks/{network.id}
                /wirepackets
              </span>
              .
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default function EventStorePage() {
  const [substrates, setSubstrates] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [substrate, setSubstrate] = useState("");
  const [activation, setActivation] = useState("0");
  const [activationOptions, setActivationOptions] = useState(["0"]);
  const [store, setStore] = useState(null);
  const [payloads, setPayloads] = useState([]);
  // Wirepackets FILE: <substrate>/activations/<activation>/event/<commitment>/wirepackets
  const [wireStreams, setWireStreams] = useState({});
  const [loadingWire, setLoadingWire] = useState(false);
  // Payload board: API PayloadKind + AuthorizedPayload (payload.rs) — display only
  const [payloadBoards, setPayloadBoards] = useState({});
  const [loadingBoards, setLoadingBoards] = useState(false);

  const [networkBudgets, setNetworkBudgets] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingKeys, setSavingKeys] = useState({});
  const [expandedNetworks, setExpandedNetworks] = useState({});

  const [loadingList, setLoadingList] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingPayloads, setLoadingPayloads] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [budgetErrors, setBudgetErrors] = useState({});
  const [budgetNotices, setBudgetNotices] = useState({});

  const selectedSubstrateRef = useRef("");
  const selectedActivationRef = useRef("0");
  const eventRequestRef = useRef(0);
  const payloadRequestRef = useRef(0);
  const budgetRequestRef = useRef(0);
  const wireRequestRef = useRef(0);
  const boardRequestRef = useRef(0);
  const savingKeysRef = useRef({});

  const events = Array.isArray(store?.events) ? store.events : [];

  const configuredNetworkCount = networkBudgets.filter(
    (entry) => entry.configured && entry.budget,
  ).length;

  const loadNetworks = useCallback(async () => {
    const result = await apiRequest("/networks");
    const rows = Array.isArray(result.networks)
      ? result.networks.map(normalizeNetwork).filter(Boolean)
      : [];

    setNetworks(rows);
    return rows;
  }, []);

  const loadSubstrates = useCallback(async () => {
    setLoadingList(true);

    try {
      const result = await apiRequest("/wallets");
      const rows = Array.isArray(result.substrates)
        ? result.substrates.filter(
            (item) =>
              item && typeof item.name === "string" && item.name.length > 0,
          )
        : [];

      setSubstrates(rows);

      const requested = new URLSearchParams(window.location.search).get(
        "substrate",
      );

      const chosen =
        rows.find((item) => item.name === requested)?.name ??
        (rows.some((item) => item.name === selectedSubstrateRef.current)
          ? selectedSubstrateRef.current
          : (rows[0]?.name ?? ""));

      selectedSubstrateRef.current = chosen;
      setSubstrate(chosen);

      if (!rows.length) {
        setError("The API returned no available substrates.");
      }

      return chosen;
    } catch (err) {
      setSubstrates([]);
      selectedSubstrateRef.current = "";
      setSubstrate("");

      setError(
        `Unable to load substrates: ${
          err instanceof Error ? err.message : "unknown API error"
        }`,
      );

      return "";
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadPayloadsForEvents = useCallback(async (name, eventRows) => {
    if (!name || !Array.isArray(eventRows) || eventRows.length === 0) {
      // Invalidate any in-flight payload request so a late response cannot
      // repopulate the list with stale rows after we cleared it.
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
          eventRows
            .map((event) => event?.record)
            .filter(
              (record) => typeof record === "string" && record.length > 0,
            ),
        ),
      ];

      const results = await Promise.allSettled(
        records.map((record) =>
          apiRequest(
            `/wallets/${encodeURIComponent(name)}/events/${encodeURIComponent(record)}/payloads`,
          ),
        ),
      );

      if (
        requestId !== payloadRequestRef.current ||
        selectedSubstrateRef.current !== name
      ) {
        return null;
      }

      const collected = [];

      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;

        const body = result.value;
        const rows = Array.isArray(body?.payloads) ? body.payloads : [];
        const fallbackRecord = records[index];

        rows.forEach((entry) => {
          const normalized = normalizePayloadEntry(entry, fallbackRecord);
          if (normalized) collected.push(normalized);
        });
      });

      setPayloads(collected);
      return collected;
    } catch (err) {
      if (
        requestId === payloadRequestRef.current &&
        selectedSubstrateRef.current === name
      ) {
        setPayloads([]);
        setError(
          `Unable to load payload render data: ${
            err instanceof Error ? err.message : "unknown API error"
          }`,
        );
      }
      return null;
    } finally {
      if (requestId === payloadRequestRef.current) {
        setLoadingPayloads(false);
      }
    }
  }, []);

  const loadEvents = useCallback(
    async (name, options = {}) => {
      if (!name) {
        eventRequestRef.current += 1;
        payloadRequestRef.current += 1;
        setStore(null);
        setPayloads([]);
        setLoadingEvents(false);
        setLoadingPayloads(false);
        return null;
      }

      const requestId = ++eventRequestRef.current;

      if (!options.silent) {
        setLoadingEvents(true);
        setError("");
      }

      try {
        const result = await apiRequest(
          `/wallets/${encodeURIComponent(name)}/events`,
        );

        if (
          requestId !== eventRequestRef.current ||
          selectedSubstrateRef.current !== name
        ) {
          return null;
        }

        const nextEvents = Array.isArray(result.events) ? result.events : [];
        setStore({ ...result, events: nextEvents });

        const choices = new Set(["0"]);

        nextEvents.forEach((event) => {
          const value = activationFromEvent(event);
          if (value !== null) choices.add(value);
        });

        const currentSubstrate = substrates.find(
          (entry) => entry.name === name,
        );
        const reported = currentSubstrate?.activations;

        if (
          reported !== undefined &&
          reported !== null &&
          /^\d+$/.test(String(reported))
        ) {
          choices.add(String(reported));
        }

        const sorted = [...choices].sort((a, b) => {
          const x = BigInt(a);
          const y = BigInt(b);
          return x < y ? -1 : x > y ? 1 : 0;
        });

        setActivationOptions(sorted);

        const selected = choices.has(selectedActivationRef.current)
          ? selectedActivationRef.current
          : (sorted[sorted.length - 1] ?? "0");

        selectedActivationRef.current = selected;
        setActivation(selected);

        // Render API: extend each event record with network/path/depth payloads.
        await loadPayloadsForEvents(name, nextEvents);

        return result;
      } catch (err) {
        if (
          requestId === eventRequestRef.current &&
          selectedSubstrateRef.current === name
        ) {
          setStore(null);
          setPayloads([]);
          setError(
            `Unable to load events for "${name}": ${
              err instanceof Error ? err.message : "unknown API error"
            }`,
          );
        }

        return null;
      } finally {
        if (requestId === eventRequestRef.current) {
          setLoadingEvents(false);
        }
      }
    },
    [substrates, loadPayloadsForEvents],
  );

  /**
   * Wirepackets file status for listeners.
   * GET /wallets/:name/activations/:activation/networks/:network/wirepackets
   * The file lives at <substrate>/activations/<activation>/event/<commitment>/wirepackets
   * (API-owned path). Network is request context only.
   */
  const loadWirePackets = useCallback(
    async (name, activationValue, networkRows, options = {}) => {
      if (!name || !Array.isArray(networkRows) || networkRows.length === 0) {
        setWireStreams({});
        return {};
      }

      const requestId = ++wireRequestRef.current;
      if (!options.silent) setLoadingWire(true);

      try {
        const results = await Promise.allSettled(
          networkRows.map((network) =>
            apiRequest(
              `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(String(activationValue))}/networks/${encodeURIComponent(network.id)}/wirepackets`,
            ).then((body) => ({ networkId: network.id, body })),
          ),
        );

        if (
          requestId !== wireRequestRef.current ||
          selectedSubstrateRef.current !== name ||
          selectedActivationRef.current !== String(activationValue)
        ) {
          return null;
        }

        const next = {};

        results.forEach((result, index) => {
          const networkId = networkRows[index]?.id;
          if (!networkId) return;

          if (result.status === "fulfilled") {
            const body = result.value.body ?? result.value;
            next[networkId] = normalizeWireStream(
              body,
              name,
              activationValue,
              networkId,
            );
          } else {
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : "Unable to load wirepackets file status.";
            next[networkId] = {
              substrate: name,
              activation: String(activationValue),
              network: networkId,
              commitment: null,
              path: null,
              exists: false,
              file: null,
              canonical: false,
              error: message,
            };
          }
        });

        setWireStreams(next);
        return next;
      } catch (err) {
        if (err?.name === "AbortError") return null;
        if (
          requestId === wireRequestRef.current &&
          selectedSubstrateRef.current === name
        ) {
          setWireStreams({});
        }
        return null;
      } finally {
        if (requestId === wireRequestRef.current) {
          setLoadingWire(false);
        }
      }
    },
    [],
  );

  /**
   * Payload board for listeners — payload.rs model only.
   * GET /wallets/:name/activations/:activation/networks/:network/payload-board
   * Renders AuthorizedPayload / PayloadKind fields the API returns; does not
   * reconstruct SettlementRequest or authorization/settlement state.
   */
  const loadPayloadBoards = useCallback(
    async (name, activationValue, networkRows, options = {}) => {
      if (!name || !Array.isArray(networkRows) || networkRows.length === 0) {
        boardRequestRef.current += 1;
        setPayloadBoards({});
        setLoadingBoards(false);
        return {};
      }

      const requestId = ++boardRequestRef.current;
      if (!options.silent) setLoadingBoards(true);

      try {
        const results = await Promise.allSettled(
          networkRows.map((network) =>
            apiRequest(
              `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(String(activationValue))}/networks/${encodeURIComponent(network.id)}/payload-board`,
            ).then((body) => ({ networkId: network.id, body })),
          ),
        );

        if (
          requestId !== boardRequestRef.current ||
          selectedSubstrateRef.current !== name ||
          selectedActivationRef.current !== String(activationValue)
        ) {
          return null;
        }

        const next = {};

        results.forEach((result, index) => {
          const networkId = networkRows[index]?.id;
          if (!networkId) return;

          if (result.status === "fulfilled") {
            const body = result.value.body ?? result.value;
            next[networkId] = normalizePayloadBoard(
              body,
              name,
              activationValue,
              networkId,
            );
          } else {
            const message =
              result.reason instanceof Error
                ? result.reason.message
                : "Unable to load payload board.";
            next[networkId] = {
              substrate: name,
              activation: String(activationValue),
              network: networkId,
              commitment: null,
              message: null,
              observation: null,
              kinds: [],
              error: message,
            };
          }
        });

        setPayloadBoards(next);
        return next;
      } catch (err) {
        if (err?.name === "AbortError") return null;
        if (
          requestId === boardRequestRef.current &&
          selectedSubstrateRef.current === name
        ) {
          setPayloadBoards({});
        }
        return null;
      } finally {
        if (requestId === boardRequestRef.current) {
          setLoadingBoards(false);
        }
      }
    },
    [],
  );

  const loadNetworkBudgets = useCallback(
    async (name, activationValue, options = {}) => {
      if (!name || !/^\d+$/.test(String(activationValue))) {
        setNetworkBudgets([]);
        return null;
      }

      const requestId = ++budgetRequestRef.current;

      if (!options.silent) setLoadingBudgets(true);

      try {
        const result = await apiRequest(
          `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activationValue)}/budgets`,
        );

        if (
          requestId !== budgetRequestRef.current ||
          selectedSubstrateRef.current !== name ||
          selectedActivationRef.current !== String(activationValue)
        ) {
          return null;
        }

        const rows = normalizeNetworkBudgets(result, activationValue);
        setNetworkBudgets(rows);

        setDrafts((current) => {
          const next = { ...current };

          rows.forEach((entry) => {
            const key = networkKey(name, String(activationValue), entry.network.id);

            if (!savingKeysRef.current[key]) {
              next[key] = draftFromBudget(
                entry.configured ? entry.budget : null,
              );
            }
          });

          return next;
        });

        return result;
      } catch (err) {
        if (requestId === budgetRequestRef.current) {
          setNetworkBudgets([]);
          setError(
            `Unable to load network budgets: ${
              err instanceof Error ? err.message : "unknown API error"
            }`,
          );
        }

        return null;
      } finally {
        if (requestId === budgetRequestRef.current) {
          setLoadingBudgets(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([loadNetworks(), loadSubstrates()]).then((results) => {
      if (cancelled) return;

      if (results[0].status === "rejected") {
        setError(
          "Unable to load registered networks. Check GET /networks on qtm-api.",
        );
      }

      if (results[1].status === "rejected") {
        setError("Unable to initialize the event store.");
      }
    });

    return () => {
      cancelled = true;
      eventRequestRef.current += 1;
      payloadRequestRef.current += 1;
      budgetRequestRef.current += 1;
      wireRequestRef.current += 1;
      boardRequestRef.current += 1;
    };
  }, [loadNetworks, loadSubstrates]);

  useEffect(() => {
    if (!substrate) {
      setStore(null);
      setPayloads([]);
      setNetworkBudgets([]);
      setWireStreams({});
      setPayloadBoards({});
      return;
    }

    selectedSubstrateRef.current = substrate;
    loadEvents(substrate);
  }, [substrate, loadEvents]);

  useEffect(() => {
    if (!substrate || !/^\d+$/.test(String(activation))) {
      setNetworkBudgets([]);
      return;
    }

    selectedActivationRef.current = activation;
    loadNetworkBudgets(substrate, activation);
  }, [substrate, activation, loadNetworkBudgets]);

  // Keep wirepackets file status and payload boards aligned with selection.
  // Wire path: <substrate>/activations/<activation>/event/<commitment>/wirepackets
  // Network is request context only (API resolves the substrate commitment).
  useEffect(() => {
    if (!substrate || !networks.length || !/^\d+$/.test(String(activation))) {
      setWireStreams({});
      setPayloadBoards({});
      return;
    }

    loadWirePackets(substrate, activation, networks);
    loadPayloadBoards(substrate, activation, networks);
  }, [substrate, activation, networks, loadWirePackets, loadPayloadBoards]);

  // Stable poll interval: depend only on selection identity, not loading flags.
  // In-flight work is guarded by request-id refs; silent mode avoids flicker.
  useEffect(() => {
    if (!substrate) return undefined;

    const timer = window.setInterval(() => {
      loadEvents(substrate, { silent: true });
      if (networks.length && /^\d+$/.test(String(activation))) {
        loadWirePackets(substrate, activation, networks, { silent: true });
        loadPayloadBoards(substrate, activation, networks, { silent: true });
      }
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [
    substrate,
    activation,
    networks,
    loadEvents,
    loadWirePackets,
    loadPayloadBoards,
  ]);

  function chooseSubstrate(name) {
    selectedSubstrateRef.current = name;
    selectedActivationRef.current = "0";

    eventRequestRef.current += 1;
    payloadRequestRef.current += 1;
    budgetRequestRef.current += 1;
    wireRequestRef.current += 1;
    boardRequestRef.current += 1;

    setSubstrate(name);
    setActivation("0");
    setActivationOptions(["0"]);
    setStore(null);
    setPayloads([]);
    setNetworkBudgets([]);
    setDrafts({});
    setExpandedNetworks({});
    setWireStreams({});
    setPayloadBoards({});
    setError("");
    setNotice("");
    setBudgetErrors({});
    setBudgetNotices({});
  }

  function chooseActivation(value) {
    if (!/^\d+$/.test(String(value))) return;

    selectedActivationRef.current = String(value);
    budgetRequestRef.current += 1;
    wireRequestRef.current += 1;
    boardRequestRef.current += 1;

    setActivation(String(value));
    setNetworkBudgets([]);
    setWireStreams({});
    setPayloadBoards({});
    setError("");
    setNotice("");
    setBudgetErrors({});
    setBudgetNotices({});
  }

  function updateDraft(key, field, value) {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? emptyDraft()),
        [field]: value,
      },
    }));

    setBudgetErrors((current) => ({ ...current, [key]: "" }));
    setBudgetNotices((current) => ({ ...current, [key]: "" }));
  }

  function validateBudget(draft) {
    const minEvents = parseSafeInteger(draft.min_events, "min_events");
    const maxEvents = parseSafeInteger(draft.max_events, "max_events");
    const maxRetainedMass = parseU128(
      draft.max_retained_mass,
      "max_retained_mass",
    );

    if (maxEvents < 1) {
      throw new Error("max_events must be at least 1.");
    }

    if (minEvents > maxEvents) {
      throw new Error("min_events cannot exceed max_events.");
    }

    if (BigInt(maxRetainedMass) < 1n) {
      throw new Error("max_retained_mass must be at least 1 byte.");
    }

    return { minEvents, maxEvents, maxRetainedMass };
  }

  function requestBody(payload) {
    return `{"min_events":${payload.minEvents},"max_events":${payload.maxEvents},"max_retained_mass":${payload.maxRetainedMass}}`;
  }

  async function saveNetworkBudget(event, network) {
    event.preventDefault();

    if (!substrate) {
      setError("Select a substrate before saving a budget.");
      return;
    }

    // Pin the selection this save belongs to; the user may switch while the
    // request is in flight.
    const savedSubstrate = substrate;
    const savedActivation = String(activation);
    const key = networkKey(savedSubstrate, savedActivation, network.id);
    let payload;

    try {
      payload = validateBudget(drafts[key] ?? emptyDraft());
    } catch (err) {
      setBudgetErrors((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Invalid budget.",
      }));
      return;
    }

    savingKeysRef.current = { ...savingKeysRef.current, [key]: true };
    setSavingKeys((current) => ({ ...current, [key]: true }));
    setBudgetErrors((current) => ({ ...current, [key]: "" }));
    setBudgetNotices((current) => ({ ...current, [key]: "" }));

    try {
      const result = await apiRequest(
        `/wallets/${encodeURIComponent(savedSubstrate)}/activations/${encodeURIComponent(savedActivation)}/budgets/${encodeURIComponent(network.id)}`,
        {
          method: "PUT",
          body: requestBody(payload),
        },
      );

      // The response must describe exactly the activation + network we saved.
      if (
        (result?.activation !== undefined &&
          result?.activation !== null &&
          String(result.activation) !== savedActivation) ||
        (result?.network?.id !== undefined && result.network.id !== network.id)
      ) {
        throw new Error(
          "The API response did not match the activation and network that were saved.",
        );
      }

      const saved = result.budget ?? {
        min_events: payload.minEvents,
        max_events: payload.maxEvents,
        max_retained_mass: payload.maxRetainedMass,
      };

      const stillSelected =
        selectedSubstrateRef.current === savedSubstrate &&
        selectedActivationRef.current === savedActivation;

      if (stillSelected) {
        setNetworkBudgets((current) =>
          current.map((row) =>
            row.network.id === network.id
              ? { ...row, configured: true, budget: saved }
              : row,
          ),
        );
      }

      setDrafts((current) => ({ ...current, [key]: draftFromBudget(saved) }));

      setBudgetNotices((current) => ({
        ...current,
        [key]: `Saved for ${network.id} · activation ${savedActivation}.`,
      }));
    } catch (err) {
      setBudgetErrors((current) => ({
        ...current,
        [key]:
          err instanceof Error
            ? err.message
            : "Unable to save this network budget.",
      }));
    } finally {
      const { [key]: _done, ...remaining } = savingKeysRef.current;
      savingKeysRef.current = remaining;
      setSavingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function refreshAll() {
    if (!substrate) return;

    setError("");
    setNotice("");

    const result = await loadEvents(substrate);

    if (result) {
      const act = selectedActivationRef.current;
      await loadNetworkBudgets(substrate, act);

      let networkList = networks;
      if (!networkList.length) {
        try {
          networkList = await loadNetworks();
        } catch {
          networkList = [];
        }
      }

      await loadWirePackets(substrate, act, networkList);
      await loadPayloadBoards(substrate, act, networkList);
      setNotice(
        "Event snapshot, payload render, budgets, wirepackets file status, and payload boards refreshed.",
      );
    }
  }

  const activationEvents = useMemo(
    () =>
      events.filter(
        (event) => activationFromEvent(event) === String(activation),
      ),
    [events, activation],
  );

  const activationRetainedMass = useMemo(
    () => totalRetainedMass(activationEvents).toString(),
    [activationEvents],
  );

  const networkBudgetById = useMemo(
    () => new Map(networkBudgets.map((row) => [row?.network?.id, row])),
    [networkBudgets],
  );

  const renderedNetworks = useMemo(() => {
    const byId = new Map();

    networks.forEach((network) => {
      if (!byId.has(network.id)) byId.set(network.id, network);
    });

    networkBudgets.forEach((row) => {
      const network = normalizeNetwork(row.network);
      if (network && !byId.has(network.id)) byId.set(network.id, network);
    });

    // Networks discovered only via payload render (beyond registered list).
    payloads.forEach((entry) => {
      if (!byId.has(entry.network.id)) {
        byId.set(entry.network.id, entry.network);
      }
    });

    return [...byId.values()];
  }, [networks, networkBudgets, payloads]);

  const payloadGroups = useMemo(() => {
    const groups = new Map();

    payloads.forEach((entry) => {
      const id = entry.network.id;

      if (!groups.has(id)) {
        groups.set(id, {
          network: entry.network,
          transit_inputs: [],
          exile_outputs: [],
          unclassified: [],
        });
      }

      const group = groups.get(id);
      const direction = entry.direction;

      if (direction === PAYLOAD_DIRECTIONS.transit_inputs) {
        group.transit_inputs.push(entry);
      } else if (direction === PAYLOAD_DIRECTIONS.exile_outputs) {
        group.exile_outputs.push(entry);
      } else {
        group.unclassified.push(entry);
      }
    });

    return groups;
  }, [payloads]);

  // The wirepackets file is keyed by activation + commitment, so every network
  // request returns the same file. Count each distinct path once.
  const wireFile = useMemo(() => {
    const seen = new Map();

    Object.values(wireStreams).forEach((stream) => {
      if (!stream || stream.error || !stream.exists || !stream.file) return;
      if (!seen.has(stream.file.path)) seen.set(stream.file.path, stream.file);
    });

    const files = [...seen.values()];
    const known = files.filter((file) => file.bytes !== null);

    return {
      count: files.length,
      bytes: known.reduce((sum, file) => sum + file.bytes, 0),
      complete: known.length === files.length,
    };
  }, [wireStreams]);

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-3 py-4 text-zinc-950 sm:px-5 sm:py-6 lg:px-8 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 sm:gap-5">
        <header className="flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/70">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-500 sm:text-xs dark:text-zinc-400">
              QuantPerm · QTM · Persistent substrate host
            </p>

            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Event Store
            </h1>

            <p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500 sm:text-sm sm:leading-6 dark:text-zinc-400">
              The substrate is the host. Event records use the payloads API;
              settlement payload shape follows payload.rs (PayloadKind,
              AuthorizedPayload). The wirepackets file lives at{" "}
              <span className="break-all font-mono">
                {WIREPACKETS_CANONICAL}
              </span>
              . Depth objects remain ancillary display only.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a href="/" className={BUTTON_CLASS}>
              Back to QTM
            </a>
            <a href="/network" className={BUTTON_CLASS}>
              Network
            </a>
          </div>
        </header>

        <Panel
          title="Substrate host"
          description="Choose the persistent substrate and activation. Payloads are loaded per event record from the render API. Wirepackets file status, payload boards, and budgets are polled for the selected activation."
          action={
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={
                !substrate ||
                loadingEvents ||
                loadingBudgets ||
                loadingPayloads ||
                loadingWire ||
                loadingBoards
              }
              onClick={refreshAll}
            >
              {loadingEvents ||
              loadingBudgets ||
              loadingPayloads ||
              loadingWire ||
              loadingBoards
                ? "Refreshing…"
                : "Refresh"}
            </button>
          }
        >
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium">
                Persistent substrate
              </span>

              <select
                className={INPUT_CLASS}
                value={substrate}
                disabled={loadingList || !substrates.length}
                onChange={(event) => chooseSubstrate(event.target.value)}
              >
                <option value="">
                  {loadingList ? "Loading substrates…" : "Select substrate"}
                </option>

                {substrates.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium">
                Activation
              </span>

              <select
                className={INPUT_CLASS}
                value={activation}
                disabled={!substrate}
                onChange={(event) => chooseActivation(event.target.value)}
              >
                {activationOptions.map((value) => (
                  <option key={value} value={value}>
                    Activation {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-4 dark:border-zinc-800">
            <Field label="Substrate host">
              {display(store?.substrate ?? substrate)}
            </Field>
            <Field label="Selected activation">{activation}</Field>
            <Field label="Persisted events">{events.length}</Field>
            <Field label="Rendered payloads">{payloads.length}</Field>
          </dl>

          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-4 dark:border-zinc-800">
            <Field label="Configured network budgets">
              {configuredNetworkCount} / {renderedNetworks.length}
            </Field>
            <Field label="Known networks">{renderedNetworks.length}</Field>
            <Field label="Wirepackets file size">
              {loadingWire
                ? "Loading"
                : wireFile.count === 0
                  ? "No file"
                  : wireFile.complete
                    ? formatBytes(wireFile.bytes)
                    : "Not reported"}
            </Field>
            <Field label="Wirepackets status">
              {loadingWire
                ? "Loading"
                : Object.keys(wireStreams).length
                  ? wireFile.count > 0
                    ? "File present"
                    : "No file"
                  : "Not loaded"}
            </Field>
          </dl>

          {store && (
            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800">
              <Field label="Substrate directory">
                {display(store.directory)}
              </Field>
              <Field label="Events directory">
                {display(store.events_directory)}
              </Field>
            </dl>
          )}
        </Panel>

        {error && <Notice>{error}</Notice>}
        {notice && <Notice type="success">{notice}</Notice>}

        <Panel
          title={`Network hierarchy · activation ${activation}`}
          description="Each network identifier is a container under the substrate host. Budgets, payload boards, and depth payloads are scoped to the selected activation and network. The wirepackets file is keyed by activation · commitment. transit_inputs and exile_outputs come from the API direction enum on each rendered payload."
          action={
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {renderedNetworks.length} networks
            </span>
          }
        >
          {loadingPayloads && (
            <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              Rendering payload records for each event…
            </p>
          )}

          {renderedNetworks.length === 0 && !loadingBudgets ? (
            <p className="mt-4 rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No registered networks or rendered payload networks were
              returned.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {renderedNetworks.map((network) => {
                const networkEntry = networkBudgetById.get(network.id);
                const budget = networkEntry?.budget ?? null;
                const configured = Boolean(networkEntry?.configured && budget);

                const key = networkKey(substrate, activation, network.id);
                const draft = drafts[key] ?? draftFromBudget(budget);
                const saving = Boolean(savingKeys[key]);
                const expanded = Boolean(expandedNetworks[key]);

                const group = payloadGroups.get(network.id) ?? {
                  transit_inputs: [],
                  exile_outputs: [],
                  unclassified: [],
                };

                return (
                  <section
                    key={network.id}
                    className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
                            Network identifier
                          </p>

                          <h3 className="mt-1 break-words text-base font-semibold tracking-tight">
                            {network.name}
                          </h3>

                          <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            {network.id}
                          </p>
                        </div>

                        <StatusPill configured={configured} />
                      </div>

                      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Field label="Coin">{display(network.coin)}</Field>
                        <Field label="Purpose">{display(network.purpose)}</Field>
                        <Field label="Derivation path">
                          {display(network.path)}
                        </Field>
                        <Field label="Payload records">
                          {group.transit_inputs.length +
                            group.exile_outputs.length +
                            group.unclassified.length}
                        </Field>
                      </dl>

                      <div className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/70">
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Network budget · activation {activation}
                        </p>

                        <BudgetSummary budget={budget} />

                        <button
                          type="button"
                          className={`${BUTTON_CLASS} mt-3 w-full justify-between`}
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedNetworks((current) => ({
                              ...current,
                              [key]: !current[key],
                            }))
                          }
                        >
                          {expanded
                            ? "Close network budget editor"
                            : "Edit network budget"}
                          <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                        </button>

                        {expanded && (
                          <form
                            className="mt-4 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800"
                            onSubmit={(event) =>
                              saveNetworkBudget(event, network)
                            }
                          >
                            <BudgetFields
                              prefix={key}
                              draft={draft}
                              disabled={saving}
                              update={(field, value) =>
                                updateDraft(key, field, value)
                              }
                            />

                            {budgetErrors[key] && (
                              <Notice>{budgetErrors[key]}</Notice>
                            )}

                            {budgetNotices[key] && (
                              <Notice type="success">
                                {budgetNotices[key]}
                              </Notice>
                            )}

                            <button
                              type="submit"
                              className={`${BUTTON_CLASS} w-full bg-zinc-950 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950`}
                              disabled={!substrate || saving || loadingBudgets}
                            >
                              {saving ? "Saving…" : "Save network budget"}
                            </button>
                          </form>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
                      <PayloadBoardPanel
                        network={network}
                        board={payloadBoards[network.id]}
                        loading={loadingBoards}
                        activation={activation}
                      />

                      <WirePacketStreamPanel
                        network={network}
                        stream={wireStreams[network.id]}
                        loading={loadingWire}
                        activation={activation}
                      />

                      <DirectionSection
                        title="transit_inputs"
                        description="Payloads rendered from event_* records for this network."
                        entries={group.transit_inputs}
                      />

                      <DirectionSection
                        title="exile_outputs"
                        description="Payloads rendered from exile records for this network."
                        entries={group.exile_outputs}
                      />

                      {group.unclassified.length > 0 && (
                        <DirectionSection
                          title="Unclassified persisted payloads"
                          description="Returned records without a recognized direction enum value."
                          entries={group.unclassified}
                        />
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {loadingBudgets && (
            <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              Loading activation-scoped network budgets…
            </p>
          )}
        </Panel>

        <Panel
          title="Activation utilization"
          description="Aggregate measurements from the event snapshot for the selected activation on this substrate host."
        >
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <Field label="Events in selected activation">
                {activationEvents.length} events
              </Field>
            </div>

            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <Field label="Retained mass in selected activation">
                {activationRetainedMass} bytes
              </Field>
            </div>

            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <Field label="Events in substrate">{events.length} events</Field>
            </div>
          </div>
        </Panel>

        <Panel
          title="Persisted event diagnostics"
          description="Event records returned by the selected substrate host."
          action={
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {events.length} record{events.length === 1 ? "" : "s"}
            </span>
          }
          className="p-0"
        >
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 text-[10px] uppercase tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  {[
                    "Activation",
                    "Event type",
                    "Record reference",
                    "Dimension",
                    "Structural value (Σ)",
                    "Depth objects",
                    "Retained mass",
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-3 font-semibold"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {events.map((event, index) => {
                  const state = event?.heritage?.state;
                  const kind = display(event.kind, "event");
                  const eventActivation =
                    event.activation ?? state?.activation_count;
                  const dimension = event.dimension ?? state?.dimension;
                  const structuralValue =
                    event.structural_value ?? state?.structural_value;

                  return (
                    <tr
                      key={`${kind}-${display(eventActivation)}-${display(dimension)}-${index}`}
                      className="align-top transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono">
                        {display(eventActivation)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold dark:bg-zinc-800">
                          {kind}
                        </span>
                      </td>
                      <td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {display(event.record)}
                      </td>
                      <td className="break-all px-4 py-3 font-mono">
                        {display(dimension)}
                      </td>
                      <td className="break-all px-4 py-3 font-mono">
                        {display(structuralValue)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {display(event.depth_objects)}
                      </td>
                      <td className="break-all px-4 py-3 font-mono">
                        {display(retainedMass(event))}
                      </td>
                    </tr>
                  );
                })}

                {events.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      {loadingEvents
                        ? "Loading persisted events…"
                        : store
                          ? "No persisted transit or exile records were returned for this substrate."
                          : "Select a substrate to inspect persisted records."}
                    </td>
                  </tr>
                )}
              </tbody>

              {store && (
                <tfoot className="border-t-2 border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950">
                  <tr>
                    <th
                      scope="row"
                      colSpan={7}
                      className="px-4 py-3 text-left font-medium"
                    >
                      <span className="block text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Runtime · API snapshot
                      </span>
                      <span className="mt-1 block break-all font-mono text-sm">
                        <RuntimeValue runtime={store.runtime} />
                      </span>
                    </th>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Panel>

        <footer className="border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
          QTM Event Store · Substrate host · Wirepackets file · Payload
          board (payload.rs) · Direction enum · Network-scoped depth ·
          Activation budgets · {API_BASE}
        </footer>
      </div>
    </main>
  );
}
