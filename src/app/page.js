
"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";

const TABS = [
  { id: "create", label: "Create" },
  { id: "open", label: "Open" },
  { id: "transit", label: "Transit" },
  { id: "exile", label: "Exile" },
];

function formatValue(key, value) {
  if (key === "commitment") return `qp${value}`;
  if (key === "coordinate") return `0x${value}`;
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
  const displayValue =
    v !== null && typeof v === "object"
      ? JSON.stringify(v, null, 2)
      : formatValue(k, v);

  return (
    <>
      <dt>{k}</dt>
      <dd className="break-all whitespace-pre-wrap">{displayValue}</dd>
    </>
  );
}

function ResultCard({ result }) {
  if (!result) return null;

  return (
    <div className="mt-6 rounded border border-zinc-300 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">
        Result:
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
        {Object.entries(result).map(([key, value]) => (
          <FragmentRow key={key} k={key} v={value} />
        ))}
      </dl>
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
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>

      <input
        className={`rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 ${
          mono ? "font-mono text-sm" : ""
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
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>

      <input
        type="number"
        min="0"
        step="1"
        className="rounded border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
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
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="mb-1 text-2xl font-semibold text-black dark:text-zinc-50">
          QTM substrate console
        </h1>

        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Manage substrates using the Rust API server (
          <code>qtm-api</code>) and the actual <code>qp_hd</code> wallet
          engine.
        </p>

        <section className="mb-6 rounded-lg border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
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
              className="text-sm text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
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
            className="w-full rounded border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
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
            <p className="mt-3 text-sm text-red-700 dark:text-red-300">
              Unable to load the substrate list: {listError}
            </p>
          )}

          {!listLoading && !listError && substrates.length === 0 && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              No substrates were found. Create one using the Create tab.
            </p>
          )}

          {selectedSubstrate && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Selected substrate:{" "}
              <span className="font-mono">{selectedSubstrate}</span>
            </p>
          )}
        </section>

        <div className="mb-6 flex gap-1 rounded-full bg-zinc-200 p-1 dark:bg-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setResult(null);
                setError("");
              }}
              className={`flex-1 rounded-full px-2 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-white text-black shadow dark:bg-zinc-950 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
              }`}
            >
              {t.label}
            </button>
          ))}
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
            <div className="rounded border border-zinc-200 px-3 py-3 text-sm dark:border-zinc-700">
              <span className="text-zinc-500 dark:text-zinc-400">
                Operation target
              </span>

              <p className="mt-1 break-all font-mono text-zinc-900 dark:text-zinc-50">
                {selectedSubstrate}
              </p>
            </div>
          )}

          {tab === "transit" && (
            <div className="grid grid-cols-2 gap-4">
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

          {tab === "open" && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Open the selected substrate and retrieve its current QTM state.
            </p>
          )}

          {tab === "exile" && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Exile the selected substrate using the Rust wallet engine.
            </p>
          )}

          <button
            type="submit"
            disabled={
              loading ||
              listLoading ||
              (substrateRequired && !selectedSubstrate)
            }
            className="mt-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {loading
              ? "Working..."
              : TABS.find((t) => t.id === tab).label}
          </button>
        </form>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <ResultCard result={result} />
      </main>
    </div>
  );
}
