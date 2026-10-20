“use client”;

import { useCallback, useEffect, useMemo, useState } from “react”;

const API_BASE = “https://qtm-api.onrender.com”;
// API_BASE is the HTTP transport only. Substrate state is selected by name
// and resolved by the Rust API for every state-changing operation.

const TABS = [
{ id: “create”, label: “Create” },
{ id: “open”, label: “Open / Receive” },
{ id: “transit”, label: “Transit” },
{ id: “exile”, label: “Exile” },
];

const isRecord = (value) =>
value !== null && typeof value === “object” && !Array.isArray(value);

const objectAt = (source, keys) => {
if (!isRecord(source)) return undefined;
for (const key of keys) {
if (isRecord(source[key])) return source[key];
}
return undefined;
};

const valueAt = (source, keys) => {
if (!isRecord(source)) return undefined;
for (const key of keys) {
if (source[key] !== null && source[key] !== undefined) {
return source[key];
}
}
return undefined;
};

const formatKey = (key) =>
String(key)
.replace(/([a-z0-9])([A-Z])/g, “$1 $2”)
.replace(/[_-]+/g, “ “)
.replace(/\b\w/g, (character) => character.toUpperCase());

function friendlyValue(value) {
if (value === null || value === undefined || value === “”) return “Not provided”;
if (typeof value === “boolean”) return value ? “Yes” : “No”;
if ([“string”, “number”, “bigint”].includes(typeof value)) return String(value);
if (Array.isArray(value)) return value.length ? ${value.length} items : “None”;
return “Details available”;
}

function flatten(value, prefix = “”, rows = []) {
if (value === null || value === undefined) {
if (prefix) rows.push([prefix, “Not provided”]);
} else if (Array.isArray(value)) {
if (!value.length && prefix) rows.push([prefix, “None”]);
value.forEach((item, index) =>
flatten(item, ${prefix || "Item"} ${index + 1}, rows)
);
} else if (isRecord(value)) {
const entries = Object.entries(value);
if (!entries.length && prefix) rows.push([prefix, “No details returned”]);
entries.forEach(([key, child]) =>
flatten(child, prefix ? ${prefix} · ${formatKey(key)} : formatKey(key), rows)
);
} else {
rows.push([prefix || “Value”, friendlyValue(value)]);
}
return rows;
}

function hasContent(value) {
return (
value !== null &&
value !== undefined &&
(typeof value !== “object” ||
(Array.isArray(value)
? value.length > 0
: Object.keys(value).length > 0))
);
}

async function readResponse(response) {
const bodyText = await response.text();
let data = {};

if (bodyText) {
try {
data = JSON.parse(bodyText);
} catch {
data = { response_text: bodyText };
}
}

if (!response.ok) {
const message = valueAt(data, [“error”, “message”, “detail”]);
throw new Error(
${message ?? Request failed (${response.status})}${ response.statusText ?  (${response.statusText}) : "" }
);
}

return data;
}

function eventMapOf(source) {
const direct = objectAt(source, [“event”, “event_map”, “eventMap”]);
if (direct) return direct;

const frame = objectAt(source, [“frame”]);
const frameEvent = objectAt(frame, [“event”, “event_map”, “eventMap”]);
if (frameEvent) return frameEvent;

const transaction = objectAt(frame, [
“quantum_transaction”,
“quantumTransaction”,
]);
return objectAt(transaction, [“event”, “event_map”, “eventMap”]);
}

function ResultHeading({ eyebrow, title }) {
return (
{eyebrow}
{title}
);
}

function KeyValueList({ value, emptyText = “No details were returned.” }) {
const rows = flatten(value);

if (!rows.length) {
return {emptyText};
}

return (
{rows.map(([key, itemValue], index) => (
<div key={${key}-${index}} className=“contents”>
{key}
{itemValue}
))}
);
}

function ResultSection({
title,
description,
value,
defaultOpen = false,
}) {
const [open, setOpen] = useState(defaultOpen);

return (
<button
type=“button”
aria-expanded={open}
onClick={() => setOpen((current) => !current)}
className=“flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60”
>
{title}
{description && (
{description}
)}
<span
aria-hidden=“true”
className={flex size-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 transition-transform dark:border-zinc-700 ${ open ? "rotate-180" : "" }}
>
  {open && (
    <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
      {hasContent(value) ? (
        <KeyValueList value={value} />
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          This information was not returned by the API.
        </p>
      )}
    </div>
  )}
</section>

);
}

function Field({
label,
value,
onChange,
required = false,
placeholder = “”,
mono = false,
type = “text”,
autoComplete,
}) {
return (
{label}
<input
type={type}
autoComplete={autoComplete}
value={value}
onChange={(event) => onChange(event.target.value)}
required={required}
placeholder={placeholder}
className={h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${ mono ? "font-mono" : "" }}
/>
);
}

function NumberField({ label, value, onChange, min = 0 }) {
return (
{label}
<input
type=“number”
min={min}
step=“1”
value={value}
onChange={(event) => onChange(event.target.value)}
required
className=“h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800”
/>
);
}

function ReceiveUnitIdentifiers({ amount }) {
const count = Number(amount);

if (!Number.isSafeInteger(count) || count <= 0) {
return (
A valid positive amount was not returned; unit identifiers cannot be listed.
);
}

const limit = 200;

return (
Receive unit ordinals
{count} {count === 1 ? “unit” : “units”} · Ordinals 1–{count}
{Array.from({ length: Math.min(count, limit) }, (_, index) => index + 1).map(
(id) => (
Unit
{id}
)
)}
{count > limit && (
Showing the first {limit} of {count} ordinals.
)}
These are display ordinals from 1 through N, not distinct persisted identifiers supplied by the API.
);
}

function eventRecordsOf(source) {
const candidates = [
source?.events,
source?.records,
source?.event_records,
source?.eventRecords,
source?.items,
source?.data?.events,
source?.data?.records,
];

for (const candidate of candidates) {
if (Array.isArray(candidate)) return candidate.filter(isRecord);
if (isRecord(candidate)) {
for (const key of [“events”, “records”, “items”]) {
if (Array.isArray(candidate[key])) return candidate[key].filter(isRecord);
}
}
}

return [];
}

function recordNameOf(record) {
for (const key of [
“record_name”,
“recordName”,
“filename”,
“file_name”,
“fileName”,
“name”,
“record”,
“path”,
“id”,
]) {
if (typeof record?.[key] === “string” && record[key].trim()) {
return record[key];
}
}
return “”;
}

function recordKind(record) {
const explicit = String(
valueAt(record, [“kind”, “type”, “record_type”, “recordType”, “operation”]) ?? “”
).toLowerCase();
const name = recordNameOf(record).toLowerCase().split(/[\/]/).pop() || “”;

if (explicit.includes(“exil”) || name.startsWith(“exile_”)) return “exile”;
if (
explicit.includes(“transit”) ||
explicit.includes(“event”) ||
name.startsWith(“event_”)
) {
return “transit”;
}
return “other”;
}

function recordIdentity(record) {
const activation = valueAt(record, [“activation”, “activation_count”, “activationCount”]);
const dimension = valueAt(record, [“dimension”]);

if (activation !== undefined && dimension !== undefined) {
return ${String(activation)}:${String(dimension)};
}

const name = recordNameOf(record).toLowerCase().split(/[\/]/).pop() || “”;
const match = name.match(/^(?:event|exile)(\d+)(\d+)(?:.[^.]+)?$/);
return match ? ${match[1]}:${match[2]} : “”;
}

function pendingEventRecords(records) {
const exiled = new Set(
records
.filter((record) => recordKind(record) === “exile”)
.map(recordIdentity)
.filter(Boolean)
);

return records.filter((record) => {
if (recordKind(record) !== “transit”) return false;
if (record.exiled === true || record.is_exiled === true || record.isExiled === true) {
return false;
}

const status = String(valueAt(record, ["status", "state"]) ?? "").toLowerCase();
if (["exiled", "settled", "consumed"].includes(status)) return false;
const identity = recordIdentity(record);
return !identity || !exiled.has(identity);

});
}

function OpenResults({ result }) {
const directory = result?.directory;
const receive = result?.receive;
const frame = objectAt(receive, [“frame”]) ?? receive;
const transaction = objectAt(frame, [“quantum_transaction”, “quantumTransaction”]);
const event = eventMapOf(receive);
const depth = objectAt(event, [“depth”]);
const objects = Array.isArray(depth?.objects) ? depth.objects : [];
const amount = valueAt(transaction, [“amount”]) ?? result?.requested_amount;

return (
  <ResultSection
    title="Substrate directory"
    description="Directory metadata returned for the selected substrate."
    value={directory}
    defaultOpen
  />
  <ResultSection
    title="Receive event depth"
    description="Depth data returned by the receive operation."
    value={depth}
    defaultOpen
  />
  {objects.length > 0 && (
    <ResultSection title="Retained objects" value={objects} />
  )}
  <section className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
    <h3 className="text-xs font-semibold">QuantumTransaction validation</h3>
    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
      {transaction
        ? "A QuantumTransaction was returned by the receive operation."
        : "The response did not contain the expected QuantumTransaction."}
    </p>
    <div className="mt-3">
      <KeyValueList
        value={{
          transaction_returned: Boolean(transaction),
          amount,
          flow: result?.flow,
          constant: valueAt(transaction, ["constant"]),
          qtm: objectAt(transaction, ["qtm"]),
        }}
      />
    </div>
    <div className="mt-4">
      <ReceiveUnitIdentifiers amount={amount} />
    </div>
  </section>
  {event && <ResultSection title="Receive event fields" value={event} />}
</section>

);
}

function EventMapSections({ event, prefix = “” }) {
const depth = objectAt(event, [“depth”]);
const heritage = objectAt(event, [“heritage”, “state_heritage”, “stateHeritage”]);
const transition = objectAt(event, [
“transition”,
“transition_heritage”,
“transitionHeritage”,
]);
const identifier = valueAt(depth, [
“identifier”,
“depth_identifier”,
“depthIdentifier”,
“id”,
]);

return (
{depth && (
<ResultSection
title={${prefix}Final depth}
description={
identifier === undefined
? “Final depth data returned by the API.”
: Depth identifier: ${friendlyValue(identifier)}
}
value={depth}
defaultOpen
/>
)}
{heritage && (
<ResultSection title={${prefix}Heritage state} value={heritage} />
)}
{transition && (
<ResultSection title={${prefix}Transition heritage} value={transition} />
)}
<ResultSection title={${prefix}Event map} value={event} />
);
}

function TransitResults({ result, network, path, substrate }) {
const frame = objectAt(result, [“frame”]);
const event = eventMapOf(result);

return (
  <ResultSection
    title="Transition substrate"
    description="Substrate context used for this transit request."
    value={{
      substrate,
      network: network?.name ?? network?.id ?? "Not specified",
      network_identifier: network?.id ?? "Not returned",
      derivation_path: path || network?.path || "Not specified",
    }}
    defaultOpen
  />
  <ResultSection
    title="QTM values"
    value={objectAt(frame, ["qtm", "Qtm"])}
    defaultOpen
  />
  {event ? (
    <EventMapSections event={event} />
  ) : (
    <ResultSection title="Event map" value={undefined} />
  )}
  <ResultSection
    title="Complete transit response"
    description="Additional fields returned by the API."
    value={result}
  />
</section>

);
}

function ExileResults({ result, substrate }) {
const frame = objectAt(result, [“frame”]);
const event = eventMapOf(result);
const depth = objectAt(event, [“depth”]);
const objects = Array.isArray(depth?.objects) ? depth.objects : [];

return (
  <ResultSection
    title="Substrate"
    value={{ substrate }}
    defaultOpen
  />
  <ResultSection
    title="Stored QTM"
    value={objectAt(frame, ["qtm", "Qtm"])}
    defaultOpen
  />
  {depth && (
    <section className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-xs font-semibold">Exile depth record</h3>
      <p className="mt-2 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {depth.path || "Depth path not returned"}
      </p>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
        {objects.length} retained {objects.length === 1 ? "object" : "objects"} returned by the API.
      </p>
      {objects.length > 0 && (
        <div className="mt-3">
          <KeyValueList value={objects} />
        </div>
      )}
    </section>
  )}
  {event ? (
    <EventMapSections event={event} prefix="Exile " />
  ) : (
    <ResultSection title="Exile event map" value={undefined} />
  )}
  <ResultSection title="Complete exile response" value={result} />
</section>

);
}

function ResultCard({ result, tab, network, path, substrate }) {
if (result === null || result === undefined) return null;

return (
{tab === “open” && }

  {tab === "transit" && (
    <TransitResults
      result={result}
      network={network}
      path={path}
      substrate={substrate}
    />
  )}
  {tab === "exile" && <ExileResults result={result} substrate={substrate} />}
  {tab === "create" && (
    <section className="space-y-3">
      <ResultHeading eyebrow="Create result" title="Substrate created" />
      <ResultSection title="Created substrate" value={result} defaultOpen />
    </section>
  )}
</div>

);
}

function makeApiUrl(path) {
return ${API_BASE}${path};
}

export default function Home() {
const [tab, setTab] = useState(“create”);

const [substrates, setSubstrates] = useState([]);
const [selectedSubstrate, setSelectedSubstrate] = useState(””);
const [listLoading, setListLoading] = useState(true);
const [listError, setListError] = useState(””);

const [networks, setNetworks] = useState([]);
const [selectedNetwork, setSelectedNetwork] = useState(””);
const [networkLoading, setNetworkLoading] = useState(true);
const [networkError, setNetworkError] = useState(””);

const [name, setName] = useState(””);
const [seedSource, setSeedSource] = useState(“persistent”);
const [indices, setIndices] = useState(“0,0,0,0,0,0,0,0,0,0,0,0”);
const [entropy, setEntropy] = useState(””);
const [phrase, setPhrase] = useState(””);
const [language, setLanguage] = useState(””);
const [passphrase, setPassphrase] = useState(””);

const [path, setPath] = useState(””);
const [purpose, setPurpose] = useState(“44”);
const [coin, setCoin] = useState(“0”);
const [account, setAccount] = useState(“0”);
const [change, setChange] = useState(“0”);
const [external, setExternal] = useState(“0”);
const [activation, setActivation] = useState(“1”);

const [receiveAmount, setReceiveAmount] = useState(“1”);
const [receiveFlow, setReceiveFlow] = useState(“receive”);

const [exileRecords, setExileRecords] = useState([]);
const [exileRecordsLoading, setExileRecordsLoading] = useState(false);
const [exileRecordsError, setExileRecordsError] = useState(””);

const [result, setResult] = useState(null);
const [error, setError] = useState(””);
const [loading, setLoading] = useState(false);

// Keep the selected substrate aligned with links from /network and /eventstore.
const [requestedSubstrate, setRequestedSubstrate] = useState(””);

useEffect(() => {
const params = new URLSearchParams(window.location.search);
setRequestedSubstrate(params.get(“substrate”) || “”);
}, []);

useEffect(() => {
if (typeof window === “undefined”) return;

const url = new URL(window.location.href);
if (selectedSubstrate) {
  url.searchParams.set("substrate", selectedSubstrate);
} else {
  url.searchParams.delete("substrate");
}
window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

}, [selectedSubstrate]);

const loadSubstrates = useCallback(async (preferred = “”) => {
setListLoading(true);
setListError(””);

try {
  const response = await fetch(makeApiUrl("/wallets"), {
    method: "GET",
    cache: "no-store",
  });
  const data = await readResponse(response);
  if (!Array.isArray(data.substrates)) {
    throw new Error("The API response did not contain a substrates list.");
  }
  const valid = data.substrates.filter(
    (item) => item && typeof item.name === "string"
  );
  setSubstrates(valid);
  setSelectedSubstrate((current) => {
    const wanted = preferred || requestedSubstrate || current;
    return wanted && valid.some((item) => item.name === wanted)
      ? wanted
      : valid[0]?.name || "";
  });
} catch (err) {
  setListError(
    err instanceof Error ? err.message : "Unable to load substrates."
  );
} finally {
  setListLoading(false);
}

}, [requestedSubstrate]);

const loadNetworks = useCallback(async () => {
setNetworkLoading(true);
setNetworkError(””);

try {
  const response = await fetch(makeApiUrl("/networks"), {
    method: "GET",
    cache: "no-store",
  });
  const data = await readResponse(response);
  if (!Array.isArray(data.networks)) {
    throw new Error("The API response did not contain a networks list.");
  }
  const valid = data.networks.filter(
    (network) =>
      network &&
      typeof network.id === "string" &&
      typeof network.name === "string"
  );
  setNetworks(valid);
  setSelectedNetwork((current) =>
    valid.some((network) => network.id === current)
      ? current
      : valid[0]?.id || ""
  );
  const first = valid[0];
  if (first) {
    if (Number.isFinite(first.purpose)) {
      setPurpose((current) =>
        current === "44" ? String(first.purpose) : current
      );
    }
    if (Number.isFinite(first.coin)) {
      setCoin((current) =>
        current === "0" ? String(first.coin) : current
      );
    }
    if (first.path) setPath((current) => current || first.path);
  }
} catch (err) {
  setNetworkError(
    err instanceof Error ? err.message : "Unable to load networks."
  );
} finally {
  setNetworkLoading(false);
}

}, []);

const loadExileRecords = useCallback(async () => {
if (!selectedSubstrate) {
setExileRecords([]);
setExileRecordsError(“Select a substrate before loading its persisted events.”);
return;
}

setExileRecordsLoading(true);
setExileRecordsError("");
try {
  const url = makeApiUrl(
    `/wallets/${encodeURIComponent(selectedSubstrate)}/events`
  );
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });
  const data = await readResponse(response);
  const records = eventRecordsOf(data);
  const recognizedList =
    Array.isArray(data.events) ||
    Array.isArray(data.records) ||
    Array.isArray(data.event_records) ||
    Array.isArray(data.eventRecords) ||
    Array.isArray(data.items) ||
    Array.isArray(data.data?.events) ||
    Array.isArray(data.data?.records) ||
    isRecord(data.events) ||
    isRecord(data.records);
  if (!records.length && !recognizedList) {
    throw new Error(
      "The events endpoint did not return a recognized persisted event-record list."
    );
  }
  setExileRecords(records);
  if (!pendingEventRecords(records).length) {
    setExileRecordsError(
      "No persisted transit events are currently identified as pending exile for this substrate."
    );
  }
} catch (err) {
  setExileRecords([]);
  setExileRecordsError(
    err instanceof Error
      ? err.message
      : "Unable to load persisted event records."
  );
} finally {
  setExileRecordsLoading(false);
}

}, [selectedSubstrate]);

useEffect(() => {
loadSubstrates();
}, [loadSubstrates]);

useEffect(() => {
loadNetworks();
}, [loadNetworks]);

useEffect(() => {
if (tab === “exile” && selectedSubstrate) {
loadExileRecords();
}
}, [tab, selectedSubstrate, loadExileRecords]);

const currentNetwork = useMemo(
() => networks.find((network) => network.id === selectedNetwork) ?? null,
[networks, selectedNetwork]
);

const pendingRecords = useMemo(
() => pendingEventRecords(exileRecords),
[exileRecords]
);

function handleSubstrateChange(value) {
setSelectedSubstrate(value);
setResult(null);
setError(””);
setExileRecords([]);
setExileRecordsError(””);
}

function handleNetworkChange(id) {
const network = networks.find((item) => item.id === id);

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
setError(””);
setResult(null);

if (tab !== "create" && !selectedSubstrate) {
  setError("Select a substrate before performing this operation.");
  return;
}
setLoading(true);
try {
  if (tab === "create") {
    const substrateName = name.trim();
    if (!substrateName) throw new Error("Enter a substrate name.");
    let payload;
    if (seedSource === "bip39") {
      if (!phrase.trim()) throw new Error("Enter a BIP39 mnemonic phrase.");
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
            item === "" ||
            !/^\d+$/.test(item) ||
            !Number.isSafeInteger(Number(item)) ||
            Number(item) < 0 ||
            Number(item) > 2047
        )
      ) {
        throw new Error(
          "Enter exactly 12 indices, each an integer from 0 to 2047."
        );
      }
      payload = {
        name: substrateName,
        seed_source: "persistent",
        indices: parsed.map(Number).join(","),
        entropy: entropy.trim() || substrateName,
      };
    }
    const response = await fetch(makeApiUrl("/wallets"), {
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
    return;
  }
  if (tab === "open") {
    const amount = Number(receiveAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Receive amount must be a positive safe integer.");
    }
    if (!["receive", "change"].includes(receiveFlow)) {
      throw new Error("Select a valid receive flow.");
    }
    const walletUrl = makeApiUrl(
      `/wallets/${encodeURIComponent(selectedSubstrate)}`
    );
    const directoryResponse = await fetch(walletUrl, {
      method: "GET",
      cache: "no-store",
    });
    const directory = await readResponse(directoryResponse);
    const receiveResponse = await fetch(`${walletUrl}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ amount, flow: receiveFlow }),
    });
    const receive = await readResponse(receiveResponse);
    setResult({
      directory,
      receive,
      requested_amount: amount,
      flow: receiveFlow,
      substrate: selectedSubstrate,
    });
    return;
  }
  if (tab === "transit") {
    if (!selectedNetwork) {
      throw new Error("Select a network before transit.");
    }
    const numeric = {
      purpose: Number(purpose),
      coin: Number(coin),
      account: Number(account),
      change: Number(change),
      external: Number(external),
      activation: Number(activation),
    };
    for (const [key, value] of Object.entries(numeric)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${key} must be a non-negative safe integer.`);
      }
    }
    // The selected substrate is the state context for this transition.
    // The network/path configure derivation; they do not replace the substrate.
    const transitUrl = makeApiUrl(
      `/wallets/${encodeURIComponent(selectedSubstrate)}/transit`
    );
    const response = await fetch(transitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        network: selectedNetwork,
        path: path.trim() || undefined,
        ...numeric,
      }),
    });
    const data = await readResponse(response);
    setResult(data);
    await Promise.all([loadSubstrates(selectedSubstrate), loadExileRecords()]);
    return;
  }
  if (tab === "exile") {
    if (!pendingRecords.length) {
      throw new Error(
        "There are no persisted transit event records identified as pending exile. Refresh the event list after recording a transit event."
      );
    }
    // The Rust API derives the exile depth from this substrate's persisted
    // event history. Do not submit a client-created depth snapshot.
    const exileUrl = makeApiUrl(
      `/wallets/${encodeURIComponent(selectedSubstrate)}/exile`
    );
    const response = await fetch(exileUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const data = await readResponse(response);
    setResult(data);
    await Promise.all([loadExileRecords(), loadSubstrates(selectedSubstrate)]);
  }
} catch (err) {
  setError(err instanceof Error ? err.message : "Something went wrong.");
} finally {
  setLoading(false);
}

}

const substrateRequired = tab !== “create”;

const linkWithSubstrate = (href) => {
if (!selectedSubstrate) return href;
const separator = href.includes(”?”) ? “&” : “?”;
return ${href}${separator}substrate=${encodeURIComponent(selectedSubstrate)};
};

return (
<div
style={{
fontFamily:
‘-apple-system, BlinkMacSystemFont, “SF Pro Text”, “Helvetica Neue”, Arial, sans-serif’,
}}
className=“min-h-screen w-full bg-zinc-50 px-1.5 py-2 text-[13px] text-zinc-900 sm:px-2 sm:py-3 dark:bg-zinc-950 dark:text-zinc-100”
>
{html { font-size: 14px; } * { min-width: 0; } body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; } a, button, input, select, textarea { font: inherit; }}

  <main className="mx-auto w-full max-w-none">
    <header className="mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        QuantPerm · QTM
      </p>
      <h1 className="mt-1.5 text-lg font-semibold tracking-tight text-zinc-950 sm:text-xl dark:text-zinc-50">
        QTM substrate console
      </h1>
      <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
        Create and inspect persistent substrates, derive network paths, and
        transition or exile state through the Rust API.
      </p>
    </header>
    <section className="mb-3 rounded-md border border-zinc-200 bg-white p-2.5 shadow-sm sm:p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor="substrate" className="text-xs font-semibold">
          Active substrate
        </label>
        <button
          type="button"
          onClick={() => loadSubstrates(selectedSubstrate)}
          disabled={listLoading}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          {listLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <select
        id="substrate"
        value={selectedSubstrate}
        onChange={(event) => handleSubstrateChange(event.target.value)}
        disabled={listLoading || !substrates.length}
        className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
      >
        {!substrates.length && (
          <option value="">
            {listLoading ? "Loading substrates…" : "No substrates available"}
          </option>
        )}
        {substrates.map((substrate) => (
          <option key={substrate.name} value={substrate.name}>
            {substrate.name} — dimension {substrate.dimension ?? "not returned"} · activations {substrate.activations ?? "not returned"}
          </option>
        ))}
      </select>
      {selectedSubstrate && (
        <div className="mt-3 space-y-2">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              State context
            </p>
            <p className="mt-1 break-all font-mono text-xs font-semibold">
              {selectedSubstrate}
            </p>
            <p className="mt-1 text-xs leading-4 text-zinc-500 dark:text-zinc-400">
              Transit and exile operate against this substrate. Network and
              derivation path are operation parameters, not separate state hosts.
            </p>
          </div>
          <ResultSection
            title="Selected substrate details"
            description="Fields returned by the API for this substrate."
            value={substrates.find((item) => item.name === selectedSubstrate) ?? {}}
          />
        </div>
      )}
      {listError && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          Unable to load substrates: {listError}
        </p>
      )}
      {!listLoading && !listError && !substrates.length && (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          No substrates were found. Create one below.
        </p>
      )}
    </section>
    <section
      aria-label="Substrate tools"
      className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      <a
        href={linkWithSubstrate("/eventstore")}
        className="block rounded-md border border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Persisted state
            </p>
            <h2 className="mt-0.5 text-xs font-semibold">Event Store</h2>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Inspect records for the selected substrate
            </p>
          </div>
          <span className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium dark:border-zinc-700">
            Open
          </span>
        </div>
      </a>
      <a
        href={linkWithSubstrate("/network")}
        className="block rounded-md border border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Derivation context
            </p>
            <h2 className="mt-0.5 text-xs font-semibold">Network</h2>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Inspect network paths in this substrate context
            </p>
          </div>
          <span className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium dark:border-zinc-700">
            Open
          </span>
        </div>
      </a>
    </section>
    <nav
      aria-label="Substrate operations"
      className="mb-3 grid grid-cols-4 gap-1 rounded-md border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900"
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
          className={`rounded-md px-1.5 py-2 text-xs font-medium transition-colors sm:px-2 ${
            tab === item.id
              ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
    <section className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm sm:p-3.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4">
        <h2 className="text-sm font-semibold">
          {TABS.find((item) => item.id === tab)?.label}
        </h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          {tab === "create" &&
            "Initialize a persistent substrate using PERM indices or a BIP39 mnemonic."}
          {tab === "open" &&
            "Read the selected substrate directory and perform a receive operation."}
          {tab === "transit" &&
            "Apply a network derivation request in the selected substrate's state context."}
          {tab === "exile" &&
            "Exile eligible transit records using the selected substrate's persisted event history."}
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {["persistent", "bip39"].map((source) => (
                <button
                  key={source}
                  type="button"
                  aria-pressed={seedSource === source}
                  onClick={() => {
                    setSeedSource(source);
                    setError("");
                  }}
                  className={`rounded-md border px-3 py-3 text-left transition-colors ${
                    seedSource === source
                      ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-800/70"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <span className="block text-xs font-semibold">
                    {source === "bip39" ? "BIP39 mnemonic" : "Persistent indices"}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    {source === "bip39"
                      ? "Derive indices and entropy from a mnemonic."
                      : "Enter 12 PERM indices and conditioning entropy."}
                  </span>
                </button>
              ))}
            </div>
            {seedSource === "persistent" ? (
              <>
                <Field
                  label="12 indices (comma-separated, 0–2047 each)"
                  value={indices}
                  onChange={setIndices}
                  required
                  mono
                />
                <Field
                  label="Conditioning entropy"
                  value={entropy}
                  onChange={setEntropy}
                  placeholder="Defaults to the substrate name"
                />
              </>
            ) : (
              <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium">BIP39 language</span>
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    required
                    className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">Select language</option>
                    <option value="english">English</option>
                    <option value="chinese_simplified">Chinese (Simplified)</option>
                    <option value="chinese_traditional">Chinese (Traditional)</option>
                    <option value="french">French</option>
                    <option value="italian">Italian</option>
                    <option value="japanese">Japanese</option>
                    <option value="korean">Korean</option>
                    <option value="spanish">Spanish</option>
                    <option value="czech">Czech</option>
                    <option value="portuguese">Portuguese</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium">Mnemonic phrase</span>
                  <textarea
                    value={phrase}
                    onChange={(event) => setPhrase(event.target.value)}
                    required
                    rows={3}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Enter words in the selected language"
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <Field
                  label="BIP39 passphrase (optional)"
                  value={passphrase}
                  onChange={setPassphrase}
                  type="password"
                  autoComplete="off"
                />
                <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  The phrase and passphrase are sent to the API for validation and derivation.
                </p>
              </div>
            )}
          </>
        )}
        {tab === "open" && (
          <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
            <div>
              <h3 className="text-xs font-semibold">Open substrate and receive</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                The selected substrate determines which directory is opened and where the receive operation is executed.
              </p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-medium">Selected substrate</p>
              <p className="mt-1 break-all font-mono text-xs">
                {selectedSubstrate || "No substrate selected"}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberField
                label="Transaction amount (N)"
                value={receiveAmount}
                onChange={setReceiveAmount}
                min={1}
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">Receive flow</span>
                <select
                  value={receiveFlow}
                  onChange={(event) => setReceiveFlow(event.target.value)}
                  className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="receive">Receive</option>
                  <option value="change">Change</option>
                </select>
              </label>
            </div>
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Unit ordinals are display values from 1 through the amount returned by the API, not canonical persisted identifiers unless the backend supplies them.
            </p>
          </div>
        )}
        {tab === "transit" && (
          <>
            <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Transition state context
              </p>
              <p className="mt-1 break-all font-mono text-xs font-semibold">
                {selectedSubstrate || "Select a substrate"}
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Transit is sent to this substrate's API route. Network and path specify derivation; they are not a separate state host.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-medium">Network</span>
                <select
                  value={selectedNetwork}
                  onChange={(event) => handleNetworkChange(event.target.value)}
                  disabled={networkLoading || !networks.length}
                  className="h-9 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {!networks.length && (
                    <option value="">
                      {networkLoading ? "Loading…" : "No networks"}
                    </option>
                  )}
                  {networks.map((network) => (
                    <option key={network.id} value={network.id}>
                      {network.name} — {network.id}
                    </option>
                  ))}
                </select>
              </label>
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
              <p
                role="alert"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
              >
                Networks could not be loaded: {networkError}{" "}
                <button
                  type="button"
                  onClick={loadNetworks}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              </p>
            )}
            {currentNetwork && (
              <ResultSection
                title="Selected network definition"
                description="Derivation metadata; substrate state remains selected above."
                value={currentNetwork}
              />
            )}
          </>
        )}
        {tab === "exile" && (
          <section className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
            <div>
              <h3 className="text-xs font-semibold">Persisted events pending exile</h3>
              <p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
                {selectedSubstrate || "No substrate selected"}
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Exile reads the selected substrate's persisted event history. The Rust API derives the exile depth; the client does not submit an in-memory depth snapshot.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-zinc-600 dark:text-zinc-300">
                {exileRecordsLoading
                  ? "Loading persisted events…"
                  : `${pendingRecords.length} transit record(s) pending exile`}
              </span>
              <button
                type="button"
                onClick={loadExileRecords}
                disabled={exileRecordsLoading || !selectedSubstrate || loading}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                {exileRecordsLoading ? "Refreshing…" : "Refresh events"}
              </button>
            </div>
            {exileRecordsError && (
              <p
                role="status"
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
              >
                {exileRecordsError}
              </p>
            )}
            <div className="space-y-2">
              <p className="text-xs font-medium">Persisted event records</p>
              {!exileRecords.length ? (
                <p className="rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  No event records were returned. Record a transit event, then refresh this list.
                </p>
              ) : (
                exileRecords.map((record, index) => {
                  const kind = recordKind(record);
                  const pending = pendingRecords.includes(record);
                  return (
                    <div
                      key={`${recordNameOf(record) || recordIdentity(record) || "record"}-${index}`}
                      className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="break-all font-mono text-xs font-medium">
                          {recordNameOf(record) || `Persisted record ${index + 1}`}
                        </p>
                        <span className="rounded-md border border-zinc-200 px-2 py-1 text-[10px] font-medium dark:border-zinc-700">
                          {kind === "transit"
                            ? pending
                              ? "Pending exile"
                              : "Transit record"
                            : kind === "exile"
                              ? "Exile record"
                              : "Persisted record"}
                        </span>
                      </div>
                      <div className="mt-3">
                        <KeyValueList value={record} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}
        <button
          type="submit"
          aria-busy={loading}
          disabled={
            loading ||
            listLoading ||
            (substrateRequired && !selectedSubstrate) ||
            (tab === "transit" && (networkLoading || !selectedNetwork)) ||
            (tab === "exile" &&
              (pendingRecords.length === 0 || exileRecordsLoading))
          }
          className="mt-1 inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
        >
          {loading
            ? "Processing…"
            : tab === "open"
              ? "Open and Receive"
              : tab === "transit"
                ? "Transit Selected Substrate"
                : tab === "exile"
                  ? "Exile Selected Substrate"
                  : "Create Substrate"}
        </button>
      </form>
    </section>
    {error && (
      <p
        role="alert"
        className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        {error}
      </p>
    )}
    <ResultCard
      result={result}
      tab={tab}
      network={currentNetwork}
      path={path}
      substrate={selectedSubstrate}
    />
    <footer className="mt-5 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
      QTM substrate console · Active substrate: {selectedSubstrate || "none"}
    </footer>
  </main>
</div>

);
}