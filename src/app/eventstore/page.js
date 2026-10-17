"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";

/*
 * Existing read endpoint:
 *   GET /wallets
 *   GET /wallets/:name/events
 *
 * Budget/deposit endpoints expected by these UI controls (must be implemented
 * by qtm-api before use):
 *   PUT  /wallets/:name/events/budget   { max_events, min_events, max_retained }
 *   POST /wallets/:name/events/deposit  { events, retained }
 *
 * "Deposit" here means an event-capacity/memory reservation request. This page
 * does not process currency or claim to implement ROM allocation.
 */

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
      body?.error || body?.message || body?.detail ||
        `Request failed with HTTP ${response.status}`,
    );
  }
  return body ?? {};
}

function text(value, fallback = "—") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function Panel({ title, description, action, children, className = "" }) {
  return (
    <section className={`min-w-0 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">{description}</p>}
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
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 break-all text-sm text-zinc-900 dark:text-zinc-100">{children ?? "—"}</dd>
      {hint && <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

function NumberInput({ label, value, onChange, min = 0, hint }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type="number" min={min} step="1" required value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 font-mono text-base outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 sm:text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
      />
      {hint && <span className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

function Metric({ label, value, unit, note }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 break-all font-mono text-xl font-semibold tabular-nums sm:text-2xl">
        {text(value, "Not configured")}
        {unit && value !== undefined && value !== null && value !== "" && <span className="ml-1 text-sm font-medium text-zinc-500">{unit}</span>}
      </p>
      {note && <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{note}</p>}
    </div>
  );
}

function RuntimeValue({ runtime }) {
  if (!runtime) return <>Not reported</>;
  const seconds = Number(runtime.unix_seconds);
  const nanos = Number(runtime.subsec_nanos ?? 0);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) return <>Invalid runtime value</>;
  return <>{new Date(seconds * 1000).toISOString()} · {nanos} ns</>;
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
  const [maxRetained, setMaxRetained] = useState("1048576");
  const [depositEvents, setDepositEvents] = useState("1");
  const [depositRetained, setDepositRetained] = useState("1024");
  const [budgetResult, setBudgetResult] = useState(null);
  const [depositResult, setDepositResult] = useState(null);

  const events = Array.isArray(store?.events) ? store.events : [];
  const budget = store?.budget_store ?? store?.budget ?? store?.capacity ?? store?.event_budget ?? null;

  const loadSubstrates = useCallback(async () => {
    setLoadingList(true);
    setError("");
    try {
      const result = await apiRequest("/wallets");
      const entries = Array.isArray(result.substrates)
        ? result.substrates.filter((item) => item && typeof item.name === "string")
        : [];
      setSubstrates(entries);
      const requested = new URLSearchParams(window.location.search).get("substrate");
      const requestedEntry = entries.find((item) => item.name === requested);
      const chosen = requestedEntry?.name ??
        (entries.some((item) => item.name === substrate) ? substrate : entries[0]?.name ?? "");
      setSubstrate(chosen);
      return chosen;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load substrates.");
      return "";
    } finally {
      setLoadingList(false);
    }
  }, [substrate]);

  const loadEvents = useCallback(async (name) => {
    if (!name) {
      setError("Select a substrate before loading its event store.");
      return null;
    }
    setLoadingEvents(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest(`/wallets/${encodeURIComponent(name)}/events`);
      setStore(result);
      setSubstrate(result.substrate || name);
      const currentBudget = result.budget_store ?? result.budget ?? result.capacity ?? result.event_budget;
      if (currentBudget && typeof currentBudget === "object") {
        if (currentBudget.max_events !== undefined) setMaxEvents(String(currentBudget.max_events));
        if (currentBudget.min_events !== undefined) setMinEvents(String(currentBudget.min_events));
        if (currentBudget.max_retained !== undefined) setMaxRetained(String(currentBudget.max_retained));
      }
      return result;
    } catch (err) {
      setStore(null);
      setError(err instanceof Error ? err.message : "Unable to load the event store.");
      return null;
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      const chosen = await loadSubstrates();
      if (!cancelled && chosen) await loadEvents(chosen);
    }
    initialize();
    return () => { cancelled = true; };
  }, [loadSubstrates, loadEvents]);

  function integer(value, label) {
    if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a non-negative whole number.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative safe integer.`);
    return parsed;
  }

  async function saveBudget(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBudgetResult(null);
    if (!substrate) { setError("Select a substrate before configuring its budget."); return; }

    let payload;
    try {
      payload = {
        max_events: integer(maxEvents, "max_events"),
        min_events: integer(minEvents, "min_events"),
        max_retained: integer(maxRetained, "max_retained"),
      };
      if (payload.max_events < 1) throw new Error("max_events must be at least 1.");
      if (payload.min_events > payload.max_events) throw new Error("min_events cannot exceed max_events.");
      if (payload.max_retained < 1) throw new Error("max_retained must be at least 1 byte.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid budget values.");
      return;
    }

    setSavingBudget(true);
    try {
      const result = await apiRequest(`/wallets/${encodeURIComponent(substrate)}/events/budget`, {
        method: "PUT", body: JSON.stringify(payload),
      });
      setBudgetResult(result);
      setNotice("Budget configuration was accepted by the API.");
      await loadEvents(substrate);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Unable to configure budget."} Verify that qtm-api implements PUT /wallets/:name/events/budget.`);
    } finally {
      setSavingBudget(false);
    }
  }

  async function submitDeposit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setDepositResult(null);
    if (!substrate) { setError("Select a substrate before requesting an event deposit."); return; }

    let payload;
    try {
      payload = {
        events: integer(depositEvents, "Event slots"),
        retained: integer(depositRetained, "Retained-memory reservation"),
      };
      if (payload.events < 1) throw new Error("Event slots must be at least 1.");
      if (payload.retained < 1) throw new Error("Retained-memory reservation must be at least 1 byte.");

      if (budget && typeof budget === "object") {
        const cap = Number(budget.max_events);
        if (Number.isFinite(cap) && events.length + payload.events > cap) {
          throw new Error("This request exceeds the configured maximum event capacity.");
        }
        const retainedCap = Number(budget.max_retained);
        const used = events.reduce((sum, item) => {
          const amount = Number(item?.retained_mass ?? 0);
          return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
        }, 0);
        if (Number.isFinite(retainedCap) && used + payload.retained > retainedCap) {
          throw new Error("This request exceeds the configured retained-memory budget.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid event deposit request.");
      return;
    }

    setCreatingDeposit(true);
    try {
      const result = await apiRequest(`/wallets/${encodeURIComponent(substrate)}/events/deposit`, {
        method: "POST", body: JSON.stringify(payload),
      });
      setDepositResult(result);
      setNotice("Event deposit request was accepted by the API.");
      await loadEvents(substrate);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Unable to submit event deposit."} Verify that qtm-api implements POST /wallets/:name/events/deposit. This page has not confirmed a deposit.`);
    } finally {
      setCreatingDeposit(false);
    }
  }

  const usedRetained = events.reduce((sum, item) => {
    const amount = Number(item?.retained_mass ?? 0);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
  const maxEventValue = Number(budget?.max_events);
  const remainingEvents = Number.isFinite(maxEventValue)
    ? Math.max(0, maxEventValue - events.length)
    : undefined;

  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-5 text-zinc-900 sm:px-6 sm:py-8 md:px-8 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-5 sm:space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">QuantPerm · QTM · Capacity engineering</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Event Store</h1>
          <p className="max-w-4xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Configure a fixed event capacity budget, request event admission, and inspect persisted event records.
            The budget structure is <code className="font-mono">BudgetStore&#123;max_events, min_events, max_retained&#125;</code>.
            Activation is the runtime coordination thread. This UI does not allocate ROM or claim to provide heap-free execution.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a href="/" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Back to QTM</a>
            <a href="/network" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Network</a>
          </div>
        </header>

        <Panel title="Substrate and event-store snapshot" description="The selected substrate owns the event records and their configured capacity." action={
          <button type="button" disabled={!substrate || loadingList || loadingEvents} onClick={() => loadEvents(substrate)} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300">
            {loadingEvents ? "Reading…" : "Refresh store"}
          </button>
        }>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Persistent substrate</span>
              <select value={substrate} disabled={loadingList || substrates.length === 0} onChange={(event) => {
                setSubstrate(event.target.value); setStore(null); setBudgetResult(null); setDepositResult(null); setError(""); setNotice("");
              }} className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950">
                <option value="">{loadingList ? "Loading substrates…" : "Select a substrate"}</option>
                {substrates.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} · activation {entry.activations ?? "—"}</option>)}
              </select>
            </label>
            <button type="button" disabled={!substrate || loadingEvents || loadingList} onClick={() => loadEvents(substrate)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">Load event store</button>
          </div>
          {store && <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 xl:grid-cols-4 dark:border-zinc-800">
            <Field label="Substrate identifier">{text(store.substrate || substrate)}</Field>
            <Field label="Event directory">{text(store.events_directory)}</Field>
            <Field label="Environment directory">{text(store.directory)}</Field>
            <Field label="Persisted event records">{events.length}</Field>
          </dl>}
        </Panel>

        <Panel title="Budget Store" description="Fixed capacity parameters. Counts and byte limits are engineering constraints, not prices.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Maximum events" value={budget?.max_events} unit="events" note="Hard upper bound for admitted records." />
            <Metric label="Minimum events" value={budget?.min_events} unit="events" note="Configured lower capacity target." />
            <Metric label="Maximum retained" value={budget?.max_retained} unit="bytes" note="Upper bound for retained payload mass." />
          </div>
          <form onSubmit={saveBudget} className="mt-5 space-y-4 rounded-lg border border-zinc-200 p-3 sm:p-4 dark:border-zinc-800">
            <div>
              <h3 className="text-sm font-semibold">Configure fixed capacity</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">The API receives <code>max_events</code>, <code>min_events</code>, and <code>max_retained</code>.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumberInput label="max_events" value={maxEvents} onChange={setMaxEvents} min={1} hint="Maximum admitted event count." />
              <NumberInput label="min_events" value={minEvents} onChange={setMinEvents} hint="Minimum configured event count." />
              <NumberInput label="max_retained (bytes)" value={maxRetained} onChange={setMaxRetained} min={1} hint="Maximum retained payload mass in bytes." />
            </div>
            <button type="submit" disabled={!substrate || savingBudget || loadingEvents} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 sm:w-auto dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300">{savingBudget ? "Applying budget…" : "Apply budget"}</button>
          </form>
          {budgetResult && <details className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><summary className="cursor-pointer text-sm font-medium">Budget API response</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs">{JSON.stringify(budgetResult, null, 2)}</pre></details>}
        </Panel>

        <Panel title="Event admission deposit" description="Request event slots and a retained-memory reservation. This is an engineering capacity request; no currency or payment credentials are collected here.">
          <form onSubmit={submitDeposit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberInput label="Event slots to reserve" value={depositEvents} onChange={setDepositEvents} min={1} hint="Number of event admissions requested." />
              <NumberInput label="Retained-memory reservation (bytes)" value={depositRetained} onChange={setDepositRetained} min={1} hint="Memory budget requested for these events." />
            </div>
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              The Rust API must enforce budget checks atomically. Browser-side validation is advisory and cannot prevent concurrent over-allocation. A successful UI response is shown only after the API accepts the request.
            </p>
            <button type="submit" disabled={!substrate || creatingDeposit || loadingEvents} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 sm:w-auto dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300">{creatingDeposit ? "Submitting deposit…" : "Submit event deposit"}</button>
          </form>
          {depositResult && <details className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><summary className="cursor-pointer text-sm font-medium">Deposit API response</summary><pre className="mt-3 whitespace-pre-wrap break-words text-xs">{JSON.stringify(depositResult, null, 2)}</pre></details>}
        </Panel>

        {error && <p role="alert" className="break-words rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm leading-6 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
        {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{notice}</p>}

        <Panel title="Capacity utilization" description="Derived from the currently loaded snapshot. The API is authoritative for admission decisions.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Persisted events" value={events.length} unit="events" />
            <Metric label="Observed retained mass" value={usedRetained} unit="bytes" note="Sum of retained_mass values returned for listed records." />
            <Metric label="Remaining event slots" value={remainingEvents} unit="events" />
          </div>
        </Panel>

        <Panel title="Persisted event diagnostics" description="Activation and retained-state measurements for engineering inspection." action={<span className="text-xs text-zinc-500 dark:text-zinc-400">{events.length} record{events.length === 1 ? "" : "s"}</span>} className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th scope="col" className="px-4 py-3">Activation</th>
                  <th scope="col" className="px-4 py-3">Event type</th>
                  <th scope="col" className="px-4 py-3">Record reference</th>
                  <th scope="col" className="px-4 py-3">Dimension</th>
                  <th scope="col" className="px-4 py-3">Structural value (Σ)</th>
                  <th scope="col" className="px-4 py-3">Depth objects</th>
                  <th scope="col" className="px-4 py-3">Retained mass</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {events.map((event, index) => <tr key={`${event.kind}-${event.activation}-${event.dimension}-${index}`} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 font-mono">{text(event.activation)}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${event.kind === "exile" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"}`}>{text(event.kind, "event")}</span></td>
                  <td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">{text(event.record)}</td>
                  <td className="break-all px-4 py-3 font-mono">{text(event.dimension)}</td>
                  <td className="break-all px-4 py-3 font-mono">{text(event.structural_value)}</td>
                  <td className="px-4 py-3 tabular-nums">{text(event.depth_objects)}</td>
                  <td className="break-all px-4 py-3 font-mono">{text(event.retained_mass)}</td>
                </tr>)}
                {events.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">{store ? "No persisted transit or exile records were found for this substrate." : "Load an event store to inspect persisted records."}</td></tr>}
              </tbody>
              {store && <tfoot className="border-t-2 border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950"><tr><th scope="row" colSpan={7} className="px-4 py-3 text-left font-medium"><span className="block text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Runtime row · API snapshot timestamp</span><span className="mt-1 block break-all font-mono text-sm"><RuntimeValue runtime={store.runtime} /></span></th></tr></tfoot>}
            </table>
          </div>
        </Panel>

        <footer className="border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">QTM Event Store · Capacity and retained-state diagnostics · Rust API</footer>
      </div>
    </main>
  );
}
