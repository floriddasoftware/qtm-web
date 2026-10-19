
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";
const REFRESH_INTERVAL = 5000;
const U128_MAX = "340282366920938463463374607431768211455";
const USD_PER_EVENT = 1;

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...options,
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
    throw new Error(
      body?.error ||
        body?.message ||
        body?.detail ||
        `Request failed with HTTP ${response.status}`,
    );
  }

  return body ?? {};
}

function text(value, fallback = "—") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function integer(value, label) {
  const input = String(value);

  if (!/^\d+$/.test(input)) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }

  const parsed = Number(input);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }

  return parsed;
}

function unsigned128(value, label) {
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
    max_events: ["max_events", "max_event"],
    min_events: ["min_events", "min_event"],
    max_retained_mass: ["max_retained_mass", "max_retained"],
  };

  for (const name of aliases[key] ?? [key]) {
    if (budget[name] !== undefined && budget[name] !== null) {
      return budget[name];
    }
  }

  return undefined;
}

function asBigInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  try {
    const input = String(value);

    if (!/^\d+$/.test(input)) return null;

    return BigInt(input);
  } catch {
    return null;
  }
}

/*
 * Prefer the canonical persisted heritage field:
 * event.heritage.state.retained_mass.
 *
 * The direct retained_mass fallback supports APIs that return event
 * summaries instead of the complete heritage object.
 */
function eventRetainedMass(event) {
  return (
    asBigInt(event?.heritage?.state?.retained_mass) ??
    asBigInt(event?.retained_mass)
  );
}

function sumEventRetainedMass(events) {
  return events.reduce((sum, event) => {
    const amount = eventRetainedMass(event);
    return amount === null ? sum : sum + amount;
  }, 0n);
}

function usd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function Panel({
  title,
  description,
  action,
  children,
  className = "",
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
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
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 break-all text-sm text-zinc-900 dark:text-zinc-100">
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

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  hint,
  disabled = false,
  type = "number",
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        type={type}
        inputMode={type === "text" ? "numeric" : undefined}
        min={type === "number" ? min : undefined}
        step={type === "number" ? "1" : undefined}
        pattern={type === "text" ? "[0-9]*" : undefined}
        required
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 font-mono text-base outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 sm:text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
      />
      {hint && (
        <span className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {hint}
        </span>
      )}
    </label>
  );
}

function Metric({ label, value, unit, note }) {
  const available =
    value !== undefined && value !== null && value !== "";

  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-2 break-all font-mono text-xl font-semibold tabular-nums sm:text-2xl">
        {text(value, "Not configured")}
        {unit && available && (
          <span className="ml-1 text-sm font-medium text-zinc-500">
            {unit}
          </span>
        )}
      </p>
      {note && (
        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {note}
        </p>
      )}
    </div>
  );
}

function RuntimeValue({ runtime }) {
  if (!runtime) return <>Not reported</>;

  const seconds = Number(runtime.unix_seconds);
  const nanos = Number(runtime.subsec_nanos ?? 0);

  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(nanos) ||
    seconds < 0
  ) {
    return <>Invalid runtime value</>;
  }

  return (
    <>
      {new Date(seconds * 1000).toISOString()} · {nanos} ns
    </>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
  type = "button",
  primary = false,
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={
        primary
          ? "inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
          : "inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      }
    >
      {children}
    </button>
  );
}

export default function EventStorePage() {
  const [substrates, setSubstrates] = useState([]);
  const [substrate, setSubstrate] = useState("");
  const [store, setStore] = useState(null);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const [creatingDeposit, setCreatingDeposit] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [maxEvents, setMaxEvents] = useState("1024");
  const [minEvents, setMinEvents] = useState("0");
  const [maxRetainedMass, setMaxRetainedMass] = useState("1048576");

  const [depositEvents, setDepositEvents] = useState("1");
  const [depositRetained, setDepositRetained] = useState("1024");

  const [budgetResult, setBudgetResult] = useState(null);
  const [depositResult, setDepositResult] = useState(null);

  const selectedSubstrateRef = useRef("");
  const requestSequenceRef = useRef(0);
  const retainedMassEditedRef = useRef(false);

  const events = Array.isArray(store?.events) ? store.events : [];

  const budget =
    store?.budget_store ??
    store?.budget ??
    store?.capacity ??
    store?.event_budget ??
    null;

  const usedRetainedBigInt = sumEventRetainedMass(events);
  const usedRetained = usedRetainedBigInt.toString();

  const configuredMaxEvents = budgetValue(budget, "max_events");
  const configuredMinEvents = budgetValue(budget, "min_events");
  const configuredMaxRetainedMass = budgetValue(
    budget,
    "max_retained_mass",
  );

  const maxEventNumber = Number(configuredMaxEvents);

  const remainingEvents =
    configuredMaxEvents !== undefined &&
    Number.isSafeInteger(maxEventNumber)
      ? Math.max(0, maxEventNumber - events.length)
      : undefined;

  // Live price estimate: one selected event costs one USD.
  const parsedDepositEvents = /^\d+$/.test(depositEvents)
    ? Number(depositEvents)
    : NaN;

  const validDepositCount =
    Number.isSafeInteger(parsedDepositEvents) &&
    parsedDepositEvents >= 0;

  const depositCost =
    validDepositCount
      ? parsedDepositEvents * USD_PER_EVENT
      : null;

  const loadSubstrates = useCallback(async () => {
    setLoadingList(true);

    try {
      const result = await apiRequest("/wallets");
      const entries = Array.isArray(result.substrates)
        ? result.substrates.filter(
            (item) => item && typeof item.name === "string",
          )
        : [];

      setSubstrates(entries);

      const requested = new URLSearchParams(
        window.location.search,
      ).get("substrate");

      const requestedEntry = entries.find(
        (item) => item.name === requested,
      );

      const current = selectedSubstrateRef.current;

      const chosen =
        requestedEntry?.name ??
        (entries.some((item) => item.name === current)
          ? current
          : entries[0]?.name ?? "");

      selectedSubstrateRef.current = chosen;
      setSubstrate(chosen);

      return chosen;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load substrates.",
      );
      return "";
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadEvents = useCallback(async (name, options = {}) => {
    if (!name) {
      setStore(null);
      setError("Select a substrate before loading its event store.");
      return null;
    }

    const requestId = ++requestSequenceRef.current;

    setLoadingEvents(true);

    if (!options.silent) {
      setError("");
      setNotice("");
    }

    try {
      const result = await apiRequest(
        `/wallets/${encodeURIComponent(name)}/events`,
      );

      if (requestId !== requestSequenceRef.current) return null;
      if (selectedSubstrateRef.current !== name) return null;

      setStore(result);

      const returnedEvents = Array.isArray(result.events)
        ? result.events
        : [];

      const returnedBudget =
        result.budget_store ??
        result.budget ??
        result.capacity ??
        result.event_budget ??
        null;

      const returnedMax = budgetValue(returnedBudget, "max_events");
      const returnedMin = budgetValue(returnedBudget, "min_events");
      const returnedRetainedMass = budgetValue(
        returnedBudget,
        "max_retained_mass",
      );

      if (returnedMax !== undefined) {
        setMaxEvents(String(returnedMax));
      }

      if (returnedMin !== undefined) {
        setMinEvents(String(returnedMin));
      }

      if (returnedRetainedMass !== undefined) {
        // A persisted budget takes precedence over automatic filling.
        setMaxRetainedMass(String(returnedRetainedMass));
        retainedMassEditedRef.current = false;
      } else if (!retainedMassEditedRef.current) {
        /*
         * Autofill the ceiling from persisted event heritage when the
         * API has not returned a configured max_retained_mass.
         * Nested heritage is preferred by sumEventRetainedMass().
         */
        const total = sumEventRetainedMass(returnedEvents);

        if (returnedEvents.some((item) => eventRetainedMass(item) !== null)) {
          setMaxRetainedMass(total.toString());
        }
      }

      return result;
    } catch (err) {
      if (requestId !== requestSequenceRef.current) return null;

      if (selectedSubstrateRef.current === name) {
        setStore(null);
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load the event store.",
        );
      }

      return null;
    } finally {
      if (requestId === requestSequenceRef.current) {
        setLoadingEvents(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const chosen = await loadSubstrates();

      if (!cancelled && chosen) {
        await loadEvents(chosen);
      }
    }

    initialize();

    return () => {
      cancelled = true;
      requestSequenceRef.current += 1;
    };
  }, [loadSubstrates, loadEvents]);

  useEffect(() => {
    if (!substrate) return undefined;

    const interval = window.setInterval(() => {
      if (!loadingEvents && !savingBudget && !creatingDeposit) {
        loadEvents(substrate, { silent: true });
      }
    }, REFRESH_INTERVAL);

    return () => window.clearInterval(interval);
  }, [
    substrate,
    loadingEvents,
    savingBudget,
    creatingDeposit,
    loadEvents,
  ]);

  function selectSubstrate(name) {
    selectedSubstrateRef.current = name;
    requestSequenceRef.current += 1;
    retainedMassEditedRef.current = false;

    setSubstrate(name);
    setStore(null);
    setBudgetResult(null);
    setDepositResult(null);
    setError("");
    setNotice("");

    if (name) loadEvents(name);
  }

  async function saveBudget(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBudgetResult(null);

    if (!substrate) {
      setError("Select a substrate before configuring its budget.");
      return;
    }

    let payload;

    try {
      const parsedMinEvents = integer(minEvents, "min_events");
      const parsedMaxEvents = integer(maxEvents, "max_events");
      const parsedMaxRetainedMass = unsigned128(
        maxRetainedMass,
        "max_retained_mass",
      );

      if (parsedMaxEvents < 1) {
        throw new Error("max_events must be at least 1.");
      }

      if (parsedMinEvents > parsedMaxEvents) {
        throw new Error("min_events cannot exceed max_events.");
      }

      if (BigInt(parsedMaxRetainedMass) < 1n) {
        throw new Error("max_retained_mass must be at least 1 byte.");
      }

      payload = {
        min_events: parsedMinEvents,
        max_events: parsedMaxEvents,
        max_retained_mass: parsedMaxRetainedMass,
      };
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Invalid budget values.",
      );
      return;
    }

    setSavingBudget(true);

    try {
      // Keep u128 precision by sending max_retained_mass as an exact
      // JSON integer instead of converting it to a JavaScript Number.
      const body =
        `{"min_events":${payload.min_events},` +
        `"max_events":${payload.max_events},` +
        `"max_retained_mass":${payload.max_retained_mass}}`;

      const result = await apiRequest(
        `/wallets/${encodeURIComponent(substrate)}/events/budget`,
        {
          method: "PUT",
          body,
        },
      );

      setBudgetResult(result);
      setNotice("The API accepted the budget configuration.");

      retainedMassEditedRef.current = false;
      await loadEvents(substrate);
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "Unable to configure the budget."} Verify that the deployed Rust API implements PUT /wallets/:name/events/budget and accepts max_retained_mass as a u128-compatible JSON integer.`,
      );
    } finally {
      setSavingBudget(false);
    }
  }

  async function submitDeposit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setDepositResult(null);

    if (!substrate) {
      setError("Select a substrate before requesting an event deposit.");
      return;
    }

    let payload;

    try {
      payload = {
        events: integer(depositEvents, "Event slots"),
        retained: integer(
          depositRetained,
          "Retained-memory reservation",
        ),
      };

      if (payload.events < 1) {
        throw new Error("Event slots must be at least 1.");
      }

      if (payload.retained < 1) {
        throw new Error(
          "Retained-memory reservation must be at least 1 byte.",
        );
      }

      if (budget && typeof budget === "object") {
        const cap = asBigInt(configuredMaxEvents);

        if (
          cap !== null &&
          BigInt(events.length) + BigInt(payload.events) > cap
        ) {
          throw new Error(
            "This request exceeds the configured maximum event capacity.",
          );
        }

        const retainedCap = asBigInt(configuredMaxRetainedMass);

        if (
          retainedCap !== null &&
          usedRetainedBigInt + BigInt(payload.retained) > retainedCap
        ) {
          throw new Error(
            "This request exceeds the configured retained-memory budget.",
          );
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Invalid event deposit request.",
      );
      return;
    }

    setCreatingDeposit(true);

    try {
      const result = await apiRequest(
        `/wallets/${encodeURIComponent(substrate)}/events/deposit`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );

      setDepositResult(result);
      setNotice(
        `The API accepted the deposit request. Requested event cost: ${usd(
          payload.events * USD_PER_EVENT,
        )}.`,
      );

      await loadEvents(substrate);
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : "Unable to submit the event deposit."} The Rust API must implement POST /wallets/:name/events/deposit. No deposit is confirmed by this page until the API returns success.`,
      );
    } finally {
      setCreatingDeposit(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-5 text-zinc-900 sm:px-6 sm:py-8 md:px-8 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-5 sm:space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM · Persistent substrate
          </p>

          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Event Store
          </h1>

          <p className="max-w-4xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Navigate persisted events within the selected substrate,
            configure its event budget, request event capacity, and
            inspect retained-state measurements. The store is scoped to
            one substrate at a time. Budget enforcement and persistence
            must be implemented by the Rust API.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="/"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Back to QTM
            </a>

            <a
              href="/network"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Network
            </a>
          </div>
        </header>

        <Panel
          title="Substrate and event-store snapshot"
          description="Each substrate has its own persisted event namespace and budget."
          action={
            <ActionButton
              disabled={!substrate || loadingEvents || loadingList}
              onClick={() => loadEvents(substrate)}
            >
              {loadingEvents ? "Reading…" : "Refresh store"}
            </ActionButton>
          }
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Persistent substrate
              </span>

              <select
                value={substrate}
                disabled={loadingList || substrates.length === 0}
                onChange={(event) =>
                  selectSubstrate(event.target.value)
                }
                className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">
                  {loadingList
                    ? "Loading substrates…"
                    : "Select a substrate"}
                </option>

                {substrates.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name} · activation {entry.activations ?? "—"}
                  </option>
                ))}
              </select>
            </label>

            <ActionButton
              disabled={!substrate || loadingEvents || loadingList}
              onClick={() => loadEvents(substrate)}
            >
              Load event store
            </ActionButton>
          </div>

          {store && (
            <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 xl:grid-cols-4 dark:border-zinc-800">
              <Field label="Substrate identifier">
                {text(store.substrate || substrate)}
              </Field>

              <Field label="Event directory">
                {text(store.events_directory)}
              </Field>

              <Field label="Environment directory">
                {text(store.directory)}
              </Field>

              <Field label="Persisted event records">
                {events.length}
              </Field>
            </dl>
          )}
        </Panel>

        <Panel
          title="Budget Store"
          description="Set the event-capacity limit and retained-memory ceiling for this substrate."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric
              label="Maximum events"
              value={configuredMaxEvents}
              unit="events"
              note="Configured admission ceiling."
            />

            <Metric
              label="Minimum events"
              value={configuredMinEvents}
              unit="events"
              note="Configured lower capacity target."
            />

            <Metric
              label="Maximum retained mass"
              value={configuredMaxRetainedMass ?? maxRetainedMass}
              unit="bytes"
              note="Uses the configured budget when available; otherwise autofills from persisted event heritage retained_mass."
            />
          </div>

          <form
            onSubmit={saveBudget}
            className="mt-5 space-y-4 rounded-lg border border-zinc-200 p-3 sm:p-4 dark:border-zinc-800"
          >
            <div>
              <h3 className="text-sm font-semibold">
                Configure event capacity
              </h3>

              <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                The API receives{" "}
                <code className="font-mono">min_events</code>,{" "}
                <code className="font-mono">max_events</code>, and{" "}
                <code className="font-mono">max_retained_mass</code>.
                Retained mass is kept as an exact decimal integer to
                preserve Rust <code className="font-mono">u128</code>{" "}
                precision.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumberInput
                label="max_events"
                value={maxEvents}
                onChange={setMaxEvents}
                min={1}
                hint="Maximum number of admitted events."
                disabled={savingBudget}
              />

              <NumberInput
                label="min_events"
                value={minEvents}
                onChange={setMinEvents}
                hint="Minimum configured event count."
                disabled={savingBudget}
              />

              <NumberInput
                label="max_retained_mass (bytes)"
                value={maxRetainedMass}
                onChange={(value) => {
                  retainedMassEditedRef.current = true;
                  setMaxRetainedMass(value);
                }}
                type="text"
                hint="Autofilled from persisted event heritage when no budget ceiling is returned; editable."
                disabled={savingBudget}
              />
            </div>

            <ActionButton
              type="submit"
              primary
              disabled={!substrate || savingBudget || loadingEvents}
            >
              {savingBudget ? "Applying budget…" : "Set budget"}
            </ActionButton>
          </form>

          {budgetResult && (
            <details className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <summary className="cursor-pointer text-sm font-medium">
                Budget response details
              </summary>
              <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(budgetResult, null, 2)}
              </pre>
            </details>
          )}
        </Panel>

        <Panel
          title="Event admission deposit"
          description="Each requested event costs $1 USD. The estimate updates automatically as you change the event count."
        >
          <form onSubmit={submitDeposit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberInput
                label="Event slots to deposit"
                value={depositEvents}
                onChange={setDepositEvents}
                min={1}
                hint="Number of event slots requested."
                disabled={creatingDeposit}
              />

              <NumberInput
                label="Retained-memory deposit (bytes)"
                value={depositRetained}
                onChange={setDepositRetained}
                min={1}
                hint="Requested retained-memory allowance."
                disabled={creatingDeposit}
              />
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Estimated event cost
                  </p>
                  <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">
                    {depositCost === null ? "—" : usd(depositCost)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {validDepositCount
                      ? `${parsedDepositEvents.toLocaleString("en-US")} event(s) × ${usd(USD_PER_EVENT)} per event`
                      : "Enter a valid whole-number event count."}
                  </p>
                </div>

                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Rate: <span className="font-mono">$1 USD / event</span>
                </div>
              </div>
            </div>

            <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              This is a calculated estimate only. It does not charge a
              payment method or establish a completed payment. The API
              must validate and persist event deposits atomically.
              Browser capacity checks are advisory.
            </p>

            <ActionButton
              type="submit"
              primary
              disabled={
                !substrate ||
                creatingDeposit ||
                loadingEvents ||
                !validDepositCount ||
                parsedDepositEvents < 1
              }
            >
              {creatingDeposit
                ? "Submitting deposit…"
                : `Deposit events · ${
                    depositCost === null ? "—" : usd(depositCost)
                  }`}
            </ActionButton>
          </form>

          {depositResult && (
            <details className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <summary className="cursor-pointer text-sm font-medium">
                Deposit response details
              </summary>
              <pre className="mt-3 whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(depositResult, null, 2)}
              </pre>
            </details>
          )}
        </Panel>

        {error && (
          <p
            role="alert"
            className="break-words rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm leading-6 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          >
            {notice}
          </p>
        )}

        <Panel
          title="Capacity utilization"
          description="Calculated from the currently loaded event-store snapshot."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric
              label="Persisted events"
              value={events.length}
              unit="events"
            />

            <Metric
              label="Observed retained mass"
              value={usedRetained}
              unit="bytes"
              note="Exact sum of valid retained_mass values, preferring event.heritage.state.retained_mass."
            />

            <Metric
              label="Remaining event slots"
              value={remainingEvents}
              unit="events"
              note="Configured maximum minus currently listed records."
            />
          </div>
        </Panel>

        <Panel
          title="Persisted event diagnostics"
          description="Records returned by the selected substrate's event store."
          action={
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {events.length} record{events.length === 1 ? "" : "s"}
            </span>
          }
          className="p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Activation
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Event type
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Record reference
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Dimension
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Structural value (Σ)
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Depth objects
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Retained mass
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {events.map((event, index) => (
                  <tr
                    key={`${event.kind}-${event.activation}-${event.dimension}-${index}`}
                    className="align-top"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono">
                      {text(event.activation)}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          event.kind === "exile"
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                            : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
                        }`}
                      >
                        {text(event.kind, "event")}
                      </span>
                    </td>

                    <td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {text(event.record)}
                    </td>

                    <td className="break-all px-4 py-3 font-mono">
                      {text(event.dimension)}
                    </td>

                    <td className="break-all px-4 py-3 font-mono">
                      {text(event.structural_value)}
                    </td>

                    <td className="px-4 py-3 tabular-nums">
                      {text(event.depth_objects)}
                    </td>

                    <td className="break-all px-4 py-3 font-mono">
                      {text(
                        event.heritage?.state?.retained_mass ??
                          event.retained_mass,
                      )}
                    </td>
                  </tr>
                ))}

                {events.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                    >
                      {store
                        ? "No persisted transit or exile records were returned for this substrate."
                        : "Load an event store to inspect persisted records."}
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
                      <span className="block text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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
          QTM Event Store · Substrate-scoped navigation · USD event-cost
          estimate · Retained-state diagnostics · Rust API
        </footer>
      </div>
    </main>
  );
}
