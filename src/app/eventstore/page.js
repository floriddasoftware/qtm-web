"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api.onrender.com"
).replace(/\/+$/, "");

const API_ROUTES = {
  listSubstrates: () => ["GET", "/wallets"],
  listNetworks: () => ["GET", "/networks"],
  listEvents: ({ name }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/events`,
  ],
  openSubstrate: ({ name, activation }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/open`,
  ],
  activationNetworks: ({ name, activation }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks`,
  ],
  activationBudgets: ({ name, activation }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/budgets`,
  ],
  saveBudget: ({ name, activation, network }) => [
    "PUT",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/budgets/${encodeURIComponent(network)}`,
  ],
  eventValue: ({ name, activation, network, field }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/${encodeURIComponent(field)}`,
  ],
  bitminerStart: ({ name, activation, network }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/start`,
  ],
  bitminerStop: ({ name, activation, network }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/stop`,
  ],
  submissions: ({ name, activation, network }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/submissions`,
  ],
  wirePackets: ({ name, activation, network, submission }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/submissions/${encodeURIComponent(submission)}/wirepackets`,
  ],
  psbt: ({ name, activation, network, submission }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/submissions/${encodeURIComponent(submission)}/psbt`,
  ],
};


async function apiRequest(route, body, signal) {
  const [method, path] = route;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.error || data?.message || `Request failed (${response.status})`
    );
  }
  return data;
}


async function loadActivationNetworks(substrateName, activation, signal) {
  const data = await apiRequest(
    API_ROUTES.activationNetworks({ name: substrateName, activation }),
    undefined,
    signal
  );


  if (
    !data ||
    !Array.isArray(data.networks) ||
    !data.event ||
    data.event.dimension == null ||
    data.event.retained_mass == null ||
    data.event.delta == null
  ) {
    throw new Error("Invalid activation network/event response.");
  }

  return {
    networks: data.networks.filter(
      (network) => typeof network === "string" && network.length > 0
    ),
    event: {
      dimension: data.event.dimension,
      retained_mass: data.event.retained_mass,
      delta: data.event.delta,
    },
  };
}


async function loadActivationBudgets(substrateName, activation, signal) {
  const data = await apiRequest(
    API_ROUTES.activationBudgets({ name: substrateName, activation }),
    undefined,
    signal
  );
  return Array.isArray(data?.budgets) ? data.budgets : [];
}


function mapBudgetsToNetworks(networks, persistedBudgets) {
  const result = {};
  for (const network of networks) {
    const entry = persistedBudgets.find((item) => item?.network?.id === network);
    result[network] = {
      min_events: String(entry?.budget?.min_events ?? 1),
      max_events: String(entry?.budget?.max_events ?? 1),
    };
  }
  return result;
}


function createActiveClip(substrate, activation, networks = [], event = null) {
  if (!substrate || activation == null) return null;
  return {
    substrate: { name: substrate.name },
    activation: { id: activation },
    network: networks,
    event,
  };
}


function activationId(event) {
  return (
    event?.activation ??
    event?.id ??
    event?.sequence ??
    event?.event ??
    null
  );
}


function NetworkContext({
  network,
  activeClip,
  budget,
  onBudgetChange,
  onSaveBudget,
  saving,
  budgetMessage,
}) {
  const substrate = activeClip?.substrate?.name;
  const activation = activeClip?.activation?.id;
  const event = activeClip?.event;

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{network}</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Activation {activation} · {substrate}
          </p>
        </div>
        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          Context Ready
        </span>
      </div>


      <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <h4 className="text-sm font-medium">Event Context Ready</h4>
        <p className="mt-1 text-sm text-zinc-500">
          Activation and registered network context have been loaded from the persisted event.
        </p>
        <p className="mt-2 text-xs text-zinc-500">This context is scoped to {network}.</p>
      </div>


      <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <h4 className="text-sm font-medium">Event Budget</h4>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Min Events
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={budget?.min_events ?? "1"}
              onChange={(e) => onBudgetChange(network, "min_events", e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            Max Events
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={budget?.max_events ?? "1"}
              onChange={(e) => onBudgetChange(network, "max_events", e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => onSaveBudget(network)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {saving ? "Saving..." : "Save Budget"}
          </button>
          {budgetMessage && (
            <p
              role="status"
              className={`text-sm ${
                budgetMessage.type === "success"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {budgetMessage.text}
            </p>
          )}
        </div>
      </div>


      <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <h4 className="text-sm font-medium">Persisted Event Values</h4>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
            <div className="text-xs text-zinc-500">Dimension</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{event?.dimension ?? "—"}</div>
          </div>
          <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
            <div className="text-xs text-zinc-500">Retained Mass</div>
            <div className="mt-1 break-all text-lg font-semibold tabular-nums">{event?.retained_mass ?? "—"}</div>
          </div>
          <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
            <div className="text-xs text-zinc-500">Transition Delta</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{event?.delta ?? "—"}</div>
          </div>
        </div>
      </div>


      <div className="mt-4">
        <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Downstream context</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {["Event Value", "Budget", "Bitminer", "Submissions", "WirePackets", "PSBT"].map((name) => (
            <div key={name} className="rounded-lg border border-zinc-200 px-3 py-3 dark:border-zinc-800">
              <div className="text-sm font-medium">{name}</div>
              <div className="mt-1 text-xs text-zinc-500">Awaiting downstream loading</div>
            </div>
          ))}
        </div>
      </div>


      <div className="mt-4 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
        <div className="text-xs font-medium text-zinc-500">Network context</div>
        <pre className="mt-2 overflow-auto text-xs">
          {JSON.stringify({ substrate, activation, network, event }, null, 2)}
        </pre>
      </div>
    </article>
  );
}


export default function Home() {
  const [substrates, setSubstrates] = useState([]);
  const [events, setEvents] = useState([]);
  const [activeClip, setActiveClip] = useState(null);
  const [budgets, setBudgets] = useState({});
  const [budgetSaving, setBudgetSaving] = useState({});
  const [budgetMessages, setBudgetMessages] = useState({});
  const [loadingSubstrates, setLoadingSubstrates] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingNetworks, setLoadingNetworks] = useState(false);
  const [error, setError] = useState("");


  const selectedSubstrate = useMemo(() => {
    if (!activeClip) return null;
    return substrates.find((substrate) => substrate.name === activeClip.substrate.name) || null;
  }, [activeClip, substrates]);


  const activations = useMemo(
    () => events.map(activationId).filter((id) => id !== null && id !== undefined).map(String),
    [events]
  );

  const activeActivation = activeClip?.activation?.id != null ? String(activeClip.activation.id) : "";
  const activeNetworks = useMemo(
    () => (Array.isArray(activeClip?.network) ? activeClip.network : []),
    [activeClip]
  );


  useEffect(() => {
    const controller = new AbortController();
    async function boot() {
      setLoadingSubstrates(true);
      setError("");
      try {
        const data = await apiRequest(API_ROUTES.listSubstrates(), undefined, controller.signal);
        const list = Array.isArray(data) ? data : data?.substrates || data?.wallets || [];
        setSubstrates(list);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message || "Failed to load substrates.");
      } finally {
        if (!controller.signal.aborted) setLoadingSubstrates(false);
      }
    }
    boot();
    return () => controller.abort();
  }, []);


  const loadEvents = useCallback(async (substrateName, signal) => {
    if (!substrateName) {
      setEvents([]);
      return [];
    }
    const data = await apiRequest(API_ROUTES.listEvents({ name: substrateName }), undefined, signal);
    const list = Array.isArray(data) ? data : data?.events || data?.activations || [];
    setEvents(list);
    return list;
  }, []);


  const selectSubstrate = useCallback(
    async (name) => {
      const substrate = substrates.find((item) => item.name === name);
      if (!substrate) return;
      setError("");
      setEvents([]);
      setActiveClip(null);
      setBudgets({});
      setBudgetSaving({});
      setBudgetMessages({});
      setLoadingEvents(true);
      setLoadingNetworks(true);
      const controller = new AbortController();
      try {
        const persistentEvents = await loadEvents(substrate.name, controller.signal);
        const latestEvent = persistentEvents.slice().reverse().find((event) => activationId(event) != null);
        if (!latestEvent) {
          setActiveClip(null);
          setBudgets({});
          return;
        }
        const id = activationId(latestEvent);
        const [activationContext, persistedBudgets] = await Promise.all([
          loadActivationNetworks(substrate.name, id, controller.signal),
          loadActivationBudgets(substrate.name, id, controller.signal),
        ]);
        setActiveClip(createActiveClip(substrate, id, activationContext.networks, activationContext.event));
        setBudgets(mapBudgetsToNetworks(activationContext.networks, persistedBudgets));
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message || "Failed to load activation context.");
          setActiveClip(null);
          setBudgets({});
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingEvents(false);
          setLoadingNetworks(false);
        }
      }
    },
    [substrates, loadEvents]
  );


  const selectActivation = useCallback(
    async (activation) => {
      if (!selectedSubstrate || activation === "") return;
      const selectedEvent = events.find((event) => String(activationId(event)) === String(activation));
      if (!selectedEvent) return;
      const id = activationId(selectedEvent);
      const controller = new AbortController();
      setError("");
      setLoadingNetworks(true);
      setBudgets({});
      setBudgetMessages({});
      setActiveClip(createActiveClip(selectedSubstrate, id, [], null));
      try {
        const [activationContext, persistedBudgets] = await Promise.all([
          loadActivationNetworks(selectedSubstrate.name, id, controller.signal),
          loadActivationBudgets(selectedSubstrate.name, id, controller.signal),
        ]);
        setActiveClip(createActiveClip(selectedSubstrate, id, activationContext.networks, activationContext.event));
        setBudgets(mapBudgetsToNetworks(activationContext.networks, persistedBudgets));
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message || "Failed to load activation networks/budgets.");
          setActiveClip(createActiveClip(selectedSubstrate, id, [], null));
          setBudgets({});
        }
      } finally {
        if (!controller.signal.aborted) setLoadingNetworks(false);
      }
    },
    [selectedSubstrate, events]
  );


  const updateNetworkBudget = useCallback((network, field, value) => {
    setBudgets((prev) => ({
      ...prev,
      [network]: { ...prev[network], [field]: value },
    }));
    setBudgetMessages((prev) => ({ ...prev, [network]: null }));
  }, []);


  const saveNetworkBudget = useCallback(async (network) => {
    if (!activeClip) return;
    const values = budgets[network];
    if (!values) return;
    const minEvents = Number(values.min_events);
    const maxEvents = Number(values.max_events);
    if (
      values.min_events === "" || values.max_events === "" ||
      !Number.isInteger(minEvents) || !Number.isInteger(maxEvents) ||
      minEvents < 0 || maxEvents <= 0 || minEvents > maxEvents
    ) {
      setBudgetMessages((prev) => ({
        ...prev,
        [network]: { type: "error", text: "Invalid budget: min must be non-negative, max must be greater than zero, and min must not exceed max." },
      }));
      return;
    }
    setBudgetSaving((prev) => ({ ...prev, [network]: true }));
    setBudgetMessages((prev) => ({ ...prev, [network]: null }));
    try {
      const response = await apiRequest(
        API_ROUTES.saveBudget({
          name: activeClip.substrate.name,
          activation: activeClip.activation.id,
          network,
        }),
        { min_events: minEvents, max_events: maxEvents }
      );
      const saved = response?.budget;
      setBudgets((prev) => ({
        ...prev,
        [network]: {
          min_events: String(saved?.min_events ?? minEvents),
          max_events: String(saved?.max_events ?? maxEvents),
        },
      }));
      setBudgetMessages((prev) => ({
        ...prev,
        [network]: { type: "success", text: "budget saved" },
      }));
    } catch (err) {
      setBudgetMessages((prev) => ({
        ...prev,
        [network]: { type: "error", text: err.message || "Failed to save budget." },
      }));
    } finally {
      setBudgetSaving((prev) => ({ ...prev, [network]: false }));
    }
  }, [activeClip, budgets]);


  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Event Store</h1>
          <p className="mt-1 text-sm text-zinc-500">Persistent activation and network contexts</p>
        </header>


        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Substrate</label>
              <select
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                value={activeClip?.substrate?.name || ""}
                disabled={loadingSubstrates}
                onChange={(event) => selectSubstrate(event.target.value)}
              >
                <option value="">{loadingSubstrates ? "Loading substrates..." : "Select substrate"}</option>
                {substrates.map((substrate) => (
                  <option key={substrate.name} value={substrate.name}>{substrate.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Activation</label>
              <select
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                value={activeActivation}
                disabled={loadingEvents || loadingNetworks || !selectedSubstrate || activations.length === 0}
                onChange={(event) => selectActivation(event.target.value)}
              >
                <option value="">
                  {loadingEvents ? "Loading activations..." : activations.length === 0 ? "No persistent activations" : "Select activation"}
                </option>
                {activations.map((activation) => (
                  <option key={activation} value={activation}>Activation {activation}</option>
                ))}
              </select>
            </div>
          </div>
          {loadingSubstrates && <p className="mt-4 text-sm text-zinc-500">Loading substrates...</p>}
          {loadingEvents && <p className="mt-4 text-sm text-zinc-500">Loading persistent activations...</p>}
          {loadingNetworks && <p className="mt-4 text-sm text-zinc-500">Loading activation network/event/budget response...</p>}
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </section>


        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">ActiveClip</h2>
          {!activeClip ? (
            <p className="mt-2 text-sm text-zinc-500">Select a substrate and persistent activation.</p>
          ) : (
            <>
              <div className="mt-4">
                <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Network overview</h3>
                {loadingNetworks ? (
                  <p className="mt-2 text-sm text-zinc-500">Loading network/event response...</p>
                ) : activeNetworks.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeNetworks.map((network) => (
                      <span key={network} className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">{network}</span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-zinc-500">No registered networks returned for this activation.</p>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Activation event values</h3>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800"><div className="text-xs text-zinc-500">Dimension</div><div className="mt-1 text-lg font-semibold tabular-nums">{activeClip.event?.dimension ?? "—"}</div></div>
                  <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800"><div className="text-xs text-zinc-500">Retained Mass</div><div className="mt-1 break-all text-lg font-semibold tabular-nums">{activeClip.event?.retained_mass ?? "—"}</div></div>
                  <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800"><div className="text-xs text-zinc-500">Delta</div><div className="mt-1 text-lg font-semibold tabular-nums">{activeClip.event?.delta ?? "—"}</div></div>
                </div>
              </div>
              <pre className="mt-4 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">{JSON.stringify(activeClip, null, 2)}</pre>
            </>
          )}
        </section>


        {activeClip && !loadingNetworks && (
          <section className="flex flex-col gap-4">
            <header>
              <h2 className="text-lg font-semibold">Event Contexts</h2>
              <p className="mt-1 text-sm text-zinc-500">Each context is scoped to a registered network returned by the activation network response.</p>
            </header>
            {activeNetworks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700"><p className="text-sm text-zinc-500">No network contexts are available for this activation.</p></div>
            ) : (
              <div className="grid gap-4">
                {activeNetworks.map((network) => (
                  <NetworkContext
                    key={`${activeClip.substrate.name}:${activeClip.activation.id}:${network}`}
                    network={network}
                    activeClip={activeClip}
                    budget={budgets[network]}
                    onBudgetChange={updateNetworkBudget}
                    onSaveBudget={saveNetworkBudget}
                    saving={Boolean(budgetSaving[network])}
                    budgetMessage={budgetMessages[network]}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
