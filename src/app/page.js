
"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";

const TABS = [
  { id: "create", label: "Create" },
  { id: "open", label: "Open" },
  { id: "transit", label: "Transit" },
  { id: "exile", label: "Exile" },
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueOf(source, keys) {
  if (!isRecord(source)) return undefined;

  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function formatValue(value) {
  if (value === undefined) return "Not provided";
  if (value === null) return "null";

  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function readResponse(response) {
  const body = await response.text();
  let data = {};

  if (body) {
    try {
      data = JSON.parse(body);
    } catch {
      data = { response_text: body };
    }
  }

  if (!response.ok) {
    const message = valueOf(data, ["error", "message", "detail"]);
    throw new Error(
      `${message === undefined ? `Request failed (${response.status})` : formatValue(message)}${response.statusText ? ` — ${response.statusText}` : ""}`,
    );
  }

  return data;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  return readResponse(response);
}

function Section({ title, children }) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      {children}
    </section>
  );
}

function DataView({ title, value }) {
  return (
    <Section title={title}>
      {value === undefined || value === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No data was returned by the API.
        </p>
      ) : (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded-md bg-zinc-50 p-3 font-mono text-xs leading-5 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          {formatValue(value)}
        </pre>
      )}
    </Section>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  placeholder = "",
  type = "text",
  mono = false,
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className={`h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800 ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function NumberField({ label, value, onChange, min = 0 }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        type="number"
        min={min}
        step="1"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
      />
    </label>
  );
}

function NetworkSelect({ networks, value, onChange, loading }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Network
      </span>
      <select
        value={value}
        disabled={loading || networks.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
      >
        {networks.length === 0 && (
          <option value="">
            {loading ? "Loading networks..." : "No networks available"}
          </option>
        )}
        {networks.map((network) => (
          <option key={network.id} value={network.id}>
            {network.name} — {network.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubstrateDetails({ substrate, directory }) {
  const details = directory ?? substrate;

  if (!details) return null;

  const name = valueOf(details, ["name", "substrate"]) ?? substrate?.name;
  const path = valueOf(details, ["namespace", "directory", "path"]);
  const dimension = valueOf(details, ["dimension"]);
  const activations = valueOf(details, [
    "activations",
    "activation_count",
    "activationCount",
  ]);
  const commitment = valueOf(details, ["commitment"]);
  const coordinate = valueOf(details, ["coordinate"]);

  return (
    <Section title="Selected environment directory">
      <dl className="grid grid-cols-[minmax(100px,0.7fr)_minmax(0,1.5fr)] gap-x-4 gap-y-3 text-sm">
        {[
          ["Identifier", name],
          ["Directory", path],
          ["Dimension", dimension],
          ["Activations", activations],
          ["Commitment", commitment],
          ["Coordinate", coordinate],
        ].map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="break-words text-zinc-500 dark:text-zinc-400">
              {label}
            </dt>
            <dd className="break-all font-mono text-zinc-800 dark:text-zinc-200">
              {value === undefined ? "Not returned" : formatValue(value)}
            </dd>
          </div>
        ))}
      </dl>
      <DataView title="Complete directory response" value={details} />
    </Section>
  );
}

export default function Home() {
  const [tab, setTab] = useState("create");

  const [substrates, setSubstrates] = useState([]);
  const [selectedSubstrate, setSelectedSubstrate] = useState("");
  const [directory, setDirectory] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [networks, setNetworks] = useState([]);
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const [networkLoading, setNetworkLoading] = useState(true);
  const [networkError, setNetworkError] = useState("");

  const [name, setName] = useState("");
  const [seedSource, setSeedSource] = useState("persistent");
  const [indices, setIndices] = useState("0,0,0,0,0,0,0,0,0,0,0,0");
  const [entropy, setEntropy] = useState("");

  const [phrase, setPhrase] = useState("");
  const [language, setLanguage] = useState("english");
  const [passphrase, setPassphrase] = useState("");

  const [path, setPath] = useState("");
  const [purpose, setPurpose] = useState("44");
  const [coin, setCoin] = useState("0");
  const [account, setAccount] = useState("0");
  const [change, setChange] = useState("0");
  const [external, setExternal] = useState("0");
  const [activation, setActivation] = useState("1");

  const [receiveAmount, setReceiveAmount] = useState("1");
  const [receiveFlow, setReceiveFlow] = useState("receive");

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);

  const loadSubstrates = useCallback(async (preferredName) => {
    setListLoading(true);
    setListError("");

    try {
      const data = await apiRequest("/wallets");

      if (!Array.isArray(data.substrates)) {
        throw new Error("The API did not return a substrates array.");
      }

      const valid = data.substrates.filter(
        (item) => item && typeof item.name === "string",
      );

      setSubstrates(valid);

      setSelectedSubstrate((current) => {
        const preferred = preferredName || current;
        if (valid.some((item) => item.name === preferred)) return preferred;
        return valid[0]?.name ?? "";
      });
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Unable to load substrates.",
      );
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadNetworks = useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError("");

    try {
      const data = await apiRequest("/networks");

      if (!Array.isArray(data.networks)) {
        throw new Error("The API did not return a networks array.");
      }

      const valid = data.networks.filter(
        (network) =>
          network &&
          typeof network.id === "string" &&
          typeof network.name === "string",
      );

      setNetworks(valid);

      setSelectedNetwork((current) =>
        valid.some((network) => network.id === current)
          ? current
          : valid[0]?.id ?? "",
      );

      const first = valid[0];
      if (first) {
        if (Number.isFinite(first.purpose)) {
          setPurpose((current) =>
            current === "44" ? String(first.purpose) : current,
          );
        }
        if (Number.isFinite(first.coin)) {
          setCoin((current) =>
            current === "0" ? String(first.coin) : current,
          );
        }
        setPath((current) => current || first.path || "");
      }
    } catch (err) {
      setNetworkError(
        err instanceof Error ? err.message : "Unable to load networks.",
      );
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubstrates();
  }, [loadSubstrates]);

  useEffect(() => {
    loadNetworks();
  }, [loadNetworks]);

  const openSubstrate = useCallback(async (substrateName) => {
    if (!substrateName) {
      setDirectory(null);
      return null;
    }

    setOpening(true);
    setListError("");

    try {
      const data = await apiRequest(
        `/wallets/${encodeURIComponent(substrateName)}`,
      );

      setDirectory(data);
      return data;
    } catch (err) {
      setDirectory(null);
      const message =
        err instanceof Error ? err.message : "Unable to open the substrate.";
      setListError(message);
      throw err;
    } finally {
      setOpening(false);
    }
  }, []);

  async function activateSubstrate(substrateName) {
    setSelectedSubstrate(substrateName);
    setDirectory(null);
    setResult(null);
    setError("");
    setListError("");

    if (!substrateName) return;

    try {
      await openSubstrate(substrateName);
    } catch {
      // openSubstrate publishes the error in the substrate-list panel.
    }
  }

  function handleNetworkChange(networkId) {
    const network = networks.find((item) => item.id === networkId);

    setSelectedNetwork(networkId);
    setResult(null);
    setError("");

    if (!network) return;

    if (Number.isFinite(network.purpose)) {
      setPurpose(String(network.purpose));
    }
    if (Number.isFinite(network.coin)) {
      setCoin(String(network.coin));
    }
    setPath(network.path || "");
  }

  async function handleCreate() {
    const substrateName = name.trim();

    if (!substrateName) {
      throw new Error("Enter a substrate identifier.");
    }

    let payload;

    if (seedSource === "bip39") {
      if (!phrase.trim()) throw new Error("Enter a BIP39 mnemonic.");
      if (!language) throw new Error("Select a BIP39 language.");

      payload = {
        name: substrateName,
        seed_source: "bip39",
        phrase: phrase.trim(),
        language,
        passphrase,
      };
    } else {
      const parsed = indices.split(",").map((item) => item.trim());

      if (
        parsed.length !== 12 ||
        parsed.some(
          (item) =>
            !/^\d+$/.test(item) ||
            !Number.isInteger(Number(item)) ||
            Number(item) < 0 ||
            Number(item) > 2047,
        )
      ) {
        throw new Error(
          "Enter exactly 12 PERM indices, each from 0 through 2047.",
        );
      }

      payload = {
        name: substrateName,
        seed_source: "persistent",
        indices: parsed.map(Number).join(","),
        entropy: entropy.trim() || substrateName,
      };
    }

    const created = await apiRequest("/wallets", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setName("");
    setEntropy("");
    setPhrase("");
    setPassphrase("");

    await loadSubstrates(substrateName);

    setSelectedSubstrate(substrateName);
    const opened = await openSubstrate(substrateName);

    setResult({
      operation: "create",
      identifier: substrateName,
      creation: created,
      directory: opened,
    });
  }

  async function handleOpen() {
    if (!selectedSubstrate) {
      throw new Error("Select a substrate first.");
    }

    const amount = Number(receiveAmount);

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Receive amount must be a positive safe integer.");
    }

    if (!["receive", "change"].includes(receiveFlow)) {
      throw new Error("Select a valid receive flow.");
    }

    const base = `/wallets/${encodeURIComponent(selectedSubstrate)}`;

    // Open the persisted environment directory first.
    const opened = await apiRequest(base);

    // Receive is a separate operation on that same environment.
    const received = await apiRequest(`${base}/receive`, {
      method: "POST",
      body: JSON.stringify({
        amount,
        flow: receiveFlow,
      }),
    });

    setDirectory(opened);
    setResult({
      operation: "open",
      substrate: selectedSubstrate,
      directory: opened,
      receive: received,
      requested_amount: amount,
      flow: receiveFlow,
    });
  }

  async function handleTransit() {
    if (!selectedSubstrate) {
      throw new Error("Select a substrate first.");
    }

    if (!selectedNetwork) {
      throw new Error("Select a network first.");
    }

    const numericFields = {
      purpose: Number(purpose),
      coin: Number(coin),
      account: Number(account),
      change: Number(change),
      external: Number(external),
      activation: Number(activation),
    };

    for (const [field, value] of Object.entries(numericFields)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${field} must be a non-negative safe integer.`);
      }
    }

    const base = `/wallets/${encodeURIComponent(selectedSubstrate)}`;

    // Resolve/open the same environment before transit.
    const opened = await apiRequest(base);

    const transit = await apiRequest(`${base}/transit`, {
      method: "POST",
      body: JSON.stringify({
        network: selectedNetwork,
        path: path.trim() || undefined,
        ...numericFields,
      }),
    });

    await loadSubstrates(selectedSubstrate);

    let refreshed = opened;
    try {
      refreshed = await apiRequest(base);
      setDirectory(refreshed);
    } catch {
      // Keep the successful transit result visible if refresh fails.
    }

    setResult({
      operation: "transit",
      substrate: selectedSubstrate,
      directory: refreshed,
      event: transit,
    });
  }

  async function handleExile() {
    if (!selectedSubstrate) {
      throw new Error("Select a substrate first.");
    }

    const base = `/wallets/${encodeURIComponent(selectedSubstrate)}`;

    // Open the selected environment; never substitute another identifier.
    const opened = await apiRequest(base);

    const exile = await apiRequest(`${base}/exile`, {
      method: "POST",
    });

    await loadSubstrates(selectedSubstrate);

    let refreshed = opened;
    try {
      refreshed = await apiRequest(base);
      setDirectory(refreshed);
    } catch {
      // The exile result remains available even if a later read fails.
    }

    setResult({
      operation: "exile",
      substrate: selectedSubstrate,
      directory: refreshed,
      event: exile,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);

    try {
      if (tab === "create") await handleCreate();
      if (tab === "open") await handleOpen();
      if (tab === "transit") await handleTransit();
      if (tab === "exile") await handleExile();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The operation failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  const currentNetwork =
    networks.find((network) => network.id === selectedNetwork) ?? null;

  const selectedRecord =
    substrates.find((item) => item.name === selectedSubstrate) ?? null;

  const substrateRequired = tab !== "create";

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-900 sm:px-6 sm:py-12 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            QTM substrate console
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Each identifier selects one environment directory. Create and open
            operations resolve that directory through the Rust API, and transit
            and exile target the same selected identifier.
          </p>
        </header>

        <section className="mb-5 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="substrate"
              className="text-sm font-semibold"
            >
              Environment directory
            </label>
            <button
              type="button"
              disabled={listLoading}
              onClick={() => loadSubstrates(selectedSubstrate)}
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            >
              {listLoading ? "Refreshing..." : "Refresh list"}
            </button>
          </div>

          <select
            id="substrate"
            value={selectedSubstrate}
            disabled={listLoading || substrates.length === 0}
            onChange={(event) => activateSubstrate(event.target.value)}
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {substrates.length === 0 && (
              <option value="">
                {listLoading ? "Loading environments..." : "No environments found"}
              </option>
            )}
            {substrates.map((substrate) => (
              <option key={substrate.name} value={substrate.name}>
                {substrate.name}
                {" — dimension "}
                {substrate.dimension ?? "not returned"}
                {" · activations "}
                {substrate.activations ?? "not returned"}
              </option>
            ))}
          </select>

          {opening && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Opening the selected environment directory…
            </p>
          )}

          {selectedSubstrate && (
            <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
              Active identifier:{" "}
              <span className="font-mono">{selectedSubstrate}</span>
            </p>
          )}

          {directory && (
            <SubstrateDetails
              substrate={selectedRecord}
              directory={directory}
            />
          )}

          {listError && (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {listError}
            </p>
          )}

          {!listLoading && !listError && substrates.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No environments are listed. Create one using the Create tab.
            </p>
          )}
        </section>

        <nav
          aria-label="Environment operations"
          className="mb-5 grid grid-cols-4 gap-1 rounded-md border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              onClick={() => {
                setTab(item.id);
                setResult(null);
                setError("");
              }}
              className={`rounded-md px-1.5 py-2 text-sm font-medium ${
                tab === item.id
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">
            {TABS.find((item) => item.id === tab)?.label}
          </h2>

          <p className="mb-4 mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {tab === "create" &&
              "Create an environment directory using persistent PERM indices or a BIP39 mnemonic."}
            {tab === "open" &&
              "Open the selected directory and execute receive against the same environment."}
            {tab === "transit" &&
              "Execute transit against the selected environment directory."}
            {tab === "exile" &&
              "Execute exile against the selected environment directory."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === "create" && (
              <>
                <Field
                  label="Environment identifier"
                  value={name}
                  onChange={setName}
                  required
                  placeholder="mars-lab"
                  mono
                />

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    {
                      id: "persistent",
                      title: "Persistent indices",
                      description: "Use twelve PERM indices and conditioning entropy.",
                    },
                    {
                      id: "bip39",
                      title: "BIP39 mnemonic",
                      description: "Derive the environment from a mnemonic phrase.",
                    },
                  ].map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      aria-pressed={seedSource === choice.id}
                      onClick={() => setSeedSource(choice.id)}
                      className={`rounded-md border p-3 text-left ${
                        seedSource === choice.id
                          ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-800"
                          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {choice.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                        {choice.description}
                      </span>
                    </button>
                  ))}
                </div>

                {seedSource === "persistent" ? (
                  <>
                    <Field
                      label="12 PERM indices (comma-separated, 0–2047)"
                      value={indices}
                      onChange={setIndices}
                      required
                      mono
                    />
                    <Field
                      label="Conditioning entropy"
                      value={entropy}
                      onChange={setEntropy}
                      placeholder="Defaults to the identifier"
                    />
                  </>
                ) : (
                  <div className="space-y-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-sm font-medium">BIP39 language</span>
                      <select
                        value={language}
                        onChange={(event) => setLanguage(event.target.value)}
                        className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      >
                        {[
                          ["english", "English"],
                          ["chinese_simplified", "Chinese (Simplified)"],
                          ["chinese_traditional", "Chinese (Traditional)"],
                          ["french", "French"],
                          ["italian", "Italian"],
                          ["japanese", "Japanese"],
                          ["korean", "Korean"],
                          ["spanish", "Spanish"],
                          ["czech", "Czech"],
                          ["portuguese", "Portuguese"],
                        ].map(([id, label]) => (
                          <option key={id} value={id}>{label}</option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Mnemonic phrase</span>
                      <textarea
                        value={phrase}
                        onChange={(event) => setPhrase(event.target.value)}
                        required
                        rows={3}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        placeholder="Enter the mnemonic words"
                      />
                    </label>

                    <Field
                      label="BIP39 passphrase (optional)"
                      value={passphrase}
                      onChange={setPassphrase}
                      type="password"
                    />

                    <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                      The mnemonic and passphrase are sent to your API. Use
                      this only over HTTPS with an API you trust.
                    </p>
                  </div>
                )}
              </>
            )}

            {tab === "open" && (
              <>
                <p className="break-all rounded-md bg-zinc-50 p-3 font-mono text-sm dark:bg-zinc-950">
                  {selectedSubstrate || "Select an environment above"}
                </p>

                <NumberField
                  label="Receive amount"
                  value={receiveAmount}
                  onChange={setReceiveAmount}
                  min={1}
                />

                <label className="flex flex-col gap-1">
                  <span className="text-sm font-medium">Receive flow</span>
                  <select
                    value={receiveFlow}
                    onChange={(event) => setReceiveFlow(event.target.value)}
                    className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="receive">Receive</option>
                    <option value="change">Change</option>
                  </select>
                </label>
              </>
            )}

            {tab === "transit" && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NetworkSelect
                    networks={networks}
                    value={selectedNetwork}
                    onChange={handleNetworkChange}
                    loading={networkLoading}
                  />
                  <Field
                    label="Derivation path"
                    value={path}
                    onChange={setPath}
                    placeholder="m/44'/0'/0'/0/0"
                    mono
                  />
                  <NumberField label="Purpose" value={purpose} onChange={setPurpose} />
                  <NumberField label="Coin" value={coin} onChange={setCoin} />
                  <NumberField label="Account" value={account} onChange={setAccount} />
                  <NumberField label="Change" value={change} onChange={setChange} />
                  <NumberField label="External" value={external} onChange={setExternal} />
                  <NumberField label="Activation" value={activation} onChange={setActivation} />
                </div>

                {networkError && (
                  <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
                    Network presets failed to load: {networkError}
                    <button
                      type="button"
                      onClick={loadNetworks}
                      className="ml-2 underline"
                    >
                      Retry
                    </button>
                  </p>
                )}

                {currentNetwork && (
                  <DataView
                    title="Selected network definition"
                    value={currentNetwork}
                  />
                )}
              </>
            )}

            {tab === "exile" && (
              <p className="break-all rounded-md bg-zinc-50 p-3 font-mono text-sm dark:bg-zinc-950">
                Environment to exile: {selectedSubstrate || "None selected"}
              </p>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                opening ||
                listLoading ||
                (substrateRequired && !selectedSubstrate) ||
                (tab === "transit" &&
                  (networkLoading || !selectedNetwork))
              }
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading
                ? "Processing..."
                : tab === "create"
                  ? "Create environment directory"
                  : tab === "open"
                    ? "Open directory and receive"
                    : tab === "transit"
                      ? "Transit selected environment"
                      : "Exile selected environment"}
            </button>
          </form>
        </section>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {result && (
          <div className="mt-5 space-y-3">
            <Section title="Operation completed">
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Operation:{" "}
                <span className="font-mono">{result.operation}</span>
              </p>
              <p className="break-all text-sm text-zinc-600 dark:text-zinc-300">
                Environment:{" "}
                <span className="font-mono">
                  {result.substrate ?? result.identifier ?? selectedSubstrate}
                </span>
              </p>
            </Section>
            <DataView title="Directory / environment state" value={result.directory} />
            {result.creation !== undefined && (
              <DataView title="Creation response" value={result.creation} />
            )}
            {result.receive !== undefined && (
              <DataView title="Receive response" value={result.receive} />
            )}
            {result.event !== undefined && (
              <DataView title="Operation event" value={result.event} />
            )}
            <DataView title="Complete operation response" value={result} />
          </div>
        )}

        <footer className="mt-9 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
          QTM substrate console · Rust API · qp_hd environment directories
        </footer>
      </div>
    </main>
  );
}
