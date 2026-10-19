“use client”;

import { useCallback, useEffect, useMemo, useRef, useState } from “react”;

const API_BASE = “https://qtm-api.onrender.com”;
const REFRESH_INTERVAL = 5000;
const U128_MAX = “340282366920938463463374607431768211455”;

async function apiRequest(path, options = {}) {
const response = await fetch(${API_BASE}${path}, {
…options,
cache: “no-store”,
headers: {
Accept: “application/json”,
…(options.body ? { “Content-Type”: “application/json” } : {}),
…options.headers,
},
});

const raw = await response.text();
let body = null;

if (raw) {
try {
body = JSON.parse(raw);
} catch {
body = { response_text: raw };
}
}

if (!response.ok) {
const detail =
body?.error ||
body?.message ||
body?.detail ||
body?.response_text;

throw new Error(
  detail
    ? String(detail)
    : `Request failed with HTTP ${response.status}.`,
);

}

return body ?? {};
}

function text(value, fallback = “—”) {
if (value === undefined || value === null || value === “”) {
return fallback;
}

if (typeof value === “object”) {
try {
return JSON.stringify(value);
} catch {
return String(value);
}
}

return String(value);
}

function integer(value, label) {
const input = String(value).trim();

if (!/^\d+$/.test(input)) {
throw new Error(${label} must be a non-negative whole number.);
}

const parsed = Number(input);

if (!Number.isSafeInteger(parsed) || parsed < 0) {
throw new Error(${label} must be a non-negative safe integer.);
}

return parsed;
}

function unsigned128(value, label) {
const input = String(value).trim();

if (!/^\d+$/.test(input)) {
throw new Error(${label} must be a non-negative whole number.);
}

const parsed = BigInt(input);

if (parsed > BigInt(U128_MAX)) {
throw new Error(${label} exceeds the maximum supported u128 value.);
}

return parsed.toString();
}

function budgetValue(budget, key) {
if (!budget || typeof budget !== “object”) return undefined;

const aliases = {
max_events: [“max_events”, “max_event”],
min_events: [“min_events”, “min_event”],
max_retained_mass: [“max_retained_mass”, “max_retained”],
};

for (const name of aliases[key] ?? [key]) {
if (budget[name] !== undefined && budget[name] !== null) {
return budget[name];
}
}

return undefined;
}

function asBigInt(value) {
if (value === undefined || value === null || value === “”) {
return null;
}

try {
const input = String(value);
if (!/^\d+$/.test(input)) return null;

const parsed = BigInt(input);
return parsed <= BigInt(U128_MAX) ? parsed : null;

} catch {
return null;
}
}

function eventRetainedMass(event) {
return (
event?.heritage?.state?.retained_mass ??
event?.heritage?.state?.retainedMass ??
event?.retained_mass ??
event?.retainedMass ??
null
);
}

function totalRetainedMass(events) {
return events.reduce((sum, event) => {
const amount = asBigInt(eventRetainedMass(event));
return amount !== null ? sum + amount : sum;
}, 0n);
}

function activationFromEvent(event) {
const value =
event?.activation ??
event?.heritage?.state?.activation_count;

if (value === undefined || value === null || value === “”) {
return null;
}

const parsed = String(value);
return /^\d+$/.test(parsed) ? parsed : null;
}

function emptyDraft() {
return {
min_events: “0”,
max_events: “1024”,
max_retained_mass: “1048576”,
};
}

function draftFromBudget(budget) {
if (!budget || typeof budget !== “object”) return emptyDraft();

return {
min_events: String(budgetValue(budget, “min_events”) ?? “0”),
max_events: String(budgetValue(budget, “max_events”) ?? “1024”),
max_retained_mass: String(
budgetValue(budget, “max_retained_mass”) ?? “1048576”,
),
};
}

function normalizeNetwork(network) {
if (!network || typeof network.id !== “string”) return null;

return {
id: network.id,
name: network.name ?? network.id,
coin: network.coin,
purpose: network.purpose,
path: network.path,
};
}

function normalizeNetworkBudgetResponse(result) {
return Array.isArray(result?.budgets) ? result.budgets : [];
}

/*

* Payload budget responses must preserve distinct payload paths and depth
* identifiers. Supported response shape:
* {
* “payload_budgets”: [{

"network": { "id": "bitcoin-native-segwit", "name": "...", "path": "..." },
"path": "the exact persisted payload path",
"depth_identifier": "the exact deserialized depth identifier",
"configured": true,
"budget": { "min_events": 0, "max_events": 1024,
            "max_retained_mass": "1048576" }

* }]
* }
* Do not synthesize identifiers from depth_objects counts. The API must
* return the actual distinct payload paths and their deserialized identifiers.
    */
    function normalizePayloadBudgetResponse(result) {
    const rows = Array.isArray(result?.payload_budgets)
    ? result.payload_budgets
    : Array.isArray(result?.payloads)
    ? result.payloads
    : [];

return rows
.map((entry) => {
const network = normalizeNetwork(entry?.network);
const path = entry?.path ?? entry?.payload_path;
const depthIdentifier =
entry?.depth_identifier ??
entry?.depthIdentifier ??
entry?.depth_id;

  if (!network || typeof path !== "string" || !path.length) {
    return null;
  }
  return {
    network,
    path,
    depth_identifier:
      depthIdentifier === undefined || depthIdentifier === null
        ? ""
        : String(depthIdentifier),
    configured: Boolean(entry.configured && entry.budget),
    budget: entry.budget ?? null,
  };
})
.filter(Boolean);

}

function networkBudgetKey(activation, networkId) {
return network:${activation}:${networkId};
}

function payloadBudgetKey(activation, networkId, path, depthIdentifier) {
return JSON.stringify([
“payload”,
String(activation),
String(networkId),
String(path),
String(depthIdentifier ?? “”),
]);
}

function Panel({ title, description, action, children, className = “” }) {
return (
<section
className={min-w-0 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900 ${className}}
>
{title}
{description && (
{description}
)}
{action && {action}}
{children}
);
}

function Field({ label, children, hint }) {
return (
{label}
{children ?? “—”}
{hint && (
{hint}
)}
);
}

function NumberInput({
label,
value,
onChange,
hint,
disabled = false,
textInput = false,
}) {
return (
{label}
<input
type={textInput ? “text” : “number”}
inputMode=“numeric”
min={textInput ? undefined : 0}
step={textInput ? undefined : 1}
pattern={textInput ? “[0-9]*” : undefined}
required
disabled={disabled}
value={value}
onChange={(event) => onChange(event.target.value)}
className=“h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 font-mono text-base outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 sm:text-sm dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800”
/>
{hint && (
{hint}
)}
);
}

function Metric({ label, value, unit, note }) {
const available = value !== undefined && value !== null && value !== “”;

return (
{label}
{text(value, “Not configured”)}
{unit && available && (
{unit}
)}
{note && (
{note}
)}
);
}

function ActionButton({
children,
disabled,
onClick,
type = “button”,
primary = false,
}) {
const base =
“inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50”;
const style = primary
? “bg-zinc-950 px-5 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300”
: “border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800”;

return (
<button
type={type}
disabled={disabled}
onClick={onClick}
className={${base} ${style}}
>
{children}
);
}

function RuntimeValue({ runtime }) {
if (!runtime) return <>Not reported</>;

const seconds = Number(runtime.unix_seconds);
const nanos = Number(runtime.subsec_nanos ?? 0);

if (
!Number.isSafeInteger(seconds) ||
!Number.isInteger(nanos) ||
seconds < 0 ||
nanos < 0 ||
nanos >= 1_000_000_000
) {
return <>Invalid runtime value</>;
}

return (
<>
{new Date(seconds * 1000).toISOString()} · {nanos} ns
</>
);
}

function EventValue({ value }) {
return {text(value)};
}

function StatusPill({ configured }) {
return (
<span
className={shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${ configured ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" }}
>
{configured ? “Configured” : “Unconfigured”}
);
}

function BudgetSummary({ budget }) {
return (
Minimum events
{text(budgetValue(budget, “min_events”), “—”)}
Maximum events
{text(budgetValue(budget, “max_events”), “—”)}
Maximum retained mass
{text(budgetValue(budget, “max_retained_mass”), “Not configured”)}
{budgetValue(budget, “max_retained_mass”) !== undefined && (
bytes
)}
);
}

export default function EventStorePage() {
const [substrates, setSubstrates] = useState([]);
const [networks, setNetworks] = useState([]);
const [substrate, setSubstrate] = useState(””);
const [activation, setActivation] = useState(“0”);
const [activationOptions, setActivationOptions] = useState([“0”]);
const [store, setStore] = useState(null);

const [networkBudgets, setNetworkBudgets] = useState([]);
const [payloadBudgets, setPayloadBudgets] = useState([]);
const [drafts, setDrafts] = useState({});
const [savingKeys, setSavingKeys] = useState({});
const [expandedNetworks, setExpandedNetworks] = useState({});
const [expandedPayloads, setExpandedPayloads] = useState({});

const [loadingList, setLoadingList] = useState(true);
const [loadingEvents, setLoadingEvents] = useState(false);
const [loadingBudgets, setLoadingBudgets] = useState(false);
const [loadingPayloadBudgets, setLoadingPayloadBudgets] = useState(false);

const [error, setError] = useState(””);
const [notice, setNotice] = useState(””);
const [budgetErrors, setBudgetErrors] = useState({});
const [budgetNotices, setBudgetNotices] = useState({});

const selectedSubstrateRef = useRef(””);
const selectedActivationRef = useRef(“0”);
const eventRequestRef = useRef(0);
const budgetRequestRef = useRef(0);
const payloadRequestRef = useRef(0);

const events = Array.isArray(store?.events) ? store.events : [];
const usedRetainedBigInt = useMemo(() => totalRetainedMass(events), [events]);
const selectedSubstrateEntry = substrates.find(
(entry) => entry.name === substrate,
);

const configuredNetworkBudgetCount = networkBudgets.filter(
(entry) => entry?.configured && entry?.budget,
).length;

const configuredPayloadBudgetCount = payloadBudgets.filter(
(entry) => entry?.configured && entry?.budget,
).length;

const loadNetworks = useCallback(async () => {
const result = await apiRequest(”/networks”);
const normalized = Array.isArray(result.networks)
? result.networks.map(normalizeNetwork).filter(Boolean)
: [];

setNetworks(normalized);
return normalized;

}, []);

const loadSubstrates = useCallback(async () => {
setLoadingList(true);

try {
  const result = await apiRequest("/wallets");
  const entries = Array.isArray(result.substrates)
    ? result.substrates.filter(
        (item) =>
          item &&
          typeof item.name === "string" &&
          item.name.length > 0,
      )
    : [];
  setSubstrates(entries);
  const requested = new URLSearchParams(window.location.search).get(
    "substrate",
  );
  const requestedEntry = entries.find((item) => item.name === requested);
  const previous = selectedSubstrateRef.current;
  const chosen =
    requestedEntry?.name ??
    (entries.some((item) => item.name === previous)
      ? previous
      : entries[0]?.name ?? "");
  selectedSubstrateRef.current = chosen;
  setSubstrate(chosen);
  if (!entries.length) {
    setError("The API returned no available substrates.");
  }
  return chosen;
} catch (err) {
  setSubstrates([]);
  selectedSubstrateRef.current = "";
  setSubstrate("");
  setError(
    `Unable to load substrates: ${
      err instanceof Error ? err.message : "unknown API error"
    }`,
  );
  return "";
} finally {
  setLoadingList(false);
}

}, []);

const loadEvents = useCallback(
async (name, options = {}) => {
if (!name) {
setStore(null);
setError(“Select a substrate before loading its event store.”);
return null;
}

  const requestId = ++eventRequestRef.current;
  if (!options.silent) {
    setLoadingEvents(true);
    setError("");
  }
  try {
    const result = await apiRequest(
      `/wallets/${encodeURIComponent(name)}/events`,
    );
    if (
      requestId !== eventRequestRef.current ||
      selectedSubstrateRef.current !== name
    ) {
      return null;
    }
    const nextEvents = Array.isArray(result.events) ? result.events : [];
    setStore({ ...result, events: nextEvents });
    const choices = new Set(["0"]);
    for (const event of nextEvents) {
      const value = activationFromEvent(event);
      if (value !== null) choices.add(value);
    }
    const reportedActivations = selectedSubstrateEntry?.activations;
    if (
      reportedActivations !== undefined &&
      reportedActivations !== null &&
      /^\d+$/.test(String(reportedActivations))
    ) {
      choices.add(String(reportedActivations));
    }
    const sortedChoices = [...choices].sort((a, b) => {
      const left = BigInt(a);
      const right = BigInt(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    setActivationOptions(sortedChoices);
    const previousActivation = selectedActivationRef.current;
    const chosenActivation = choices.has(previousActivation)
      ? previousActivation
      : sortedChoices[sortedChoices.length - 1] ?? "0";
    selectedActivationRef.current = chosenActivation;
    setActivation(chosenActivation);
    return result;
  } catch (err) {
    if (requestId !== eventRequestRef.current) return null;
    if (selectedSubstrateRef.current === name) {
      setStore(null);
      setError(
        `Unable to load events for "${name}": ${
          err instanceof Error ? err.message : "unknown API error"
        }`,
      );
    }
    return null;
  } finally {
    if (requestId === eventRequestRef.current) {
      setLoadingEvents(false);
    }
  }
},
[selectedSubstrateEntry],

);

const loadNetworkBudgets = useCallback(
async (name, activationValue, options = {}) => {
if (!name || !/^\d+$/.test(String(activationValue))) {
setNetworkBudgets([]);
return null;
}

  const requestId = ++budgetRequestRef.current;
  if (!options.silent) setLoadingBudgets(true);
  try {
    const result = await apiRequest(
      `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(
        activationValue,
      )}/budgets`,
    );
    if (
      requestId !== budgetRequestRef.current ||
      selectedSubstrateRef.current !== name ||
      selectedActivationRef.current !== String(activationValue)
    ) {
      return null;
    }
    const entries = normalizeNetworkBudgetResponse(result);
    setNetworkBudgets(entries);
    setDrafts((current) => {
      const next = { ...current };
      for (const entry of entries) {
        const networkId = entry?.network?.id;
        if (!networkId) continue;
        const key = networkBudgetKey(activationValue, networkId);
        if (!savingKeys[key]) {
          next[key] = draftFromBudget(
            entry.configured ? entry.budget : null,
          );
        }
      }
      return next;
    });
    return result;
  } catch (err) {
    if (requestId !== budgetRequestRef.current) return null;
    setNetworkBudgets([]);
    setError(
      `Unable to load network budgets for activation ${activationValue}: ${
        err instanceof Error ? err.message : "unknown API error"
      }`,
    );
    return null;
  } finally {
    if (requestId === budgetRequestRef.current) {
      setLoadingBudgets(false);
    }
  }
},
[savingKeys],

);

const loadPayloadBudgets = useCallback(
async (name, activationValue, options = {}) => {
if (!name || !/^\d+$/.test(String(activationValue))) {
setPayloadBudgets([]);
return null;
}

  const requestId = ++payloadRequestRef.current;
  if (!options.silent) setLoadingPayloadBudgets(true);
  try {
    /*
     * This endpoint must return one row per distinct persisted payload
     * path/depth identifier, rather than aggregating rows by network.
     */
    const result = await apiRequest(
      `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(
        activationValue,
      )}/payload-budgets`,
    );
    if (
      requestId !== payloadRequestRef.current ||
      selectedSubstrateRef.current !== name ||
      selectedActivationRef.current !== String(activationValue)
    ) {
      return null;
    }
    const entries = normalizePayloadBudgetResponse(result);
    setPayloadBudgets(entries);
    setDrafts((current) => {
      const next = { ...current };
      for (const entry of entries) {
        const key = payloadBudgetKey(
          activationValue,
          entry.network.id,
          entry.path,
          entry.depth_identifier,
        );
        if (!savingKeys[key]) {
          next[key] = draftFromBudget(
            entry.configured ? entry.budget : null,
          );
        }
      }
      return next;
    });
    return result;
  } catch (err) {
    if (requestId !== payloadRequestRef.current) return null;
    setPayloadBudgets([]);
    setBudgetErrors((current) => ({
      ...current,
      payloadLoad: `Unable to load payload budgets: ${
        err instanceof Error ? err.message : "unknown API error"
      }`,
    }));
    return null;
  } finally {
    if (requestId === payloadRequestRef.current) {
      setLoadingPayloadBudgets(false);
    }
  }
},
[savingKeys],

);

useEffect(() => {
let cancelled = false;

async function initialize() {
  const results = await Promise.allSettled([
    loadNetworks(),
    loadSubstrates(),
  ]);
  if (cancelled) return;
  if (results[0].status === "rejected") {
    setError(
      "Unable to load registered networks. Check GET /networks on qtm-api.",
    );
  }
  if (results[1].status === "rejected") {
    setError("Unable to initialize the event store.");
  }
}
initialize();
return () => {
  cancelled = true;
  eventRequestRef.current += 1;
  budgetRequestRef.current += 1;
  payloadRequestRef.current += 1;
};

}, [loadNetworks, loadSubstrates]);

useEffect(() => {
if (!substrate) {
setStore(null);
setNetworkBudgets([]);
setPayloadBudgets([]);
return;
}

selectedSubstrateRef.current = substrate;
loadEvents(substrate);

}, [substrate, loadEvents]);

useEffect(() => {
if (!substrate || !/^\d+$/.test(String(activation))) {
setNetworkBudgets([]);
setPayloadBudgets([]);
return;
}

selectedActivationRef.current = activation;
loadNetworkBudgets(substrate, activation);
loadPayloadBudgets(substrate, activation);

}, [substrate, activation, loadNetworkBudgets, loadPayloadBudgets]);

useEffect(() => {
if (!substrate) return undefined;

const interval = window.setInterval(() => {
  if (!loadingEvents) loadEvents(substrate, { silent: true });
}, REFRESH_INTERVAL);
return () => window.clearInterval(interval);

}, [substrate, loadingEvents, loadEvents]);

function selectSubstrate(name) {
selectedSubstrateRef.current = name;
selectedActivationRef.current = “0”;

eventRequestRef.current += 1;
budgetRequestRef.current += 1;
payloadRequestRef.current += 1;
setSubstrate(name);
setActivation("0");
setActivationOptions(["0"]);
setStore(null);
setNetworkBudgets([]);
setPayloadBudgets([]);
setError("");
setNotice("");
setBudgetErrors({});
setBudgetNotices({});

}

function selectActivation(value) {
if (!/^\d+$/.test(String(value))) return;

selectedActivationRef.current = String(value);
budgetRequestRef.current += 1;
payloadRequestRef.current += 1;
setActivation(String(value));
setNetworkBudgets([]);
setPayloadBudgets([]);
setError("");
setNotice("");
setBudgetErrors({});
setBudgetNotices({});

}

function updateDraft(key, field, value) {
setDrafts((current) => ({
…current,
[key]: {
…(current[key] ?? emptyDraft()),
[field]: value,
},
}));

setBudgetErrors((current) => ({ ...current, [key]: "" }));
setBudgetNotices((current) => ({ ...current, [key]: "" }));

}

function validateBudget(draft) {
const minEvents = integer(draft.min_events, “min_events”);
const maxEvents = integer(draft.max_events, “max_events”);
const maxRetainedMass = unsigned128(
draft.max_retained_mass,
“max_retained_mass”,
);

if (maxEvents < 1) {
  throw new Error("max_events must be at least 1.");
}
if (minEvents > maxEvents) {
  throw new Error("min_events cannot exceed max_events.");
}
if (BigInt(maxRetainedMass) < 1n) {
  throw new Error("max_retained_mass must be at least 1 byte.");
}
return { minEvents, maxEvents, maxRetainedMass };

}

function budgetRequestBody(payload) {
/*
* Keep max_retained_mass as an exact decimal JSON integer. Do not convert
* this u128 value to a JavaScript Number.
*/
return (
{"min_events":${payload.minEvents}, +
"max_events":${payload.maxEvents}, +
"max_retained_mass":${payload.maxRetainedMass}}
);
}

async function saveNetworkBudget(event, network) {
event.preventDefault();

if (!substrate) {
  setError("Select a substrate before saving a budget.");
  return;
}
const key = networkBudgetKey(activation, network.id);
const draft = drafts[key] ?? emptyDraft();
let payload;
try {
  payload = validateBudget(draft);
} catch (err) {
  setBudgetErrors((current) => ({
    ...current,
    [key]: err instanceof Error ? err.message : "Invalid budget.",
  }));
  return;
}
setSavingKeys((current) => ({ ...current, [key]: true }));
setBudgetErrors((current) => ({ ...current, [key]: "" }));
setBudgetNotices((current) => ({ ...current, [key]: "" }));
try {
  const result = await apiRequest(
    `/wallets/${encodeURIComponent(
      substrate,
    )}/activations/${encodeURIComponent(
      activation,
    )}/budgets/${encodeURIComponent(network.id)}`,
    {
      method: "PUT",
      body: budgetRequestBody(payload),
    },
  );
  setNetworkBudgets((current) =>
    current.map((entry) =>
      entry?.network?.id === network.id
        ? {
            ...entry,
            configured: true,
            budget: result.budget ?? {
              min_events: payload.minEvents,
              max_events: payload.maxEvents,
              max_retained_mass: payload.maxRetainedMass,
            },
          }
        : entry,
    ),
  );
  setBudgetNotices((current) => ({
    ...current,
    [key]: `Saved for ${network.id} · activation ${activation}.`,
  }));
} catch (err) {
  setBudgetErrors((current) => ({
    ...current,
    [key]: err instanceof Error
      ? err.message
      : "Unable to save this network budget.",
  }));
} finally {
  setSavingKeys((current) => {
    const next = { ...current };
    delete next[key];
    return next;
  });
}

}

async function savePayloadBudget(event, entry) {
event.preventDefault();

if (!substrate) {
  setError("Select a substrate before saving a payload budget.");
  return;
}
const key = payloadBudgetKey(
  activation,
  entry.network.id,
  entry.path,
  entry.depth_identifier,
);
const draft = drafts[key] ?? draftFromBudget(entry.budget);
let payload;
try {
  payload = validateBudget(draft);
} catch (err) {
  setBudgetErrors((current) => ({
    ...current,
    [key]: err instanceof Error ? err.message : "Invalid payload budget.",
  }));
  return;
}
setSavingKeys((current) => ({ ...current, [key]: true }));
setBudgetErrors((current) => ({ ...current, [key]: "" }));
setBudgetNotices((current) => ({ ...current, [key]: "" }));
try {
  /*
   * The path and depth identifier are separate address components.
   * encodeURIComponent preserves each component as one URL segment.
   *
   * Expected API:
   * PUT /wallets/:name/activations/:activation/payload-budgets/:network/:path/:depth
   */
  const endpoint =
    `/wallets/${encodeURIComponent(substrate)}` +
    `/activations/${encodeURIComponent(activation)}` +
    `/payload-budgets/${encodeURIComponent(entry.network.id)}` +
    `/${encodeURIComponent(entry.path)}` +
    `/${encodeURIComponent(entry.depth_identifier || "_")}`;
  const result = await apiRequest(endpoint, {
    method: "PUT",
    body: budgetRequestBody(payload),
  });
  setPayloadBudgets((current) =>
    current.map((candidate) => {
      const candidateKey = payloadBudgetKey(
        activation,
        candidate.network.id,
        candidate.path,
        candidate.depth_identifier,
      );
      if (candidateKey !== key) return candidate;
      return {
        ...candidate,
        configured: true,
        budget: result.budget ?? {
          min_events: payload.minEvents,
          max_events: payload.maxEvents,
          max_retained_mass: payload.maxRetainedMass,
        },
      };
    }),
  );
  setBudgetNotices((current) => ({
    ...current,
    [key]: `Saved payload budget for ${entry.network.id}, activation ${activation}.`,
  }));
} catch (err) {
  setBudgetErrors((current) => ({
    ...current,
    [key]: err instanceof Error
      ? err.message
      : "Unable to save this payload budget.",
  }));
} finally {
  setSavingKeys((current) => {
    const next = { ...current };
    delete next[key];
    return next;
  });
}

}

async function refreshAll() {
if (!substrate) return;

setError("");
setNotice("");
const eventResult = await loadEvents(substrate);
if (eventResult) {
  await Promise.all([
    loadNetworkBudgets(substrate, selectedActivationRef.current),
    loadPayloadBudgets(substrate, selectedActivationRef.current),
  ]);
  setNotice(
    "Event snapshot, network budgets, and payload budgets refreshed.",
  );
}

}

const activationEvents = useMemo(
() =>
events.filter(
(event) => activationFromEvent(event) === String(activation),
),
[events, activation],
);

const activationRetainedMass = useMemo(
() => totalRetainedMass(activationEvents).toString(),
[activationEvents],
);

const networkBudgetById = useMemo(() => {
const map = new Map();

for (const entry of networkBudgets) {
  const id = entry?.network?.id;
  if (id) map.set(id, entry);
}
return map;

}, [networkBudgets]);

const renderedNetworks = useMemo(() => {
if (networks.length) return networks;

return networkBudgets
  .map((entry) => normalizeNetwork(entry.network))
  .filter(Boolean);

}, [networks, networkBudgets]);

const payloadGroups = useMemo(() => {
const groups = new Map();

for (const entry of payloadBudgets) {
  const id = entry.network.id;
  if (!groups.has(id)) {
    groups.set(id, {
      network: entry.network,
      entries: [],
    });
  }
  groups.get(id).entries.push(entry);
}
return [...groups.values()];

}, [payloadBudgets]);

return (
QuantPerm · QTM · Persistent substrate
Event Store
Manage activation-scoped network budgets and distinct payload
budgets within each network path. Payload path and depth
identifiers remain independent persistence keys.
      <div className="flex flex-wrap gap-2">
        <a
          href="/"
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Back to QTM
        </a>
        <a
          href="/network"
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Network
        </a>
      </div>
    </header>
    <Panel
      title="Universal substrate"
      description="Select one persistent substrate, then select the activation whose network and payload budgets you want to inspect or update."
      action={
        <ActionButton
          disabled={
            !substrate ||
            loadingEvents ||
            loadingBudgets ||
            loadingPayloadBudgets
          }
          onClick={refreshAll}
        >
          {loadingEvents || loadingBudgets || loadingPayloadBudgets
            ? "Refreshing…"
            : "Refresh"}
        </ActionButton>
      }
    >
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Persistent substrate
          </span>
          <select
            value={substrate}
            disabled={loadingList || substrates.length === 0}
            onChange={(event) => selectSubstrate(event.target.value)}
            className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
          >
            <option value="">
              {loadingList ? "Loading substrates…" : "Select substrate"}
            </option>
            {substrates.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Activation
          </span>
          <select
            value={activation}
            disabled={!substrate || activationOptions.length === 0}
            onChange={(event) => selectActivation(event.target.value)}
            className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
          >
            {activationOptions.map((value) => (
              <option key={value} value={value}>
                Activation {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 xl:grid-cols-4 dark:border-zinc-800">
        <Field label="Substrate">{text(store?.substrate ?? substrate)}</Field>
        <Field label="Activation directory">
          <EventValue
            value={
              substrate
                ? `${text(store?.directory)}/event/${activation}`
                : "—"
            }
          />
        </Field>
        <Field label="Persisted events">{events.length}</Field>
        <Field label="Configured network budgets">
          {configuredNetworkBudgetCount} / {renderedNetworks.length}
        </Field>
      </dl>
      <div className="mt-4 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800">
        <Field label="Configured payload budgets">
          {configuredPayloadBudgetCount} / {payloadBudgets.length}
        </Field>
        <Field label="Distinct payload path records">
          {payloadBudgets.length}
        </Field>
      </div>
      {store && (
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800">
          <Field label="Substrate directory">
            <EventValue value={store.directory} />
          </Field>
          <Field label="Events directory">
            <EventValue value={store.events_directory} />
          </Field>
        </div>
      )}
    </Panel>
    {error && (
      <div
        role="alert"
        className="break-words rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm leading-6 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        {error}
      </div>
    )}
    {budgetErrors.payloadLoad && (
      <div
        role="alert"
        className="break-words rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      >
        {budgetErrors.payloadLoad}
      </div>
    )}
    {notice && (
      <div
        role="status"
        className="break-words rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      >
        {notice}
      </div>
    )}
    <Panel
      title={`Network budgets · activation ${activation}`}
      description="One budget per registered network. These budgets govern the network-level event and retained-mass limits; payload budgets are configured separately below."
      action={
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {renderedNetworks.length} registered networks
        </span>
      }
    >
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {renderedNetworks.map((network) => {
          const entry = networkBudgetById.get(network.id);
          const configured = Boolean(entry?.configured && entry?.budget);
          const budget = entry?.budget ?? null;
          const key = networkBudgetKey(activation, network.id);
          const draft = drafts[key] ?? draftFromBudget(budget);
          const saving = Boolean(savingKeys[key]);
          const expanded = Boolean(expandedNetworks[key]);
          return (
            <section
              key={network.id}
              className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold">
                    {network.name}
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {network.id}
                  </p>
                </div>
                <StatusPill configured={configured} />
              </div>
              <BudgetSummary budget={budget} />
              <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <p>
                  <span className="font-medium">Coin:</span>{" "}
                  {text(network.coin)}
                </p>
                <p className="mt-1 break-all">
                  <span className="font-medium">Network path:</span>{" "}
                  {text(network.path)}
                </p>
                <p className="mt-1 break-all">
                  <span className="font-medium">Budget file:</span>{" "}
                  {substrate
                    ? `${text(store?.directory)}/event/${activation}/${network.id}/budget`
                    : "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setExpandedNetworks((current) => ({
                    ...current,
                    [key]: !current[key],
                  }))
                }
                className="mt-4 inline-flex min-h-10 w-full items-center justify-between rounded-lg border border-zinc-200 px-3 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                aria-expanded={expanded}
              >
                <span>
                  {expanded ? "Close network editor" : "Edit network budget"}
                </span>
                <span aria-hidden="true">{expanded ? "−" : "+"}</span>
              </button>
              {expanded && (
                <form
                  onSubmit={(event) => saveNetworkBudget(event, network)}
                  className="mt-4 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800"
                >
                  <NumberInput
                    label="min_events"
                    value={draft.min_events}
                    onChange={(value) =>
                      updateDraft(key, "min_events", value)
                    }
                    hint="Minimum event capacity."
                    disabled={saving}
                  />
                  <NumberInput
                    label="max_events"
                    value={draft.max_events}
                    onChange={(value) =>
                      updateDraft(key, "max_events", value)
                    }
                    hint="Maximum admitted event count."
                    disabled={saving}
                  />
                  <NumberInput
                    label="max_retained_mass"
                    value={draft.max_retained_mass}
                    onChange={(value) =>
                      updateDraft(key, "max_retained_mass", value)
                    }
                    textInput
                    hint="Exact decimal integer, up to u128::MAX."
                    disabled={saving}
                  />
                  {budgetErrors[key] && (
                    <p
                      role="alert"
                      className="break-words rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                    >
                      {budgetErrors[key]}
                    </p>
                  )}
                  {budgetNotices[key] && (
                    <p
                      role="status"
                      className="break-words rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                    >
                      {budgetNotices[key]}
                    </p>
                  )}
                  <ActionButton
                    type="submit"
                    primary
                    disabled={
                      !substrate || saving || loadingBudgets
                    }
                  >
                    {saving ? "Saving…" : "Save network budget"}
                  </ActionButton>
                  <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    Saving changes only this network budget for activation{" "}
                    <span className="font-mono">{activation}</span>.
                  </p>
                </form>
              )}
            </section>
          );
        })}
      </div>
      {loadingBudgets && (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Loading network budgets for activation {activation}…
        </p>
      )}
      {!loadingBudgets && renderedNetworks.length === 0 && (
        <p className="mt-4 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          No registered networks were returned. Check GET /networks.
        </p>
      )}
    </Panel>
    <Panel
      title={`Payload budgets · activation ${activation}`}
      description="A second, independent budget layer. Each distinct payload path and its deserialized depth identifier gets its own card, scoped to its parent network. Saving one payload does not change the network budget or another payload."
      action={
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {payloadBudgets.length} distinct payload entries
        </span>
      }
    >
      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        Payload paths and depth identifiers must come from the API's
        deserialized records. This UI does not infer identifiers from
        aggregate depth-object counts or manufacture paths when no
        persisted identifier is available.
      </div>
      {loadingPayloadBudgets && (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Loading distinct payload paths for activation {activation}…
        </p>
      )}
      {!loadingPayloadBudgets && payloadBudgets.length === 0 && (
        <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm font-medium">
            No distinct payload budget entries were returned.
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            The payload-budgets endpoint must return one record per actual
            network payload path and depth identifier. If the endpoint is
            not implemented yet, this section remains empty until the API
            exposes those persisted objects.
          </p>
        </div>
      )}
      {payloadGroups.length > 0 && (
        <div className="mt-4 space-y-5">
          {payloadGroups.map((group) => (
            <section
              key={group.network.id}
              className="min-w-0 rounded-xl border border-zinc-200 p-3 sm:p-4 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">
                    {group.network.name}
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {group.network.id}
                  </p>
                  <p className="mt-1 break-all text-xs text-zinc-500 dark:text-zinc-400">
                    Network derivation path: {text(group.network.path)}
                  </p>
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {group.entries.length} payload path
                  {group.entries.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {group.entries.map((entry) => {
                  const key = payloadBudgetKey(
                    activation,
                    entry.network.id,
                    entry.path,
                    entry.depth_identifier,
                  );
                  const configured = Boolean(
                    entry.configured && entry.budget,
                  );
                  const draft =
                    drafts[key] ?? draftFromBudget(entry.budget);
                  const saving = Boolean(savingKeys[key]);
                  const expanded = Boolean(expandedPayloads[key]);
                  return (
                    <article
                      key={key}
                      className="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold">
                            Payload budget
                          </h4>
                          <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            {entry.network.id}
                          </p>
                        </div>
                        <StatusPill configured={configured} />
                      </div>
                      <dl className="mt-4 grid grid-cols-1 gap-3">
                        <Field label="Payload path">
                          <EventValue value={entry.path} />
                        </Field>
                        <Field label="Depth identifier">
                          <EventValue
                            value={
                              entry.depth_identifier || "Not supplied"
                            }
                          />
                        </Field>
                        <Field label="Activation">{activation}</Field>
                      </dl>
                      <BudgetSummary budget={entry.budget} />
                      <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                        <p className="font-medium">Payload budget address</p>
                        <p className="mt-1 break-all font-mono">
                          {text(store?.directory)}/event/{activation}/
                          {entry.network.id}/{entry.path}/budget
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPayloads((current) => ({
                            ...current,
                            [key]: !current[key],
                          }))
                        }
                        className="mt-4 inline-flex min-h-10 w-full items-center justify-between rounded-lg border border-zinc-200 px-3 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-950"
                        aria-expanded={expanded}
                      >
                        <span>
                          {expanded
                            ? "Close payload editor"
                            : "Edit payload budget"}
                        </span>
                        <span aria-hidden="true">
                          {expanded ? "−" : "+"}
                        </span>
                      </button>
                      {expanded && (
                        <form
                          onSubmit={(event) =>
                            savePayloadBudget(event, entry)
                          }
                          className="mt-4 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800"
                        >
                          <NumberInput
                            label="min_events"
                            value={draft.min_events}
                            onChange={(value) =>
                              updateDraft(key, "min_events", value)
                            }
                            hint="Minimum event capacity for this payload."
                            disabled={saving}
                          />
                          <NumberInput
                            label="max_events"
                            value={draft.max_events}
                            onChange={(value) =>
                              updateDraft(key, "max_events", value)
                            }
                            hint="Maximum admitted events for this payload."
                            disabled={saving}
                          />
                          <NumberInput
                            label="max_retained_mass"
                            value={draft.max_retained_mass}
                            onChange={(value) =>
                              updateDraft(
                                key,
                                "max_retained_mass",
                                value,
                              )
                            }
                            textInput
                            hint="Exact decimal integer, up to u128::MAX."
                            disabled={saving}
                          />
                          {budgetErrors[key] && (
                            <p
                              role="alert"
                              className="break-words rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                            >
                              {budgetErrors[key]}
                            </p>
                          )}
                          {budgetNotices[key] && (
                            <p
                              role="status"
                              className="break-words rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                            >
                              {budgetNotices[key]}
                            </p>
                          )}
                          <ActionButton
                            type="submit"
                            primary
                            disabled={
                              !substrate ||
                              saving ||
                              loadingPayloadBudgets
                            }
                          >
                            {saving ? "Saving…" : "Save payload budget"}
                          </ActionButton>
                          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                            This save is scoped to the selected activation,
                            network, payload path, and depth identifier.
                          </p>
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Panel>
    <Panel
      title="Activation utilization"
      description="These measurements summarize the selected substrate's persisted event snapshot. They are not a per-network ledger unless individual event records identify a network."
    >
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric
          label="Events in selected activation"
          value={activationEvents.length}
          unit="events"
        />
        <Metric
          label="Retained mass in selected activation"
          value={activationRetainedMass}
          unit="bytes"
          note="Exact sum of retained_mass values on matching activation records."
        />
        <Metric
          label="Events in substrate"
          value={events.length}
          unit="events"
          note="Total records returned by the event-store endpoint."
        />
      </div>
    </Panel>
    <Panel
      title="Persisted event diagnostics"
      description="Records returned by the selected substrate's event store."
      action={
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {events.length} record{events.length === 1 ? "" : "s"}
        </span>
      }
      className="p-0"
    >
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <tr>
              <th scope="col" className="px-4 py-3">Activation</th>
              <th scope="col" className="px-4 py-3">Event type</th>
              <th scope="col" className="px-4 py-3">Record reference</th>
              <th scope="col" className="px-4 py-3">Dimension</th>
              <th scope="col" className="px-4 py-3">Structural value (Σ)</th>
              <th scope="col" className="px-4 py-3">Depth objects</th>
              <th scope="col" className="px-4 py-3">Retained mass</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {events.map((event, index) => {
              const heritageState = event?.heritage?.state;
              const kind = text(event.kind, "event");
              const eventActivation =
                event.activation ?? heritageState?.activation_count;
              const dimension = event.dimension ?? heritageState?.dimension;
              const structuralValue =
                event.structural_value ?? heritageState?.structural_value;
              const retainedMass = eventRetainedMass(event);
              return (
                <tr
                  key={`${kind}-${text(eventActivation)}-${text(dimension)}-${index}`}
                  className="align-top transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono">
                    {text(eventActivation)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                        kind === "exile"
                          ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                          : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200"
                      }`}
                    >
                      {kind}
                    </span>
                  </td>
                  <td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {text(event.record)}
                  </td>
                  <td className="break-all px-4 py-3 font-mono">
                    {text(dimension)}
                  </td>
                  <td className="break-all px-4 py-3 font-mono">
                    {text(structuralValue)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {text(event.depth_objects)}
                  </td>
                  <td className="break-all px-4 py-3 font-mono">
                    {text(retainedMass)}
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  {loadingEvents
                    ? "Loading persisted events…"
                    : store
                      ? "No persisted transit or exile records were returned for this substrate."
                      : "Load a substrate to inspect persisted records."}
                </td>
              </tr>
            )}
          </tbody>
          {store && (
            <tfoot className="border-t-2 border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950">
              <tr>
                <th
                  scope="row"
                  colSpan={7}
                  className="px-4 py-3 text-left font-medium"
                >
                  <span className="block text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Runtime · API snapshot
                  </span>
                  <span className="mt-1 block break-all font-mono text-sm">
                    <RuntimeValue runtime={store.runtime} />
                  </span>
                </th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
    <footer className="border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
      QTM Event Store · Universal substrate · Activation-scoped network
      budgets · Payload-path-scoped budgets · Distinct depth identifiers ·
      Rust API
    </footer>
  </div>
</main>

);
}