"use client";

import { useState } from "react";

const API_BASE = "http://localhost:8080";

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

function ResultCard({ result }) {
  if (!result) return null;

  return (
    <div className="mt-6 rounded border border-zinc-300 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">
        {result.mock ? "Mock result (not real yet):" : "Result:"}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
        {Object.entries(result)
          .filter(([key]) => key !== "mock")
          .map(([key, value]) => (
            <FragmentRow key={key} k={key} v={value} />
          ))}
      </dl>
    </div>
  );
}

function FragmentRow({ k, v }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className="break-all">{formatValue(k, v)}</dd>
    </>
  );
}

export default function Home() {
  const [tab, setTab] = useState("create");

  // Create fields
  const [name, setName] = useState("");
  const [indices, setIndices] = useState("0,0,0,0,0,0,0,0,0,0,0,0");
  const [entropy, setEntropy] = useState("");

  // Open / Exile field
  const [openName, setOpenName] = useState("");
  const [exileName, setExileName] = useState("");

  // Transit fields
  const [transitName, setTransitName] = useState("");
  const [purpose, setPurpose] = useState(44);
  const [coin, setCoin] = useState(0);
  const [account, setAccount] = useState(0);
  const [change, setChange] = useState(0);
  const [external, setExternal] = useState(0);
  const [activation, setActivation] = useState(1);

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);

    try {
      let res;

      if (tab === "create") {
        res = await fetch(`${API_BASE}/wallets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, indices, entropy }),
        });
      } else if (tab === "open") {
        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(openName)}`,
        );
      } else if (tab === "transit") {
        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(transitName)}/transit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
      } else if (tab === "exile") {
        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(exileName)}/exile`,
          { method: "POST" },
        );
      }

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "something went wrong");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="mb-1 text-2xl font-semibold text-black dark:text-zinc-50">
          QTM substrate console
        </h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Talking to a real, separate Rust API server (<code>qtm-api</code>,
          :8080) — its logic is still mocked internally until{" "}
          <code>qtm-graph</code> is available.
        </p>

        <div className="mb-6 flex gap-1 rounded-full bg-zinc-200 p-1 dark:bg-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setResult(null);
                setError("");
              }}
              className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
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
                label="Wallet name"
                value={name}
                onChange={setName}
                required
                placeholder="my-wallet"
              />
              <Field
                label="12 indices (comma-separated, 0–2047 each)"
                value={indices}
                onChange={setIndices}
                mono
              />
              <Field
                label="Entropy text (optional — defaults to wallet name)"
                value={entropy}
                onChange={setEntropy}
                placeholder="leave blank to use the wallet name"
              />
            </>
          )}

          {tab === "open" && (
            <Field
              label="Wallet name"
              value={openName}
              onChange={setOpenName}
              required
              placeholder="my-wallet"
            />
          )}

          {tab === "transit" && (
            <>
              <Field
                label="Wallet name"
                value={transitName}
                onChange={setTransitName}
                required
                placeholder="my-wallet"
              />
              <div className="grid grid-cols-2 gap-4">
                <NumberField
                  label="purpose"
                  value={purpose}
                  onChange={setPurpose}
                />
                <NumberField label="coin" value={coin} onChange={setCoin} />
                <NumberField
                  label="account"
                  value={account}
                  onChange={setAccount}
                />
                <NumberField
                  label="change"
                  value={change}
                  onChange={setChange}
                />
                <NumberField
                  label="external"
                  value={external}
                  onChange={setExternal}
                />
                <NumberField
                  label="activation"
                  value={activation}
                  onChange={setActivation}
                />
              </div>
            </>
          )}

          {tab === "exile" && (
            <Field
              label="Wallet name"
              value={exileName}
              onChange={setExileName}
              required
              placeholder="my-wallet"
            />
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
          >
            {loading ? "Working..." : TABS.find((t) => t.id === tab).label}
          </button>
        </form>

        {error && (
          <p className="mt-6 rounded bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        <ResultCard result={result} />
      </main>
    </div>
  );
}

function Field({ label, value, onChange, required, placeholder, mono }) {
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
        className="rounded border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}