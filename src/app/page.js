"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";
const TABS = [
  { id: "create", label: "Create" },
  { id: "open", label: "Open / Receive" },
  { id: "transit", label: "Transit" },
  { id: "exile", label: "Exile" },
];

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const objectAt = (source, keys) => {
  if (!isRecord(source)) return undefined;
  for (const key of keys) if (isRecord(source[key])) return source[key];
  return undefined;
};
const valueAt = (source, keys) => {
  if (!isRecord(source)) return undefined;
  for (const key of keys) {
    if (source[key] !== null && source[key] !== undefined) return source[key];
  }
  return undefined;
};
const formatKey = (key) => String(key)
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase());

function friendlyValue(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (["string", "number", "bigint"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.length ? `${value.length} items` : "None";
  return "Details available";
}

function flatten(value, prefix = "", rows = []) {
  if (value === null || value === undefined) {
    if (prefix) rows.push([prefix, "Not provided"]);
  } else if (Array.isArray(value)) {
    if (!value.length && prefix) rows.push([prefix, "None"]);
    value.forEach((item, i) => flatten(item, `${prefix || "Item"} ${i + 1}`, rows));
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    if (!entries.length && prefix) rows.push([prefix, "No details returned"]);
    entries.forEach(([key, child]) =>
      flatten(child, prefix ? `${prefix} · ${formatKey(key)}` : formatKey(key), rows));
  } else {
    rows.push([prefix || "Value", friendlyValue(value)]);
  }
  return rows;
}

function hasContent(value) {
  return value !== null && value !== undefined &&
    (typeof value !== "object" || (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0));
}

async function readResponse(response) {
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { response_text: text }; }
  }
  if (!response.ok) {
    const message = valueAt(data, ["error", "message", "detail"]);
    throw new Error(`${message ?? `Request failed (${response.status})`}${response.statusText ? ` (${response.statusText})` : ""}`);
  }
  return data;
}

function eventMapOf(source) {
  const direct = objectAt(source, ["event", "event_map", "eventMap"]);
  if (direct) return direct;
  const frame = objectAt(source, ["frame"]);
  const frameEvent = objectAt(frame, ["event", "event_map", "eventMap"]);
  if (frameEvent) return frameEvent;
  const tx = objectAt(frame, ["quantum_transaction", "quantumTransaction"]);
  return objectAt(tx, ["event", "event_map", "eventMap"]);
}

function ResultHeading({ eyebrow, title }) {
  return <div>
    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{eyebrow}</p>
    <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
  </div>;
}

function KeyValueList({ value, emptyText = "No details were returned." }) {
  const rows = flatten(value);
  if (!rows.length) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyText}</p>;
  return <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 text-sm sm:grid-cols-[minmax(130px,0.75fr)_minmax(0,1.5fr)]">
    {rows.map(([key, val], i) => <div key={`${key}-${i}`} className="contents">
      <dt className="min-w-0 break-words text-zinc-500 dark:text-zinc-400">{key}</dt>
      <dd className="min-w-0 break-words font-medium text-zinc-800 dark:text-zinc-200">{val}</dd>
    </div>)}
  </dl>;
}

function ResultSection({ title, description, value, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
    <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-800/60">
      <span className="min-w-0">
        <span className="block break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
        {description && <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">{description}</span>}
      </span>
      <span className={`flex size-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 transition-transform dark:border-zinc-700 ${open ? "rotate-180" : ""}`} aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" className="size-4"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    </button>
    {open && <div className="border-t border-zinc-200 px-3 py-3 sm:px-4 dark:border-zinc-800">
      {!hasContent(value) ? <p className="text-sm text-zinc-500 dark:text-zinc-400">This information was not returned by the API.</p> : <KeyValueList value={value} />}
    </div>}
  </section>;
}

function Field({ label, value, onChange, required = false, placeholder = "", mono = false, type = "text", autoComplete }) {
  return <label className="flex min-w-0 flex-col gap-1">
    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
    <input type={type} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder}
      className={`h-9 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${mono ? "font-mono" : ""}`} />
  </label>;
}

function NumberField({ label, value, onChange, min = 0 }) {
  return <label className="flex min-w-0 flex-col gap-1">
    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
    <input type="number" min={min} step="1" value={value} onChange={(e) => onChange(e.target.value)} required
      className="h-9 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2.5 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800" />
  </label>;
}

function ReceiveUnitIdentifiers({ amount }) {
  const count = Number(amount);
  if (!Number.isSafeInteger(count) || count <= 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">A valid positive amount was not returned; unit identifiers cannot be listed.</p>;
  }
  return <section className="space-y-3">
    <div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Receive unit identifiers</h3>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{count} {count === 1 ? "unit" : "units"} · Display ordinals 1–{count}</p>
    </div>
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: count }, (_, i) => i + 1).map((id) => <li key={id} className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Unit</span><span className="font-mono text-sm font-semibold">{id}</span>
      </li>)}
    </ol>
    <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">These are display ordinals from 1 through N, not distinct persisted identifiers supplied by the API.</p>
  </section>;
}

function OpenResults({ result }) {
  const directory = result?.directory;
  const receive = result?.receive;
  const frame = objectAt(receive, ["frame"]) ?? receive;
  const transaction = objectAt(frame, ["quantum_transaction", "quantumTransaction"]);
  const event = eventMapOf(receive);
  const depth = objectAt(event, ["depth"]);
  const objects = Array.isArray(depth?.objects) ? depth.objects : [];
  const amount = valueAt(transaction, ["amount"]) ?? result?.requested_amount;
  return <section className="mt-5 space-y-4">
    <ResultHeading eyebrow="Open result" title="Substrate directory and receive depth" />
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">Substrate directory</h3>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Directory metadata returned by the API for the selected substrate.</p>
      <div className="mt-4"><KeyValueList value={directory} emptyText="The API did not return directory metadata." /></div>
    </div>
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">Receive event depth</h3>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Readable fields from the event returned by the receive operation.</p>
      <div className="mt-4"><KeyValueList value={depth} emptyText="No event depth was returned." /></div>
      {objects.length > 0 && <div className="mt-4 space-y-2">{objects.map((item, i) => <div key={`${item?.identifier ?? "object"}-${i}`} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <h4 className="mb-3 text-sm font-medium">Retained object {item?.position ?? i + 1}</h4><KeyValueList value={item} />
      </div>)}</div>}
    </div>
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">QuantumTransaction validation</h3>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{transaction ? "The API returned a QuantumTransaction from the receive operation." : "The response did not contain the expected QuantumTransaction."}</p>
      <div className="mt-4"><KeyValueList value={{ transaction_returned: Boolean(transaction), amount, flow: result?.flow, constant: valueAt(transaction, ["constant"]), qtm: objectAt(transaction, ["qtm"]) }} /></div>
      <div className="mt-5"><ReceiveUnitIdentifiers amount={amount} /></div>
    </div>
    {event && <ResultSection title="Receive event fields" description="Event data displayed as key–value pairs." value={event} />}
  </section>;
}

function EventMapSections({ event, prefix = "" }) {
  const depth = objectAt(event, ["depth"]);
  const heritage = objectAt(event, ["heritage", "state_heritage", "stateHeritage"]);
  const transition = objectAt(event, ["transition", "transition_heritage", "transitionHeritage"]);
  return <div className="space-y-3">
    <ResultSection title={`${prefix}Event Map`} description="Event fields returned by the API, displayed without raw JSON syntax." value={event} defaultOpen />
    {depth && <ResultSection title={`${prefix}Event depth`} value={depth} />}
    {heritage && <ResultSection title={`${prefix}Heritage state`} value={heritage} />}
    {transition && <ResultSection title={`${prefix}Transition`} value={transition} />}
  </div>;
}

function TransitResults({ result, network, path }) {
  const frame = objectAt(result, ["frame"]);
  const event = eventMapOf(result);
  return <section className="mt-5 space-y-4">
    <ResultHeading eyebrow="Transit result" title="QP44 event" />
    <ResultSection title="QTM values" value={objectAt(frame, ["qtm", "Qtm"])} defaultOpen />
    <ResultSection title="Network and path" value={{ network: network?.name ?? network?.id ?? "Not specified", network_identifier: network?.id ?? "Not returned", path: path || network?.path || "Not specified" }} />
    {event ? <EventMapSections event={event} /> : <ResultSection title="Event Map" value={undefined} />}
    <ResultSection title="Additional transit fields" description="Other returned fields presented as key–value pairs." value={result} />
  </section>;
}

function ExileResults({ result }) {
  const frame = objectAt(result, ["frame"]);
  const event = eventMapOf(result);
  return <section className="mt-5 space-y-4">
    <ResultHeading eyebrow="Exile result" title="Exile event" />
    <ResultSection title="Stored QTM" value={objectAt(frame, ["qtm", "Qtm"])} defaultOpen />
    {event ? <EventMapSections event={event} prefix="Exile " /> : <ResultSection title="Exile Event Map" value={undefined} />}
    <ResultSection title="Additional exile fields" description="Other returned fields presented as key–value pairs." value={result} />
  </section>;
}

function ResultCard({ result, tab, network, path }) {
  if (result === null || result === undefined) return null;
  return <div className="mt-5 space-y-4">
    {tab === "open" && <OpenResults result={result} />}
    {tab === "transit" && <TransitResults result={result} network={network} path={path} />}
    {tab === "exile" && <ExileResults result={result} />}
    {tab === "create" && <section className="space-y-3">
      <ResultHeading eyebrow="Create result" title="Substrate creation" />
      <ResultSection title="Created substrate" value={result} defaultOpen />
    </section>}
  </div>;
}

export default function Home() {
  const [tab, setTab] = useState("create");
  const [substrates, setSubstrates] = useState([]);
  const [selectedSubstrate, setSelectedSubstrate] = useState("");
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
  const [language, setLanguage] = useState("");
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

  const loadSubstrates = useCallback(async (preferred) => {
    setListLoading(true);
    setListError("");
    try {
      const response = await fetch(`${API_BASE}/wallets`, { cache: "no-store" });
      const data = await readResponse(response);
      if (!Array.isArray(data.substrates)) throw new Error("The API response did not contain a substrates list.");
      const valid = data.substrates.filter((item) => item && typeof item.name === "string");
      setSubstrates(valid);
      setSelectedSubstrate((current) => {
        const wanted = preferred || current;
        return wanted && valid.some((item) => item.name === wanted) ? wanted : valid[0]?.name || "";
      });
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Unable to load substrates.");
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadNetworks = useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError("");
    try {
      const response = await fetch(`${API_BASE}/networks`, { cache: "no-store" });
      const data = await readResponse(response);
      if (!Array.isArray(data.networks)) throw new Error("The API response did not contain a networks list.");
      const valid = data.networks.filter((n) => n && typeof n.id === "string" && typeof n.name === "string");
      setNetworks(valid);
      setSelectedNetwork((current) => valid.some((n) => n.id === current) ? current : valid[0]?.id || "");
      const first = valid[0];
      if (first) {
        if (Number.isFinite(first.purpose)) setPurpose((current) => current === "44" ? String(first.purpose) : current);
        if (Number.isFinite(first.coin)) setCoin((current) => current === "0" ? String(first.coin) : current);
        setPath((current) => current || first.path || "");
      }
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : "Unable to load networks.");
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  useEffect(() => { loadSubstrates(); }, [loadSubstrates]);
  useEffect(() => { loadNetworks(); }, [loadNetworks]);

  const currentNetwork = networks.find((n) => n.id === selectedNetwork) ?? null;

  function handleNetworkChange(id) {
    const network = networks.find((n) => n.id === id);
    setSelectedNetwork(id);
    setResult(null);
    setError("");
    if (!network) return;
    if (Number.isFinite(network.purpose)) setPurpose(String(network.purpose));
    if (Number.isFinite(network.coin)) setCoin(String(network.coin));
    setPath(network.path || "");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (tab !== "create" && !selectedSubstrate) {
      setError("Select a substrate before performing this operation.");
      return;
    }
    setLoading(true);
    try {
      let response;
      if (tab === "create") {
        const substrateName = name.trim();
        if (!substrateName) throw new Error("Enter a substrate name.");
        let payload;
        if (seedSource === "bip39") {
          if (!phrase.trim()) throw new Error("Enter a BIP39 mnemonic phrase.");
          if (!language) throw new Error("Select a BIP39 language.");
          payload = { name: substrateName, seed_source: "bip39", phrase: phrase.trim(), language, passphrase };
        } else {
          const parsed = indices.split(",").map((item) => item.trim());
          if (parsed.length !== 12 || parsed.some((item) => item === "" || !/^\d+$/.test(item) || !Number.isSafeInteger(Number(item)) || Number(item) < 0 || Number(item) > 2047)) {
            throw new Error("Enter exactly 12 indices, each an integer from 0 to 2047.");
          }
          payload = { name: substrateName, seed_source: "persistent", indices: parsed.map(Number).join(","), entropy: entropy.trim() || substrateName };
        }
        response = await fetch(`${API_BASE}/wallets`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        const data = await readResponse(response);
        setResult(data);
        setName(""); setEntropy(""); setPhrase(""); setPassphrase("");
        await loadSubstrates(substrateName);
      } else if (tab === "open") {
        const amount = Number(receiveAmount);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Receive amount must be a positive safe integer.");
        if (!["receive", "change"].includes(receiveFlow)) throw new Error("Select a valid receive flow.");
        const walletUrl = `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}`;
        const directoryResponse = await fetch(walletUrl, { method: "GET", cache: "no-store" });
        const directory = await readResponse(directoryResponse);
        const receiveResponse = await fetch(`${walletUrl}/receive`, {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ amount, flow: receiveFlow }),
        });
        const receive = await readResponse(receiveResponse);
        setResult({ directory, receive, requested_amount: amount, flow: receiveFlow });
      } else if (tab === "transit") {
        if (!selectedNetwork) throw new Error("Select a network before transit.");
        const numeric = { purpose: Number(purpose), coin: Number(coin), account: Number(account), change: Number(change), external: Number(external), activation: Number(activation) };
        for (const [key, val] of Object.entries(numeric)) {
          if (!Number.isSafeInteger(val) || val < 0) throw new Error(`${key} must be a non-negative safe integer.`);
        }
        response = await fetch(`${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/transit`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network: selectedNetwork, path: path.trim() || undefined, ...numeric }),
        });
        setResult(await readResponse(response));
        await loadSubstrates(selectedSubstrate);
      } else if (tab === "exile") {
        response = await fetch(`${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/exile`, {
          method: "POST", headers: { "Content-Type": "application/json" },
        });
        setResult(await readResponse(response));
        await loadSubstrates(selectedSubstrate);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const substrateRequired = tab !== "create";

  return <div className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-900 sm:px-6 sm:py-12 dark:bg-zinc-950 dark:text-zinc-100">
    <main className="mx-auto w-full max-w-6xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">QuantPerm · QTM</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50">QTM substrate console</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">Manage substrates using the Rust API server <code className="rounded-sm bg-zinc-200/80 px-1 py-0.5 text-xs dark:bg-zinc-800">qtm-api</code> and the <code>qp_hd</code> wallet engine.</p>
      </header>

      <div className="mb-5 grid min-w-0 grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
      <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="substrate" className="text-sm font-semibold">Substrate</label>
          <button type="button" onClick={() => loadSubstrates()} disabled={listLoading} className="rounded-sm px-2 py-1 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800">{listLoading ? "Refreshing..." : "Refresh list"}</button>
        </div>
        <select id="substrate" value={selectedSubstrate} onChange={(e) => { setSelectedSubstrate(e.target.value); setResult(null); setError(""); }} disabled={listLoading || !substrates.length}
          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800">
          {!substrates.length && <option value="">{listLoading ? "Loading substrates..." : "No substrates available"}</option>}
          {substrates.map((s, i) => <option key={`${s.name}-${i}`} value={s.name}>{s.name} — dimension {s.dimension ?? "not returned"} · activations {s.activations ?? "not returned"}</option>)}
        </select>
        {selectedSubstrate && <div className="mt-3 space-y-2">
          <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">Selected: <span className="font-mono">{selectedSubstrate}</span></p>
          <ResultSection title="Selected substrate details" description="Fields returned for the selected substrate." value={substrates.find((s) => s.name === selectedSubstrate) ?? {}} />
        </div>}
        {listError && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">Unable to load the substrate list: {listError}</p>}
        {!listLoading && !listError && !substrates.length && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No substrates were found. Create one using the Create tab.</p>}
      </section>

      <section className="flex min-w-0 flex-col rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Event records</p>
          <h2 className="mt-2 text-lg font-semibold">Event Store</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Open the event store view to inspect persisted event records separately from the selected substrate summary.</p>
        </div>
        <a href="/eventstore" className="mt-auto inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-800">Open Event Store</a>
      </section>

      <section className="flex min-w-0 flex-col rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Network tools</p>
          <h2 className="mt-2 text-lg font-semibold">Network</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Open the dedicated network view to inspect network-related data and controls independently of substrate management.</p>
        </div>
        <a href="/network" className="mt-auto inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-800">Open Network</a>
      </section>
      </div>

      <nav aria-label="Substrate operations" className="mb-5 grid grid-cols-4 gap-1 rounded-md border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900">
        {TABS.map((item) => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => { setTab(item.id); setResult(null); setError(""); }}
          className={`min-w-0 rounded-sm px-1.5 py-2 text-sm font-medium transition-colors sm:px-2 ${tab === item.id ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"}`}>{item.label}</button>)}
      </nav>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4">
          <h2 className="text-base font-semibold">{TABS.find((t) => t.id === tab)?.label}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {tab === "create" && "Initialize a substrate using persistent indices or a BIP39 mnemonic."}
            {tab === "open" && "Inspect the substrate directory and receive event depth; list unit ordinals from 1 through N."}
            {tab === "transit" && "Select a network, customize its path, and inspect the resulting QP44 event."}
            {tab === "exile" && "Exile the selected substrate using the wallet engine and inspect its event."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {tab === "create" && <>
            <Field label="Substrate name" value={name} onChange={setName} required placeholder="mars-lab" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {["persistent", "bip39"].map((source) => <button key={source} type="button" aria-pressed={seedSource === source} onClick={() => { setSeedSource(source); setError(""); }}
                className={`rounded-md border px-3 py-3 text-left ${seedSource === source ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-800/70" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"}`}>
                <span className="block text-sm font-semibold">{source === "bip39" ? "BIP39 mnemonic" : "Persistent indices"}</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">{source === "bip39" ? "Derive indices and entropy from a mnemonic." : "Enter the 12 PERM indices and conditioning entropy."}</span>
              </button>)}
            </div>
            {seedSource === "persistent" ? <>
              <Field label="12 indices (comma-separated, 0–2047 each)" value={indices} onChange={setIndices} required mono />
              <Field label="Conditioning entropy" value={entropy} onChange={setEntropy} placeholder="Defaults to the substrate name" />
            </> : <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
              <label className="flex flex-col gap-1"><span className="text-sm font-medium">BIP39 language</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} required className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <option value="">Select language</option><option value="english">English</option><option value="chinese_simplified">Chinese (Simplified)</option><option value="chinese_traditional">Chinese (Traditional)</option><option value="french">French</option><option value="italian">Italian</option><option value="japanese">Japanese</option><option value="korean">Korean</option><option value="spanish">Spanish</option><option value="czech">Czech</option><option value="portuguese">Portuguese</option>
                </select>
              </label>
              <label className="flex flex-col gap-1"><span className="text-sm font-medium">Mnemonic phrase</span>
                <textarea value={phrase} onChange={(e) => setPhrase(e.target.value)} required rows={3} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Enter words in the selected language" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              </label>
              <Field label="BIP39 passphrase (optional)" value={passphrase} onChange={setPassphrase} type="password" autoComplete="off" />
              <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">The phrase and passphrase are sent to the API for validation and derivation.</p>
            </div>}
          </>}

          {tab === "open" && <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
            <div><h3 className="text-sm font-semibold">Substrate directory and depth</h3><p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">Inspect directory metadata and validate the QuantumTransaction send flow through the receive endpoint.</p></div>
            <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-sm font-medium">Selected substrate</p><p className="mt-1 break-all font-mono text-sm">{selectedSubstrate || "No substrate selected"}</p><p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">The API must return directory metadata to confirm the server-side path.</p></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberField label="Transaction amount (N)" value={receiveAmount} onChange={setReceiveAmount} min={1} />
              <label className="flex flex-col gap-1"><span className="text-sm font-medium">Receive flow</span><select value={receiveFlow} onChange={(e) => setReceiveFlow(e.target.value)} className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"><option value="receive">Receive</option><option value="change">Change</option></select></label>
            </div>
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">Unit ordinals are displayed from 1 through the amount returned by the API. They are not canonical persisted identifiers unless the backend supplies them.</p>
          </div>}

          {tab === "transit" && <>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex min-w-0 flex-col gap-1"><span className="text-sm font-medium">Network</span><select value={selectedNetwork} onChange={(e) => handleNetworkChange(e.target.value)} disabled={networkLoading || !networks.length} className="h-9 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">{!networks.length && <option value="">{networkLoading ? "Loading..." : "No networks"}</option>}{networks.map((n, i) => <option key={`${n.id}-${i}`} value={n.id}>{n.name} — {n.id}</option>)}</select></label>
              <Field label="Derivation path" value={path} onChange={setPath} placeholder="m/44'/0'/0'/0/0" mono />
              <NumberField label="Purpose" value={purpose} onChange={setPurpose} /><NumberField label="Coin" value={coin} onChange={setCoin} />
              <NumberField label="Account" value={account} onChange={setAccount} /><NumberField label="Change" value={change} onChange={setChange} />
              <NumberField label="External" value={external} onChange={setExternal} /><NumberField label="Activation" value={activation} onChange={setActivation} />
            </div>
            {networkError && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">Networks could not be loaded: {networkError} <button type="button" onClick={loadNetworks} className="font-semibold underline">Retry</button></p>}
            {currentNetwork && <ResultSection title="Selected network definition" value={currentNetwork} />}
          </>}

          <button type="submit" aria-busy={loading} disabled={loading || listLoading || (substrateRequired && !selectedSubstrate) || (tab === "transit" && (networkLoading || !selectedNetwork))}
            className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300">
            {loading ? "Processing..." : tab === "open" ? "Open and Receive" : TABS.find((t) => t.id === tab)?.label}
          </button>
        </form>
      </section>

      {error && <p role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <ResultCard result={result} tab={tab} network={currentNetwork} path={path} />
      <footer className="mt-9 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">QTM substrate console</footer>
    </main>
  </div>;
}
