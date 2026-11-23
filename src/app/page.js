"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
// Substrate state lives in the machine-local ~/.qp/substrates and is operated
// on by the QP runtime. Inside a native shell (for example Tauri) the console
// calls that runtime directly through IPC: no HTTP. A plain browser cannot
// reach the local filesystem, so it uses the qtm-api HTTP server.
// Prefer NEXT_PUBLIC_QTM_API_BASE when set; otherwise fall back to the public
// qtm-api deployment so a Vercel (or similar) host never routes /wallets to
// itself.
// Substrate storage is owned by the server-side QP runtime.
// substrate_root() is resolved by Rust, never by the browser.
const TABS = [
{ id: "create", label: "Create" },
{ id: "receive", label: "Receive" },
{ id: "transit", label: "Transit" },
{ id: "exile", label: "Exile" },
];
const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api.onrender.com"
).replace(/\/+$/, "");

// Module-level persistent cache across client navigation and remounts.
const qtmSessionCache = {
  substrates: null,
  networks: null,
  selectedSubstrate: "",
  selectedNetwork: "",
};

let inflightSubstratesPromise = null;
let inflightNetworksPromise = null;
const isRecord = (value) =>
value !== null && typeof value === "object" && !Array.isArray(value);
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
.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
.replace(/[_-]+/g, " ")
.replace(/\b\w/g, (character) => character.toUpperCase());
function friendlyValue(value) {
if (value === null || value === undefined || value === "") {
return "Not provided";
}
if (typeof value === "boolean") {
return value ? "Yes" : "No";
}
if (["string", "number", "bigint"].includes(typeof value)) {
return String(value);
}
if (Array.isArray(value)) {
return value.length ? `${value.length} items` : "None";
}
return "Details available";
}
function flatten(value, prefix = "", rows = []) {
if (value === null || value === undefined) {
if (prefix) rows.push([prefix, "Not provided"]);
} else if (Array.isArray(value)) {
if (!value.length && prefix) {
rows.push([prefix, "None"]);
}
value.forEach((item, index) => {
flatten(item, `${prefix || "Item"} ${index + 1}`, rows);
});
} else if (isRecord(value)) {
const entries = Object.entries(value);
if (!entries.length && prefix) {
rows.push([prefix, "No details returned"]);
}
entries.forEach(([key, child]) => {
flatten(
child,
prefix ? `${prefix} · ${formatKey(key)}` : formatKey(key),
rows
);
});
} else {
rows.push([prefix || "Value", friendlyValue(value)]);
}
return rows;
}
function hasContent(value) {
return (
value !== null &&
value !== undefined &&
(typeof value !== "object" ||
(Array.isArray(value)
? value.length > 0
: Object.keys(value).length > 0))
);
}
class RuntimeError extends Error {
constructor(message, details = {}) {
super(message);
this.name = "RuntimeError";
this.status = details.status ?? 0;
this.statusText = details.statusText ?? "";
this.url = details.url ?? "";
this.body = details.body;
}
}
// Native IPC entry point, present only inside a native shell.
function nativeInvoke() {
if (typeof window === "undefined" || !isTauri()) return null;
return invoke;
}
const NATIVE_COMMANDS = {
listSubstrates: "qtm_list_substrates",
listNetworks: "qtm_list_networks",
createSubstrate: "qtm_create",
receive: "qtm_receive",
transit: "qtm_transit",
exile: "qtm_exile",
listEvents: "qtm_events",
submissionValue: "qtm_submission_value",
};
const API_ROUTES = {
listSubstrates: () => ["GET", "/wallets"],
listNetworks: () => ["GET", "/networks"],
createSubstrate: () => ["POST", "/wallets"],
openSubstrate: ({ name, activation }) => [
  "GET",
  `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/open`,
],
receive: ({ name }) => [
"POST",
⁠/wallets/${encodeURIComponent(name)}/receive⁠,
],
transit: ({ name }) => [
"POST",
⁠/wallets/${encodeURIComponent(name)}/transit⁠,
],
exile: ({ name }) => [
"POST",
⁠/wallets/${encodeURIComponent(name)}/exile⁠,
],
listEvents: ({ name }) => [
"GET",
⁠/wallets/${encodeURIComponent(name)}/events⁠,
],
submissionValue: ({ name, activation, network, field }) => [
"GET",
⁠/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/${encodeURIComponent(field)}⁠,
],
};
function directMessage(cause) {
if (typeof cause === "string" && cause.trim()) return cause.trim();
if (cause instanceof Error && cause.message) return cause.message;
if (isRecord(cause)) {
const message = valueAt(cause, ["error", "message", "detail"]);
if (typeof message === "string" && message.trim()) return message.trim();
if (message !== undefined) return String(message);
}
return "The QP runtime reported an error.";
}
function parseApiResponse(raw) {
if (!raw) return {};
try {
return JSON.parse(raw);
} catch {
return { response_text: raw };
}
}
async function apiRequest(path, options = {}) {
const method = options.method || "GET";
const url = ⁠${API_BASE}${path}⁠;
const startedAt = performance.now();
let response;
console.info(⁠[QTM API] START ${method} ${path}⁠);
try {
response = await fetch(url, {
method,
headers: {
Accept: "application/json",
...(options.body !== undefined
? { "Content-Type": "application/json" }
: {}),
...options.headers,
},
...(options.body !== undefined
? { body: JSON.stringify(options.body) }
: {}),
cache: "no-store",
...(options.signal ? { signal: options.signal } : {}),
});
console.info(
⁠[QTM API] HEADERS ${method} ${path} ⁠ +
⁠status=${response.status} ⁠ +
⁠elapsed=${Math.round(performance.now() - startedAt)}ms⁠
);
} catch (cause) {
console.error(⁠[QTM API] FETCH FAILED ${method} ${path}⁠, cause);
throw new RuntimeError(
⁠Could not reach the QTM API at ${API_BASE} while calling ${method} ${path}: ${directMessage(cause)}⁠,
{ status: 0, url }
);
}
let raw;
try {
raw = await response.text();
console.info(
⁠[QTM API] BODY COMPLETE ${method} ${path} ⁠ +
⁠bytes=${raw.length} ⁠ +
⁠elapsed=${Math.round(performance.now() - startedAt)}ms⁠
);
} catch (cause) {
console.error(⁠[QTM API] BODY FAILED ${method} ${path}⁠, cause);
throw new RuntimeError(
⁠The QTM API connection closed before the response was read (${method} ${path}): ${directMessage(cause)}⁠,
{
status: response.status,
statusText: response.statusText,
url: response.url || url,
}
);
}
const data = parseApiResponse(raw);
if (!response.ok) {
const message = valueAt(data, ["error", "message", "detail"]);
throw new RuntimeError(
typeof message === "string" && message.trim()
? message.trim()
: ⁠Request failed with HTTP ${response.status}: ${method} ${path}⁠,
{
status: response.status,
statusText: response.statusText,
url: response.url || url,
body: data,
}
);
}
console.info(
⁠[QTM API] SUCCESS ${method} ${path} ⁠ +
⁠elapsed=${Math.round(performance.now() - startedAt)}ms⁠
);
return data;
}
async function callRuntime(operation, args = {}) {
const native = nativeInvoke();
if (native) {
const command = NATIVE_COMMANDS[operation];
if (!command) {
throw new RuntimeError(
⁠Native command is not registered: ${operation}⁠
);
}
try {
return await native(command, args || {});
} catch (cause) {
throw new RuntimeError(directMessage(cause));
}
}
const route = API_ROUTES[operation];
if (!route) {
throw new RuntimeError(
⁠Browser API route is not registered: ${operation}⁠
);
}
const [method, path] = route(args || {});
const body = ["createSubstrate", "receive", "transit"].includes(operation)
? args?.request
: undefined;
return apiRequest(path, {
method,
...(body !== undefined ? { body } : {}),
});
}
function eventMapOf(source) {
const direct = objectAt(source, ["event", "event_map", "eventMap"]);
if (direct) return direct;
const frame = objectAt(source, ["frame"]);
const frameEvent = objectAt(frame, ["event", "event_map", "eventMap"]);
if (frameEvent) return frameEvent;
const transaction = objectAt(frame, [
"quantum_transaction",
"quantumTransaction",
]);
return objectAt(transaction, ["event", "event_map", "eventMap"]);
}
function ResultHeading({ eyebrow, title }) {
return (
<div className="space-y-1">
{eyebrow && (
<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
{eyebrow}
</p>
)}
<h3 className="text-sm font-semibold">{title}</h3>
</div>
);
}
function KeyValueList({ value, emptyText = "No details were returned." }) {
const rows = flatten(value);
if (!rows.length) {
return (
<p className="text-xs text-zinc-500 dark:text-zinc-400">{emptyText}</p>
);
}
return (
<dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
{rows.map(([key, itemValue], index) => (
<div key={⁠${key}-${index}⁠} className="min-w-0">
<dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
{key}
</dt>
<dd className="mt-0.5 break-words text-xs text-zinc-800 dark:text-zinc-200">
{itemValue}
</dd>
</div>
))}
</dl>
);
}
function ResultSection({ title, description, value, defaultOpen = false }) {
const [open, setOpen] = useState(defaultOpen);
return (
<section className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
<button
type="button"
aria-expanded={open}
onClick={() => setOpen((current) => !current)}
className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
>
<span className="min-w-0">
<span className="block text-xs font-semibold">{title}</span>
{description && (
<span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
{description}
</span>
)}
</span>
<span
aria-hidden="true"
className={⁠flex size-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 transition-transform dark:border-zinc-700 ${ open ? "rotate-180" : "" }⁠}
>
⌄
</span>
</button>
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
placeholder = "",
mono = false,
type = "text",
autoComplete,
}) {
return (
<label className="flex min-w-0 flex-col gap-1">
<span className="text-xs font-medium">{label}</span>
<input
type={type}
autoComplete={autoComplete}
value={value}
onChange={(event) => onChange(event.target.value)}
required={required}
placeholder={placeholder}
className={⁠h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${ mono ? "font-mono" : "" }⁠}
/>
</label>
);
}
function NumberField({ label, value, onChange, min = 0 }) {
return (
<label className="flex min-w-0 flex-col gap-1">
<span className="text-xs font-medium">{label}</span>
<input
type="number"
min={min}
step="1"
value={value}
onChange={(event) => onChange(event.target.value)}
required
className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
/>
</label>
);
}
// Controlled ordinal selector. Amount (N) defines the coordinate range 1…N;
// every unit is its own button and button n means ordinal coordinate n.
// The grid is windowed (only visible rows are mounted) inside a scroll
// container, so there is no display cutoff and every ordinal stays reachable.
// When amount changes to N the frame loads persisted events for that range
// (0..N) and marks every ordinal backed by a persisted transit event with a
const ORDINAL_COLUMNS = 8;
const ORDINAL_ROW_HEIGHT = 38;
const ORDINAL_VIEWPORT_HEIGHT = 190;
const ORDINAL_OVERSCAN = 2;
function ReceiveOrdinalSelector({
amount,
ordinal,
onChange,
persistedOrdinals = [],
persistedLoading = false,
persistedError = "",
}) {
const [scrollTop, setScrollTop] = useState(0);
const count = Number(amount);
const selected = Number(ordinal);
const persisted = new Set(persistedOrdinals);
if (!Number.isSafeInteger(count) || count <= 0) {
return (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
Enter a positive amount to load persisted ordinals.
</p>
);
}
const totalRows = Math.ceil(count / ORDINAL_COLUMNS);
const firstRow = Math.max(
0,
Math.floor(scrollTop / ORDINAL_ROW_HEIGHT) - ORDINAL_OVERSCAN
);
const lastRow = Math.min(
totalRows - 1,
Math.ceil((scrollTop + ORDINAL_VIEWPORT_HEIGHT) / ORDINAL_ROW_HEIGHT) +
ORDINAL_OVERSCAN
);
const rows = [];
for (let row = firstRow; row <= lastRow; row += 1) {
const cells = [];
for (let column = 0; column < ORDINAL_COLUMNS; column += 1) {
const id = row * ORDINAL_COLUMNS + column + 1;
if (id > count) break;
const isSelected = id === selected;
const isPersisted = persisted.has(id);
const cellClass = isPersisted
? isSelected
? "border-emerald-600 bg-emerald-200 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-900/70 dark:text-emerald-100"
: "border-emerald-300 bg-emerald-100 text-emerald-950 hover:bg-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-900/70"
: isSelected
? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-950"
: "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-900";
cells.push(
<button
key={id}
type="button"
aria-pressed={isSelected}
aria-label={⁠Ordinal ${id}${isPersisted ? ", persisted transit" : ""}⁠}
onClick={() => onChange(id)}
className={⁠flex h-8 min-w-0 items-center justify-center rounded-md border px-0.5 text-center transition-colors ${cellClass}⁠}
>
<span className="font-mono text-xs font-semibold leading-none">
{id}
</span>
</button>
);
}
rows.push(
<div
key={row}
className="grid gap-1 pb-1"
style={{
height: ORDINAL_ROW_HEIGHT,
gridTemplateColumns: ⁠repeat(${ORDINAL_COLUMNS}, minmax(0, 1fr))⁠,
}}
>
{cells}
</div>
);
}
return (
<section className="space-y-1.5">
<div>
<h4 className="text-xs font-semibold">
Ordinal units · Range 0–{count}
</h4>
<p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
{persisted.size} persisted transit(s) · {count} available coordinates
· Selected {Number.isSafeInteger(selected) ? selected : "none"}
</p>
</div>
{persistedLoading && (
<p className="text-xs text-emerald-600 dark:text-emerald-400">
Loading persisted events…
</p>
)}
{persistedError && (
<p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
{persistedError}
</p>
)}
<div
onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
className="overflow-y-auto rounded-lg border border-zinc-200 p-1 dark:border-zinc-800"
style={{ height: ORDINAL_VIEWPORT_HEIGHT }}
>
<div
className="relative"
style={{ height: totalRows * ORDINAL_ROW_HEIGHT }}
>
<div
className="absolute left-0 right-0"
style={{ top: firstRow * ORDINAL_ROW_HEIGHT }}
>
{rows}
</div>
</div>
</div>
<div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
<span className="size-2.5 rounded-sm border border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50" />
Persisted transit
<span className="ml-2 size-2.5 rounded-sm border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900" />
No persisted transit
</div>
</section>
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
if (Array.isArray(candidate)) {
return candidate.filter(isRecord);
}
if (isRecord(candidate)) {
for (const key of ["events", "records", "items"]) {
if (Array.isArray(candidate[key])) {
return candidate[key].filter(isRecord);
}
}
}
}
return [];
}
function recordNameOf(record) {
for (const key of [
"record_name",
"recordName",
"filename",
"file_name",
"fileName",
"name",
"record",
"path",
"id",
]) {
if (typeof record?.[key] === "string" && record[key].trim()) {
return record[key];
}
}
return "";
}
// Same 6:3 (2:1) ratio for every frame; stacks and relaxes the ratio on
// narrow screens, scrolling inside the frame when content is taller.
function Frame({ eyebrow, title, tone = "default", actions, children }) {
const toneClass =
tone === "sensitive"
? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30"
: "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
return (
<section
className={⁠flex min-w-0 flex-col overflow-hidden rounded-xl border sm:aspect-[2/1] ${toneClass}⁠}
>
<div className="flex shrink-0 items-start justify-between gap-2 border-b border-inherit px-3 py-2">
<div className="min-w-0">
{eyebrow && (
<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
{eyebrow}
</p>
)}
<h3 className="text-xs font-semibold">{title}</h3>
</div>
{actions && (
<div className="flex shrink-0 flex-wrap items-center gap-1.5">
{actions}
</div>
)}
</div>
<div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
</section>
);
}
function FrameButton({ onClick, disabled, children }) {
return (
<button
type="button"
onClick={onClick}
disabled={disabled}
className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
>
{children}
</button>
);
}
// Copies the exact underlying value (never a formatted label or a shortened
// display string) to the clipboard.
async function copyValue(value) {
if (value === null || value === undefined) return;
try {
await navigator.clipboard.writeText(String(value));
} catch {
// Clipboard access can be denied by the browser; nothing else to do.
}
}
// Small overlapping-squares copy control. ⁠label⁠ is the accessible name,
// for example "Copy address".
function CopyButton({ value, label }) {
const [copied, setCopied] = useState(false);
const empty = value === null || value === undefined || value === "";
useEffect(() => {
if (!copied) return undefined;
const timer = setTimeout(() => setCopied(false), 1500);
return () => clearTimeout(timer);
}, [copied]);
async function handleCopy() {
if (empty) return;
await copyValue(value);
setCopied(true);
}
return (
<button
type="button"
onClick={handleCopy}
disabled={empty}
aria-label={label}
title={copied ? "Copied" : label}
className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-900 dark:bg-zinc-900 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
>
{copied ? (
<svg
aria-hidden="true"
viewBox="0 0 24 24"
width="13"
height="13"
fill="none"
stroke="currentColor"
strokeWidth="2"
strokeLinecap="round"
strokeLinejoin="round"
>
<polyline points="20 6 9 17 4 12" />
</svg>
) : (
<svg
aria-hidden="true"
viewBox="0 0 24 24"
width="13"
height="13"
fill="none"
stroke="currentColor"
strokeWidth="2"
strokeLinecap="round"
strokeLinejoin="round"
>
<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
</svg>
)}
</button>
);
}
// One labelled network value with its own copy control.
function NetworkValueRow({ label, value, copyLabel }) {
return (
<div className="min-w-0">
<dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
{label}
</dt>
<dd className="mt-0.5 flex items-start gap-2">
<span className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">
{value === null || value === undefined || value === ""
? "Not provided"
: String(value)}
</span>
<CopyButton value={value} label={copyLabel} />
</dd>
</div>
);
}
// Display safeguard only; it is not access control.
function Blurred({ revealed, children }) {
return (
<div
aria-hidden={!revealed}
className={
revealed
? ""
: "pointer-events-none select-none blur-sm transition-[filter]"
}
>
{children}
</div>
);
}
// ---------------------------------------------------------------------------
// Operation 2: Independent Submission Derivation Results
// ---------------------------------------------------------------------------
function DeriveResults({ result }) {
const [revealSensitive, setRevealSensitive] = useState(false);
const [privateKey, setPrivateKey] = useState("");
const [privateKeyLoading, setPrivateKeyLoading] = useState(false);
const [privateKeyError, setPrivateKeyError] = useState("");
async function revealPrivateKey() {
if (privateKey) {
setPrivateKey("");
return;
}
setPrivateKeyLoading(true);
setPrivateKeyError("");
try {
const value = await callRuntime("submissionValue", {
name: result.substrate,
activation: result.activation,
submission: result.submission,
network: result.network,
field: "xpriv",
});
setPrivateKey(
typeof value === "string"
? value
: value?.response_text ?? JSON.stringify(value)
);
} catch (error) {
setPrivateKeyError(
error instanceof Error
? error.message
: "Unable to retrieve the private extended key."
);
} finally {
setPrivateKeyLoading(false);
}
}
return (
<div className="space-y-3">
<section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
<h3 className="text-xs font-semibold">Submission derivation identity</h3>
<p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
Persisted independently under activation {result?.activation}, submission {result?.submission}, network {result?.network}.
</p>
<div className="mt-3">
<KeyValueList
value={{
substrate: result?.substrate,
activation: result?.activation,
submission: result?.submission,
network: result?.network,
derivation_path: result?.derivation?.derivation_path,
directory: result?.derivation?.directory,
authorization_state: result?.derivation?.authorization_state,
settlement_state: result?.derivation?.settlement_state,
}}
/>
</div>
</section>
<Frame
eyebrow="Derived Values · Sensitive"
title="Network Key Material & Address"
tone="sensitive"
actions={
<FrameButton
onClick={() => setRevealSensitive((current) => !current)}
>
{revealSensitive ? "Hide values" : "Reveal values"}
</FrameButton>
}
>
<div className="space-y-3">
<KeyValueList
value={{
master_fingerprint: result?.derivations?.fingerprint,
address: result?.derivations?.address,
}}
/>
{revealSensitive ? (
<div className="space-y-3 border-t border-amber-200 pt-3 dark:border-amber-900">
<ResultSection
title="Address"
value={result?.derivations?.address}
defaultOpen
/>
<ResultSection
title="ScriptPubKey"
value={result?.derivations?.scriptpubkey}
defaultOpen
/>
<ResultSection
title="Master fingerprint"
value={result?.derivations?.fingerprint}
/>
<ResultSection
title="Xpub"
value={result?.derivations?.xpub}
/>
<ResultSection
title="Zpub"
value={result?.derivations?.zpub}
/>
<div className="space-y-2 rounded-lg border border-amber-300 p-3 dark:border-amber-800">
<div className="flex items-center justify-between gap-2">
<p className="text-xs font-semibold">
Private extended key · Xpriv
</p>
<FrameButton
onClick={revealPrivateKey}
disabled={privateKeyLoading}
>
{privateKeyLoading
? "Loading…"
: privateKey
? "Clear"
: "Reveal Xpriv"}
</FrameButton>
</div>
{privateKeyError && (
<p role="alert" className="text-xs text-red-600">
{privateKeyError}
</p>
)}
{privateKey && (
<p className="break-all rounded-lg bg-amber-100 p-2 font-mono text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
{privateKey}
</p>
)}
{!privateKey && !privateKeyError && (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
Xpriv is fetched on demand only when explicitly revealed.
</p>
)}
</div>
</div>
) : (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
Full scriptPubKey and extended keys are hidden. Reveal to inspect all derived values for this submission.
</p>
)}
</div>
</Frame>
<ResultSection
title="Complete derivation response"
value={result?.derivation}
/>
</div>
);
}
// Frame 4 · Network inputs. Fed by result.receive.derivation (metadata sent
// by the Receive response). Every supported network discovered for the
// activation gets its own section; values are loaded from the persisted
// activation.
function ReceiveNetworkDerivations({ derivation }) {
const [networkValues, setNetworkValues] = useState({});
const [privateKeys, setPrivateKeys] = useState({});
const [loading, setLoading] = useState(false);
const [privateKeyLoading, setPrivateKeyLoading] = useState({});
const [error, setError] = useState({});
const [privateKeyError, setPrivateKeyError] = useState({});
useEffect(() => {
let active = true;
async function loadNetworkValues() {
const networks = Array.isArray(derivation?.networks)
? derivation.networks
: [];
if (
!derivation?.substrate ||
!Number.isSafeInteger(Number(derivation.activation)) ||
!networks.length
) {
setNetworkValues({});
return;
}
setLoading(true);
setError({});
try {
const fields = [
"fingerprint",
"scriptpubkey",
"xpub",
"zpub",
"address",
];
const failures = {};
const entries = await Promise.all(
networks
.filter(
(network) =>
network.supported === true &&
network.available !== false &&
typeof network.network === "string"
)
.map(async (network) => {
try {
const values = await Promise.all(
fields.map(async (field) => {
const response = await callRuntime("submissionValue", {
name: derivation.substrate,
activation: Number(derivation.activation),
network: network.network,
field,
});
return [
field,
typeof response === "string"
? response
: response?.response_text ??
JSON.stringify(response),
];
})
);
return [network.network, Object.fromEntries(values)];
} catch (err) {
failures[network.network] =
err instanceof Error
? err.message
: "Unable to retrieve activation network values.";
return null;
}
})
);
if (active) {
setNetworkValues(Object.fromEntries(entries.filter(Boolean)));
setError(failures);
}
} catch (err) {
if (active) {
setError({
general:
err instanceof Error
? err.message
: "Unable to retrieve activation network values.",
});
}
} finally {
if (active) setLoading(false);
}
}
loadNetworkValues();
return () => {
active = false;
};
}, [derivation]);
async function revealPrivateKey(networkId) {
if (privateKeys[networkId]) {
setPrivateKeys((current) => {
const next = { ...current };
delete next[networkId];
return next;
});
return;
}
setPrivateKeyLoading((current) => ({
...current,
[networkId]: true,
}));
setPrivateKeyError((current) => ({
...current,
[networkId]: "",
}));
try {
const response = await callRuntime("submissionValue", {
name: derivation.substrate,
activation: Number(derivation.activation),
network: networkId,
field: "xpriv",
});
const value =
typeof response === "string"
? response
: response?.response_text ?? JSON.stringify(response);
setPrivateKeys((current) => ({
...current,
[networkId]: value,
}));
} catch (err) {
setPrivateKeyError((current) => ({
...current,
[networkId]:
err instanceof Error
? err.message
: "Unable to retrieve the private extended key.",
}));
} finally {
setPrivateKeyLoading((current) => ({
...current,
[networkId]: false,
}));
}
}
if (!derivation) return null;
const networks = Array.isArray(derivation.networks)
? derivation.networks
: [];
return (
<section className="min-w-0 overflow-hidden rounded-xl border border-emerald-300 bg-white dark:border-emerald-800 dark:bg-zinc-900">
<div className="border-b border-emerald-200 px-3 py-2 dark:border-emerald-900">
<p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
Frame 4 · Network inputs
</p>
<h3 className="text-xs font-semibold">
Activation {derivation.activation}
</h3>
<p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
Network values are retrieved from the persisted activation.
</p>
</div>
<div className="space-y-3 p-3">
{loading && (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
Loading persisted network values…
</p>
)}
{error.general && (
<p
role="alert"
className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
>
{error.general}
</p>
)}
{networks.length === 0 ? (
<p className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-zinc-500 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-zinc-400">
No network derivations were returned for this activation.
</p>
) : (
networks.map((network) => {
const networkId = network.network;
const networkName = network.name || networkId;
const values = networkValues[networkId];
return (
<section
key={networkId}
className="space-y-3 rounded-lg border border-emerald-200 p-3 dark:border-emerald-900"
>
<div className="flex flex-wrap items-center justify-between gap-2">
<h4 className="text-xs font-semibold">{networkName}</h4>
<span className="rounded-md border border-emerald-200 px-2 py-1 text-[10px] font-medium dark:border-emerald-900">
{network.supported ? "Supported" : "Unsupported"}
</span>
</div>
{network.supported === false ? (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
{network.message ||
"Network derivation is not supported."}
</p>
) : values ? (
<>
<dl className="grid grid-cols-1 gap-3">
<NetworkValueRow
label="Master fingerprint"
value={values.fingerprint}
copyLabel={⁠Copy ${networkName} master fingerprint⁠}
/>
<NetworkValueRow
label="ScriptPubKey"
value={values.scriptpubkey}
copyLabel={⁠Copy ${networkName} scriptPubKey⁠}
/>
<NetworkValueRow
label="Xpub"
value={values.xpub}
copyLabel={⁠Copy ${networkName} xpub⁠}
/>
<NetworkValueRow
label="Zpub"
value={values.zpub}
copyLabel={⁠Copy ${networkName} zpub⁠}
/>
<NetworkValueRow
label="Address"
value={values.address}
copyLabel={⁠Copy ${networkName} address⁠}
/>
</dl>
<div className="space-y-2 border-t border-emerald-200 pt-3 dark:border-emerald-900">
<div className="flex flex-wrap items-center justify-between gap-2">
<p className="text-xs font-semibold">
Private extended key · Xpriv
</p>
<FrameButton
onClick={() => revealPrivateKey(networkId)}
disabled={Boolean(privateKeyLoading[networkId])}
>
{privateKeyLoading[networkId]
? "Loading…"
: privateKeys[networkId]
? "Hide Xpriv"
: "Reveal Xpriv"}
</FrameButton>
</div>
{privateKeyError[networkId] && (
<p role="alert" className="text-xs text-red-600">
{privateKeyError[networkId]}
</p>
)}
{privateKeys[networkId] ? (
<div className="flex items-start gap-2">
<p className="min-w-0 flex-1 break-all rounded-lg bg-amber-100 p-2 font-mono text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
{privateKeys[networkId]}
</p>
<CopyButton
value={privateKeys[networkId]}
label={⁠Copy ${networkName} xpriv⁠}
/>
</div>
) : (
!privateKeyError[networkId] && (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
Retrieved only when explicitly revealed.
</p>
)
)}
</div>
</>
) : error[networkId] ? (
<p role="alert" className="text-xs text-red-600">
{error[networkId]}
</p>
) : (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
{loading
? "Loading network values…"
: "No persisted values were returned."}
</p>
)}
</section>
);
})
)}
</div>
</section>
);
}
// ---------------------------------------------------------------------------
// Operation 3: Activation-Scoped Receive Results
// ---------------------------------------------------------------------------
function ReceiveResults({ result }) {
const [revealReceive, setRevealReceive] = useState(false);
const receive = result?.receive;
const frame = objectAt(receive, ["frame"]);
const transaction = objectAt(frame, ["quantum_transaction"]);
const event = objectAt(frame, ["event"]);
const openedQtm = objectAt(transaction, ["qtm"]);
const heritage = objectAt(event, ["heritage"]);
const depth = objectAt(event, ["depth"]);
const runtime = objectAt(event, ["runtime"]);
const networks = Array.isArray(receive?.networks) ? receive.networks : [];
const identity = {
substrate: receive?.substrate ?? result?.substrate,
post_activation: receive?.post_activation,
ordinal: result?.ordinal,
flow: result?.flow,
networks,
};
const receiveValues = transaction
? {
receive_amount: result?.requested_amount,
ordinal: result?.ordinal,
flow: result?.flow,
constant: valueAt(transaction, ["constant"]),
constant_delta: valueAt(transaction, ["constant_delta"]),
}
: undefined;
return (
<div className="space-y-3">
<section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
<h3 className="text-xs font-semibold">Receive event identity</h3>
<p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
Networks are taken from the observation pipelines associated with the
received post-state activation.
</p>
<div className="mt-3">
<KeyValueList value={identity} />
</div>
</section>
<Frame eyebrow="Frame 1" title="Transaction QTM">
{hasContent(openedQtm) ? (
<KeyValueList value={openedQtm} />
) : (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
Transaction QTM was not returned.
</p>
)}
</Frame>
<Frame
eyebrow="Frame 2"
title="Receive values"
actions={
<FrameButton
onClick={() => setRevealReceive((current) => !current)}
>
{revealReceive ? "Clear" : "Reveal"}
</FrameButton>
}
>
{receiveValues ? (
<Blurred revealed={revealReceive}>
<KeyValueList value={receiveValues} />
</Blurred>
) : (
<p className="text-xs text-zinc-500 dark:text-zinc-400">
The response did not contain the expected transaction.
</p>
)}
</Frame>
<Frame eyebrow="Frame 3" title="Immediate heritage">
<div className="space-y-3">
<KeyValueList
value={{
flow: result?.flow,
scale: valueAt(event, ["scale"]),
runtime_unix_seconds: valueAt(runtime, ["unix_seconds"]),
runtime_subsec_nanos: valueAt(runtime, ["subsec_nanos"]),
}}
/>
{hasContent(heritage) && (
<div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
Heritage
</p>
<KeyValueList value={heritage} />
</div>
)}
{hasContent(depth) && (
<div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
Depth
</p>
<KeyValueList value={depth} />
</div>
)}
</div>
</Frame>
<Frame eyebrow="Frame 4" title="Receive networks">
{networks.length > 0 ? (
<KeyValueList value={networks} />
) : (
<p className="text-xs text-amber-700 dark:text-amber-400">
No running observation pipeline networks were returned for
post-activation {receive?.post_activation ?? "not provided"}.
</p>
)}
</Frame>
<ResultSection title="Complete Receive API response" value={receive} />
</div>
);
}
function EventMapSections({ event, prefix = "" }) {
const depth = objectAt(event, ["depth"]);
const heritage = objectAt(event, ["heritage"]);
const state = objectAt(heritage, ["state"]);
const transition = objectAt(heritage, ["transition"]);
const depthPath = valueAt(depth, ["path"]);
return (
<div className="space-y-3">
{depth && (
<ResultSection
title={⁠${prefix}Final depth⁠}
description={
depthPath === undefined
? "Final depth data returned by the API."
: ⁠Depth path: ${friendlyValue(depthPath)}⁠
}
value={depth}
defaultOpen
/>
)}
{state && (
<ResultSection title={⁠${prefix}Heritage state⁠} value={state} />
)}
{transition && (
<ResultSection
title={⁠${prefix}Transition heritage⁠}
value={transition}
/>
)}
<ResultSection title={⁠${prefix}Event map⁠} value={event} />
</div>
);
}
function TransitResults({ result, network, path, substrate }) {
const frame = objectAt(result, ["frame"]);
const event = eventMapOf(result);
return (
<div className="space-y-3">
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
</div>
);
}
function ExileResults({ result, substrate }) {
const frame = objectAt(result, ["frame"]);
const event = eventMapOf(result);
const depth = objectAt(event, ["depth"]);
const objects = Array.isArray(depth?.objects) ? depth.objects : [];
return (
<div className="space-y-3">
<ResultSection title="Substrate" value={{ substrate }} defaultOpen />
<ResultSection
title="Stored QTM"
value={objectAt(frame, ["qtm", "Qtm"])}
defaultOpen
/>
{depth && (
<section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
<h3 className="text-xs font-semibold">Exile depth record</h3>
<p className="mt-2 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
{depth.path || "Depth path not returned"}
</p>
<p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
{objects.length} retained{" "}
{objects.length === 1 ? "object" : "objects"} returned by the API.
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
</div>
);
}
function ResultCard({ result, tab, network, path, substrate }) {
if (result === null || result === undefined) return null;
return (
<div className="mt-4 space-y-3">
{tab === "receive" && <ReceiveResults result={result} />}
{tab === "transit" && (
<TransitResults
result={result}
network={network}
path={path}
substrate={substrate}
/>
)}
{tab === "exile" && (
<ExileResults result={result} substrate={substrate} />
)}
{tab === "create" && (
<section className="space-y-3">
<ResultHeading eyebrow="Create result" title="Substrate created" />
<ResultSection
title="Created substrate"
value={result}
defaultOpen
/>
</section>
)}
</div>
);
}
function readQuerySubstrate() {
if (typeof window === "undefined") return "";
try {
return (new URLSearchParams(window.location.search).get("substrate") || "").trim();
} catch {
return "";
}
}
export default function Home() {
const initialCachedSubstrates = Array.isArray(qtmSessionCache.substrates)
? qtmSessionCache.substrates
: [];
const initialCachedNetworks = Array.isArray(qtmSessionCache.networks)
? qtmSessionCache.networks
: [];
const [tab, setTab] = useState("create");
const [substrates, setSubstrates] = useState(initialCachedSubstrates);
const [selectedSubstrate, setSelectedSubstrate] = useState(() => {
const querySub = readQuerySubstrate();
if (
querySub &&
(!qtmSessionCache.substrates ||
qtmSessionCache.substrates.some((item) => item.name === querySub))
) {
return querySub;
}
if (qtmSessionCache.selectedSubstrate) {
return qtmSessionCache.selectedSubstrate;
}
return initialCachedSubstrates[0]?.name || "";
});
const [listLoading, setListLoading] = useState(
!qtmSessionCache.initialized && initialCachedSubstrates.length === 0
);
const [listError, setListError] = useState("");
const [networks, setNetworks] = useState(initialCachedNetworks);
const [selectedNetwork, setSelectedNetwork] = useState(() => {
if (
qtmSessionCache.selectedNetwork &&
(!qtmSessionCache.networks ||
qtmSessionCache.networks.some(
(net) => net.id === qtmSessionCache.selectedNetwork
))
) {
return qtmSessionCache.selectedNetwork;
}
return initialCachedNetworks[0]?.id || "";
});
const [networkLoading, setNetworkLoading] = useState(
!qtmSessionCache.initialized && initialCachedNetworks.length === 0
);
const [networkError, setNetworkError] = useState("");
const [name, setName] = useState("");
const [seedSource, setSeedSource] = useState("persistent");
const [indices, setIndices] = useState("0,0,0,0,0,0,0,0,0,0,0,0");
const [entropy, setEntropy] = useState("");
const [phrase, setPhrase] = useState("");
const [language, setLanguage] = useState("");
const [passphrase, setPassphrase] = useState("");
const [path, setPath] = useState(() => initialCachedNetworks[0]?.path || "");
const [purpose, setPurpose] = useState(() =>
Number.isFinite(initialCachedNetworks[0]?.purpose)
? String(initialCachedNetworks[0].purpose)
: "44"
);
const [coin, setCoin] = useState(() =>
Number.isFinite(initialCachedNetworks[0]?.coin)
? String(initialCachedNetworks[0].coin)
: "0"
);
const [account, setAccount] = useState("0");
const [change, setChange] = useState("0");
const [external, setExternal] = useState("0");
const [activation, setActivation] = useState("1");
// Activation-scoped Receive state
const [receiveAmount, setReceiveAmount] = useState("1");
const [receiveOrdinal, setReceiveOrdinal] = useState("1");
const [receiveFlow, setReceiveFlow] = useState("receive");
// Receive persistence state (amount-range transit events)
const [receiveEvents, setReceiveEvents] = useState([]);
const [receiveEventsLoading, setReceiveEventsLoading] = useState(false);
const [receiveEventsError, setReceiveEventsError] = useState("");
const receiveEventsRequestRef = useRef(0);
const [exileRecords, setExileRecords] = useState([]);
const [exileRecordsLoading, setExileRecordsLoading] = useState(false);
const [exileRecordsError, setExileRecordsError] = useState("");
const [result, setResult] = useState(null);
const [error, setError] = useState("");
const [loading, setLoading] = useState(false);
const [runtimeMode, setRuntimeMode] = useState("detecting…");
useEffect(() => {
setRuntimeMode(
nativeInvoke()
? "local QP runtime (native)"
: API_BASE
? ⁠API ${API_BASE}⁠
: "not available in this browser"
);
}, []);
const requestedSubstrateRef = useRef(null);
const listRequestRef = useRef(0);
const exileRequestRef = useRef(0);
const selectedRef = useRef(selectedSubstrate);
const [selectionReady, setSelectionReady] = useState(
Boolean(qtmSessionCache.initialized || selectedSubstrate)
);
useEffect(() => {
selectedRef.current = selectedSubstrate;
qtmSessionCache.selectedSubstrate = selectedSubstrate;
}, [selectedSubstrate]);
useEffect(() => {
qtmSessionCache.selectedNetwork = selectedNetwork;
}, [selectedNetwork]);
useEffect(() => {
if (!selectionReady) return;
const url = new URL(window.location.href);
if (selectedSubstrate) {
url.searchParams.set("substrate", selectedSubstrate);
} else {
url.searchParams.delete("substrate");
}
window.history.replaceState(
{},
"",
⁠${url.pathname}${url.search}${url.hash}⁠
);
}, [selectedSubstrate, selectionReady]);
// Loads substrates; if ⁠forceRefresh⁠ is false and cached data exists, reuses cache.
const loadSubstrates = useCallback(
async (preferred = "", { forceRefresh = false } = {}) => {
if (!forceRefresh && Array.isArray(qtmSessionCache.substrates)) {
const cachedValid = qtmSessionCache.substrates;
setSubstrates(cachedValid);
setListError("");
setListLoading(false);
setSelectedSubstrate((current) => {
const querySub = readQuerySubstrate();
const wanted = [preferred, current, querySub, qtmSessionCache.selectedSubstrate].find(
(candidate) =>
candidate && cachedValid.some((item) => item.name === candidate)
);
const resolved = wanted || cachedValid[0]?.name || "";
qtmSessionCache.selectedSubstrate = resolved;
return resolved;
});
qtmSessionCache.initialized = true;
setSelectionReady(true);
return;
}
if (inflightSubstratesPromise && !forceRefresh) {
return inflightSubstratesPromise;
}
const requestId = ++listRequestRef.current;
if (requestedSubstrateRef.current === null) {
requestedSubstrateRef.current = readQuerySubstrate();
}
setListLoading(true);
setListError("");
const task = (async () => {
try {
const data = await callRuntime("listSubstrates");
if (!Array.isArray(data.substrates)) {
throw new Error(
"The API response did not contain a substrates list."
);
}
if (requestId !== listRequestRef.current) return;
const valid = data.substrates.filter(
(item) => item && typeof item.name === "string"
);
const requested = requestedSubstrateRef.current;
requestedSubstrateRef.current = "";
qtmSessionCache.substrates = valid;
qtmSessionCache.initialized = true;
setSubstrates(valid);
setSelectedSubstrate((current) => {
const wanted = [preferred, current, requested, qtmSessionCache.selectedSubstrate].find(
(candidate) =>
candidate && valid.some((item) => item.name === candidate)
);
const resolved = wanted || valid[0]?.name || "";
qtmSessionCache.selectedSubstrate = resolved;
return resolved;
});
setSelectionReady(true);
} catch (err) {
if (requestId !== listRequestRef.current) return;
setListError(
err instanceof Error ? err.message : "Unable to load substrates."
);
} finally {
if (requestId === listRequestRef.current) {
setListLoading(false);
}
}
})();
inflightSubstratesPromise = task;
try {
await task;
} finally {
if (inflightSubstratesPromise === task) {
inflightSubstratesPromise = null;
}
}
},
[]
);
// Loads networks; reuses cached networks unless explicitly forced.
const loadNetworks = useCallback(async ({ forceRefresh = false } = {}) => {
if (!forceRefresh && Array.isArray(qtmSessionCache.networks)) {
const cachedValid = qtmSessionCache.networks;
setNetworks(cachedValid);
setNetworkError("");
setNetworkLoading(false);
setSelectedNetwork((current) => {
const resolved =
(current && cachedValid.some((network) => network.id === current)
? current
: null) ||
(qtmSessionCache.selectedNetwork &&
cachedValid.some((network) => network.id === qtmSessionCache.selectedNetwork)
? qtmSessionCache.selectedNetwork
: null) ||
cachedValid[0]?.id ||
"";
qtmSessionCache.selectedNetwork = resolved;
return resolved;
});
qtmSessionCache.initialized = true;
return;
}
if (inflightNetworksPromise && !forceRefresh) {
return inflightNetworksPromise;
}
setNetworkLoading(true);
setNetworkError("");
const task = (async () => {
try {
const data = await callRuntime("listNetworks");
if (!Array.isArray(data.networks)) {
throw new Error(
"The API response did not contain a networks list."
);
}
const valid = data.networks.filter(
(network) =>
network &&
typeof network.id === "string" &&
typeof network.name === "string"
);
qtmSessionCache.networks = valid;
qtmSessionCache.initialized = true;
setNetworks(valid);
setSelectedNetwork((current) => {
const resolved =
(current && valid.some((network) => network.id === current)
? current
: null) ||
(qtmSessionCache.selectedNetwork &&
valid.some((network) => network.id === qtmSessionCache.selectedNetwork)
? qtmSessionCache.selectedNetwork
: null) ||
valid[0]?.id ||
"";
qtmSessionCache.selectedNetwork = resolved;
return resolved;
});
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
if (first.path) {
setPath((current) => current || first.path);
}
}
} catch (err) {
setNetworkError(
err instanceof Error ? err.message : "Unable to load networks."
);
} finally {
setNetworkLoading(false);
}
})();
inflightNetworksPromise = task;
try {
await task;
} finally {
if (inflightNetworksPromise === task) {
inflightNetworksPromise = null;
}
}
}, []);
const loadExileRecords = useCallback(async () => {
const substrate = selectedSubstrate;
const requestId = ++exileRequestRef.current;
const isCurrent = () =>
requestId === exileRequestRef.current &&
selectedRef.current === substrate;
if (!substrate) {
setExileRecords([]);
setExileRecordsLoading(false);
setExileRecordsError(
"Select a substrate before loading its persisted events."
);
return;
}
setExileRecordsLoading(true);
setExileRecordsError("");
try {
const data = await callRuntime("listEvents", { name: substrate });
if (!isCurrent()) return;
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
} catch (err) {
if (!isCurrent()) return;
setExileRecords([]);
setExileRecordsError(
err instanceof Error
? err.message
: "Unable to load persisted event records."
);
} finally {
if (requestId === exileRequestRef.current) {
setExileRecordsLoading(false);
}
}
}, [selectedSubstrate]);
// Receive persistence loader — uses existing listEvents / GET /wallets/:name/events.
// Only kind === "transit" events whose activation falls inside 1..amount are kept.
const loadReceiveEvents = useCallback(async () => {
const substrate = selectedSubstrate;
const amount = Number(receiveAmount);
const requestId = ++receiveEventsRequestRef.current;
const isCurrent = () =>
requestId === receiveEventsRequestRef.current &&
selectedRef.current === substrate;
if (!substrate || !Number.isSafeInteger(amount) || amount <= 0) {
setReceiveEvents([]);
setReceiveEventsLoading(false);
setReceiveEventsError("");
return;
}
setReceiveEventsLoading(true);
setReceiveEventsError("");
try {
const data = await callRuntime("listEvents", {
name: substrate,
});
if (!isCurrent()) return;
const records = eventRecordsOf(data);
const recognizedList =
Array.isArray(data.events) ||
Array.isArray(data.records) ||
Array.isArray(data.event_records) ||
Array.isArray(data.eventRecords) ||
Array.isArray(data.items) ||
Array.isArray(data.data?.events) ||
Array.isArray(data.data?.records);
if (!records.length && !recognizedList) {
throw new Error(
"The events endpoint did not return a persisted event list."
);
}
setReceiveEvents(
records.filter((record) => {
const activation = Number(record.activation);
return (
record.kind === "transit" &&
Number.isSafeInteger(activation) &&
activation >= 1 &&
activation <= amount
);
})
);
} catch (err) {
if (!isCurrent()) return;
setReceiveEvents([]);
setReceiveEventsError(
err instanceof Error
? err.message
: "Unable to load persisted receive events."
);
} finally {
if (requestId === receiveEventsRequestRef.current) {
setReceiveEventsLoading(false);
}
}
}, [selectedSubstrate, receiveAmount]);
// Initial session hydration: runs only when module cache is not yet populated.
// Returning from Event Store reuses cached substrates & networks without re-fetching.
useEffect(() => {
if (!qtmSessionCache.initialized || qtmSessionCache.substrates === null) {
void loadSubstrates("", { forceRefresh: false });
}
if (!qtmSessionCache.initialized || qtmSessionCache.networks === null) {
void loadNetworks({ forceRefresh: false });
}
}, [loadSubstrates, loadNetworks]);
useEffect(() => {
if (tab === "exile" && selectedSubstrate) {
loadExileRecords();
}
}, [tab, selectedSubstrate, loadExileRecords]);
// Load (or clear) the amount-range transit events for the Receive tab.
useEffect(() => {
if (tab === "receive" && selectedSubstrate) {
loadReceiveEvents();
} else {
receiveEventsRequestRef.current += 1;
setReceiveEventsLoading(false);
}
}, [tab, selectedSubstrate, receiveAmount, loadReceiveEvents]);
const currentNetwork = useMemo(
() => networks.find((network) => network.id === selectedNetwork) ?? null,
[networks, selectedNetwork]
);
function handleSubstrateChange(value) {
selectedRef.current = value;
qtmSessionCache.selectedSubstrate = value;
exileRequestRef.current += 1;
receiveEventsRequestRef.current += 1;
setExileRecordsLoading(false);
setReceiveEventsLoading(false);
setSelectedSubstrate(value);
setResult(null);
setError("");
setExileRecords([]);
setExileRecordsError("");
setReceiveEvents([]);
setReceiveEventsError("");
}
function handleNetworkChange(id) {
const network = networks.find((item) => item.id === id);
qtmSessionCache.selectedNetwork = id;
setSelectedNetwork(id);
setReceiveOrdinal("1");
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
function handleReceiveAmountChange(value) {
setReceiveAmount(value);
setResult(null);
setError("");
const amount = Number(value);
const ordinal = Number(receiveOrdinal);
if (!Number.isSafeInteger(amount) || amount < 1) {
setReceiveOrdinal("1");
} else if (ordinal > amount) {
setReceiveOrdinal(String(amount));
}
}
// -------------------------------------------------------------------------
// 3. Activation-Scoped Receive Handler (POST /wallets/:name/receive)
// -------------------------------------------------------------------------
async function handleReceiveExecution() {
const amount = Number(receiveAmount);
if (!Number.isSafeInteger(amount) || amount <= 0) {
throw new Error("Receive amount must be a positive safe integer.");
}
if (!["receive", "change"].includes(receiveFlow)) {
throw new Error("Select a valid receive flow.");
}
const ordinal = Number(receiveOrdinal);
if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > amount) {
throw new Error("Select a valid ordinal within the receive amount.");
}
const receive = await callRuntime("receive", {
name: selectedSubstrate,
request: {
amount,
flow: receiveFlow,
ordinal,
},
});
const frame = objectAt(receive, ["frame"]);
const transaction = objectAt(frame, ["quantum_transaction"]);
const event = objectAt(frame, ["event"]);
const heritage = objectAt(event, ["heritage"]);
if (!transaction || !event || !heritage) {
throw new Error(
"Receive succeeded but did not return the expected transaction and event heritage."
);
}
setResult({
receive,
requested_amount: amount,
ordinal,
flow: receiveFlow,
substrate: selectedSubstrate,
});
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
if (tab === "create") {
const substrateName = name.trim();
if (!substrateName) {
throw new Error("Enter a substrate name.");
}
if (!/^[A-Za-z0-9_-]{1,64}$/.test(substrateName)) {
throw new Error(
"Substrate name must be 1-64 ASCII letters, digits, hyphens, or underscores."
);
}
let payload;
if (seedSource === "bip39") {
const mnemonic = phrase.trim();
if (!mnemonic) {
throw new Error("Enter a BIP39 mnemonic phrase.");
}
if (!language) {
throw new Error("Select a BIP39 language.");
}
payload = {
name: substrateName,
seed_source: "bip39",
phrase: mnemonic,
language,
passphrase,
};
} else if (seedSource === "persistent") {
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
} else {
throw new Error("Select a valid substrate seed source.");
}
if (!nativeInvoke()) {
const confirmed = window.confirm(
⁠You are creating "${substrateName}" in browser mode.\n\n⁠ +
"The seed material will be sent to the configured QTM API:\n" +
⁠${API_BASE}\n\n⁠ +
"Continue only if you trust this server."
);
if (!confirmed) {
return;
}
}
const data = await callRuntime("createSubstrate", {
request: payload,
});
setResult(data);
setName("");
setEntropy("");
setPhrase("");
setPassphrase("");
void loadSubstrates(substrateName, { forceRefresh: true });
return;
}
if (tab === "receive") {
await handleReceiveExecution();
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
throw new Error(⁠${key} must be a non-negative safe integer.⁠);
}
}
const data = await callRuntime("transit", {
name: selectedSubstrate,
request: {
network: selectedNetwork,
path: path.trim() || undefined,
...numeric,
},
});
setResult(data);
return;
}
if (tab === "exile") {
const data = await callRuntime("exile", {
name: selectedSubstrate,
});
setResult(data);
await loadExileRecords();
}
} catch (err) {
setError(err instanceof Error ? err.message : "Something went wrong.");
} finally {
setLoading(false);
}
}
const substrateRequired = tab !== "create";
const linkWithSubstrate = (href) => {
if (!selectedSubstrate) return href;
const separator = href.includes("?") ? "&" : "?";
return ⁠${href}${separator}substrate=${encodeURIComponent( selectedSubstrate )}⁠;
};
return (
<div
style={{
fontFamily:
'-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif',
}}
className="min-h-screen w-full bg-zinc-50 px-1.5 py-2 text-[13px] text-zinc-900 sm:px-2 sm:py-3 dark:bg-zinc-950 dark:text-zinc-100"
>
<style jsx global>{`
html {
font-size: 14px;
}
* {
min-width: 0;
}
body {
margin: 0;
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text",
"Helvetica Neue", Arial, sans-serif;
}
a,
button,
input,
select,
textarea {
font: inherit;
}
`}</style>
<main className="mx-auto w-full max-w-none">
<header className="mb-3">
<p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
QuantPerm · QTM
</p>
<h1 className="mt-1.5 text-lg font-semibold tracking-tight text-zinc-950 sm:text-xl dark:text-zinc-50">
QTM substrate console
</h1>
<p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
Create and inspect persistent substrates, recover persisted
ordinals, derive submission keys, and execute receive, transit, or
exile operations.
</p>
</header>
<section className="mb-3 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm sm:p-3 dark:border-zinc-800 dark:bg-zinc-900">
<div className="mb-2 flex items-center justify-between gap-3">
<label htmlFor="substrate" className="text-xs font-semibold">
Active substrate
</label>
<button
type="button"
onClick={() => loadSubstrates("", { forceRefresh: true })}
disabled={listLoading}
className="rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
>
{listLoading ? "Refreshing…" : "Refresh"}
</button>
</div>
<select
id="substrate"
value={selectedSubstrate}
onChange={(event) => handleSubstrateChange(event.target.value)}
disabled={listLoading || loading || !substrates.length}
className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-800"
>
{!substrates.length && (
<option value="">
{listLoading
? "Loading substrates…"
: "No substrates available"}
</option>
)}
{substrates.map((substrate) => (
<option key={substrate.name} value={substrate.name}>
{substrate.name} — dimension{" "}
{substrate.dimension ?? "not returned"} · activations{" "}
{substrate.activations ?? "not returned"}
</option>
))}
</select>
{selectedSubstrate && (
<div className="mt-3 space-y-2">
<div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
State context
</p>
<p className="mt-1 break-all font-mono text-xs font-semibold">
{selectedSubstrate}
</p>
<p className="mt-1 text-xs leading-4 text-zinc-500 dark:text-zinc-400">
Open, Receive, Transit, and Exile operate against this
substrate independently. Derivation is available inside
Receive and runs as a separate operation.
</p>
</div>
<ResultSection
title="Selected substrate details"
description="Fields returned by the API for this substrate."
value={
substrates.find(
(item) => item.name === selectedSubstrate
) ?? {}
}
/>
</div>
)}
{listError && (
<p
role="status"
className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
>
Substrate list unavailable: {listError} You can still create a
substrate in the Create tab.
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
className="block rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
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
<span className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-medium dark:border-zinc-700">
Open
</span>
</div>
</a>
<a
href={linkWithSubstrate("/network")}
className="block rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
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
<span className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-medium dark:border-zinc-700">
Open
</span>
</div>
</a>
</section>
<nav
aria-label="Substrate operations"
className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-zinc-100/80 p-1 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
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
className={⁠rounded-lg px-1.5 py-2 text-xs font-medium transition-colors sm:px-2 ${ tab === item.id ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100" }⁠}
>
{item.label}
</button>
))}
</nav>
<section className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:p-3.5 dark:border-zinc-800 dark:bg-zinc-900">
<div className="mb-4">
<h2 className="text-sm font-semibold">
{TABS.find((item) => item.id === tab)?.label}
</h2>
<p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
{tab === "create" &&
"Initialize a persistent substrate using PERM indices or a BIP39 mnemonic."}
{tab === "receive" &&
"Derive all available network keys for a persisted submission, then execute Receive or Change at a chosen ordinal. Derivation and Receive are separate operations."}
{tab === "transit" &&
"Apply a network derivation request in the selected substrate's state context."}
{tab === "exile" &&
"Request exile for the selected substrate. The API decides eligibility from its persisted event history."}
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
className={⁠rounded-lg border px-3 py-3 text-left transition-colors ${ seedSource === source ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-800/70" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50" }⁠}
>
<span className="block text-xs font-semibold">
{source === "bip39"
? "BIP39 mnemonic"
: "Persistent indices"}
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
<div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
<label className="flex flex-col gap-1">
<span className="text-xs font-medium">
BIP39 language
</span>
<select
value={language}
onChange={(event) => setLanguage(event.target.value)}
required
className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
>
<option value="">Select language</option>
<option value="english">English</option>
<option value="chinese_simplified">
Chinese (Simplified)
</option>
<option value="chinese_traditional">
Chinese (Traditional)
</option>
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
<span className="text-xs font-medium">
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
placeholder="Enter words in the selected language"
className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
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
The phrase and passphrase are sent to the API for
validation and derivation.
</p>
</div>
)}
</>
)}
{tab === "receive" && (
<div className="space-y-3">
<section className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
<div>
<h3 className="text-xs font-semibold">
Receive submission
</h3>
<p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
Execute the selected persisted submission. Receive derives
the available networks from the received event and
retrieves their persisted input and key values
automatically.
</p>
</div>
<div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
<p className="text-xs font-medium">Selected substrate</p>
<p className="mt-1 break-all font-mono text-xs">
{selectedSubstrate || "No substrate selected"}
</p>
</div>
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
<NumberField
label="Transaction amount (N)"
value={receiveAmount}
onChange={handleReceiveAmountChange}
min={1}
/>
<label className="flex flex-col gap-1">
<span className="text-xs font-medium">
Receive flow
</span>
<select
value={receiveFlow}
onChange={(event) => setReceiveFlow(event.target.value)}
className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
>
<option value="receive">Receive</option>
<option value="change">Change</option>
</select>
</label>
</div>
{Number.isSafeInteger(Number(receiveAmount)) &&
Number(receiveAmount) > 0 && (
<ReceiveOrdinalSelector
amount={receiveAmount}
ordinal={receiveOrdinal}
persistedOrdinals={receiveEvents.map((record) =>
Number(record.activation)
)}
persistedLoading={receiveEventsLoading}
persistedError={receiveEventsError}
onChange={(n) => {
setReceiveOrdinal(String(n));
setResult(null);
setError("");
}}
/>
)}
</section>
</div>
)}
{tab === "transit" && (
<>
<div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
Transition state context
</p>
<p className="mt-1 break-all font-mono text-xs font-semibold">
{selectedSubstrate || "Select a substrate"}
</p>
<p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
Transit is sent to this substrate's API route. Network and
path specify derivation; they are not a separate state host.
</p>
</div>
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
<label className="flex min-w-0 flex-col gap-1">
<span className="text-xs font-medium">Network</span>
<select
value={selectedNetwork}
onChange={(event) =>
handleNetworkChange(event.target.value)
}
disabled={networkLoading || !networks.length}
className="h-9 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
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
<p
role="alert"
className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
>
Networks could not be loaded: {networkError}{" "}
<button
type="button"
onClick={() => loadNetworks({ forceRefresh: true })}
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
<section className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
<div>
<h3 className="text-xs font-semibold">
Persisted event history
</h3>
<p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
{selectedSubstrate || "No substrate selected"}
</p>
<p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
Exile reads the selected substrate's persisted event
history. The Rust API decides eligibility and derives the
exile depth; the browser neither gates the request nor
submits an in-memory depth snapshot.
</p>
</div>
<div className="flex flex-wrap items-center justify-between gap-2">
<span className="text-xs text-zinc-600 dark:text-zinc-300">
{exileRecordsLoading
? "Loading persisted events…"
: ⁠${exileRecords.length} persisted record(s)⁠}
</span>
<button
type="button"
onClick={loadExileRecords}
disabled={
exileRecordsLoading || !selectedSubstrate || loading
}
className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
>
{exileRecordsLoading ? "Refreshing…" : "Refresh events"}
</button>
</div>
{exileRecordsError && (
<p
role="status"
className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
>
{exileRecordsError}
</p>
)}
<div className="space-y-2">
<p className="text-xs font-medium">Persisted event records</p>
{!exileRecords.length ? (
<p className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
No event records were returned. Record a transit event,
then refresh this list.
</p>
) : (
exileRecords.map((record, index) => {
return (
<div
key={⁠${recordNameOf(record) || "record"}-${index}⁠}
className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
>
<div className="flex flex-wrap items-center justify-between gap-2">
<p className="break-all font-mono text-xs font-medium">
{recordNameOf(record) ||
⁠Persisted record ${index + 1}⁠}
</p>
<span className="rounded-lg border border-zinc-200 px-2 py-1 text-[10px] font-medium dark:border-zinc-700">
{formatKey(
valueAt(record, ["kind", "type"]) ?? "record"
)}
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
(substrateRequired && (listLoading || !selectedSubstrate)) ||
(tab === "transit" && (networkLoading || !selectedNetwork))
}
className="mt-1 inline-flex min-h-10 items-center justify-center rounded-lg bg-zinc-950 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
>
{loading
? "Processing…"
: tab === "open"
? "Recover Persisted Ordinal"
: tab === "receive"
? "Execute Receive"
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
className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
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
QTM substrate console · Active substrate:{" "}
{selectedSubstrate || "none"} · Runtime: {runtimeMode}
</footer>
</main>
</div>
);
}