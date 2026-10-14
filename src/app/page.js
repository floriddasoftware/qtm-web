
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
  "namespace",
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
  "transition",
  "tau",
  "delta",
  "gross_work",
  "grossWork",
  "net_work",
  "netWork",
  "mirror_bytes",
  "mirrorBytes",
  "activation",
  "depth",
];

function formatValue(key, value) {
  if (value === null || value === undefined) return String(value);
  if (key === "commitment") return `qp${value}`;
  if (key === "coordinate") return `0x${value}`;

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

function firstDefined(source, keys) {
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

function FragmentRow({ k, v }) {
  const displayValue =
    v !== null && typeof v === "object"
      ? JSON.stringify(v, null, 2)
      : formatValue(k, v);

  return (
    <>
      <dt className="break-words text-zinc-500 dark:text-zinc-400">
        {k.replaceAll("_", " ")}
      </dt>
      <dd className="min-w-0 break-all whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
        {displayValue}
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
      open={defaultOpen}
      className="group overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </span>
          {description && (
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          )}
        </span>

        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition-transform group-open:rotate-180 dark:border-zinc-700 dark:text-zinc-300"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="size-4"
          >
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

      <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-700">
        {!populated ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No data was returned for this section.
          </p>
        ) : entries ? (
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 text-xs sm:grid-cols-[minmax(100px,0.65fr)_minmax(0,1.6fr)]">
            {entries.map(([key, entryValue]) => (
              <FragmentRow key={key} k={key} v={entryValue} />
            ))}
          </dl>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-zinc-700 dark:text-zinc-300">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
}

function ResultCard({ result, tab }) {
  if (result === null || result === undefined) return null;

  if (tab === "open") {
    const state =
      firstDefined(result, [
        "state",
        "quantperm",
        "quant_perm",
        "quantPerm",
      ]) ?? pickFields(result, STATE_KEYS);

    const transition =
      firstDefined(result, [
        "transition",
        "transition_heritage",
        "transitionHeritage",
        "heritage",
      ]) ?? pickFields(result, TRANSITION_KEYS);

    const stateValue = hasContent(state) ? state : result;
    const transitionValue = hasContent(transition)
      ? transition
      : {};

    return (
      <section className="mt-7 space-y-3" aria-label="Open results">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            Open results
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Substrate state
          </h2>
        </div>

        <ResultSection
          title="State / QuantPerm"
          description="Current substrate state and QuantPerm data"
          value={stateValue}
          defaultOpen
        />

        <ResultSection
          title="Transition / Transition Heritage"
          description="Transition measurements and retained heritage"
          value={transitionValue}
        />
      </section>
    );
  }

  if (tab === "transit") {
    const event =
      firstDefined(result, ["event"]) ?? result;

    const qtm =
      firstDefined(event, ["qtm", "Qtm"]) ??
      firstDefined(result, ["event_qtm", "eventQtm"]);

    const heritage =
      firstDefined(event, [
        "heritage",
        "transition_heritage",
        "transitionHeritage",
      ]) ??
      firstDefined(result, [
        "event_heritage",
        "eventHeritage",
      ]);

    return (
      <section className="mt-7 space-y-3" aria-label="Transit results">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            Transit results
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            QP44 event
          </h2>
        </div>

        <ResultSection
          title="Event / QTM"
          description="QTM coordinates, commitment, and event state"
          value={qtm ?? (hasContent(event) ? event : result)}
          defaultOpen
        />

        <ResultSection
          title="Event / Heritage"
          description="Transition heritage associated with the event"
          value={heritage ?? {}}
        />
      </section>
    );
  }

  return (
    <section className="mt-7 space-y-3" aria-label="Operation result">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          Operation result
        </p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {tab === "create" ? "Created substrate" : "Exile result"}
        </h2>
      </div>

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
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>

      <input
        className={`w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800 ${
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
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>

      <input
        type="number"
        min="0"
        step="1"
        className="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 font-mono text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
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
        <header className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>

          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50">
            QTM substrate console
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Manage substrates through the Rust API server (
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">
              qtm-api
            </code>
            ) and the <code>qp_hd</code> wallet engine. Open and Transit
            results are organized by their state and heritage structures.
          </p>
        </header>

        <section className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-3 flex items-center justify-between gap-3">
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
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800"
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
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>Selected substrate</span>
              <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                {selectedSubstrate}
              </span>
            </div>
          )}
        </section>

        <nav
          aria-label="Substrate operations"
          className="mb-6 grid grid-cols-4 gap-1 rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
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
              className={`min-w-0 rounded-lg px-2 py-2.5 text-sm font-medium transition-colors ${
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
          <div className="mb-5">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {TABS.find((t) => t.id === tab).label} substrate
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {tab === "create" &&
                "Initialize a substrate with its indices and entropy."}
              {tab === "open" &&
                "Retrieve the current state and transition heritage."}
              {tab === "transit" &&
                "Derive a QTM event and inspect its QTM and heritage results."}
              {tab === "exile" &&
                "Exile the selected substrate using the Rust wallet engine."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-950">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Operation target
                </span>
                <p className="mt-1 break-all font-mono text-sm text-zinc-900 dark:text-zinc-50">
                  {selectedSubstrate}
                </p>
              </div>
            )}

            {tab === "transit" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              disabled={
                loading ||
                listLoading ||
                (substrateRequired && !selectedSubstrate)
              }
              className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
                />
              )}
              {loading
                ? "Working..."
                : `Run ${TABS.find((t) => t.id === tab).label}`}
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

        <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
          QTM substrate console · Results are returned by the API and displayed
          according to their response structure.
        </footer>
      </main>
    </div>
  );
}
