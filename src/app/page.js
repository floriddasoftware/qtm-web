
"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";

const TABS = [
  { id: "create", label: "Create" },
  { id: "open", label: "Open" },
  { id: "transit", label: "Transit" },
  { id: "exile", label: "Exile" },
];

const STATE_KEYS = [
  "perm",
  "indices",
  "entropy",
  "dimension",
  "structural_value",
  "structuralValue",
  "activation_count",
  "activationCount",
  "retained_mass",
  "retainedMass",
  "commitment",
  "coordinate",
  "sigma",
  "network",
];

const TRANSITION_KEYS = [
  "tau",
  "delta",
  "gross_work",
  "grossWork",
  "net_work",
  "netWork",
  "mirror_bytes",
  "mirrorBytes",
];

function getObject(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }

  return undefined;
}

function getValue(source, keys) {
  if (!source || typeof source !== "object") return undefined;

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(source, key) &&
      source[key] !== null &&
      source[key] !== undefined
    ) {
      return source[key];
    }
  }

  return undefined;
}

function pickFields(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(source).filter(([key]) => keys.includes(key)),
  );
}

function hasContent(value) {
  if (value === null || value === undefined) return false;

  if (typeof value !== "object") return true;

  return Object.keys(value).length > 0;
}

function formatKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");
}

function formatValue(key, value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (key === "commitment") {
    const text = String(value);
    return text.startsWith("qp") ? text : `qp${text}`;
  }

  if (key === "coordinate") {
    const text = String(value);
    return text.startsWith("0x") ? text : `0x${text}`;
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value, null, 2);
  }

  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

async function readResponse(res) {
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error || `Request failed with status ${res.status}`,
    );
  }

  return data;
}

function FragmentRow({ k, v }) {
  return (
    <>
      <dt className="min-w-0 break-words text-zinc-500 dark:text-zinc-400">
        {formatKey(k)}
      </dt>

      <dd className="min-w-0 break-all whitespace-pre-wrap font-mono text-zinc-800 dark:text-zinc-200">
        {formatValue(k, v)}
      </dd>
    </>
  );
}

function ResultSection({
  title,
  description,
  value,
  defaultOpen = false,
}) {
  const populated = hasContent(value);

  const entries =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? Object.entries(value)
      : null;

  return (
    <details
      defaultOpen={defaultOpen}
      className="group overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-800/60 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </span>

          {description && (
            <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          )}
        </span>

        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition-transform group-open:rotate-180 dark:border-zinc-700 dark:text-zinc-300"
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-4">
            <path
              d="m5 7.5 5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>

      <div className="border-t border-zinc-200 px-3 py-3 sm:px-4 dark:border-zinc-700">
        {!populated ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No data was returned for this section.
          </p>
        ) : entries ? (
          <dl className="grid min-w-0 grid-cols-[minmax(90px,0.7fr)_minmax(0,1.5fr)] gap-x-3 gap-y-3 text-xs sm:gap-x-5">
            {entries.map(([key, entryValue]) => (
              <FragmentRow key={key} k={key} v={entryValue} />
            ))}
          </dl>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
}

function ResultHeading({ eyebrow, title }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        {eyebrow}
      </p>

      <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
    </div>
  );
}

function HeritageSections({ heritage, prefix = "" }) {
  const state =
    getObject(heritage, ["state", "quantperm", "quant_perm", "quantPerm"]) ??
    pickFields(heritage, STATE_KEYS);

  const transition =
    getObject(heritage, [
      "transition",
      "transition_heritage",
      "transitionHeritage",
    ]) ?? pickFields(heritage, TRANSITION_KEYS);

  return (
    <div className="space-y-3">
      <ResultSection
        title={`${prefix}State / QuantPerm`}
        description="QuantPerm state, coordinates, and accumulated values"
        value={state}
        defaultOpen
      />

      <ResultSection
        title={`${prefix}Transition / Transition Heritage`}
        description="Transition measurements and mirror bytes"
        value={transition}
      />
    </div>
  );
}

function OpenResults({ result }) {
  const heritage =
    getObject(result, [
      "heritage",
      "state_heritage",
      "stateHeritage",
    ]) ?? result;

  return (
    <section className="mt-7" aria-label="Open results">
      <ResultHeading
        eyebrow="Open results"
        title="Substrate heritage"
      />

      <HeritageSections heritage={heritage} />
    </section>
  );
}

function TransitResults({ result }) {
  // Direction owns EventMap.
  const direction =
    getObject(result, ["direction"]) ?? result;

  // EventMap owns both event and runtime.
  const eventMap =
    getObject(direction, ["event_map", "eventMap"]) ??
    getObject(result, ["event_map", "eventMap"]);

  // Support responses that expose event directly.
  const event =
    getObject(eventMap, ["event"]) ??
    getObject(direction, ["event"]) ??
    getObject(result, ["event"]);

  // The event owns QTM and Heritage.
  const qtm =
    getValue(event, ["qtm", "Qtm"]) ??
    getValue(eventMap, ["qtm", "Qtm"]) ??
    getValue(result, ["event_qtm", "eventQtm"]);

  const heritage =
    getObject(event, [
      "heritage",
      "transition_heritage",
      "transitionHeritage",
    ]) ??
    getObject(eventMap, ["heritage"]) ??
    getObject(result, ["event_heritage", "eventHeritage"]);

  const runtime =
    getValue(eventMap, ["runtime"]) ??
    getValue(direction, ["runtime"]) ??
    getValue(result, ["runtime"]);

  const fallbackEvent = event ?? result;

  return (
    <section className="mt-7" aria-label="Transit results">
      <ResultHeading
        eyebrow="Transit results"
        title="QP44 event"
      />

      <div className="space-y-3">
        <ResultSection
          title="Event Map"
          description="The QTM object owned by the event"
          value={
            qtm !== undefined
              ? qtm
              : getObject(fallbackEvent, ["qtm", "Qtm"]) ?? fallbackEvent
          }
          defaultOpen
        />

        <details className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-800/60 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Event / Heritage
              </span>
              <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Heritage contains state and transition as distinct objects
              </span>
            </span>

            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition-transform group-open:rotate-180 dark:border-zinc-700 dark:text-zinc-300"
            >
              <svg viewBox="0 0 20 20" fill="none" className="size-4">
                <path
                  d="m5 7.5 5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </summary>

          <div className="space-y-3 border-t border-zinc-200 p-3 sm:p-4 dark:border-zinc-700">
            {heritage ? (
              <HeritageSections heritage={heritage} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No heritage object was returned by the event.
              </p>
            )}
          </div>
        </details>

        {runtime !== undefined && (
          <ResultSection
            title="EventMap / Runtime"
            description="Runtime data owned by EventMap"
            value={runtime}
          />
        )}
      </div>
    </section>
  );
}

function ResultCard({ result, tab }) {
  if (result === null || result === undefined) return null;

  if (tab === "open") {
    return <OpenResults result={result} />;
  }

  if (tab === "transit") {
    return <TransitResults result={result} />;
  }

  return (
    <section className="mt-7">
      <ResultHeading
        eyebrow="Operation result"
        title={tab === "create" ? "Created substrate" : "Exile result"}
      />

      <ResultSection
        title="Result"
        description="Response returned by the QTM API"
        value={result}
        defaultOpen
      />
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
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>

      <input
        className={`h-9 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${
          mono ? "font-mono" : ""
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>

      <input
        type="number"
        min="0"
        step="1"
        className="h-9 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2.5 font-mono text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        required
      />
    </label>
  );
}

export default function Home() {
  const [tab, setTab] = useState("create");

  const [substrates, setSubstrates] = useState([]);
  const [selectedSubstrate, setSelectedSubstrate] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [name, setName] = useState("");
  const [indices, setIndices] = useState(
    "0,0,0,0,0,0,0,0,0,0,0,0",
  );
  const [entropy, setEntropy] = useState("");

  const [purpose, setPurpose] = useState(44);
  const [coin, setCoin] = useState(0);
  const [account, setAccount] = useState(0);
  const [change, setChange] = useState(0);
  const [external, setExternal] = useState(0);
  const [activation, setActivation] = useState(1);

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSubstrates = useCallback(async (preferredName) => {
    setListLoading(true);
    setListError("");

    try {
      const res = await fetch(`${API_BASE}/wallets`, {
        cache: "no-store",
      });

      const data = await readResponse(res);

      if (!Array.isArray(data.substrates)) {
        throw new Error("The API returned an invalid substrate list.");
      }

      setSubstrates(data.substrates);

      setSelectedSubstrate((current) => {
        const preferred = preferredName || current;

        if (
          preferred &&
          data.substrates.some((item) => item.name === preferred)
        ) {
          return preferred;
        }

        return data.substrates[0]?.name || "";
      });
    } catch (err) {
      setListError(
        err instanceof Error
          ? err.message
          : "Unable to load substrates.",
      );
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubstrates();
  }, [loadSubstrates]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResult(null);

    if (tab !== "create" && !selectedSubstrate) {
      setError("Select a substrate before performing this operation.");
      return;
    }

    setLoading(true);

    try {
      let res;

      if (tab === "create") {
        const substrateName = name.trim();

        if (!substrateName) {
          throw new Error("Enter a substrate name.");
        }

        res = await fetch(`${API_BASE}/wallets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: substrateName,
            indices,
            entropy: entropy.trim() || substrateName,
          }),
        });

        const data = await readResponse(res);

        setResult(data);
        setName("");
        setEntropy("");

        await loadSubstrates(substrateName);
      } else if (tab === "open") {
        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}`,
          { cache: "no-store" },
        );

        setResult(await readResponse(res));
      } else if (tab === "transit") {
        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/transit`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              purpose,
              coin,
              account,
              change,
              external,
              activation,
            }),
          },
        );

        setResult(await readResponse(res));
        await loadSubstrates(selectedSubstrate);
      } else if (tab === "exile") {
        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/exile`,
          { method: "POST" },
        );

        setResult(await readResponse(res));
        await loadSubstrates(selectedSubstrate);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  const substrateRequired = tab !== "create";

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-8 font-sans sm:py-12 dark:bg-black">
      <main className="w-full max-w-2xl">
        <header className="mb-7">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>

          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50">
            QTM substrate console
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Manage substrates using the Rust API server (
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">
              qtm-api
            </code>
            ) and the <code>qp_hd</code> wallet engine.
          </p>
        </header>

        <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label
              htmlFor="substrate"
              className="text-sm font-semibold text-zinc-800 dark:text-zinc-200"
            >
              Substrate
            </label>

            <button
              type="button"
              onClick={() => loadSubstrates()}
              disabled={listLoading}
              className="rounded-md px-2 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-zinc-800"
            >
              {listLoading ? "Refreshing..." : "Refresh list"}
            </button>
          </div>

          <select
            id="substrate"
            value={selectedSubstrate}
            onChange={(e) => {
              setSelectedSubstrate(e.target.value);
              setResult(null);
              setError("");
            }}
            disabled={listLoading || substrates.length === 0}
            className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800"
          >
            {substrates.length === 0 && (
              <option value="">
                {listLoading
                  ? "Loading substrates..."
                  : "No substrates available"}
              </option>
            )}

            {substrates.map((substrate) => (
              <option key={substrate.name} value={substrate.name}>
                {substrate.name} — dimension {substrate.dimension}
                {" · "}activations {substrate.activations}
              </option>
            ))}
          </select>

          {listError && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              Unable to load the substrate list: {listError}
            </p>
          )}

          {!listLoading && !listError && substrates.length === 0 && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              No substrates were found. Create one using the Create tab.
            </p>
          )}

          {selectedSubstrate && (
            <p className="mt-2 break-all text-xs text-zinc-500 dark:text-zinc-400">
              Selected:{" "}
              <span className="font-mono">{selectedSubstrate}</span>
            </p>
          )}
        </section>

        <nav
          aria-label="Substrate operations"
          className="mb-5 grid grid-cols-4 gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setResult(null);
                setError("");
              }}
              className={`min-w-0 rounded-lg px-1.5 py-2 text-sm font-medium transition-colors sm:px-2 ${
                tab === t.id
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {TABS.find((t) => t.id === tab).label}
            </h2>

            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {tab === "create" &&
                "Initialize a substrate with its indices and entropy."}
              {tab === "open" &&
                "Inspect QuantPerm state and transition heritage."}
              {tab === "transit" &&
                "Derive an event and inspect its QTM and heritage."}
              {tab === "exile" &&
                "Exile the selected substrate using the wallet engine."}
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

                <Field
                  label="12 indices (comma-separated, 0–2047 each)"
                  value={indices}
                  onChange={setIndices}
                  required
                  mono
                />

                <Field
                  label="Entropy text (optional)"
                  value={entropy}
                  onChange={setEntropy}
                  placeholder="Defaults to the substrate name"
                />
              </>
            )}

            {substrateRequired && selectedSubstrate && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Operation target
                </span>

                <p className="mt-0.5 break-all font-mono text-sm text-zinc-900 dark:text-zinc-50">
                  {selectedSubstrate}
                </p>
              </div>
            )}

            {tab === "transit" && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:gap-x-4">
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
            )}

            <button
              type="submit"
              aria-busy={loading}
              disabled={
                loading ||
                listLoading ||
                (substrateRequired && !selectedSubstrate)
              }
              className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
                />
              )}

              {TABS.find((t) => t.id === tab).label}
            </button>
          </form>
        </section>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <ResultCard result={result} tab={tab} />

        <footer className="mt-9 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
          QTM substrate console
        </footer>
      </main>
    </div>
  );
}
