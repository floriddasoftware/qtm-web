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
  return (
    
      
{eyebrow}
      
{title}
    
  );
}

function KeyValueList({ value, emptyText = "No details were returned." }) {
  const rows = flatten(value);
  if (!rows.length) return 
{emptyText}
;
  return (
    
      {rows.map(([key, val], i) => (
        
          
{key}
          
{val}
        
      ))}
    
  );
}

function ResultSection({ title, description, value, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    
       setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-zinc-50 sm:px-3 dark:hover:bg-zinc-800/60"
      >
        
          {title}
          {description && (
            {description}
          )}
        
        
          
            
          
        
      
      {open && (
        
          {!hasContent(value) ? (
            
This information was not returned by the API.
          ) : (
            
          )}
        
      )}
    
  );
}

function Field({ label, value, onChange, required = false, placeholder = "", mono = false, type = "text", autoComplete }) {
  return (
    
      {label}
      {value} onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className={`h-8 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${mono ? "font-mono" : ""}`}
      />
    
  );
}

function NumberField({ label, value, onChange, min = 0 }) {
  return (
    
      {label}
       onChange(e.target.value)}
        required
        className="h-8 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 font-mono text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
      />
    
  );
}

function ReceiveUnitIdentifiers({ amount }) {
  const count = Number(amount);
  if (!Number.isSafeInteger(count) || count <= 0) {
    return 
A valid positive amount was not returned; unit identifiers cannot be listed.
;
  }
  return (
    
      
        
Receive unit identifiers
        
          {count} {count === 1 ? "unit" : "units"} · Display ordinals 1–{count}
        
      
      
        {Array.from({ length: count }, (_, i) => i + 1).map((id) => (
          
            Unit
            {id}
          
        ))}
      
      
        These are display ordinals from 1 through N, not distinct persisted identifiers supplied by the API.
      
    
  );
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
  return (
    
      
      
      
      {objects.length > 0 && (
        
          {objects.map((item, i) => (
            
          ))}
        
      )}
      
      
        
      
      {event && }
    
  );
}

function EventMapSections({ event, prefix = "" }) {
  const depth = objectAt(event, ["depth"]);
  const heritage = objectAt(event, ["heritage", "state_heritage", "stateHeritage"]);
  const transition = objectAt(event, ["transition", "transition_heritage", "transitionHeritage"]);
  return (
    
      
      {depth && }
      {heritage && }
      {transition && }
    
  );
}

function TransitResults({ result, network, path }) {
  const frame = objectAt(result, ["frame"]);
  const event = eventMapOf(result);
  return (
    
      
      
      
      {event ?  : }
      
    
  );
}

function ExileResults({ result }) {
  const frame = objectAt(result, ["frame"]);
  const event = eventMapOf(result);
  return (
    
      
      
      {event ?  : }
      
    
  );
}

function ResultCard({ result, tab, network, path }) {
  if (result === null || result === undefined) return null;
  return (
    
      {tab === "open" && }
      {tab === "transit" && }
      {tab === "exile" && }
      {tab === "create" && (
        
          
          
        
      )}
    
  );
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
      setSelectedNetwork((current) => (valid.some((n) => n.id === current) ? current : valid[0]?.id || ""));
      const first = valid[0];
      if (first) {
        if (Number.isFinite(first.purpose)) setPurpose((current) => (current === "44" ? String(first.purpose) : current));
        if (Number.isFinite(first.coin)) setCoin((current) => (current === "0" ? String(first.coin) : current));
        setPath((current) => current || first.path || "");
      }
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : "Unable to load networks.");
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
          if (
            parsed.length !== 12 ||
            parsed.some((item) => item === "" || !/^\d+$/.test(item) || !Number.isSafeInteger(Number(item)) || Number(item) < 0 || Number(item) > 2047)
          ) {
            throw new Error("Enter exactly 12 indices, each an integer from 0 to 2047.");
          }
          payload = { name: substrateName, seed_source: "persistent", indices: parsed.map(Number).join(","), entropy: entropy.trim() || substrateName };
        }
        response = await fetch(`${API_BASE}/wallets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await readResponse(response);
        setResult(data);
        setName("");
        setEntropy("");
        setPhrase("");
        setPassphrase("");
        await loadSubstrates(substrateName);
      } else if (tab === "open") {
        const amount = Number(receiveAmount);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Receive amount must be a positive safe integer.");
        if (!["receive", "change"].includes(receiveFlow)) throw new Error("Select a valid receive flow.");
        const walletUrl = `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}`;
        const directoryResponse = await fetch(walletUrl, { method: "GET", cache: "no-store" });
        const directory = await readResponse(directoryResponse);
        const receiveResponse = await fetch(`${walletUrl}/receive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ amount, flow: receiveFlow }),
        });
        const receive = await readResponse(receiveResponse);
        setResult({ directory, receive, requested_amount: amount, flow: receiveFlow });
      } else if (tab === "transit") {
        if (!selectedNetwork) throw new Error("Select a network before transit.");
        const numeric = {
          purpose: Number(purpose),
          coin: Number(coin),
          account: Number(account),
          change: Number(change),
          external: Number(external),
          activation: Number(activation),
        };
        for (const [key, val] of Object.entries(numeric)) {
          if (!Number.isSafeInteger(val) || val < 0) throw new Error(`${key} must be a non-negative safe integer.`);
        }
        response = await fetch(`${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/transit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network: selectedNetwork, path: path.trim() || undefined, ...numeric }),
        });
        setResult(await readResponse(response));
        await loadSubstrates(selectedSubstrate);
      } else if (tab === "exile") {
        response = await fetch(`${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/exile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

  return (
    
      
        
          
            QuantPerm · QTM
          
          
            QTM substrate console
          
          
            Manage substrates using the Rust API server{" "}
            qtm-api and the{" "}
            qp_hd wallet engine.
          
        

        
          
            
              
                Substrate
              
               loadSubstrates()}
                disabled={listLoading}
                className="rounded px-1.5 py-0.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
              >
                {listLoading ? "Refreshing…" : "Refresh"}
              
            
             {
                setSelectedSubstrate(e.target.value);
                setResult(null);
                setError("");
              }}
              disabled={listLoading || !substrates.length}
              className="h-8 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
            >
              {!substrates.length && (
                {listLoading ? "Loading substrates…" : "No substrates available"}
              )}
              {substrates.map((s, i) => (
                 {s.name} {s.dimension != null || s.activations != null ? ` · dim ${s.dimension ?? "—"} · act ${s.activations ?? "—"}` : ""}
              ))}
            
            {selectedSubstrate && (
              
                
                  Selected: {selectedSubstrate}
                
                 s.name === selectedSubstrate) ?? {}}
                />
              
            )}
            {listError && (
              
                Unable to load the substrate list: {listError}
              
            )}
            {!listLoading && !listError && !substrates.length && (
              
No substrates were found. Create one using the Create tab.
            )}
          

          
            
              
Event records
              
Event Store
              
                Inspect persisted event records separately from the selected substrate summary.
              
            
            
              Open Event Store
            
          

          
            
              
Network tools
              
Network
              
                Inspect network-related data and controls independently of substrate management.
              
            
            
              Open Network
            
          
        

        
          {TABS.map((item) => (
             {
                setTab(item.id);
                setResult(null);
                setError("");
              }}
              className={`min-w-0 rounded-sm px-1 py-1.5 text-xs font-medium transition-colors sm:px-1.5 sm:text-sm ${
                tab === item.id
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {item.label}
            
          ))}
        

        
          
            
{TABS.find((t) => t.id === tab)?.label}
            
              {tab === "create" && "Initialize a substrate using persistent indices or a BIP39 mnemonic."}
              {tab === "open" && "Inspect the substrate directory and receive event depth; list unit ordinals from 1 through N."}
              {tab === "transit" && "Select a network, customize its path, and inspect the resulting QP44 event."}
              {tab === "exile" && "Exile the selected substrate using the wallet engine and inspect its event."}
            
          

          
            {tab === "create" && (
              <>
                
                
                  {["persistent", "bip39"].map((source) => (
                     {
                        setSeedSource(source);
                        setError("");
                      }}
                      className={`rounded-md border px-2.5 py-2 text-left ${
                        seedSource === source
                          ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-800/70"
                          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                      }`}
                    >
                      
                        {source === "bip39" ? "BIP39 mnemonic" : "Persistent indices"}
                      
                      
                        {source === "bip39"
                          ? "Derive indices and entropy from a mnemonic."
                          : "Enter the 12 PERM indices and conditioning entropy."}
                      
                    
                  ))}
                
                {seedSource === "persistent" ? (
                  <>
                    
                    
                  
                ) : (
                  
                    
                      BIP39 language
                       setLanguage(e.target.value)}
                        required
                        className="h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        Select language
                        English
                        Chinese (Simplified)
                        Chinese (Traditional)
                        French
                        Italian
                        Japanese
                        Korean
                        Spanish
                        Czech
                        Portuguese
                      
                    
                    
                      Mnemonic phrase
                       setPhrase(e.target.value)}
                        required
                        rows={3}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Enter words in the selected language"
                        className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>
                    <Field label="BIP39 passphrase (optional)" value={passphrase} onChange={setPassphrase} type="password" autoComplete="off" />
                    <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                      The phrase and passphrase are sent to the API for validation and derivation.
                    </p>
                  </div>
                )}
              </>
            )}

            {tab === "open" && (
              <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-950/50">
                <div>
                  <h3 className="text-sm font-semibold">Substrate directory and depth</h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                    Inspect directory metadata and validate the QuantumTransaction send flow through the receive endpoint.
                  </p>
                </div>
                <div className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="text-[13px] font-medium">Selected substrate</p>
                  <p className="mt-0.5 break-all font-mono text-sm">{selectedSubstrate || "No substrate selected"}</p>
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    The API must return directory metadata to confirm the server-side path.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <NumberField label="Transaction amount (N)" value={receiveAmount} onChange={setReceiveAmount} min={1} />
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-medium">Receive flow</span>
                    <select
                      value={receiveFlow}
                      onChange={(e) => setReceiveFlow(e.target.value)}
                      className="h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="receive">Receive</option>
                      <option value="change">Change</option>
                    </select>
                  </label>
                </div>
                <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  Unit ordinals are displayed from 1 through the amount returned by the API. They are not canonical persisted identifiers unless the backend supplies them.
                </p>
              </div>
            )}

            {tab === "transit" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-medium">Network</span>
                    <select
                      value={selectedNetwork}
                      onChange={(e) => handleNetworkChange(e.target.value)}
                      disabled={networkLoading || !networks.length}
                      className="h-8 min-w-0 rounded-md border border-zinc-300 bg-white px-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {!networks.length && <option value="">{networkLoading ? "Loading…" : "No networks"}</option>}
                      {networks.map((n, i) => (
                        <option key={`${n.id}-${i}`} value={n.id}>
                          {n.name} — {n.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field label="Derivation path" value={path} onChange={setPath} placeholder="m/44'/0'/0'/0/0" mono />
                  <NumberField label="Purpose" value={purpose} onChange={setPurpose} />
                  <NumberField label="Coin" value={coin} onChange={setCoin} />
                  <NumberField label="Account" value={account} onChange={setAccount} />
                  <NumberField label="Change" value={change} onChange={setChange} />
                  <NumberField label="External" value={external} onChange={setExternal} />
                  <NumberField label="Activation" value={activation} onChange={setActivation} />
                </div>
                {networkError && (
                  <p
                    role="alert"
                    className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                  >
                    Networks could not be loaded: {networkError}{" "}
                    <button type="button" onClick={loadNetworks} className="font-semibold underline">
                      Retry
                    </button>
                  </p>
                )}
                {currentNetwork && <ResultSection title="Selected network definition" value={currentNetwork} />}
              </>
            )}

            <button
              type="submit"
              aria-busy={loading}
              disabled={
                loading ||
                listLoading ||
                (substrateRequired && !selectedSubstrate) ||
                (tab === "transit" && (networkLoading || !selectedNetwork))
              }
              className="mt-1.5 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading ? "Processing…" : tab === "open" ? "Open and Receive" : TABS.find((t) => t.id === tab)?.label}
            </button>
          </form>
        </section>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <ResultCard result={result} tab={tab} network={currentNetwork} path={path} />
        <footer className="mt-6 border-t border-zinc-200 pt-3 text-[11px] leading-4 text-zinc-500 dark:border-zinc-800 sm:mt-8 sm:pt-3.5 sm:text-xs">
          QTM substrate console
        </footer>
      </main>
    </div>
  );
}
</code></pre>
</body></html>
