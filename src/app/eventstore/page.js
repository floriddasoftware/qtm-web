
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api.onrender.com"
).replace(/\/+$/, "");

// ============================================================
// API_ROUTES — EVENT STORE ROUTING INVARIANT
//
// Route chronology:
// 01 Substrates
// 02 Networks
// 03 Persistent Activations
// 04 Open Activation
// 05 Event Value
// 06 Network Route
// 07 Budget
// 08 Save Budget
// 09 Bitminer Start
// 10 Bitminer Stop
// 11 Submissions
// 12 WirePackets
// 13 PSBT
// ============================================================

const API_ROUTES = {
  // 01 — Substrates
  listSubstrates: () => ["GET", "/wallets"],

  // 02 — Available networks
  listNetworks: () => ["GET", "/networks"],

  // 03 — Persistent activations
  listEvents: ({ name }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/events`,
  ],

  // 04 — Open persistent activation
  openSubstrate: ({ name, activation }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/open`,
  ],

  // 05 — Event value
  eventValue: ({ name, activation, network, field }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/${encodeURIComponent(field)}`,
  ],

  // 06 — Network derivation / NetworkRoute
  networkRoute: ({ name, activation }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/network`,
  ],

  // 07 — Budget
  budget: ({ name, activation, network }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/budget`,
  ],

  // 08 — Save Budget
  saveBudget: ({ name, activation, network }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/budget`,
  ],

  // 09 — Bitminer Start
  bitminerStart: ({ name, activation, network }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/start`,
  ],

  // 10 — Bitminer Stop
  bitminerStop: ({ name, activation, network }) => [
    "POST",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/stop`,
  ],

  // 11 — Submissions
  submissions: ({ name, activation, network }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/submissions`,
  ],

  // 12 — WirePackets
  wirePackets: ({ name, activation, network, submission }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/submissions/${encodeURIComponent(submission)}/wirepackets`,
  ],

  // 13 — PSBT
  psbt: ({ name, activation, network, submission }) => [
    "GET",
    `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/submissions/${encodeURIComponent(submission)}/psbt`,
  ],
};

// ============================================================
// API REQUEST — all requests must pass through this function
// ============================================================

async function apiRequest(route, body, signal) {
  const [method, path] = route;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined
      ? { "Content-Type": "application/json" }
      : undefined,
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
      data?.error ||
      data?.message ||
      `Request failed (${response.status})`
    );
  }

  return data;
}

// ============================================================
// ACTIVE CLIP
// ============================================================

function createActiveClip(substrate, activation) {
  if (!substrate || activation == null) return null;

  return {
    substrate: {
      name: substrate.name,
    },
    activation: {
      id: activation,
    },
    network: null,
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

// ============================================================
// EVENT STORE
// ============================================================

export default function Home() {
  const [substrates, setSubstrates] = useState([]);
  const [events, setEvents] = useState([]);

  const [activeClip, setActiveClip] = useState(null);

  const [loadingSubstrates, setLoadingSubstrates] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const [error, setError] = useState("");

  const selectedSubstrate = useMemo(() => {
    if (!activeClip) return null;

    return substrates.find(
      (substrate) =>
        substrate.name === activeClip.substrate.name
    ) || null;
  }, [activeClip, substrates]);

  const activations = useMemo(() => {
    return events
      .map(activationId)
      .filter((id) => id !== null && id !== undefined)
      .map(String);
  }, [events]);

  const activeActivation = activeClip?.activation?.id != null
    ? String(activeClip.activation.id)
    : "";

  // ----------------------------------------------------------
  // Initial substrate loading — primary execution point
  // ----------------------------------------------------------

  useEffect(() => {
    const controller = new AbortController();

    async function boot() {
      setLoadingSubstrates(true);
      setError("");

      try {
        const data = await apiRequest(
          API_ROUTES.listSubstrates(),
          undefined,
          controller.signal
        );

        const list = Array.isArray(data)
          ? data
          : data?.substrates || data?.wallets || [];

        setSubstrates(list);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message || "Failed to load substrates.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingSubstrates(false);
        }
      }
    }

    boot();

    return () => controller.abort();
  }, []);

  // ----------------------------------------------------------
  // Persistent activation loading
  // ----------------------------------------------------------

  const loadEvents = useCallback(async (substrateName, signal) => {
    if (!substrateName) {
      setEvents([]);
      return [];
    }

    const data = await apiRequest(
      API_ROUTES.listEvents({ name: substrateName }),
      undefined,
      signal
    );

    const list = Array.isArray(data)
      ? data
      : data?.events || data?.activations || [];

    setEvents(list);
    return list;
  }, []);

  // ----------------------------------------------------------
  // Substrate selector
  // ----------------------------------------------------------

  const selectSubstrate = useCallback(
    async (name) => {
      const substrate = substrates.find(
        (item) => item.name === name
      );

      if (!substrate) return;

      setError("");
      setEvents([]);
      setActiveClip(null);
      setLoadingEvents(true);

      const controller = new AbortController();

      try {
        const persistentEvents = await loadEvents(
          substrate.name,
          controller.signal
        );

        const latestEvent = persistentEvents
          .slice()
          .reverse()
          .find((event) => activationId(event) != null);

        if (!latestEvent) {
          setActiveClip(null);
          return;
        }

        const id = activationId(latestEvent);

        // Commit the entire activation context in one update.
        setActiveClip(createActiveClip(substrate, id));
      } catch (err) {
        setError(err.message || "Failed to load activations.");
        setActiveClip(null);
      } finally {
        setLoadingEvents(false);
      }
    },
    [substrates, loadEvents]
  );

  // ----------------------------------------------------------
  // Activation selector
  // ----------------------------------------------------------

  const selectActivation = useCallback(
    (activation) => {
      if (!selectedSubstrate || activation === "") return;

      const selectedEvent = events.find(
        (event) => String(activationId(event)) === String(activation)
      );

      if (!selectedEvent) return;

      const id = activationId(selectedEvent);

      // Construct a complete new context. Do not update activation
      // independently from its substrate.
      const nextClip = createActiveClip(selectedSubstrate, id);

      setError("");
      setActiveClip(nextClip);
    },
    [selectedSubstrate, events]
  );

  // ==========================================================
  // INITIAL EVENT STORE UI
  // ==========================================================

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">

        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Event Store
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            Persistent activation and event context
          </p>
        </header>

        {/* Substrate / Activation selector */}

        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Substrate */}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                Substrate
              </label>

              <select
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                value={activeClip?.substrate?.name || ""}
                disabled={loadingSubstrates}
                onChange={(event) =>
                  selectSubstrate(event.target.value)
                }
              >
                <option value="">
                  {loadingSubstrates
                    ? "Loading substrates..."
                    : "Select substrate"}
                </option>

                {substrates.map((substrate) => (
                  <option
                    key={substrate.name}
                    value={substrate.name}
                  >
                    {substrate.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Persistent activation */}

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                Activation
              </label>

              <select
                className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                value={activeActivation}
                disabled={
                  loadingEvents ||
                  !selectedSubstrate ||
                  activations.length === 0
                }
                onChange={(event) =>
                  selectActivation(event.target.value)
                }
              >
                <option value="">
                  {loadingEvents
                    ? "Loading activations..."
                    : activations.length === 0
                    ? "No persistent activations"
                    : "Select activation"}
                </option>

                {activations.map((activation) => (
                  <option key={activation} value={activation}>
                    Activation {activation}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadingSubstrates && (
            <p className="mt-4 text-sm text-zinc-500">
              Loading substrates...
            </p>
          )}

          {loadingEvents && (
            <p className="mt-4 text-sm text-zinc-500">
              Loading persistent activations...
            </p>
          )}

          {error && (
            <p className="mt-4 text-sm text-red-500">
              {error}
            </p>
          )}
        </section>

        {/* ActiveClip context */}

        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">
            ActiveClip
          </h2>

          {!activeClip ? (
            <p className="mt-2 text-sm text-zinc-500">
              Select a substrate and persistent activation.
            </p>
          ) : (
            <pre className="mt-3 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
              {JSON.stringify(activeClip, null, 2)}
            </pre>
          )}
        </section>

        {/* Downstream event contents are intentionally not mounted yet. */}

        {activeClip && (
          <section className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
            <h2 className="font-medium">
              Event Context Ready
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Activation is selected. Event value, NetworkRoute,
              Budget, Bitminer, Submissions, WirePackets, and PSBT
              will load downstream from this ActiveClip.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
