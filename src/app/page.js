"use client";
import { useCallback, useEffect, useId, useState } from "react";
const API_BASE = "https://qtm-api.onrender.com";
const TABS = [
  { id: "create", label: "Create" },
  { id: "open", label: "Open" },
  { id: "transit", label: "Transit" },
  { id: "exile", label: "Exile" },
];
const BIP39_LANGUAGES = [
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
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function displayValue(value) {
  if (value === undefined) return "Not returned";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return formatValue(value);
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
      `${message === undefined ? `Request failed (${response.status})` : formatValue(message)}${
        response.statusText ? ` — ${response.statusText}` : ""
      }`,
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
function Section({ title, children, className = "" }) {
  return (
    <section
      className={`min-w-0 space-y-3 rounded-lg border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      {children}
    </section>
  );
}
function ValueTree({ value, depth = 0 }) {
  if (value === undefined || value === null || typeof value !== "object") {
    return (
      <span
        className={`break-all ${
          typeof value === "string"
            ? "font-mono"
            : "font-medium text-zinc-800 dark:text-zinc-200"
        }`}
      >
        {displayValue(value)}
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-zinc-500">Empty list</span>;
    }
    return (
      <div className="min-w-0 space-y-2">
        {value.map((item, index) => (
          <details
            key={index}
            open={depth < 1 && value.length <= 4}
            className="min-w-0 rounded-md border border-zinc-200 dark:border-zinc-800"
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
              Item {index + 1}
              {isRecord(item) ? " · fields" : ""}
              {Array.isArray(item) ? ` · ${item.length} items` : ""}
            </summary>
            <div className="min-w-0 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <ValueTree value={item} depth={depth + 1} />
            </div>
          </details>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return <span className="text-zinc-500">No fields</span>;
  }
  return (
    <dl className="min-w-0 divide-y divide-zinc-100 dark:divide-zinc-800">
      {entries.map(([key, item]) => {
        const nested = isRecord(item) || Array.isArray(item);
        return (
          <div
            key={key}
            className="grid min-w-0 grid-cols-1 gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[minmax(110px,0.7fr)_minmax(0,1.5fr)] sm:gap-x-4"
          >
            <dt className="break-words text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {key.replaceAll("_", " ")}
            </dt>
            <dd className="min-w-0 text-sm text-zinc-800 dark:text-zinc-200">
              {nested ? (
                <details className="min-w-0">
                  <summary className="cursor-pointer select-none text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {Array.isArray(item)
                      ? `${item.length} item${item.length === 1 ? "" : "s"}`
                      : `${Object.keys(item).length} field${
                          Object.keys(item).length === 1 ? "" : "s"
                        }`}
                  </summary>
                  <div className="mt-2 min-w-0 rounded-md bg-zinc-50 p-2 dark:bg-zinc-950">
                    <ValueTree value={item} depth={depth + 1} />
                  </div>
                </details>
              ) : (
                <ValueTree value={item} depth={depth + 1} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
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
        <ValueTree value={value} />
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
  disabled = false,
  autoComplete = "off",
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
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className={`h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800 ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}
function NumberField({ label, value, onChange, min = 0, max }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
      />
    </label>
  );
}
function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  required = false,
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <select
        id={id}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-800"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function SubstrateDetails({ substrate, directory }) {
  const details = directory ?? substrate;
  if (!details) return null;
  const fields = [
    ["Identifier", valueOf(details, ["name", "substrate"]) ?? substrate?.name],
    ["Directory", valueOf(details, ["namespace", "directory", "path"])],
    ["Dimension", valueOf(details, ["dimension"])],
    [
      "Activations",
      valueOf(details, ["activations", "activation_count", "activationCount"]),
    ],
    ["Commitment", valueOf(details, ["commitment", "qtm_commitment"])],
    ["Coordinate", valueOf(details, ["coordinate", "qtm_coordinate"])],
    ["Network", valueOf(details, ["network", "qtm_network"])],
    ["Structural value", valueOf(details, ["structural_value"])],
    ["Retained mass", valueOf(details, ["retained_mass"])],
    ["Sigma", valueOf(details, ["sigma", "qtm_sigma"])],
  ];
  return (
    <Section title="Selected environment">
      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(110px,0.7fr)_minmax(0,1.5fr)]">
        {fields.map(([label, value]) => (
          <div key={label} className="grid min-w-0 grid-cols-subgrid sm:col-span-2">
            <dt className="break-words text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {label}
            </dt>
            <dd className="break-all text-sm text-zinc-800 dark:text-zinc-200">
              {displayValue(value)}
            </dd>
          </div>
        ))}
      </dl>
      <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          More environment fields
        </summary>
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <ValueTree value={details} />
        </div>
      </details>
    </Section>
  );
}
function EnvironmentSelect({
  substrates,
  value,
  onChange,
  loading,
}) {
  const options = substrates.map((substrate) => ({
    value: substrate.name,
    label: `${substrate.name} · dimension ${substrate.dimension ?? "—"} · activations ${substrate.activations ?? "—"}`,
  }));
  return (
    <SelectField
      label="Environment directory"
      value={value}
      onChange={onChange}
      options={options}
      placeholder={
        loading ? "Loading environments…" : "Select an environment"
      }
      disabled={loading || substrates.length === 0}
      required
    />
  );
}
function NetworkSelect({ networks, value, onChange, loading }) {
  return (
    <SelectField
      label="Network preset"
      value={value}
      onChange={onChange}
      options={networks.map((network) => ({
        value: network.id,
        label: `${network.name} · ${network.id}`,
      }))}
      placeholder={loading ? "Loading networks…" : "Select a network"}
      disabled={loading || networks.length === 0}
      required
    />
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
  const [exileDepthPath, setExileDepthPath] = useState("");
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
        throw new Error("The API did not return a substrates list.");
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
        err instanceof Error ? err.message : "Unable to load environments.",
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
        throw new Error("The API did not return a network list.");
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
        err instanceof Error ? err.message : "Unable to open the environment.";
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
      // The selected environment's read error is shown in the environment panel.
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
      throw new Error("Enter an environment identifier.");
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
      throw new Error("Select an environment first.");
    }
    const amount = Number(receiveAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Receive amount must be a positive safe integer.");
    }
    if (!["receive", "change"].includes(receiveFlow)) {
      throw new Error("Select a valid receive flow.");
    }
    const base = `/wallets/${encodeURIComponent(selectedSubstrate)}`;
    const opened = await apiRequest(base);
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
      throw new Error("Select an environment first.");
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
      // Preserve the successful transit result if refresh fails.
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
      throw new Error("Select an environment first.");
    }
    const depthPath = exileDepthPath.trim();
    if (!depthPath) {
      throw new Error("Enter the network depth path to exile.");
    }
    const base = `/wallets/${encodeURIComponent(selectedSubstrate)}`;
    // Resolve the exact selected environment before submitting the operation.
    const opened = await apiRequest(base);
    // The API must validate depth_path against persisted events in this
    // selected environment. It must not treat this value as an arbitrary
    // filesystem path supplied by the client.
    const exile = await apiRequest(`${base}/exile`, {
      method: "POST",
      body: JSON.stringify({
        depth_path: depthPath,
      }),
    });
    await loadSubstrates(selectedSubstrate);
    let refreshed = opened;
    try {
      refreshed = await apiRequest(base);
      setDirectory(refreshed);
    } catch {
      // Keep the exile response visible if refreshing the directory fails.
    }
    setResult({
      operation: "exile",
      substrate: selectedSubstrate,
      depth_path: depthPath,
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
  const submitDisabled =
    loading ||
    opening ||
    listLoading ||
    (substrateRequired && !selectedSubstrate) ||
    (tab === "create" && !name.trim()) ||
    (tab === "transit" && (networkLoading || !selectedNetwork)) ||
    (tab === "exile" && !exileDepthPath.trim());
  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-5 text-zinc-900 sm:px-6 sm:py-8 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            QTM substrate console
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Select an environment, inspect its persisted state, and run
            operations against that environment. API results are displayed as
            readable fields rather than raw JSON.
          </p>
        </header>
        <section className="mb-4 space-y-3 rounded-lg border border-zinc-200 bg-white p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Active environment</h2>
            <button
              type="button"
              disabled={listLoading}
              onClick={() => loadSubstrates(selectedSubstrate)}
              className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {listLoading ? "Refreshing…" : "Refresh environments"}
            </button>
          </div>
          <EnvironmentSelect
            substrates={substrates}
            value={selectedSubstrate}
            loading={listLoading}
            onChange={activateSubstrate}
          />
          {opening && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Reading the selected environment…
            </p>
          )}
          {selectedSubstrate && (
            <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
              Selected identifier:{" "}
              <span className="font-mono text-zinc-800 dark:text-zinc-200">
                {selectedSubstrate}
              </span>
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
              No environments are listed. Create one in the Create tab.
            </p>
          )}
        </section>
        <nav
          aria-label="Environment operations"
          className="mb-4 grid grid-cols-4 gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
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
              className={`min-w-0 rounded-md px-1 py-2.5 text-sm font-medium transition-colors ${
                tab === item.id
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white"
                  : "text-zinc-600 hover:bg-white/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-base font-semibold">
            {TABS.find((item) => item.id === tab)?.label}
          </h2>
          <p className="mb-4 mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {tab === "create" &&
              "Create an environment from persistent PERM indices or a BIP39 mnemonic."}
            {tab === "open" &&
              "Read the selected environment and execute receive against it."}
            {tab === "transit" &&
              "Choose a network preset and execute transit in the selected environment."}
            {tab === "exile" &&
              "Provide a network depth path to identify the event to exile in the selected environment."}
          </p>
          <form onSubmit={handleSubmit} className="min-w-0 space-y-4">
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
                      description:
                        "Use twelve PERM indices and conditioning entropy.",
                    },
                    {
                      id: "bip39",
                      title: "BIP39 mnemonic",
                      description:
                        "Derive the environment from a mnemonic phrase.",
                    },
                  ].map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      aria-pressed={seedSource === choice.id}
                      onClick={() => setSeedSource(choice.id)}
                      className={`min-w-0 rounded-md border p-3 text-left transition-colors ${
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
                  <div className="space-y-3">
                    <Field
                      label="12 PERM indices (comma-separated, 0–2047)"
                      value={indices}
                      onChange={setIndices}
                      required
                      mono
                      placeholder="0,0,0,0,0,0,0,0,0,0,0,0"
                    />
                    <Field
                      label="Conditioning entropy"
                      value={entropy}
                      onChange={setEntropy}
                      placeholder="Defaults to the identifier"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <SelectField
                      label="BIP39 language"
                      value={language}
                      onChange={setLanguage}
                      options={BIP39_LANGUAGES.map(([value, label]) => ({
                        value,
                        label,
                      }))}
                      required
                    />
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Mnemonic phrase
                      </span>
                      <textarea
                        value={phrase}
                        onChange={(event) => setPhrase(event.target.value)}
                        required
                        rows={3}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Enter the mnemonic words"
                        className="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
                      />
                    </label>
                    <Field
                      label="BIP39 passphrase (optional)"
                      value={passphrase}
                      onChange={setPassphrase}
                      type="password"
                      autoComplete="new-password"
                    />
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      The mnemonic and passphrase are sent to your API. Only
                      use this with an HTTPS API you control and trust.
                    </p>
                  </div>
                )}
              </>
            )}
            {tab === "open" && (
              <>
                <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-950">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Environment targeted
                  </p>
                  <p className="mt-1 break-all font-mono text-sm">
                    {selectedSubstrate || "Select an environment above"}
                  </p>
                </div>
                <NumberField
                  label="Receive amount"
                  value={receiveAmount}
                  onChange={setReceiveAmount}
                  min={1}
                />
                <SelectField
                  label="Receive flow"
                  value={receiveFlow}
                  onChange={setReceiveFlow}
                  options={[
                    { value: "receive", label: "Receive" },
                    { value: "change", label: "Change" },
                  ]}
                  required
                />
              </>
            )}
            {tab === "transit" && (
              <>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
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
                {networkError && (
                  <div
                    role="alert"
                    className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                  >
                    <p>Network presets failed to load: {networkError}</p>
                    <button
                      type="button"
                      onClick={loadNetworks}
                      className="mt-2 underline underline-offset-2"
                    >
                      Retry loading networks
                    </button>
                  </div>
                )}
                {currentNetwork && (
                  <DataView
                    title="Selected network"
                    value={currentNetwork}
                  />
                )}
              </>
            )}
            {tab === "exile" && (
              <div className="space-y-3">
                <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-950">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Environment targeted for exile
                  </p>
                  <p className="mt-1 break-all font-mono text-sm">
                    {selectedSubstrate || "Select an environment above"}
                  </p>
                </div>
                <Field
                  label="Network depth path"
                  value={exileDepthPath}
                  onChange={setExileDepthPath}
                  required
                  placeholder="Enter the persisted network depth path"
                  mono
                />
                <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Enter the logical depth path associated with the persisted
                  event. The API should match it against events inside the
                  selected environment and reject paths that do not belong to
                  that environment.
                </p>
              </div>
            )}
            <button
              type="submit"
              disabled={submitDisabled}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading
                ? "Processing…"
                : tab === "create"
                  ? "Create environment"
                  : tab === "open"
                    ? "Open and receive"
                    : tab === "transit"
                      ? "Transit selected environment"
                      : "Exile selected depth path"}
            </button>
          </form>
        </section>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
        {result && (
          <div className="mt-4 min-w-0 space-y-3">
            <Section title="Operation result">
              <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[minmax(110px,0.7fr)_minmax(0,1.5fr)]">
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Operation
                </dt>
                <dd className="break-words font-mono text-sm">
                  {result.operation}
                </dd>
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Environment
                </dt>
                <dd className="break-all font-mono text-sm">
                  {result.substrate ??
                    result.identifier ??
                    selectedSubstrate ??
                    "Not returned"}
                </dd>
                {result.depth_path !== undefined && (
                  <>
                    <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Network depth path
                    </dt>
                    <dd className="break-all font-mono text-sm">
                      {result.depth_path}
                    </dd>
                  </>
                )}
                {result.requested_amount !== undefined && (
                  <>
                    <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Receive amount
                    </dt>
                    <dd className="font-mono text-sm">
                      {result.requested_amount}
                    </dd>
                  </>
                )}
                {result.flow !== undefined && (
                  <>
                    <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Receive flow
                    </dt>
                    <dd className="font-mono text-sm">{result.flow}</dd>
                  </>
                )}
              </dl>
            </Section>
            {result.directory !== undefined && (
              <DataView
                title="Updated environment state"
                value={result.directory}
              />
            )}
            {result.creation !== undefined && (
              <DataView title="Creation result" value={result.creation} />
            )}
            {result.receive !== undefined && (
              <DataView title="Receive result" value={result.receive} />
            )}
            {result.event !== undefined && (
              <DataView title="Event result" value={result.event} />
            )}
          </div>
        )}
        <footer className="mt-8 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
          QTM substrate console · Rust API · qp_hd environment directories
        </footer>
      </div>
    </main>
  );
}