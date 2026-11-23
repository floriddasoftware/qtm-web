"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
// Same API origin configuration as the main page (src/app/page.js).
const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api.onrender.com"
).replace(/\/+$/, "");
const COIN_TYPES = [
{ key: "bitcoin", name: "Bitcoin", symbol: "BTC", type: 0, path: "m/44'/0'/0'/0/0" },
{ key: "ethereum", name: "Ethereum", symbol: "ETH", type: 60, path: "m/44'/60'/0'/0/0" },
{ key: "solana", name: "Solana", symbol: "SOL", type: 501, path: "m/44'/501'/0'/0'" },
{ key: "tron", name: "Tron", symbol: "TRX", type: 195, path: "m/44'/195'/0'/0/0" },
];
const BITCOIN_KINDS = {
legacy: { label: "Legacy · P2PKH", note: "BIP44 · m/44'/0'/0'/0/0" },
segwit: { label: "SegWit · P2WPKH", note: "BIP84 · m/84'/0'/0'/0/0" },
other: { label: "Bitcoin", note: "" },
};
const INPUT =
  "h-10 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-500 focus:ring-4 focus:ring-zinc-500/10 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950";
const BUTTON =
  "inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
const OUTER =
  "qtm-pop min-w-0 self-start rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
const INNER =
  "qtm-pop min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/60";

const QTM_STYLES = `
@keyframes qtm-pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.qtm-pop {
  animation: qtm-pop 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@keyframes qtm-backdrop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes qtm-dialog-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.qtm-backdrop {
  animation: qtm-backdrop-in 0.2s ease-out both;
}

.qtm-dialog {
  animation: qtm-dialog-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .qtm-pop,
  .qtm-backdrop,
  .qtm-dialog {
    animation: none;
  }
}
`;

const WIREPACKETS_POLL_MS = 2000;

async function apiRequest(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;

    throw new Error(
      `Could not reach the QTM API at ${API_BASE}: ${
        cause instanceof Error ? cause.message : "network error"
      }`,
    );
  }

  const raw = await response.text();

  let body = {};

    let body = {};

  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { response_text: raw };
    }
  }

  if (!response.ok) {
    throw new Error(
      body?.error ||
        body?.message ||
        body?.detail ||
        body?.response_text ||
        `Request failed with HTTP ${response.status}`,
    );
  }

  return body;
}
function enc(value) {
return encodeURIComponent(String(value));
}
/* ───────────── Canonical ActiveClip model (mirrors bit_miner::ActiveClip) ───────────── */
function parseActivationNumber(value) {
if (typeof value === "number") {
return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
if (typeof value === "bigint") {
return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
? Number(value)
: null;
}
if (typeof value === "string") {
const trimmed = value.trim();
if (!/^\d+$/.test(trimmed)) return null;
const parsed = Number(trimmed);
return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
return null;
}
function createActiveClip(input) {
if (!input || typeof input !== "object" || Array.isArray(input)) return null;
const substrate =
typeof input.substrate === "string" ? input.substrate.trim() : "";
const activation = parseActivationNumber(input.activation);
if (!substrate || activation === null) return null;
return Object.freeze({
substrate,
activation,
});
}
function activeClipKey(clip) {
  return clip ? `${clip.substrate}:${clip.activation}` : "";
}
function sameActiveClip(a, b) {
if (!a || !b) return false;
return a.substrate === b.substrate && a.activation === b.activation;
}
/* ───────────── Runtime call (mirrors callRuntime in src/app/page.js) ───────────── */
function nativeInvoke() {
if (typeof window === "undefined") return null;
return (
window.TAURI?.core?.invoke ??
window.TAURI_INTERNALS?.invoke ??
null
);
}
const NATIVE_COMMANDS = {
resolveClipEvent: "qtm_clip_event",
};
const API_ROUTES = {
resolveClipEvent: ({ clip }) => [
  "GET",
  `/wallets/${enc(clip.substrate)}/activations/${enc(clip.activation)}/event`,
],
};
async function callRuntime(operation, args = {}) {
  const invoke = nativeInvoke();

  if (invoke) {
    try {
      return await invoke(NATIVE_COMMANDS[operation], args);
    } catch (cause) {
      throw new Error(
        typeof cause === "string" && cause.trim()
          ? cause.trim()
          : cause instanceof Error && cause.message
            ? cause.message
            : "The QP runtime reported an error.",
      );
    }
  }

  const route = API_ROUTES[operation];

  if (typeof route !== "function") {
    throw new Error(
      `Unsupported QP runtime operation: ${String(operation)}.`,
    );
  }

  const [method, path] = route(args || {});

  return apiRequest(path, { method });
}
/* ───────────── Event Heritage & Direct Clip Event Resolution ───────────── */
function heritageStateOf(event) {
if (!event || typeof event !== "object") return null;
const state = event?.heritage?.state;
return state && typeof state === "object" && !Array.isArray(state)
? state
: null;
}
function activationFromHeritageState(heritageState) {
if (!heritageState || typeof heritageState !== "object") return null;
const raw =
typeof heritageState.activations === "function"
? heritageState.activations()
: heritageState.activations ??
heritageState.activation_count ??
heritageState.activation;
return parseActivationNumber(raw);
}
function activationFromHeritage(event) {
if (!event || typeof event !== "object") return null;
const fromState = activationFromHeritageState(heritageStateOf(event));
if (fromState !== null) return fromState;
return parseActivationNumber(event?.activation);
}
function recordOf(row) {
for (const key of ["record", "record_name", "filename", "id"]) {
const value = row?.[key];
if (typeof value === "string" && value.trim()) return value.trim();
}
return "";
}
function compareEventRows(a, b) {
const aa = activationFromHeritage(a);
const bb = activationFromHeritage(b);
if (aa !== bb) {
if (aa === null) return 1;
if (bb === null) return -1;
if (aa !== bb) return aa < bb ? -1 : 1;
}
const ra = recordOf(a);
const rb = recordOf(b);
return ra < rb ? -1 : ra > rb ? 1 : 0;
}
function extractClipEventCandidates(response, clip) {
if (!response || typeof response !== "object") return [];
const rawList = Array.isArray(response)
? response
: Array.isArray(response?.events)
? response.events
: response?.event && typeof response.event === "object"
? [response.event]
: !Array.isArray(response) &&
(response.heritage || response.record || response.record_name || response.id || response.activation != null)
? [response]
: [];
const rows = [];
for (const row of rawList) {
if (!row || typeof row !== "object" || Array.isArray(row)) continue;
const rowActivation = activationFromHeritage(row);
if (rowActivation !== clip.activation) continue;
const heritageState = heritageStateOf(row);
if (
heritageState &&
typeof heritageState.substrate === "string" &&
heritageState.substrate.trim() &&
heritageState.substrate.trim() !== clip.substrate
) {
continue;
}
const record = recordOf(row);
rows.push({
...row,
...(record ? { record } : {}),
activation: rowActivation,
});
}
return rows.sort(compareEventRows);
}
function resolveAuthoritativeEvent(rows, clip) {
if (!Array.isArray(rows) || rows.length === 0 || !clip) return null;
const withHeritage = rows.filter(
(row) =>
heritageStateOf(row) !== null &&
activationFromHeritageState(heritageStateOf(row)) === clip.activation,
);
const candidates = withHeritage.length > 0 ? withHeritage : rows;
const withRecord = candidates.filter((row) => Boolean(recordOf(row)));
const ordered = withRecord.length > 0 ? withRecord : candidates;
return ordered[ordered.length - 1] || null;
}
async function resolveEventForClip(clip, signal) {
let response;
try {
response = await callRuntime("resolveClipEvent", { clip });
} catch (err) {
if (err?.name === "AbortError") throw err;
const fallback = await apiRequest(
⁠/wallets/${enc(clip.substrate)}/events?activation=${enc(clip.activation)}⁠,
{ signal },
);
response = fallback;
}
const rows = extractClipEventCandidates(response, clip);
const authoritativeEvent = resolveAuthoritativeEvent(rows, clip);
const directory =
response &&
!Array.isArray(response) &&
typeof response?.directory === "string"
? response.directory
: "";
return {
rows,
authoritativeEvent,
directory,
};
}
function normalizeNetworkId(value) {
if (typeof value !== "string" && typeof value !== "number") return "";
return String(value).trim();
}
function observationMatches(status, networkId, activationValue) {
if (!status || typeof status !== "object") return false;
if (status.network != null && normalizeNetworkId(status.network) !== networkId) return false;
if (status.activation != null && String(status.activation) !== String(activationValue)) return false;
return true;
}
function normalizeDerivedNetwork(entry) {
if (typeof entry === "string" || typeof entry === "number") {
const id = normalizeNetworkId(entry);
if (!id) return null;
const lower = id.toLowerCase();
const isBtc = lower.includes("btc") || lower.includes("bitcoin");
const isSegwit = /segwit|bech32|p2wpkh|84/.test(lower);
const isLegacy = /legacy|p2pkh|44/.test(lower);
return {
id,
name: id,
coin: isBtc ? "bitcoin" : undefined,
purpose: isBtc ? (isSegwit ? "84" : isLegacy ? "44" : undefined) : undefined,
path: isBtc
? isSegwit
? "m/84'/0'/0'/0/0"
: isLegacy
? "m/44'/0'/0'/0/0"
: undefined
: undefined,
registered: true,
};
}
const id = normalizeNetworkId(entry?.id ?? entry?.network_id ?? entry?.network);
if (!id) return null;
return {
id,
name: entry.name || id,
coin: entry.coin,
purpose: entry.purpose,
path: entry.path,
registered: entry.registered ?? true,
};
}
async function fetchDerivedNetworksFromHeritage(clip, heritageState, signal) {
const authoritativeActivation = activationFromHeritageState(heritageState);
if (authoritativeActivation === null || authoritativeActivation !== clip.activation) {
throw new Error(
⁠Event heritage activation (${String(authoritativeActivation)}) does not match ActiveClip activation (${clip.activation}).⁠,
);
}
const body = await apiRequest(
⁠/wallets/${enc(clip.substrate)}/activations/${enc(authoritativeActivation)}/networks⁠,
{ signal },
);
if (body?.activation != null && String(body.activation) !== String(authoritativeActivation)) {
throw new Error(
⁠Derived networks activation mismatch (expected ${authoritativeActivation}, got ${body.activation}).⁠,
);
}
const rawList = Array.isArray(body)
? body
: Array.isArray(body?.networks)
? body.networks
: [];
const unique = new Map();
for (const item of rawList) {
if (item && typeof item === "object" && item.registered === false) continue;
const normalized = normalizeDerivedNetwork(item);
if (normalized && !unique.has(normalized.id)) {
unique.set(normalized.id, normalized);
}
}
return {
event: body?.event && typeof body.event === "object" ? body.event : null,
networks: [...unique.values()],
};
}
function normalizePayload(entry, fallbackRecord) {
const network = normalizeDerivedNetwork(entry?.network);
const path = entry?.path ?? entry?.payload_path;
const depth = entry?.depth_identifier ?? entry?.depthIdentifier ?? entry?.depth_id;
if (!network || typeof path !== "string" || depth == null) return null;
const record = String(entry?.record ?? fallbackRecord);
const rawDirection = String(entry?.direction || "").toLowerCase();
const direction =
rawDirection === "transit_inputs" || rawDirection === "transit"
? "transit_inputs"
: rawDirection === "exile_outputs" || rawDirection === "exile"
? "exile_outputs"
: record.startsWith("event_")
? "transit_inputs"
: record.startsWith("exile_")
? "exile_outputs"
: "unclassified";
const objects = Array.isArray(entry?.objects) ? entry.objects : [];
return {
...entry,
record,
network,
path,
depth_identifier: String(depth),
direction,
objects,
};
}
function payloadRowKey(payload) {
return JSON.stringify([
payload.record,
payload.network.id,
payload.path,
payload.depth_identifier,
]);
}
function coinKey(network) {
if (!network) return "other";
const coin = String(network.coin ?? "").toLowerCase();
const id = String(network.id ?? "").toLowerCase();
for (const c of COIN_TYPES) {
if (
coin === c.key ||
coin === String(c.type) ||
coin === c.symbol.toLowerCase() ||
id === c.symbol.toLowerCase() ||
id.includes(c.key)
) {
return c.key;
}
}
const match = String(network.path ?? "").match(/^m/\d+'?/(\d+)'?/);
if (match) {
const found = COIN_TYPES.find((c) => String(c.type) === match[1]);
if (found) return found.key;
}
return "other";
}
function bitcoinNetwork(network) {
return coinKey(network) === "bitcoin";
}
function bitcoinKind(network) {
const pathPurpose = String(network.path ?? "").match(/^m/(\d+)'?/);
const purpose = String(network.purpose ?? "").trim() || (pathPurpose ? pathPurpose[1] : "");
if (purpose === "84") return "segwit";
if (purpose === "44") return "legacy";
const text = ⁠${network.id} ${network.name}⁠.toLowerCase();
if (/segwit|bech32|p2wpkh/.test(text)) return "segwit";
if (/legacy|p2pkh/.test(text)) return "legacy";
return "other";
}
function ownPayloadKind(board, network) {
const own = coinKey(network);
const matches = (Array.isArray(board?.kinds) ? board.kinds : []).filter(
(entry) => coinKey({ coin: entry?.kind, id: String(entry?.kind ?? "") }) === own,
);
return matches.sort((a, b) => Number(Boolean(b.in_scope)) - Number(Boolean(a.in_scope)))[0] || null;
}
function money(value) {
if (value === undefined || value === null || value === "") return "—";
return String(value);
}
function flag(value) {
return value == null ? "Not reported" : value ? "Yes" : "No";
}
/* ───────────────────────── UI primitives ───────────────────────── */
function Pill({ children, tone = "neutral" }) {
const tones = {
neutral:
"border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
};
return (
<span className={⁠inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}⁠}>
{children}
</span>
);
}
function Notice({ children, type = "error" }) {
const styles =
type === "success"
? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200";
return (
<p role={type === "error" ? "alert" : "status"} className={⁠qtm-pop break-words rounded-xl border px-3 py-2 text-xs leading-5 ${styles}⁠}>
{children}
</p>
);
}
function Field({ label, children }) {
return (
<div className="min-w-0">
<dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
{label}
</dt>
<dd className="mt-0.5 break-words text-sm font-medium leading-5">{children ?? "—"}</dd>
</div>
);
}
function Fields({ children, min = "8rem" }) {
return (
<dl className="grid gap-x-4 gap-y-3" style={{ gridTemplateColumns: ⁠repeat(auto-fit, minmax(${min}, 1fr))⁠ }}>
{children}
</dl>
);
}
function Stat({ label, value, wide = false }) {
return (
<div className={⁠min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60 ${wide ? "col-span-2" : ""}⁠}>
<p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
<p className="mt-1 break-all text-sm font-semibold tabular-nums">{value}</p>
</div>
);
}
function Collapsible({ open, children }) {
return (
<div className={⁠grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${open ? "visible grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0"}⁠}>
<div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
</div>
);
}
function Card({
title,
subtitle,
badge,
defaultOpen = false,
inner = false,
scroll = false,
className = "",
style,
children,
}) {
const [open, setOpen] = useState(defaultOpen);
return (
<section style={style} className={⁠${inner ? INNER : OUTER} ${className}⁠}>
<button
type="button"
aria-expanded={open}
onClick={() => setOpen((value) => !value)}
className={⁠flex w-full items-center gap-3 text-left ${inner ? "px-3 py-2.5" : "px-4 py-3.5"}⁠}
>
<span className="min-w-0 flex-1">
<span className={⁠block truncate font-semibold ${inner ? "text-[11px] uppercase tracking-wider text-zinc-600 dark:text-zinc-300" : "text-sm"}⁠}>
{title}
</span>
{subtitle && <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{subtitle}</span>}
</span>
{badge}
<span aria-hidden="true" className={⁠shrink-0 text-zinc-400 transition-transform duration-300 ${open ? "rotate-180" : ""}⁠}>▾</span>
</button>
<Collapsible open={open}>
<div className={⁠border-t border-zinc-200/80 dark:border-zinc-800 ${inner ? "p-3" : "p-4"} ${scroll ? "max-h-80 overflow-y-auto overscroll-contain" : ""}⁠}>
{children}
</div>
</Collapsible>
</section>
);
}
function SectionHeading({ title, meta, children }) {
return (
<div className="flex flex-wrap items-center gap-2 px-1 pt-2">
<h2 className="text-base font-semibold tracking-tight">{title}</h2>
{meta && <Pill>{meta}</Pill>}
{children && <p className="basis-full text-xs text-zinc-500 dark:text-zinc-400">{children}</p>}
</div>
);
}
/* ───────────────────────── Network pieces ───────────────────────── */
function BudgetSummary({ budget }) {
return (
<Fields min="7rem">
<Field label="Min events">{money(budget?.min_events)}</Field>
<Field label="Max events">{money(budget?.max_events)}</Field>
</Fields>
);
}
function BudgetEditor({ budget, disabled, saving, onSave }) {
const toDraft = () => ({
min_events: String(budget?.min_events ?? 0),
max_events: String(budget?.max_events ?? 1024),
});
const [draft, setDraft] = useState(toDraft);
useEffect(() => {
setDraft(toDraft());
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [budget?.min_events, budget?.max_events]);
return (
<form
className="mt-4 grid gap-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800"
onSubmit={(event) => {
event.preventDefault();
onSave(draft);
}}
>
{[
["min_events", "Min events"],
["max_events", "Max events"],
].map(([key, label]) => (
<label key={key} className="block min-w-0">
<span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
{label}
</span>
<input
className={INPUT}
inputMode="numeric"
value={draft[key]}
disabled={disabled || saving}
onChange={(event) =>
setDraft((current) => ({
...current,
[key]: event.target.value,
}))
}
/>
</label>
))}
<div className="sm:col-span-2">
<button
className={⁠${BUTTON} w-full sm:w-auto⁠}
type="submit"
disabled={disabled || saving}
>
{saving ? "Saving budget…" : "Save network budget"}
</button>
</div>
</form>
);
}
function PayloadBoard({ board, kind, loading }) {
if (loading && !board) return <p className="text-xs text-zinc-500">Loading payload board…</p>;
if (!board) return <p className="text-xs text-zinc-500">No payload-board response yet.</p>;
const obs = board.observation;
const ap = kind?.authorized_payload;
return (
<div className="space-y-3">
{board.error && <Notice>{board.error}</Notice>}
{board.message && <p className="text-xs text-zinc-500">{board.message}</p>}
{kind ? (
<Fields min="8rem">
<Field label="Payload kind">{money(kind.kind)}</Field>
<Field label="Commitment"><span className="break-all font-mono text-xs">{money(board.commitment)}</span></Field>
<Field label="Depth path">{money(kind.depth_path)}</Field>
<Field label="Depth record">{money(kind.depth_record)}</Field>
<Field label="Depth objects">{kind.depth_objects?.length ?? 0}</Field>
<Field label="Authorized payload">{flag(ap?.carried)}</Field>
<Field label="Authorization">{money(ap?.authorization_state)}</Field>
<Field label="Settlement">{money(ap?.settlement_state)}</Field>
{obs && <Field label="Miner feature">{flag(obs.bit_minner_feature)}</Field>}
{obs && <Field label="Settlement carried">{flag(obs.settlement_payload_carried)}</Field>}
</Fields>
) : (
<p className="text-xs text-zinc-500">The API returned no payload kind for this network's chain.</p>
)}
</div>
);
}
/* ───────────────────────── Bit-Miner log popup ───────────────────────── */
const LOG_POLL_RUNNING_MS = 2500;
const LOG_POLL_STOPPED_MS = 6000;
const LOG_DISPLAY_MAX_CHARS = 250_000;
const LOG_STICK_THRESHOLD_PX = 24;
const LOG_BUTTON =
"inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[11px] font-medium transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
async function fetchBitMinerLog({ clip, network, signal }) {
const path = ⁠/wallets/${enc(clip.substrate)}/activations/${enc(clip.activation)}/networks/${enc(network)}/observation/log⁠;
let response;
try {
response = await fetch(⁠${API_BASE}${path}⁠, { cache: "no-store", headers: { Accept: "text/plain" }, signal });
} catch (cause) {
if (cause?.name === "AbortError") throw cause;
const reason = cause instanceof Error && cause.message ? cause.message : "network error";
throw new Error(⁠Could not reach the QTM runtime at ${API_BASE} (${reason}).⁠);
}
const text = await response.text();
if (!response.ok) {
let detail = text.trim();
try {
const parsed = JSON.parse(text);
detail = parsed?.error || parsed?.message || parsed?.detail || detail;
} catch {
// Keep the raw error body.
}
throw new Error(detail ? String(detail).slice(0, 400) : ⁠Log request failed with HTTP ${response.status}.⁠);
}
return text.length > LOG_DISPLAY_MAX_CHARS ? text.slice(-LOG_DISPLAY_MAX_CHARS) : text;
}
function BitMinerLogPopup({ clip, network, running, onClose, onRefreshStatus }) {
const [log, setLog] = useState(null);
const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [error, setError] = useState("");
const [updatedAt, setUpdatedAt] = useState(null);
const [pinned, setPinned] = useState(true);
const dialogRef = useRef(null);
const scrollRef = useRef(null);
const pinnedRef = useRef(true);
const requestRef = useRef(0);
const inflightRef = useRef(null);
const closeRef = useRef(onClose);
useEffect(() => { closeRef.current = onClose; }, [onClose]);
const load = useCallback(async () => {
inflightRef.current?.abort();
const controller = new AbortController();
inflightRef.current = controller;
const requestId = ++requestRef.current;
setRefreshing(true);
try {
const text = await fetchBitMinerLog({ clip, network, signal: controller.signal });
if (requestId !== requestRef.current) return;
setLog((previous) => (previous === text ? previous : text));
setUpdatedAt(new Date());
setError("");
} catch (err) {
if (err?.name === "AbortError" || requestId !== requestRef.current) return;
setError(err instanceof Error ? err.message : "Unable to load the bit-miner log.");
} finally {
if (requestId === requestRef.current) {
setLoading(false);
setRefreshing(false);
}
}
}, [clip, network]);
useEffect(() => {
let cancelled = false;
let timer = null;
const interval = running ? LOG_POLL_RUNNING_MS : LOG_POLL_STOPPED_MS;
const tick = async () => {
if (!document.hidden) await load();
if (!cancelled) timer = setTimeout(tick, interval);
};
tick();
return () => {
cancelled = true;
if (timer) clearTimeout(timer);
requestRef.current += 1;
inflightRef.current?.abort();
};
}, [load, running]);
useEffect(() => {
const el = scrollRef.current;
if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
}, [log]);
function handleScroll() {
const el = scrollRef.current;
if (!el) return;
const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= LOG_STICK_THRESHOLD_PX;
pinnedRef.current = atBottom;
setPinned(atBottom);
}
function jumpToLatest() {
const el = scrollRef.current;
if (!el) return;
pinnedRef.current = true;
setPinned(true);
el.scrollTop = el.scrollHeight;
}
function handleRefresh() {
pinnedRef.current = true;
setPinned(true);
onRefreshStatus?.();
load();
}
useEffect(() => {
const previousFocus = document.activeElement;
const previousOverflow = document.body.style.overflow;
document.body.style.overflow = "hidden";
dialogRef.current?.focus();
function onKeyDown(event) {
if (event.key === "Escape") {
event.preventDefault();
closeRef.current?.();
return;
}
if (event.key !== "Tab" || !dialogRef.current) return;
const focusable = dialogRef.current.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
if (focusable.length === 0) {
event.preventDefault();
return;
}
const first = focusable[0];
const last = focusable[focusable.length - 1];
if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
event.preventDefault();
last.focus();
} else if (!event.shiftKey && document.activeElement === last) {
event.preventDefault();
first.focus();
}
}
document.addEventListener("keydown", onKeyDown);
return () => {
document.removeEventListener("keydown", onKeyDown);
document.body.style.overflow = previousOverflow;
if (previousFocus instanceof HTMLElement) previousFocus.focus();
};
}, []);
const hasLog = typeof log === "string" && log.length > 0;
return (
<div className="qtm-backdrop fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
<div
ref={dialogRef}
role="dialog"
aria-modal="true"
aria-labelledby="bitminer-log-title"
tabIndex={-1}
className="qtm-dialog flex max-h-[78vh] w-full max-w-[800px] flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white text-zinc-950 shadow-2xl outline-none sm:min-w-[min(720px,100%)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
>
<div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-5 sm:py-4 dark:border-zinc-800">
<div className="min-w-0">
<div className="flex flex-wrap items-center gap-2">
<h2 id="bitminer-log-title" className="text-sm font-semibold tracking-tight sm:text-base">Bit-Miner logs</h2>
<span role="status" className={⁠inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${running ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}⁠}>
<span aria-hidden="true" className={⁠h-1.5 w-1.5 rounded-full ${running ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-zinc-400"}⁠} />
{running ? "Running" : "Stopped"}
</span>
</div>
<p className="mt-1 break-all font-mono text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">{clip.substrate} · activation {clip.activation} · {network}</p>
</div>
<div className="flex shrink-0 items-center gap-2">
<button type="button" className={LOG_BUTTON} disabled={refreshing} onClick={handleRefresh}>{refreshing ? "Refreshing…" : "Refresh"}</button>
<button type="button" aria-label="Close log viewer" className={⁠${LOG_BUTTON} w-8 px-0 text-base leading-none⁠} onClick={onClose}>×</button>
</div>
</div>
<div className="relative flex min-h-0 flex-1 flex-col bg-zinc-950">
{error && (
<div role="alert" className="shrink-0 break-words border-b border-red-900/60 bg-red-950 px-4 py-2 text-xs leading-5 text-red-200">
{error}{hasLog ? " Showing the last output received." : ""}
</div>
)}
<div ref={scrollRef} onScroll={handleScroll} tabIndex={0} aria-label="Bit-miner process log output" className="min-h-[16rem] flex-1 overflow-auto overscroll-contain px-4 py-3 sm:px-5">
{loading && log === null ? (
<p className="text-xs text-zinc-400">Loading log…</p>
) : hasLog ? (
<pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-zinc-100 sm:text-xs">{log}</pre>
) : error && log === null ? (
<p className="text-xs text-zinc-400">The log could not be loaded.</p>
) : (
<p className="text-xs text-zinc-400">No log output yet. Output appears here once the bit-miner process writes to its log.</p>
)}
</div>
{!pinned && hasLog && <button type="button" onClick={jumpToLatest} className="absolute bottom-3 right-4 rounded-full border border-zinc-600 bg-zinc-800/95 px-3 py-1.5 text-[11px] font-medium text-zinc-100 shadow-lg transition hover:bg-zinc-700">Jump to latest ↓</button>}
</div>
<div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-2.5 text-[10px] text-zinc-500 sm:px-5 dark:border-zinc-800 dark:text-zinc-400">
<span>{updatedAt ? ⁠Updated ${updatedAt.toLocaleTimeString()}⁠ : "Waiting for first response…"}</span>
<span>Auto-refresh every {(running ? LOG_POLL_RUNNING_MS : LOG_POLL_STOPPED_MS) / 1000}s · Esc to close</span>
</div>
</div>
</div>
);
}
function StreamBody({ status, busy, results, network, actionError, onAction, onRefresh, onViewLogs }) {
const known = typeof status?.running === "boolean";
const running = status?.running === true;
const observedAt =
status?.runtime?.unix_seconds != null
? new Date(Number(status.runtime.unix_seconds) * 1000).toLocaleString()
: null;
const clips = Array.isArray(status?.clips) ? status.clips : [];
const eventPath = status?.event_path ?? status?.path;
return (
<div className="space-y-3">
<div className="flex min-w-0 flex-wrap items-center gap-2">
<Pill tone={running ? "ok" : known ? "neutral" : "warn"}>{running ? "Running" : known ? "Idle" : "Unknown"}</Pill>
{status?.pid != null && <span className="text-xs text-zinc-500">PID {status.pid}</span>}
</div>
{status && (
<Fields min="7rem">
<Field label="Process">{running ? "Running" : known ? "Not running" : "Not reported"}</Field>
<Field label="PID">{money(status.pid)}</Field>
<Field label="Activation">{money(status.activation)}</Field>
<Field label="Network"><span className="break-all font-mono text-xs">{money(status.network)}</span></Field>
<Field label="Status read">{money(observedAt)}</Field>
</Fields>
)}
<div className="grid grid-cols-3 gap-2">
<button type="button" className={⁠${BUTTON} w-full min-w-0 px-2 text-xs whitespace-nowrap⁠} disabled={busy || running} onClick={() => onAction("start", network)}>{busy ? "Working…" : "Start"}</button>
<button type="button" className={⁠${BUTTON} w-full min-w-0 px-2 text-xs whitespace-nowrap⁠} disabled={busy} onClick={() => onRefresh(network)}>Refresh</button>
<button type="button" className={⁠${BUTTON} w-full min-w-0 px-2 text-xs whitespace-nowrap⁠} disabled={busy || !running} onClick={() => onAction("stop", network)}>Stop</button>
</div>
{actionError && <Notice>{actionError}</Notice>}
{status?.error && <Notice>{status.error}</Notice>}
{eventPath && <p className="break-all font-mono text-[10px] text-zinc-500">Event path: {eventPath}</p>}
{status?.log_path && <p className="break-all font-mono text-[10px] text-zinc-500">Process log: {status.log_path}</p>}
{clips.length > 0 && (
<div>
<h5 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Observation clips</h5>
<ul className="mt-1 space-y-1">
{clips.map((clip, index) => (
<li key={⁠${clip?.substrate}-${index}⁠} className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
<span className="break-all font-mono">{money(clip?.substrate)}</span>
<Pill tone={clip?.active ? "ok" : "neutral"}>{clip?.active ? "Active" : "Inactive"}</Pill>
{clip?.direction && <span>{clip.direction}</span>}
</li>
))}
</ul>
</div>
)}
<div>
<div className="flex items-center justify-between">
<h5 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">BitMiner responses</h5>
<div className="flex items-center gap-2">
<button type="button" className={LOG_BUTTON} disabled={!onViewLogs} onClick={() => onViewLogs?.(network)}>View process logs</button>
<span className="text-[10px] tabular-nums text-zinc-500">{results.length}</span>
</div>
</div>
<div aria-live="polite" aria-label="Bitcoin bit-miner API responses" className="mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain rounded-xl bg-white p-2 dark:bg-zinc-900">
{results.map((entry) => (
<div key={entry.id} className="border-b border-zinc-200 pb-2 last:border-0 last:pb-0 dark:border-zinc-800">
<div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
<span className="min-w-0 break-words font-semibold">{entry.label}</span>
<time className="shrink-0">{entry.time}</time>
</div>
<pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-zinc-700 dark:text-zinc-300">{JSON.stringify(entry.body, null, 2)}</pre>
</div>
))}
{results.length === 0 && <p className="py-2 text-xs text-zinc-500">Start bit-miner to launch its window loop. Refresh reads the API process status without adding another response entry.</p>}
</div>
</div>
</div>
);
}
function WirePacketsBody({ metadata, loading }) {
const [selectedSubmission, setSelectedSubmission] = useState("");
const route = metadata?.file_route;
const href = route
? ⁠${API_BASE}${route.startsWith("/") ? route : ⁠/${route}⁠}⁠
: null;
const packets = Array.isArray(metadata?.packets) ? metadata.packets : [];
const selectedPacket =
packets.find((packet) => String(packet.submission) === selectedSubmission) ||
packets[packets.length - 1] ||
null;
const entries = Array.isArray(selectedPacket?.packets)
? [...selectedPacket.packets].sort((a, b) => Number(a.vout) - Number(b.vout))
: [];
if (loading && !metadata) {
return <p className="text-xs text-zinc-500">Loading WirePackets…</p>;
}
if (!metadata) {
return <p className="text-xs text-zinc-500">No WirePackets metadata response.</p>;
}
return (
<div className="space-y-3">
<Fields min="7rem">
<Field label="Scope">{money(metadata.scope)}</Field>
<Field label="Total bytes">
{metadata.bytes == null ? "Not reported" : Number(metadata.bytes).toLocaleString()}
</Field>
<Field label="Persisted submissions">{packets.length}</Field>
<Field label="Files present">{flag(metadata.exists)}</Field>
</Fields>
{metadata.path && (
<p className="break-all font-mono text-[11px] text-zinc-500">{metadata.path}</p>
)}
{packets.length > 0 ? (
<div className="space-y-2">
<label className="flex min-w-0 items-center gap-2">
<span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Submission</span>
<select
aria-label="Select WirePacket submission"
className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
value={selectedPacket ? String(selectedPacket.submission) : ""}
onChange={(event) => setSelectedSubmission(event.target.value)}
>
{packets.map((packet) => (
<option key={packet.submission} value={String(packet.submission)}>
Submission {packet.submission} · {packet.packet_count ?? packet.packets?.length ?? 0} vout entries
</option>
))}
</select>
<Pill tone="ok">{entries.length} vout</Pill>
</label>
{selectedPacket && (
<div className="min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-2 dark:border-zinc-800 dark:bg-zinc-950/60">
<p className="mb-2 break-all font-mono text-[10px] text-zinc-500">{selectedPacket.path}</p>
{entries.length > 0 ? (
<div className="overflow-x-auto">
<table className="w-full min-w-[620px] table-fixed text-left text-[10px]">
<thead className="text-[9px] uppercase tracking-wider text-zinc-500">
<tr>
<th className="w-12 px-2 py-1.5">Vout</th>
<th className="w-24 px-2 py-1.5 text-right">Value (sat)</th>
<th className="w-44 px-2 py-1.5">Txid</th>
<th className="px-2 py-1.5">Script pubkey</th>
<th className="w-32 px-2 py-1.5">Commitment</th>
</tr>
</thead>
<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
{entries.map((entry, index) => (
<tr key={⁠${entry.vout}-${index}⁠} className="align-top">
<td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">{money(entry.vout)}</td>
<td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums">{entry.value_sat == null ? "—" : Number(entry.value_sat).toLocaleString()}</td>
<td className="break-all px-2 py-2 font-mono text-zinc-500">{money(entry.txid)}</td>
<td className="break-all px-2 py-2 font-mono text-zinc-500">{money(entry.script_pubkey)}</td>
<td className="break-all px-2 py-2 font-mono text-zinc-500">{money(entry.commitment)}</td>
</tr>
))}
</tbody>
</table>
</div>
) : (
<p className="text-xs text-zinc-500">No decoded packet values for this submission.</p>
)}
</div>
)}
</div>
) : (
<p className="text-xs text-zinc-500">The API returned no persisted submission files for this activation.</p>
)}
{href && (
<a className={⁠${BUTTON} w-full⁠} href={href} target="_blank" rel="noreferrer">
Open combined WirePackets file
</a>
)}
</div>
);
}
function PayloadItem({ payload }) {
const [open, setOpen] = useState(false);
return (
<div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
<div className="flex items-start justify-between gap-2">
<span className="min-w-0 break-all text-xs font-semibold">{payload.record}</span>
<Pill>{payload.objects.length} obj</Pill>
</div>
<p className="mt-1 break-all font-mono text-[11px] text-zinc-500">{payload.depth_identifier}</p>
<p className="mt-0.5 break-all font-mono text-[10px] text-zinc-400">{payload.path}</p>
{payload.objects.length > 0 && (
<>
<button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="mt-2 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
Depth objects
<span aria-hidden="true" className={⁠transition-transform duration-300 ${open ? "rotate-180" : ""}⁠}>▾</span>
</button>
<Collapsible open={open}>
<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-zinc-500">{JSON.stringify(payload.objects, null, 2)}</pre>
</Collapsible>
</>
)}
</div>
);
}
function PayloadRecordsBody({ group }) {
const sections = [
["Transit inputs", group.transit_inputs],
["Exile outputs", group.exile_outputs],
["Unclassified", group.unclassified],
].filter(([, rows]) => rows.length > 0);
if (sections.length === 0) return <p className="text-xs text-zinc-500">No payload records for this network.</p>;
return (
<div className="space-y-4">
{sections.map(([title, rows]) => (
<div key={title}>
<h5 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{title} <Pill>{rows.length}</Pill></h5>
<div className="grid gap-2">{rows.map((payload) => <PayloadItem key={payloadRowKey(payload)} payload={payload} />)}</div>
</div>
))}
</div>
);
}
function NetworkCard({
kind, network, defaultOpen, index, clip, budgetRow, group, board, wire,
observation, observationError, busy, results,
loadingBoard, loadingBudget, savingBudget, loadingWire, loadingObservation,
budgetError, budgetNotice, onSaveBudget, onStreamAction, onRefreshStream, onViewLogs,
}) {
const meta = BITCOIN_KINDS[kind];
const style = { animationDelay: ⁠${Math.min(index, 6) * 60}ms⁠ };
if (!network) {
return (
<Card title={meta.label} subtitle={meta.note} badge={<Pill tone="warn">Not derived</Pill>} className="w-full" style={style}>
<p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
No {meta.label} network was derived from the persisted event's heritage state for this ActiveClip.
</p>
</Card>
);
}
const status =
observation && (observation.network == null || normalizeNetworkId(observation.network) === network.id)
? observation
: undefined;
const budget = budgetRow?.budget || null;
const configured = Boolean(budgetRow?.configured && budget);
const payloadKind = ownPayloadKind(board, network);
const payloadTotal = group.transit_inputs.length + group.exile_outputs.length + group.unclassified.length;
const activationLabel = clip ? String(clip.activation) : "—";
return (
<Card title={kind === "other" ? network.name : meta.label} subtitle={network.id} badge={<Pill tone={configured ? "ok" : "neutral"}>{configured ? "Budget set" : "No budget"}</Pill>} defaultOpen={defaultOpen} className="w-full" style={style}>
<div className="space-y-3">
<Fields min="7rem">
<Field label="Purpose">{money(network.purpose)}</Field>
<Field label="Derivation path"><span className="break-all font-mono text-xs">{money(network.path)}</span></Field>
</Fields>
<Card
inner
defaultOpen
title={⁠Network budget · event/${activationLabel}/${network.id}/budget⁠}
badge={
loadingBudget ? (
<Pill>Loading</Pill>
) : savingBudget ? (
<Pill>Saving</Pill>
) : null
}
>
<BudgetSummary budget={budget} />
<BudgetEditor
budget={budget}
disabled={loadingBudget || savingBudget || !clip}
saving={savingBudget}
onSave={(draft) => onSaveBudget(network, draft)}
/>
{budgetError && (
<div className="mt-3">
<Notice>{budgetError}</Notice>
</div>
)}
{budgetNotice && (
<div className="mt-3">
<Notice type="success">{budgetNotice}</Notice>
</div>
)}
</Card>
<Card inner scroll title="Payload board" badge={<Pill tone={payloadKind?.available ? "ok" : "neutral"}>{payloadKind ? (payloadKind.available ? "Available" : "Unavailable") : "None"}</Pill>}>
<PayloadBoard board={board} kind={payloadKind} loading={loadingBoard} />
</Card>
<Card inner title="Bit-miner" badge={<Pill tone={status?.running === true ? "ok" : "neutral"}>{status?.running === true ? "Running" : status?.running === false ? "Idle" : loadingObservation ? "Checking…" : "Unknown"}</Pill>}>
<StreamBody status={status} busy={busy} results={results} network={network} actionError={observationError} onAction={onStreamAction} onRefresh={onRefreshStream} onViewLogs={onViewLogs} />
</Card>
<Card inner title="Wirepackets file" badge={<Pill tone={wire?.exists ? "ok" : "neutral"}>{wire?.exists ? "Present" : "None"}</Pill>}>
<WirePacketsBody metadata={wire} loading={loadingWire} />
</Card>
<Card inner scroll title="Payload records" badge={<Pill>{payloadTotal}</Pill>}>
<PayloadRecordsBody group={group} />
</Card>
</div>
</Card>
);
}
/* ───────────────────────── ActiveClip-driven Event Store ───────────────────────── */
const EMPTY_CLIP_STORE = Object.freeze({
clipKey: "",
loadingEvent: false,
eventRows: [],
directory: "",
authoritativeEvent: null,
heritageState: null,
derivedEventSnapshot: null,
derivedNetworks: [],
loadingNetworks: false,
payloads: [],
loadingPayloads: false,
budgetsByNetwork: {},
loadingBudgets: {},
savingBudgets: {},
budgetErrors: {},
budgetNotices: {},
boards: {},
loadingBoards: {},
wirePackets: {},
loadingWire: {},
observations: {},
busyObservation: {},
observationErrors: {},
loadingObservations: {},
streamResults: {},
error: "",
notice: "",
});
export function EventStoreView({ clip }) {
const activeClip = useMemo(() => createActiveClip(clip), [clip]);
const clipKey = useMemo(() => activeClipKey(activeClip), [activeClip]);
const [store, setStore] = useState(EMPTY_CLIP_STORE);
const [logViewer, setLogViewer] = useState(null);
// Monotonic lifecycle generation & cancellation controller scoped exclusively to activeClip.
const lifecycleGenRef = useRef(0);
const activeClipKeyRef = useRef("");
const abortControllerRef = useRef(null);
const isClipCurrent = useCallback(
(targetKey, generation) =>
Boolean(targetKey) &&
generation === lifecycleGenRef.current &&
activeClipKeyRef.current === targetKey,
[],
);
// Scoped state updater: drops any update from an invalidated clip.
const updateScopedStore = useCallback(
(targetKey, generation, updater) => {
if (!isClipCurrent(targetKey, generation)) return;
setStore((prev) => {
if (prev.clipKey !== targetKey) return prev;
const patch = typeof updater === "function" ? updater(prev) : updater;
return { ...prev, ...patch };
});
},
[isClipCurrent],
);
// Stage 5b helper: load budgets for the derived networks of the active clip's heritage state.
const loadBudgetsForClip = useCallback(
async (targetClip, targetKey, generation, networkRows, signal) => {
const networkIds = (networkRows || [])
.map((network) => normalizeNetworkId(network?.id))
.filter(Boolean);
if (networkIds.length === 0) {
updateScopedStore(targetKey, generation, {
budgetsByNetwork: {},
loadingBudgets: {},
});
return {};
}
const idsSet = new Set(networkIds);
updateScopedStore(targetKey, generation, (prev) => ({
loadingBudgets: Object.fromEntries(networkIds.map((id) => [id, true])),
budgetErrors: {
...prev.budgetErrors,
...Object.fromEntries(networkIds.map((id) => [id, ""])),
},
}));
try {
const body = await apiRequest(
⁠/wallets/${enc(targetClip.substrate)}/activations/${enc(targetClip.activation)}/budgets⁠,
{ signal },
);
if (!isClipCurrent(targetKey, generation)) return null;
const rows = Array.isArray(body?.budgets) ? body.budgets : [];
const nextMap = {};
for (const row of rows) {
if (row?.activation != null && String(row.activation) !== String(targetClip.activation)) {
continue;
}
const net = normalizeDerivedNetwork(row?.network ?? row?.network_id);
if (!net || !idsSet.has(net.id)) continue;
nextMap[net.id] = row;
}
const scoped = Object.fromEntries(
networkIds.map((id) => [id, nextMap[id] ?? null]),
);
updateScopedStore(targetKey, generation, {
budgetsByNetwork: scoped,
loadingBudgets: Object.fromEntries(networkIds.map((id) => [id, false])),
});
return scoped;
} catch (err) {
if (err?.name !== "AbortError" && isClipCurrent(targetKey, generation)) {
const message = err instanceof Error ? err.message : "API error";
updateScopedStore(targetKey, generation, {
budgetsByNetwork: Object.fromEntries(networkIds.map((id) => [id, null])),
loadingBudgets: Object.fromEntries(networkIds.map((id) => [id, false])),
budgetErrors: Object.fromEntries(
networkIds.map((id) => [
id,
⁠Unable to load budget for event/${targetClip.activation}/${id}/budget: ${message}⁠,
]),
),
});
}
return null;
}
},
[isClipCurrent, updateScopedStore],
);
// Stage 5a helper: load complete persistent payload storage belonging to the resolved clip events.
const loadPersistentPayloadsForClip = useCallback(
async (targetClip, targetKey, generation, eventRows, signal) => {
const records = [
...new Set(
(eventRows || [])
.map((row) => recordOf(row))
.filter(Boolean),
),
];
if (records.length === 0) {
updateScopedStore(targetKey, generation, {
payloads: [],
loadingPayloads: false,
});
return [];
}
updateScopedStore(targetKey, generation, { loadingPayloads: true });
try {
const responses = await Promise.all(
records.map((rec) =>
apiRequest(
⁠/wallets/${enc(targetClip.substrate)}/events/${enc(rec)}/payloads⁠,
{ signal },
).then((body) => ({ rec, body })),
),
);
if (!isClipCurrent(targetKey, generation)) return null;
const unique = new Map();
for (const { rec, body } of responses) {
const rows = Array.isArray(body?.payloads) ? body.payloads : [];
for (const entry of rows) {
const normalized = normalizePayload(entry, rec);
if (!normalized) continue;
const key = payloadRowKey(normalized);
if (!unique.has(key)) unique.set(key, normalized);
}
}
const collected = [...unique.values()];
updateScopedStore(targetKey, generation, {
payloads: collected,
loadingPayloads: false,
});
return collected;
} catch (err) {
if (err?.name !== "AbortError" && isClipCurrent(targetKey, generation)) {
updateScopedStore(targetKey, generation, {
payloads: [],
loadingPayloads: false,
error: ⁠Unable to load payload records: ${ err instanceof Error ? err.message : "unknown API error" }⁠,
});
}
return null;
}
},
[isClipCurrent, updateScopedStore],
);
// Canonical ActiveClip Initialization Sequence:
// 1. Receive the ActiveClip.
// 2. Resolve the persisted event directly from that ActiveClip.
// 3. Obtain the authoritative event heritage state from ⁠event.heritage.state⁠.
// 4. Resolve the applicable network derivations from the event's authoritative state.
// 5. Load the persistent storage belonging to that clip.
// 6. Render the complete Event Store.
useEffect(() => {
abortControllerRef.current?.abort();
abortControllerRef.current = null;
const generation = ++lifecycleGenRef.current;
activeClipKeyRef.current = clipKey;
setLogViewer(null);
if (!activeClip) {
setStore({
...EMPTY_CLIP_STORE,
error:
"Event Store requires a valid ActiveClip ({ substrate, activation }).",
});
return;
}
const controller = new AbortController();
abortControllerRef.current = controller;
const { signal } = controller;
setStore({
...EMPTY_CLIP_STORE,
clipKey,
loadingEvent: true,
});
void (async () => {
// Step 2: Resolve the persisted event directly from this ActiveClip.
let resolved;
try {
resolved = await resolveEventForClip(activeClip, signal);
if (!isClipCurrent(clipKey, generation)) return;
} catch (err) {
if (err?.name === "AbortError" || !isClipCurrent(clipKey, generation)) {
return;
}
updateScopedStore(clipKey, generation, {
loadingEvent: false,
error:
err instanceof Error && err.message
? err.message
: "Unable to resolve persisted event for ActiveClip.",
});
return;
}
const clipEventRows = resolved.rows;
const authoritativeEvent = resolved.authoritativeEvent;
if (!authoritativeEvent) {
updateScopedStore(clipKey, generation, {
loadingEvent: false,
eventRows: [],
directory: resolved.directory,
notice: ⁠No persisted event found for ActiveClip (${activeClip.substrate} · activation ${activeClip.activation}).⁠,
});
return;
}
// Step 3: Obtain the authoritative event heritage state from ⁠event.heritage.state⁠.
const heritageState = heritageStateOf(authoritativeEvent);
if (!heritageState) {
updateScopedStore(clipKey, generation, {
loadingEvent: false,
eventRows: clipEventRows,
directory: resolved.directory,
authoritativeEvent,
error:
"Resolved event is missing authoritative event.heritage.state.",
});
return;
}
const heritageActivation = activationFromHeritageState(heritageState);
if (heritageActivation !== activeClip.activation) {
updateScopedStore(clipKey, generation, {
loadingEvent: false,
eventRows: clipEventRows,
directory: resolved.directory,
authoritativeEvent,
heritageState,
error: ⁠Event heritage activation (${String(heritageActivation)}) does not match ActiveClip (${activeClip.activation}).⁠,
});
return;
}
updateScopedStore(clipKey, generation, {
loadingEvent: false,
eventRows: clipEventRows,
directory: resolved.directory,
authoritativeEvent,
heritageState,
loadingNetworks: true,
});
// Step 4: Resolve applicable network derivations from the event's authoritative heritage state.
let derivedResult;
try {
derivedResult = await fetchDerivedNetworksFromHeritage(
activeClip,
heritageState,
signal,
);
} catch (err) {
if (err?.name === "AbortError" || !isClipCurrent(clipKey, generation)) {
return;
}
updateScopedStore(clipKey, generation, {
loadingNetworks: false,
error: ⁠Unable to derive networks from event heritage state: ${ err instanceof Error ? err.message : "unknown API error" }⁠,
});
return;
}
if (!isClipCurrent(clipKey, generation)) return;
const networkRows = derivedResult.networks;
updateScopedStore(clipKey, generation, {
loadingNetworks: false,
derivedEventSnapshot: derivedResult.event,
derivedNetworks: networkRows,
});
// Step 5: Load the complete persistent storage belonging to this ActiveClip.
void loadPersistentPayloadsForClip(
activeClip,
clipKey,
generation,
clipEventRows,
signal,
);
void loadBudgetsForClip(
activeClip,
clipKey,
generation,
networkRows,
signal,
);
for (const network of networkRows) {
const netId = normalizeNetworkId(network?.id);
if (!netId) continue;
// Payload board per derived network
updateScopedStore(clipKey, generation, (prev) => ({
loadingBoards: { ...prev.loadingBoards, [netId]: true },
}));
void apiRequest(
⁠/wallets/${enc(activeClip.substrate)}/activations/${enc(heritageActivation)}/networks/${enc(netId)}/payload-board⁠,
{ signal },
)
.then((boardBody) => {
if (!isClipCurrent(clipKey, generation)) return;
if (
boardBody?.activation != null &&
String(boardBody.activation) !== String(heritageActivation)
) {
return;
}
updateScopedStore(clipKey, generation, (prev) => ({
boards: { ...prev.boards, [netId]: boardBody },
}));
})
.catch(() => {})
.finally(() => {
updateScopedStore(clipKey, generation, (prev) => ({
loadingBoards: { ...prev.loadingBoards, [netId]: false },
}));
});
if (bitcoinNetwork(network)) {
// Observation status per derived Bitcoin network
updateScopedStore(clipKey, generation, (prev) => ({
loadingObservations: { ...prev.loadingObservations, [netId]: true },
observationErrors: { ...prev.observationErrors, [netId]: "" },
}));
void apiRequest(
⁠/wallets/${enc(activeClip.substrate)}/activations/${enc(heritageActivation)}/networks/${enc(netId)}/observation⁠,
{ signal },
)
.then((status) => {
if (!isClipCurrent(clipKey, generation)) return;
if (!observationMatches(status, netId, heritageActivation)) {
updateScopedStore(clipKey, generation, (prev) => ({
observationErrors: {
...prev.observationErrors,
[netId]: "Observation status response did not match this network.",
},
}));
return;
}
updateScopedStore(clipKey, generation, (prev) => ({
observations: { ...prev.observations, [netId]: status },
}));
})
.catch((err) => {
if (err?.name === "AbortError" || !isClipCurrent(clipKey, generation)) {
return;
}
updateScopedStore(clipKey, generation, (prev) => ({
observationErrors: {
...prev.observationErrors,
[netId]:
err instanceof Error
? err.message
: "Unable to load observation status.",
},
}));
})
.finally(() => {
updateScopedStore(clipKey, generation, (prev) => ({
loadingObservations: { ...prev.loadingObservations, [netId]: false },
}));
});
// WirePackets persistent storage per derived Bitcoin network
updateScopedStore(clipKey, generation, (prev) => ({
loadingWire: { ...prev.loadingWire, [netId]: true },
}));
void apiRequest(
⁠/wallets/${enc(activeClip.substrate)}/activations/${enc(heritageActivation)}/networks/${enc(netId)}/wirepackets⁠,
{ signal },
)
.then((metadata) => {
if (!isClipCurrent(clipKey, generation)) return;
if (
metadata?.activation != null &&
String(metadata.activation) !== String(heritageActivation)
) {
return;
}
updateScopedStore(clipKey, generation, (prev) => ({
wirePackets: { ...prev.wirePackets, [netId]: metadata },
}));
})
.catch(() => {})
.finally(() => {
updateScopedStore(clipKey, generation, (prev) => ({
loadingWire: { ...prev.loadingWire, [netId]: false },
}));
});
}
}
})();
return () => {
controller.abort();
};
}, [
activeClip,
clipKey,
isClipCurrent,
updateScopedStore,
loadPersistentPayloadsForClip,
loadBudgetsForClip,
]);
const scopedStore = store.clipKey === clipKey ? store : EMPTY_CLIP_STORE;
const authoritativeEvent = scopedStore.authoritativeEvent;
const heritageState = scopedStore.heritageState;
const focusedEvent =
scopedStore.derivedEventSnapshot || authoritativeEvent || null;
const authoritativeRecord = recordOf(authoritativeEvent);
const retainedMass = useMemo(() => {
const fromHeritage = heritageState?.retained_mass;
if (fromHeritage !== undefined && fromHeritage !== null && /^\d+/.test(String(fromHeritage))) {
return BigInt(fromHeritage);
}
return scopedStore.eventRows.reduce((sum, row) => {
const value =
row?.retained_mass ?? row?.heritage?.state?.retained_mass ?? "0";
return /^\d+/.test(String(value)) ? sum + BigInt(value) : sum;
}, 0n);
}, [heritageState, scopedStore.eventRows]);
const payloadGroups = useMemo(() => {
const groups = new Map();
for (const payload of scopedStore.payloads) {
const id = payload.network.id;
if (!groups.has(id)) {
groups.set(id, {
transit_inputs: [],
exile_outputs: [],
unclassified: [],
});
}
groups.get(id)[payload.direction].push(payload);
}
return groups;
}, [scopedStore.payloads]);
const networkBudgetById = useMemo(() => {
const result = new Map();
for (const [id, row] of Object.entries(scopedStore.budgetsByNetwork)) {
if (!row) continue;
const net = normalizeDerivedNetwork(row.network ?? row.network_id) || { id };
result.set(id, { ...row, network: net });
}
return result;
}, [scopedStore.budgetsByNetwork]);
const bitcoinSlots = useMemo(() => {
const buckets = { legacy: [], segwit: [], other: [] };
for (const network of scopedStore.derivedNetworks) {
if (bitcoinNetwork(network)) buckets[bitcoinKind(network)].push(network);
}
const slots = [];
for (const kind of ["segwit", "legacy"]) {
if (buckets[kind].length === 0) slots.push({ kind, network: null });
else buckets[kind].forEach((network) => slots.push({ kind, network }));
}
buckets.other.forEach((network) => slots.push({ kind: "other", network }));
return slots;
}, [scopedStore.derivedNetworks]);
const observationRunning = scopedStore.derivedNetworks.some(
(network) =>
bitcoinNetwork(network) &&
scopedStore.observations[network.id]?.running === true,
);
const anyNetworkLoading =
scopedStore.loadingNetworks ||
Object.values(scopedStore.loadingObservations).some(Boolean) ||
Object.values(scopedStore.loadingBoards).some(Boolean) ||
Object.values(scopedStore.loadingWire).some(Boolean) ||
Object.values(scopedStore.loadingBudgets).some(Boolean) ||
Object.values(scopedStore.savingBudgets).some(Boolean);
const overviewBadge = (() => {
if (!activeClip) return <Pill tone="warn">Missing ActiveClip</Pill>;
if (scopedStore.loadingEvent) return <Pill>Resolving event</Pill>;
if (!heritageState) return <Pill tone="warn">No heritage state</Pill>;
if (scopedStore.loadingNetworks) return <Pill>Deriving networks</Pill>;
if (observationRunning) return <Pill tone="ok">Syncing</Pill>;
if (anyNetworkLoading || scopedStore.loadingPayloads) return <Pill>Loading storage</Pill>;
if (Object.values(scopedStore.budgetErrors).some(Boolean)) return <Pill tone="warn">Budget error</Pill>;
if (scopedStore.error) return <Pill tone="warn">Partial</Pill>;
return <Pill tone="ok">Ready</Pill>;
})();
const runningBitcoinNetworkIds = useMemo(
() =>
JSON.stringify(
scopedStore.derivedNetworks
.filter(bitcoinNetwork)
.filter((network) => scopedStore.observations[network.id]?.running === true)
.map((network) => network.id),
),
[scopedStore.derivedNetworks, scopedStore.observations],
);
// Clip-scoped WirePackets polling when bit-miner is running.
useEffect(() => {
if (!activeClip || !heritageState) return;
const networkIds = JSON.parse(runningBitcoinNetworkIds);
if (!networkIds.length) return;
const targetClip = activeClip;
const targetKey = clipKey;
const generation = lifecycleGenRef.current;
let cancelled = false;
let timeoutId = null;
const pollWirePackets = async () => {
await Promise.allSettled(
networkIds.map(async (networkId) => {
try {
const metadata = await apiRequest(
⁠/wallets/${enc(targetClip.substrate)}/activations/${enc(targetClip.activation)}/networks/${enc(networkId)}/wirepackets⁠,
);
if (cancelled || !isClipCurrent(targetKey, generation)) return;
if (
metadata?.activation != null &&
String(metadata.activation) !== String(targetClip.activation)
) {
return;
}
updateScopedStore(targetKey, generation, (prev) => ({
wirePackets: { ...prev.wirePackets, [networkId]: metadata },
}));
} catch {
// Poll failures stay local.
}
}),
);
if (!cancelled && isClipCurrent(targetKey, generation)) {
timeoutId = window.setTimeout(pollWirePackets, WIREPACKETS_POLL_MS);
}
};
timeoutId = window.setTimeout(pollWirePackets, 0);
return () => {
cancelled = true;
if (timeoutId !== null) window.clearTimeout(timeoutId);
};
}, [
activeClip,
clipKey,
heritageState,
runningBitcoinNetworkIds,
isClipCurrent,
updateScopedStore,
]);
const appendStreamResult = useCallback(
(targetKey, generation, networkId, label, body) => {
updateScopedStore(targetKey, generation, (prev) => ({
streamResults: {
...prev.streamResults,
[networkId]: [
...(prev.streamResults[networkId] || []),
{
id: ⁠${Date.now()}-${Math.random().toString(36).slice(2)}⁠,
label,
time: new Date().toLocaleTimeString(),
body,
},
].slice(-60),
},
}));
},
[updateScopedStore],
);
const observationScope = (network) => {
const id = normalizeNetworkId(network?.id);
const targetClip = activeClip;
const targetKey = clipKey;
const generation = lifecycleGenRef.current;
return {
id,
targetClip,
targetKey,
generation,
valid: Boolean(id) && Boolean(targetClip) && Boolean(heritageState),
route: targetClip
? ⁠/wallets/${enc(targetClip.substrate)}/activations/${enc(targetClip.activation)}/networks/${enc(id)}/observation⁠
: "",
activation: targetClip ? String(targetClip.activation) : "",
stale: () => !isClipCurrent(targetKey, generation),
};
};
const readObservationStatus = async (scope) => {
const status = await apiRequest(scope.route);
if (scope.stale()) return null;
if (!observationMatches(status, scope.id, scope.activation)) {
throw new Error("Observation status response did not match this network.");
}
updateScopedStore(scope.targetKey, scope.generation, (prev) => ({
observations: { ...prev.observations, [scope.id]: status },
}));
return status;
};
const refreshStream = async (network) => {
const scope = observationScope(network);
if (!scope.valid) return;
const { id, targetKey, generation } = scope;
updateScopedStore(targetKey, generation, (prev) => ({
busyObservation: { ...prev.busyObservation, [id]: true },
observationErrors: { ...prev.observationErrors, [id]: "" },
}));
try {
await readObservationStatus(scope);
} catch (err) {
if (!scope.stale()) {
updateScopedStore(targetKey, generation, (prev) => ({
observationErrors: {
...prev.observationErrors,
[id]:
err instanceof Error
? err.message
: "Unable to retrieve bit-miner process status.",
},
}));
}
} finally {
if (!scope.stale()) {
updateScopedStore(targetKey, generation, (prev) => ({
busyObservation: { ...prev.busyObservation, [id]: false },
}));
}
}
};
const streamAction = async (action, network) => {
const scope = observationScope(network);
if (!scope.valid) return;
const { id, targetKey, generation } = scope;
updateScopedStore(targetKey, generation, (prev) => ({
busyObservation: { ...prev.busyObservation, [id]: true },
observationErrors: { ...prev.observationErrors, [id]: "" },
}));
try {
const result = await apiRequest(scope.route, {
method: action === "start" ? "POST" : "DELETE",
});
if (scope.stale()) return;
appendStreamResult(
targetKey,
generation,
id,
⁠${action.toUpperCase()} observation response⁠,
result,
);
const status = await readObservationStatus(scope);
if (status === null) return;
appendStreamResult(
targetKey,
generation,
id,
action === "start" ? "Initial process status" : "Process status after stop",
status,
);
} catch (err) {
if (scope.stale()) return;
const failure = {
error:
err instanceof Error
? err.message
: "Bitcoin bit-miner request failed.",
};
appendStreamResult(
targetKey,
generation,
id,
⁠${action.toUpperCase()} request error⁠,
failure,
);
updateScopedStore(targetKey, generation, (prev) => ({
observationErrors: { ...prev.observationErrors, [id]: failure.error },
}));
} finally {
if (!scope.stale()) {
updateScopedStore(targetKey, generation, (prev) => ({
busyObservation: { ...prev.busyObservation, [id]: false },
}));
}
}
};
const saveBudget = async (network, draft) => {
const id = normalizeNetworkId(network.id);
const targetClip = activeClip;
const targetKey = clipKey;
const generation = lifecycleGenRef.current;
if (!id || !targetClip || !heritageState) return;
const stale = () => !isClipCurrent(targetKey, generation);
updateScopedStore(targetKey, generation, (prev) => ({
budgetErrors: { ...prev.budgetErrors, [id]: "" },
budgetNotices: { ...prev.budgetNotices, [id]: "" },
}));
const minEvents = Number(draft.min_events);
const maxEvents = Number(draft.max_events);
if (
!Number.isInteger(minEvents) ||
minEvents < 0 ||
!Number.isInteger(maxEvents) ||
maxEvents < 0
) {
updateScopedStore(targetKey, generation, (prev) => ({
budgetErrors: {
...prev.budgetErrors,
[id]: "Min events and max events must be non-negative integers.",
},
}));
return;
}
updateScopedStore(targetKey, generation, (prev) => ({
savingBudgets: { ...prev.savingBudgets, [id]: true },
}));
try {
await apiRequest(
⁠/wallets/${enc(targetClip.substrate)}/activations/${enc(targetClip.activation)}/networks/${enc(id)}/budgets⁠,
{
method: "PUT",
body: JSON.stringify({
min_events: minEvents,
max_events: maxEvents,
}),
},
);
if (stale()) return;
await loadBudgetsForClip(
targetClip,
targetKey,
generation,
scopedStore.derivedNetworks,
);
if (stale()) return;
updateScopedStore(targetKey, generation, (prev) => ({
budgetNotices: {
...prev.budgetNotices,
[id]: ⁠Saved budget (${minEvents} … ${maxEvents}).⁠,
},
}));
} catch (err) {
if (stale()) return;
updateScopedStore(targetKey, generation, (prev) => ({
budgetErrors: {
...prev.budgetErrors,
[id]:
err instanceof Error
? err.message
: "Unable to save network budget.",
},
}));
} finally {
if (!stale()) {
updateScopedStore(targetKey, generation, (prev) => ({
savingBudgets: { ...prev.savingBudgets, [id]: false },
}));
}
}
};
const activeLogViewer =
logViewer &&
activeClip &&
sameActiveClip(logViewer.clip, activeClip) &&
bitcoinSlots.some((slot) => slot.network?.id === logViewer.network)
? logViewer
: null;
const openBitMinerLogs = (network) => {
if (!activeClip || !network?.id) return;
setLogViewer({
clip: activeClip,
network: network.id,
});
};
const closeBitMinerLogs = useCallback(() => setLogViewer(null), []);
const eventsEmptyText = activeClip
? scopedStore.loadingEvent
? "Resolving persisted event for ActiveClip…"
: "No persisted event records matched this ActiveClip."
: "An ActiveClip ({ substrate, activation }) must be supplied.";
const emptyGroup = { transit_inputs: [], exile_outputs: [], unclassified: [] };
return (
<main className="min-h-screen bg-zinc-50 px-3 py-4 text-zinc-950 sm:px-6 sm:py-8 dark:bg-zinc-950 dark:text-zinc-50">
<style>{QTM_STYLES}</style>
<div
className="mx-auto flex w-full max-w-7xl flex-col gap-4"
inert={activeLogViewer ? true : undefined}
aria-hidden={activeLogViewer ? true : undefined}
>
{/* Header */}
<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
<div className="min-w-0">
<h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
QTM Event Store
</h1>
<p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500 sm:text-sm dark:text-zinc-400">
Single-ActiveClip persistent event storage, authoritative event
heritage state, derived networks, network budgets, payload boards,
Bitcoin observation, and API-owned wirepackets.
</p>
</div>
<div className="flex min-w-0 flex-col gap-2 sm:w-96">
{/* Navigation */}
<div className="grid grid-cols-2 gap-2">
<a href="/network" className={BUTTON}>
Network
</a>
<a
href={
activeClip
? ⁠/?clip=${encodeURIComponent(JSON.stringify(activeClip))}⁠
: "/"
}
className={BUTTON}
>
QTM
</a>
</div>
{/* ActiveClip summary */}
<div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
<span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
ActiveClip
</span>
<span className="mt-0.5 block truncate font-mono text-xs">
{activeClip
? ⁠${activeClip.substrate} · activation ${activeClip.activation}⁠
: "No ActiveClip"}
</span>
</div>
</div>
</header>
{/* Notifications */}
{scopedStore.error && <Notice>{scopedStore.error}</Notice>}
{scopedStore.notice && <Notice type="success">{scopedStore.notice}</Notice>}
{/* Overview */}
<Card
defaultOpen
title="Overview"
subtitle={
activeClip
? ⁠${activeClip.substrate} · Activation ${activeClip.activation}${ authoritativeRecord ? ⁠ · ${authoritativeRecord}⁠ : "" }⁠
: "No ActiveClip context"
}
badge={overviewBadge}
className="w-full"
>
<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
<Stat label="Clip substrate" value={activeClip ? activeClip.substrate : "—"} wide />
<Stat label="Clip activation" value={activeClip ? String(activeClip.activation) : "—"} />
<Stat label="Authoritative event" value={authoritativeRecord || "—"} wide />
<Stat
label="Heritage activation"
value={
heritageState
? String(activationFromHeritageState(heritageState) ?? "—")
: "—"
}
/>
<Stat label="Persisted clip events" value={scopedStore.eventRows.length} />
<Stat label="Derived networks" value={scopedStore.derivedNetworks.length} />
<Stat label="Retained mass" value={retainedMass.toString()} />
<Stat label="API base" value={API_BASE} wide />
{scopedStore.directory && (
<Stat label="Storage directory" value={scopedStore.directory} wide />
)}
{focusedEvent && (
<Stat label="Event kind" value={money(focusedEvent.kind)} />
)}
</div>
</Card>
{/* Bitcoin network cards */}
{bitcoinSlots.map((slot, index) => {
const id = slot.network?.id;
return (
<NetworkCard
key={id || ⁠placeholder-${slot.kind}⁠}
kind={slot.kind}
network={slot.network}
defaultOpen={index === 0}
index={index}
clip={heritageState ? activeClip : null}
budgetRow={id ? networkBudgetById.get(id) : undefined}
group={(id && payloadGroups.get(id)) || emptyGroup}
board={id ? scopedStore.boards[id] : undefined}
wire={id ? scopedStore.wirePackets[id] : undefined}
observation={id ? scopedStore.observations[id] : undefined}
observationError={id ? scopedStore.observationErrors[id] : ""}
busy={id ? scopedStore.busyObservation[id] === true : false}
results={(id && scopedStore.streamResults[id]) || []}
loadingBoard={id ? scopedStore.loadingBoards[id] === true : false}
loadingBudget={id ? scopedStore.loadingBudgets[id] === true : false}
savingBudget={id ? scopedStore.savingBudgets[id] === true : false}
loadingWire={id ? scopedStore.loadingWire[id] === true : false}
loadingObservation={id ? scopedStore.loadingObservations[id] === true : false}
budgetError={id ? scopedStore.budgetErrors[id] : ""}
budgetNotice={id ? scopedStore.budgetNotices[id] : ""}
onSaveBudget={saveBudget}
onStreamAction={streamAction}
onRefreshStream={refreshStream}
onViewLogs={openBitMinerLogs}
/>
);
})}
{/* Other chains */}
<SectionHeading title="Other chains" meta="derived from event heritage">
Derived non-Bitcoin networks for this ActiveClip alongside planned chain slots.
</SectionHeading>
<div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
{COIN_TYPES.filter((coin) => coin.key !== "bitcoin").map(
(coin, index) => {
const derivedCount = scopedStore.derivedNetworks.filter(
(network) => coinKey(network) === coin.key,
).length;
return (
<Card
key={coin.key}
title={coin.name}
subtitle={⁠coin type ${coin.type}⁠}
badge={
<Pill tone={derivedCount > 0 ? "ok" : "warn"}>
{derivedCount > 0
? ⁠${derivedCount} derived⁠
: "Planned"}
</Pill>
}
style={{ animationDelay: ⁠${index * 60}ms⁠ }}
>
<Fields min="7rem">
<Field label="Registry path">
<span className="break-all font-mono text-xs">
{coin.path}
</span>
</Field>
<Field label="Derived networks">{derivedCount}</Field>
</Fields>
</Card>
);
},
)}
</div>
{/* Diagnostics */}
<SectionHeading title="Diagnostics" />
{/* Persisted event records /}
<Card
defaultOpen
scroll
title="Persisted clip event records"
subtitle="Resolved directly from ActiveClip → event.heritage.state"
badge={<Pill>{scopedStore.eventRows.length}</Pill>}
className="w-full"
>
{/ Desktop table */}
<div className="hidden overflow-x-auto rounded-xl border border-zinc-200 lg:block dark:border-zinc-800">
<table className="w-full min-w-[850px] border-collapse text-left text-sm">
<thead className="bg-zinc-100 text-[10px] uppercase tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
<tr>
{[
"Activation",
"Event type",
"Record reference",
"Dimension",
"Structural value (Σ)",
"Depth objects",
"Retained mass",
].map((heading) => (
<th key={heading} className="px-4 py-3 font-semibold">
{heading}
</th>
))}
</tr>
</thead>
<tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
{scopedStore.eventRows.map((row, index) => {
const state = heritageStateOf(row);
const isFocused =
Boolean(authoritativeRecord) &&
recordOf(row) === authoritativeRecord;
return (
<tr
key={⁠${row?.record ?? "row"}-${index}⁠}
className={⁠align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${ isFocused ? "bg-emerald-50/60 dark:bg-emerald-950/30" : "" }⁠}
>
<td className="whitespace-nowrap px-4 py-3 font-mono">
{activationFromHeritage(row) ?? money(row?.activation)}
</td>
<td className="px-4 py-3">
{money(row?.kind)}
</td>
<td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-zinc-500">
{money(row?.record)}
{isFocused && (
<span className="ml-2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
authoritative
</span>
)}
</td>
<td className="break-all px-4 py-3 font-mono">
{money(row?.dimension ?? state?.dimension)}
</td>
<td className="break-all px-4 py-3 font-mono">
{money(
row?.structural_value ?? state?.structural_value,
)}
</td>
<td className="px-4 py-3">
{money(row?.depth_objects)}
</td>
<td className="break-all px-4 py-3 font-mono">
{money(row?.retained_mass ?? state?.retained_mass)}
</td>
</tr>
);
})}
{scopedStore.eventRows.length === 0 && (
<tr>
<td
colSpan={7}
className="px-4 py-10 text-center text-sm text-zinc-500"
>
{eventsEmptyText}
</td>
</tr>
)}
</tbody>
</table>
</div>
{/* Mobile cards */}
<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">
{scopedStore.eventRows.map((row, index) => {
const state = heritageStateOf(row);
const isFocused =
Boolean(authoritativeRecord) &&
recordOf(row) === authoritativeRecord;
return (
<article
key={⁠${row?.record ?? "row"}-card-${index}⁠}
className={⁠${INNER} p-3 ${ isFocused ? "ring-2 ring-emerald-400/60" : "" }⁠}
>
<div className="flex items-start justify-between gap-2">
<h4 className="min-w-0 break-all text-sm font-semibold">
{money(row?.kind)}
</h4>
<Pill>
Act. {activationFromHeritage(row) ?? money(row?.activation)}
</Pill>
</div>
<p className="mt-1 break-all font-mono text-[11px] text-zinc-500">
{money(row?.record)}
{isFocused && (
<span className="ml-2 text-[10px] font-semibold text-emerald-600">
authoritative
</span>
)}
</p>
<div className="mt-3">
<Fields min="7rem">
<Field label="Dimension">
{money(row?.dimension ?? state?.dimension)}
</Field>
<Field label="Structural value (Σ)">
{money(
row?.structural_value ?? state?.structural_value,
)}
</Field>
<Field label="Depth objects">
{money(row?.depth_objects)}
</Field>
<Field label="Retained mass">
{money(row?.retained_mass ?? state?.retained_mass)}
</Field>
</Fields>
</div>
</article>
);
})}
{scopedStore.eventRows.length === 0 && (
<p className="col-span-full rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
{eventsEmptyText}
</p>
)}
</div>
</Card>
{/* Footer */}
<footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
QTM Event Store · {API_BASE}
</footer>
</div>
{/* BitMiner log viewer */}
{activeLogViewer && (
<BitMinerLogPopup
key={⁠${activeLogViewer.clip.substrate}|${activeLogViewer.clip.activation}|${activeLogViewer.network}⁠}
clip={activeLogViewer.clip}
network={activeLogViewer.network}
running={scopedStore.observations[activeLogViewer.network]?.running === true}
onClose={closeBitMinerLogs}
onRefreshStatus={() =>
refreshStream({ id: activeLogViewer.network })
}
/>
)}
</main>
);
}
function EventStoreRouteBoundary() {
const searchParams = useSearchParams();
const clip = useMemo(() => {
const raw = searchParams.get("clip");
if (!raw) return null;
try {
return createActiveClip(JSON.parse(raw));
} catch {
return null;
}
}, [searchParams]);
return <EventStoreView clip={clip} />;
}
export default function EventStorePage({ clip }) {
if (clip !== undefined) {
return <EventStoreView clip={clip} />;
}
return (
<Suspense
fallback={
<main className="min-h-screen bg-zinc-50 px-3 py-4 text-zinc-950 sm:px-6 sm:py-8 dark:bg-zinc-950 dark:text-zinc-50">
<div className="mx-auto w-full max-w-7xl">
<p className="text-sm text-zinc-500">
Loading QTM Event Store…
</p>
</div>
</main>
}
>
<EventStoreRouteBoundary />
</Suspense>
);
}