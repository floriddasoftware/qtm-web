"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";
const REFRESH_INTERVAL = 5000;
const U128_MAX = "340282366920938463463374607431768211455";

const INPUT_CLASS =
  "h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/10 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950";

const BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

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
      body?.error ||
      body?.message ||
      body?.detail ||
      body?.response_text;

    throw new Error(
      detail ? String(detail) : `Request failed with HTTP ${response.status}.`
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
      budgetValue(budget, "max_retained_mass") ?? "1048576"
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
  };
}

function normalizeNetworkBudgets(result) {
  return Array.isArray(result?.budgets)
    ? result.budgets
        .map((row) => {
          const network = normalizeNetwork(row?.network);
          return network ? { ...row, network } : null;
        })
        .filter(Boolean)
    : [];
}

/*
 * Payload identity is the full tuple:
 * activation + network ID + persisted path + depth identifier.
 *
 * Direction is taken from returned metadata or the actual persisted path.
 * Unknown records are not silently relabelled as transit or exile.
 */
function classifyPayload(entry) {
  const metadata = [
    entry?.direction,
    entry?.kind,
    entry?.event_type,
    entry?.record_type,
    entry?.source,
    entry?.category,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  const path = String(
    entry?.path ?? entry?.payload_path ?? entry?.record ?? ""
  ).toLowerCase();

  const combined = `${metadata} ${path}`;

  if (
    /exile_outputs|exile[-_/ ]?output|exile/.test(combined)
  ) {
    return "exile_outputs";
  }

  if (
    /transit_inputs|transit[-_/ ]?input|event_\d|transit/.test(combined)
  ) {
    return "transit_inputs";
  }

  return "unclassified";
}

function normalizePayloadBudgets(result) {
  const rows = Array.isArray(result?.payload_budgets)
    ? result.payload_budgets
    : Array.isArray(result?.payloads)
      ? result.payloads
      : [];

  return rows
    .map((entry) => {
      const network = normalizeNetwork(entry?.network);
      const path = entry?.path ?? entry?.payload_path;
      const depth =
        entry?.depth_identifier ??
        entry?.depthIdentifier ??
        entry?.depth_id;

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

      return {
        ...entry,
        network,
        path,
        depth_identifier: String(depth),
        direction: classifyPayload({ ...entry, path }),
        configured: Boolean(entry.configured && entry.budget),
        budget: entry.budget ?? null,
      };
    })
    .filter(Boolean);
}

function networkKey(activation, networkId) {
  return `network:${activation}:${networkId}`;
}

function payloadKey(activation, networkId, path, depth) {
  return JSON.stringify([
    "payload",
    String(activation),
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
        {display(
          budgetValue(budget, "max_retained_mass"),
          "Not configured"
        )}
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
          <span className="mb-1.5 block text-sm font-medium">
            {field.label}
          </span>

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

function PayloadCard({
  entry,
  activation,
  store,
  drafts,
  savingKeys,
  expandedPayloads,
  budgetErrors,
  budgetNotices,
  loadingPayloadBudgets,
  updateDraft,
  savePayloadBudget,
  setExpandedPayloads,
}) {
  const key = payloadKey(
    activation,
    entry.network.id,
    entry.path,
    entry.depth_identifier
  );

  const configured = Boolean(entry.configured && entry.budget);
  const draft = drafts[key] ?? draftFromBudget(entry.budget);
  const saving = Boolean(savingKeys[key]);
  const expanded = Boolean(expandedPayloads[key]);

  return (
    <article className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold">Payload record</h4>
          <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {entry.network.id}
          </p>
        </div>

        <StatusPill configured={configured} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3">
        <Field label="Persisted payload path">{entry.path}</Field>
        <Field label="Depth identifier">{entry.depth_identifier}</Field>
        <Field label="Activation">{activation}</Field>
      </dl>

      <BudgetSummary budget={entry.budget} />

      <button
        type="button"
        className={`${BUTTON_CLASS} mt-3 w-full justify-between`}
        aria-expanded={expanded}
        onClick={() =>
          setExpandedPayloads((current) => ({
            ...current,
            [key]: !current[key],
          }))
        }
      >
        {expanded ? "Close payload editor" : "Edit payload budget"}
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <form
          className="mt-4 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800"
          onSubmit={(event) => savePayloadBudget(event, entry)}
        >
          <BudgetFields
            prefix={key}
            draft={draft}
            disabled={saving}
            update={(field, value) => updateDraft(key, field, value)}
          />

          {budgetErrors[key] && (
            <Notice>{budgetErrors[key]}</Notice>
          )}

          {budgetNotices[key] && (
            <Notice type="success">{budgetNotices[key]}</Notice>
          )}

          <button
            type="submit"
            className={`${BUTTON_CLASS} w-full bg-zinc-950 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950`}
            disabled={!store?.substrate || saving || loadingPayloadBudgets}
          >
            {saving ? "Saving…" : "Save payload budget"}
          </button>

          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Scoped to activation, network ID, actual payload path, and depth
            identifier.
          </p>
        </form>
      )}
    </article>
  );
}

function DirectionSection({
  title,
  description,
  entries,
  activation,
  store,
  drafts,
  savingKeys,
  expandedPayloads,
  budgetErrors,
  budgetNotices,
  loadingPayloadBudgets,
  updateDraft,
  savePayloadBudget,
  setExpandedPayloads,
}) {
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
              No payload budget records for this direction were returned by
              the API. This does not prove that the server-side directory is
              empty.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {entries.map((entry) => (
                <PayloadCard
                  key={payloadKey(
                    activation,
                    entry.network.id,
                    entry.path,
                    entry.depth_identifier
                  )}
                  entry={entry}
                  activation={activation}
                  store={store}
                  drafts={drafts}
                  savingKeys={savingKeys}
                  expandedPayloads={expandedPayloads}
                  budgetErrors={budgetErrors}
                  budgetNotices={budgetNotices}
                  loadingPayloadBudgets={loadingPayloadBudgets}
                  updateDraft={updateDraft}
                  savePayloadBudget={savePayloadBudget}
                  setExpandedPayloads={setExpandedPayloads}
                />
              ))}
            </div>
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

  const [networkBudgets, setNetworkBudgets] = useState([]);
  const [payloadBudgets, setPayloadBudgets] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingKeys, setSavingKeys] = useState({});
  const [expandedNetworks, setExpandedNetworks] = useState({});
  const [expandedPayloads, setExpandedPayloads] = useState({});

  const [loadingList, setLoadingList] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [loadingPayloadBudgets, setLoadingPayloadBudgets] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [budgetErrors, setBudgetErrors] = useState({});
  const [budgetNotices, setBudgetNotices] = useState({});

  const selectedSubstrateRef = useRef("");
  const selectedActivationRef = useRef("0");
  const eventRequestRef = useRef(0);
  const budgetRequestRef = useRef(0);
  const payloadRequestRef = useRef(0);

  const events = Array.isArray(store?.events) ? store.events : [];

  const configuredNetworkCount = networkBudgets.filter(
    (entry) => entry.configured && entry.budget
  ).length;

  const configuredPayloadCount = payloadBudgets.filter(
    (entry) => entry.configured && entry.budget
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
              item &&
              typeof item.name === "string" &&
              item.name.length > 0
          )
        : [];

      setSubstrates(rows);

      const requested = new URLSearchParams(window.location.search).get(
        "substrate"
      );

      const chosen =
        rows.find((item) => item.name === requested)?.name ??
        (rows.some((item) => item.name === selectedSubstrateRef.current)
          ? selectedSubstrateRef.current
          : rows[0]?.name ?? "");

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
        }`
      );

      return "";
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadEvents = useCallback(async (name, options = {}) => {
    if (!name) {
      setStore(null);
      return null;
    }

    const requestId = ++eventRequestRef.current;

    if (!options.silent) {
      setLoadingEvents(true);
      setError("");
    }

    try {
      const result = await apiRequest(
        `/wallets/${encodeURIComponent(name)}/events`
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
        (entry) => entry.name === name
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
        : sorted[sorted.length - 1] ?? "0";

      selectedActivationRef.current = selected;
      setActivation(selected);

      return result;
    } catch (err) {
      if (
        requestId === eventRequestRef.current &&
        selectedSubstrateRef.current === name
      ) {
        setStore(null);
        setError(
          `Unable to load events for "${name}": ${
            err instanceof Error ? err.message : "unknown API error"
          }`
        );
      }

      return null;
    } finally {
      if (requestId === eventRequestRef.current) {
        setLoadingEvents(false);
      }
    }
  }, [substrates]);

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
          `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activationValue)}/budgets`
        );

        if (
          requestId !== budgetRequestRef.current ||
          selectedSubstrateRef.current !== name ||
          selectedActivationRef.current !== String(activationValue)
        ) {
          return null;
        }

        const rows = normalizeNetworkBudgets(result);
        setNetworkBudgets(rows);

        setDrafts((current) => {
          const next = { ...current };

          rows.forEach((entry) => {
            const key = networkKey(activationValue, entry.network.id);

            if (!savingKeys[key]) {
              next[key] = draftFromBudget(
                entry.configured ? entry.budget : null
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
            }`
          );
        }

        return null;
      } finally {
        if (requestId === budgetRequestRef.current) {
          setLoadingBudgets(false);
        }
      }
    },
    [savingKeys]
  );

  const loadPayloadBudgets = useCallback(
    async (name, activationValue, options = {}) => {
      if (!name || !/^\d+$/.test(String(activationValue))) {
        setPayloadBudgets([]);
        return null;
      }

      const requestId = ++payloadRequestRef.current;

      if (!options.silent) setLoadingPayloadBudgets(true);

      try {
        const result = await apiRequest(
          `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activationValue)}/payload-budgets`
        );

        if (
          requestId !== payloadRequestRef.current ||
          selectedSubstrateRef.current !== name ||
          selectedActivationRef.current !== String(activationValue)
        ) {
          return null;
        }

        const rows = normalizePayloadBudgets(result);
        setPayloadBudgets(rows);

        setDrafts((current) => {
          const next = { ...current };

          rows.forEach((entry) => {
            const key = payloadKey(
              activationValue,
              entry.network.id,
              entry.path,
              entry.depth_identifier
            );

            if (!savingKeys[key]) {
              next[key] = draftFromBudget(
                entry.configured ? entry.budget : null
              );
            }
          });

          return next;
        });

        setBudgetErrors((current) => ({
          ...current,
          payloadLoad: "",
        }));

        return result;
      } catch (err) {
        if (requestId === payloadRequestRef.current) {
          setPayloadBudgets([]);
          setBudgetErrors((current) => ({
            ...current,
            payloadLoad: `Unable to load payload budgets: ${
              err instanceof Error ? err.message : "unknown API error"
            }`,
          }));
        }

        return null;
      } finally {
        if (requestId === payloadRequestRef.current) {
          setLoadingPayloadBudgets(false);
        }
      }
    },
    [savingKeys]
  );

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([loadNetworks(), loadSubstrates()]).then((results) => {
      if (cancelled) return;

      if (results[0].status === "rejected") {
        setError(
          "Unable to load registered networks. Check GET /networks on qtm-api."
        );
      }

      if (results[1].status === "rejected") {
        setError("Unable to initialize the event store.");
      }
    });

    return () => {
      cancelled = true;
      eventRequestRef.current += 1;
      budgetRequestRef.current += 1;
      payloadRequestRef.current += 1;
    };
  }, [loadNetworks, loadSubstrates]);

  useEffect(() => {
    if (!substrate) {
      setStore(null);
      setNetworkBudgets([]);
      setPayloadBudgets([]);
      return;
    }

    selectedSubstrateRef.current = substrate;
    loadEvents(substrate);
  }, [substrate, loadEvents]);

  useEffect(() => {
    if (!substrate || !/^\d+$/.test(String(activation))) {
      setNetworkBudgets([]);
      setPayloadBudgets([]);
      return;
    }

    selectedActivationRef.current = activation;

    loadNetworkBudgets(substrate, activation);
    loadPayloadBudgets(substrate, activation);
  }, [substrate, activation, loadNetworkBudgets, loadPayloadBudgets]);

  useEffect(() => {
    if (!substrate) return undefined;

    const timer = window.setInterval(() => {
      if (!loadingEvents) {
        loadEvents(substrate, { silent: true });
      }
    }, REFRESH_INTERVAL);

    return () => window.clearInterval(timer);
  }, [substrate, loadingEvents, loadEvents]);

  function chooseSubstrate(name) {
    selectedSubstrateRef.current = name;
    selectedActivationRef.current = "0";

    eventRequestRef.current += 1;
    budgetRequestRef.current += 1;
    payloadRequestRef.current += 1;

    setSubstrate(name);
    setActivation("0");
    setActivationOptions(["0"]);
    setStore(null);
    setNetworkBudgets([]);
    setPayloadBudgets([]);
    setError("");
    setNotice("");
    setBudgetErrors({});
    setBudgetNotices({});
  }

  function chooseActivation(value) {
    if (!/^\d+$/.test(String(value))) return;

    selectedActivationRef.current = String(value);

    budgetRequestRef.current += 1;
    payloadRequestRef.current += 1;

    setActivation(String(value));
    setNetworkBudgets([]);
    setPayloadBudgets([]);
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
      "max_retained_mass"
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
    // Keep u128 values as decimal integers in JSON, never convert them to Number.
    return `{"min_events":${payload.minEvents},"max_events":${payload.maxEvents},"max_retained_mass":${payload.maxRetainedMass}}`;
  }

  async function saveNetworkBudget(event, network) {
    event.preventDefault();

    if (!substrate) {
      setError("Select a substrate before saving a budget.");
      return;
    }

    const key = networkKey(activation, network.id);
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

    setSavingKeys((current) => ({ ...current, [key]: true }));
    setBudgetErrors((current) => ({ ...current, [key]: "" }));
    setBudgetNotices((current) => ({ ...current, [key]: "" }));

    try {
      const result = await apiRequest(
        `/wallets/${encodeURIComponent(substrate)}/activations/${encodeURIComponent(activation)}/budgets/${encodeURIComponent(network.id)}`,
        {
          method: "PUT",
          body: requestBody(payload),
        }
      );

      setNetworkBudgets((current) =>
        current.map((row) =>
          row.network.id === network.id
            ? {
                ...row,
                configured: true,
                budget:
                  result.budget ?? {
                    min_events: payload.minEvents,
                    max_events: payload.maxEvents,
                    max_retained_mass: payload.maxRetainedMass,
                  },
              }
            : row
        )
      );

      setBudgetNotices((current) => ({
        ...current,
        [key]: `Saved for ${network.id} · activation ${activation}.`,
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
      setSavingKeys((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function savePayloadBudget(event, entry) {
    event.preventDefault();

    if (!substrate) {
      setError("Select a substrate before saving a payload budget.");
      return;
    }

    const key = payloadKey(
      activation,
      entry.network.id,
      entry.path,
      entry.depth_identifier
    );

    let payload;

    try {
      payload = validateBudget(
        drafts[key] ?? draftFromBudget(entry.budget)
      );
    } catch (err) {
      setBudgetErrors((current) => ({
        ...current,
        [key]:
          err instanceof Error ? err.message : "Invalid payload budget.",
      }));
      return;
    }

    setSavingKeys((current) => ({ ...current, [key]: true }));
    setBudgetErrors((current) => ({ ...current, [key]: "" }));
    setBudgetNotices((current) => ({ ...current, [key]: "" }));

    try {
      const endpoint =
        `/wallets/${encodeURIComponent(substrate)}` +
        `/activations/${encodeURIComponent(activation)}` +
        `/payload-budgets/${encodeURIComponent(entry.network.id)}` +
        `/${encodeURIComponent(entry.path)}` +
        `/${encodeURIComponent(entry.depth_identifier)}`;

      const result = await apiRequest(endpoint, {
        method: "PUT",
        body: requestBody(payload),
      });

      setPayloadBudgets((current) =>
        current.map((row) =>
          payloadKey(
            activation,
            row.network.id,
            row.path,
            row.depth_identifier
          ) === key
            ? {
                ...row,
                configured: true,
                budget:
                  result.budget ?? {
                    min_events: payload.minEvents,
                    max_events: payload.maxEvents,
                    max_retained_mass: payload.maxRetainedMass,
                  },
              }
            : row
        )
      );

      setBudgetNotices((current) => ({
        ...current,
        [key]: `Saved payload budget for ${entry.network.id} · activation ${activation}.`,
      }));
    } catch (err) {
      setBudgetErrors((current) => ({
        ...current,
        [key]:
          err instanceof Error
            ? err.message
            : "Unable to save this payload budget.",
      }));
    } finally {
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
      await Promise.all([
        loadNetworkBudgets(substrate, selectedActivationRef.current),
        loadPayloadBudgets(substrate, selectedActivationRef.current),
      ]);

      setNotice("Event snapshot and budgets refreshed.");
    }
  }

  const activationEvents = useMemo(
    () =>
      events.filter(
        (event) => activationFromEvent(event) === String(activation)
      ),
    [events, activation]
  );

  const activationRetainedMass = useMemo(
    () => totalRetainedMass(activationEvents).toString(),
    [activationEvents]
  );

  const networkBudgetById = useMemo(
    () =>
      new Map(
        networkBudgets.map((row) => [row?.network?.id, row])
      ),
    [networkBudgets]
  );

  const renderedNetworks = useMemo(() => {
    const registered = networks.length ? networks : [];
    const fromBudgets = networkBudgets
      .map((row) => normalizeNetwork(row.network))
      .filter(Boolean);

    const byId = new Map();

    [...registered, ...fromBudgets].forEach((network) => {
      if (!byId.has(network.id)) byId.set(network.id, network);
    });

    // Include networks present in persisted payload rows, even if a budget
    // endpoint omits an otherwise registered network.
    payloadBudgets.forEach((entry) => {
      if (!byId.has(entry.network.id)) {
        byId.set(entry.network.id, entry.network);
      }
    });

    return [...byId.values()];
  }, [networks, networkBudgets, payloadBudgets]);

  const payloadGroups = useMemo(() => {
    const groups = new Map();

    payloadBudgets.forEach((entry) => {
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

      if (direction === "transit_inputs") {
        group.transit_inputs.push(entry);
      } else if (direction === "exile_outputs") {
        group.exile_outputs.push(entry);
      } else {
        group.unclassified.push(entry);
      }
    });

    return groups;
  }, [payloadBudgets]);

  return (
    <main className="min-h-screen bg-[#f7f8fa] px-3 py-4 text-zinc-950 sm:px-5 sm:py-6 lg:px-8 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 sm:gap-5">
        <header className="flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/70">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-500 sm:text-xs dark:text-zinc-400">
              QuantPerm · QTM · Persistent substrate
            </p>

            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Event Store
            </h1>

            <p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500 sm:text-sm sm:leading-6 dark:text-zinc-400">
              Inspect persisted transit inputs and exile outputs inside each
              network. Network and payload budgets remain independently
              scoped to the selected activation.
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
          title="Universal substrate"
          description="Choose a persistent substrate and activation to inspect its network-specific payload records."
          action={
            <button
              type="button"
              className={BUTTON_CLASS}
              disabled={
                !substrate ||
                loadingEvents ||
                loadingBudgets ||
                loadingPayloadBudgets
              }
              onClick={refreshAll}
            >
              {loadingEvents ||
              loadingBudgets ||
              loadingPayloadBudgets
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
            <Field label="Substrate">
              {display(store?.substrate ?? substrate)}
            </Field>

            <Field label="Selected activation">{activation}</Field>

            <Field label="Persisted events">{events.length}</Field>

            <Field label="Registered networks">
              {renderedNetworks.length}
            </Field>
          </dl>

          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-4 dark:border-zinc-800">
            <Field label="Configured network budgets">
              {configuredNetworkCount} / {renderedNetworks.length}
            </Field>

            <Field label="Configured payload budgets">
              {configuredPayloadCount} / {payloadBudgets.length}
            </Field>

            <Field label="Distinct payload records">
              {payloadBudgets.length}
            </Field>

            <Field label="Event snapshot">
              {loadingEvents ? "Refreshing" : store ? "Loaded" : "Not loaded"}
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

        {budgetErrors.payloadLoad && (
          <Notice type="warning">{budgetErrors.payloadLoad}</Notice>
        )}

        {notice && <Notice type="success">{notice}</Notice>}

        <Panel
          title={`Network hierarchy · activation ${activation}`}
          description="Every network identifier has its own container. Transit inputs and exile outputs are nested beneath that network, with each returned payload path and depth identifier preserved as a separate record."
          action={
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {renderedNetworks.length} networks
            </span>
          }
        >
          {loadingPayloadBudgets && (
            <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              Loading payload records for activation {activation}…
            </p>
          )}

          {renderedNetworks.length === 0 && !loadingBudgets ? (
            <p className="mt-4 rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No registered networks were returned. Check GET /networks.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {renderedNetworks.map((network) => {
                const networkEntry = networkBudgetById.get(network.id);
                const budget = networkEntry?.budget ?? null;
                const configured = Boolean(
                  networkEntry?.configured && budget
                );

                const key = networkKey(activation, network.id);
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
                        <Field label="Coin">
                          {display(network.coin)}
                        </Field>

                        <Field label="Purpose">
                          {display(network.purpose)}
                        </Field>

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

                          <span aria-hidden="true">
                            {expanded ? "−" : "+"}
                          </span>
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
                              disabled={
                                !substrate || saving || loadingBudgets
                              }
                            >
                              {saving ? "Saving…" : "Save network budget"}
                            </button>

                            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                              This budget is scoped to network{" "}
                              <span className="break-all font-mono">
                                {network.id}
                              </span>{" "}
                              at activation {activation}.
                            </p>
                          </form>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
                      <DirectionSection
                        title="transit_inputs"
                        description="Persisted input payload records associated with this network."
                        entries={group.transit_inputs}
                        activation={activation}
                        store={store}
                        drafts={drafts}
                        savingKeys={savingKeys}
                        expandedPayloads={expandedPayloads}
                        budgetErrors={budgetErrors}
                        budgetNotices={budgetNotices}
                        loadingPayloadBudgets={loadingPayloadBudgets}
                        updateDraft={updateDraft}
                        savePayloadBudget={savePayloadBudget}
                        setExpandedPayloads={setExpandedPayloads}
                      />

                      <DirectionSection
                        title="exile_outputs"
                        description="Persisted output payload records associated with this network."
                        entries={group.exile_outputs}
                        activation={activation}
                        store={store}
                        drafts={drafts}
                        savingKeys={savingKeys}
                        expandedPayloads={expandedPayloads}
                        budgetErrors={budgetErrors}
                        budgetNotices={budgetNotices}
                        loadingPayloadBudgets={loadingPayloadBudgets}
                        updateDraft={updateDraft}
                        savePayloadBudget={savePayloadBudget}
                        setExpandedPayloads={setExpandedPayloads}
                      />

                      {group.unclassified.length > 0 && (
                        <DirectionSection
                          title="Unclassified persisted payloads"
                          description="Returned records without enough direction metadata to classify as transit inputs or exile outputs."
                          entries={group.unclassified}
                          activation={activation}
                          store={store}
                          drafts={drafts}
                          savingKeys={savingKeys}
                          expandedPayloads={expandedPayloads}
                          budgetErrors={budgetErrors}
                          budgetNotices={budgetNotices}
                          loadingPayloadBudgets={loadingPayloadBudgets}
                          updateDraft={updateDraft}
                          savePayloadBudget={savePayloadBudget}
                          setExpandedPayloads={setExpandedPayloads}
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
          description="Aggregate measurements from the event snapshot. These are substrate-level totals, not a per-network ledger unless individual records identify their network."
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
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Sum of valid retained_mass values on matching activation
                records.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <Field label="Events in substrate">
                {events.length} events
              </Field>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Total records returned by the event-store endpoint.
              </p>
            </div>
          </div>
        </Panel>

        <Panel
          title="Persisted event diagnostics"
          description="Event records returned by the selected substrate's API snapshot."
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
          QTM Event Store · Persistent substrate · Activation-scoped budgets ·
          Network-scoped payloads · Distinct payload paths and depth identifiers
        </footer>
      </div>
    </main>
  );
}
