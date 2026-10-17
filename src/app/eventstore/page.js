"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";

async function apiRequest(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      body?.error || `Request failed with HTTP ${response.status}`,
    );
  }

  return body;
}

function formatRuntime(runtime) {
  if (!runtime) return "Not reported";

  const seconds = Number(runtime.unix_seconds);
  const nanos = Number(runtime.subsec_nanos ?? 0);

  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
    return "Invalid runtime value";
  }

  return `${new Date(seconds * 1000).toISOString()} · ${nanos} ns`;
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="mt-1 break-all text-sm text-zinc-900 dark:text-zinc-100">
        {children ?? "—"}
      </dd>
    </div>
  );
}

export default function EventStorePage() {
  const [substrates, setSubstrates] = useState([]);
  const [substrate, setSubstrate] = useState("");
  const [store, setStore] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState("");

  const loadSubstrates = useCallback(async () => {
    setLoadingList(true);
    setError("");

    try {
      const result = await apiRequest("/wallets");
      const entries = Array.isArray(result.substrates)
        ? result.substrates
        : [];

      setSubstrates(entries);

      const requested = new URLSearchParams(
        window.location.search,
      ).get("substrate");

      const available = entries.find(
        (entry) => entry.name === requested,
      );

      if (available) {
        setSubstrate(available.name);
      } else {
        setSubstrate((current) =>
          entries.some((entry) => entry.name === current)
            ? current
            : "",
        );
      }

      return requested && available ? available.name : "";
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

  const loadEvents = useCallback(async (name) => {
    if (!name) {
      setError("Select a substrate first.");
      return;
    }

    setLoadingEvents(true);
    setError("");
    setStore(null);

    try {
      const result = await apiRequest(
        `/wallets/${encodeURIComponent(name)}/events`,
      );

      setStore(result);
      setSubstrate(result.substrate || name);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load the event store.",
      );
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const requested = await loadSubstrates();

      if (!cancelled && requested) {
        await loadEvents(requested);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [loadSubstrates, loadEvents]);

  const events = Array.isArray(store?.events) ? store.events : [];

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Event Store
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Inspect persisted transit and exile records, their depth
            objects, structural value, and retained mass. The Rust API
            resolves the selected substrate and reads its stored state.
          </p>
        </header>

        <section className="mb-5 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <label
              htmlFor="eventstore-substrate"
              className="mb-2 block text-sm font-semibold"
            >
              Persistent environment
            </label>

            <select
              id="eventstore-substrate"
              value={substrate}
              disabled={loadingList || substrates.length === 0}
              onChange={(event) => {
                setSubstrate(event.target.value);
                setStore(null);
                setError("");
              }}
              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">
                {loadingList
                  ? "Loading environments..."
                  : "Select a substrate"}
              </option>

              {substrates.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name} · activation {entry.activations ?? "—"}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!substrate || loadingList}
              onClick={() => loadEvents(substrate)}
              className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loadingEvents ? "Reading event store..." : "Load event store"}
            </button>

            <button
              type="button"
              disabled={loadingList}
              onClick={async () => {
                const requested = await loadSubstrates();
                if (requested) await loadEvents(requested);
              }}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Refresh
            </button>

            <a
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Back to QTM
            </a>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
        </section>

        {store && (
          <>
            <section className="mb-5 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-3 text-base font-semibold">
                Persisted environment
              </h2>

              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Substrate identifier">
                  {store.substrate}
                </Field>

                <Field label="Event directory">
                  {store.events_directory}
                </Field>

                <Field label="Environment directory">
                  {store.directory}
                </Field>

                <Field label="Persisted records">
                  {events.length}
                </Field>
              </dl>
            </section>

            <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <h2 className="text-base font-semibold">
                  Event and retained-state diagnostics
                </h2>

                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {events.length} record{events.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    <tr>
                      <th scope="col" className="px-4 py-3">Activation</th>
                      <th scope="col" className="px-4 py-3">Event</th>
                      <th scope="col" className="px-4 py-3">Dimension</th>
                      <th scope="col" className="px-4 py-3">Structural value (Σ)</th>
                      <th scope="col" className="px-4 py-3">Depth objects</th>
                      <th scope="col" className="px-4 py-3">Retained mass</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {events.map((event, index) => (
                      <tr
                        key={`${event.kind}-${event.activation}-${event.dimension}-${index}`}
                        className="align-top"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono">
                          {event.activation}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                              event.kind === "exile"
                                ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                                : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
                            }`}
                          >
                            {event.kind}
                          </span>
                          <p className="mt-1 max-w-xs break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            {event.record}
                          </p>
                        </td>

                        <td className="break-all px-4 py-3 font-mono">
                          {event.dimension}
                        </td>

                        <td className="break-all px-4 py-3 font-mono">
                          {event.structural_value}
                        </td>

                        <td className="px-4 py-3 tabular-nums">
                          {event.depth_objects}
                        </td>

                        <td className="break-all px-4 py-3 font-mono">
                          {event.retained_mass}
                        </td>
                      </tr>
                    ))}

                    {events.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                        >
                          No persisted transit or exile records were found
                          for this substrate.
                        </td>
                      </tr>
                    )}
                  </tbody>

                  <tfoot className="border-t-2 border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950">
                    <tr>
                      <th
                        scope="row"
                        colSpan={6}
                        className="px-4 py-3 text-left font-medium"
                      >
                        <span className="block text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Runtime row · API snapshot timestamp
                        </span>
                        <span className="mt-1 block break-all font-mono text-sm">
                          {formatRuntime(store.runtime)}
                        </span>
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </>
        )}

        <footer className="mt-8 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
          QTM Event Store · Read-only diagnostics · State resolved by qtm-api
        </footer>
      </div>
    </main>
  );
}
