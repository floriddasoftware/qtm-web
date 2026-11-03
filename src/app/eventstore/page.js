"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api-hxcs.onrender.com"
).replace(/\/+$/, "");

const U128_MAX = 340282366920938463463374607431768211455n;

// Mirrors QTM/src/pathsregistry.rs (CoinType + PathsRegistry::get_path).
// Each coin maps to exactly one PayloadKind in qtm-api/src/payload.rs.
const COIN_TYPES = [
  { key: "bitcoin", name: "Bitcoin", symbol: "BTC", type: 0, path: "m/44'/0'/0'/0/0" },
  { key: "ethereum", name: "Ethereum", symbol: "ETH", type: 60, path: "m/44'/60'/0'/0/0" },
  { key: "solana", name: "Solana", symbol: "SOL", type: 501, path: "m/44'/501'/0'/0'" },
  { key: "tron", name: "Tron", symbol: "TRX", type: 195, path: "m/44'/195'/0'/0/0" },
];

// Bitcoin is the only PayloadKind with two address types.
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
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
.qtm-pop { animation: qtm-pop 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
@media (prefers-reduced-motion: reduce) { .qtm-pop { animation: none; } }
`;

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

function activationFromEvent(event) {
  const value =
    event?.activation ??
    event?.heritage?.state?.activation_count ??
    event?.manifold?.activations;
  return value === undefined || value === null || !/^\d+$/.test(String(value))
    ? null
    : String(value);
}

function normalizeNetwork(network) {
  if (!network || typeof network.id !== "string") return null;
  return {
    id: network.id,
    name: network.name || network.id,
    coin: network.coin,
    purpose: network.purpose,
    path: network.path,
    registered: network.registered,
  };
}

function normalizePayload(entry, fallbackRecord) {
  const network = normalizeNetwork(entry?.network);
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

function networkKey(network) {
  return network?.id || "";
}

// Maps an API network to a registry coin key (bitcoin / ethereum / solana / tron / other).
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
  const match = String(network.path ?? "").match(/^m\/\d+'?\/(\d+)'?/);
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
  const text = `${network.id} ${network.name} ${network.path || ""}`.toLowerCase();
  const purpose = String(network.purpose ?? "");
  if (purpose === "84" || /segwit|bech32|p2wpkh|84'/.test(text)) return "segwit";
  if (purpose === "44" || /legacy|p2pkh|44'/.test(text)) return "legacy";
  return "other";
}

// payload-board returns one entry per PayloadKind (Bitcoin, Ethereum, Solana, Tron).
// A network only ever shows the single kind that belongs to its own chain.
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

function parseU128(value, label) {
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a non-negative whole number.`);
  const parsed = BigInt(raw);
  if (parsed > U128_MAX) throw new Error(`${label} exceeds u128.`);
  return parsed.toString();
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
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}
    >
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
    <p
      role={type === "error" ? "alert" : "status"}
      className={`qtm-pop break-words rounded-xl border px-3 py-2 text-xs leading-5 ${styles}`}
    >
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
    <dl
      className="grid gap-x-4 gap-y-3"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))` }}
    >
      {children}
    </dl>
  );
}

function Stat({ label, value, wide = false }) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60 ${
        wide ? "col-span-2" : ""
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 break-all text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Collapsible({ open, children }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${
        open ? "visible grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}

// Every card folds and drops down. Body height is capped when `scroll` is set
// so tall content never stretches a card into a vertical strip.
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
    <section style={style} className={`${inner ? INNER : OUTER} ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-3 text-left ${inner ? "px-3 py-2.5" : "px-4 py-3.5"}`}
      >
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate font-semibold ${
              inner
                ? "text-[11px] uppercase tracking-wider text-zinc-600 dark:text-zinc-300"
                : "text-sm"
            }`}
          >
            {title}
          </span>
          {subtitle && (
            <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {subtitle}
            </span>
          )}
        </span>
        {badge}
        <span
          aria-hidden="true"
          className={`shrink-0 text-zinc-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      <Collapsible open={open}>
        <div
          className={`border-t border-zinc-200/80 dark:border-zinc-800 ${inner ? "p-3" : "p-4"} ${
            scroll ? "max-h-80 overflow-y-auto overscroll-contain" : ""
          }`}
        >
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
      <Field label="Max retained mass">{money(budget?.max_retained_mass)}</Field>
    </Fields>
  );
}

function BudgetEditor({ budget, disabled, onSave }) {
  const toDraft = () => ({
    min_events: String(budget?.min_events ?? 0),
    max_events: String(budget?.max_events ?? 1024),
    max_retained_mass: String(budget?.max_retained_mass ?? 1048576),
  });
  const [draft, setDraft] = useState(toDraft);

  useEffect(() => {
    setDraft(toDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget?.min_events, budget?.max_events, budget?.max_retained_mass]);

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
        ["max_retained_mass", "Max retained mass (u128)"],
      ].map(([key, label]) => (
        <label
          key={key}
          className={`block min-w-0 ${key === "max_retained_mass" ? "sm:col-span-2" : ""}`}
        >
          <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {label}
          </span>
          <input
            className={INPUT}
            inputMode="numeric"
            value={draft[key]}
            disabled={disabled}
            onChange={(event) =>
              setDraft((current) => ({ ...current, [key]: event.target.value }))
            }
          />
        </label>
      ))}
      <div className="sm:col-span-2">
        <button className={`${BUTTON} w-full sm:w-auto`} type="submit" disabled={disabled}>
          Save network budget
        </button>
      </div>
    </form>
  );
}

// Shows only the network's own PayloadKind (one per chain; Bitcoin covers Legacy and SegWit).
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
          <Field label="Commitment">
            <span className="break-all font-mono text-xs">{money(board.commitment)}</span>
          </Field>
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
        <p className="text-xs text-zinc-500">
          The API returned no payload kind for this network&apos;s chain.
        </p>
      )}
    </div>
  );
}

function StreamBody({ status, busy, results, network, onAction, onRefresh }) {
  const running = status?.running === true;

  return (
    <div className="space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Pill tone={running ? "ok" : "warn"}>
          {running ? "Running" : status?.running === false ? "Stopped" : "Unknown"}
        </Pill>

        {status?.pid && (
          <span className="text-xs text-zinc-500">
            PID {status.pid}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className={`${BUTTON} w-full min-w-0 px-2 text-xs whitespace-nowrap`}
          disabled={busy || running}
          onClick={() => onAction("start", network)}
        >
          {busy ? "Working…" : "Start"}
        </button>

        <button
          type="button"
          className={`${BUTTON} w-full min-w-0 px-2 text-xs whitespace-nowrap`}
          disabled={busy}
          onClick={() => onRefresh(network)}
        >
          Refresh
        </button>

        <button
          type="button"
          className={`${BUTTON} w-full min-w-0 px-2 text-xs whitespace-nowrap`}
          disabled={busy || !running}
          onClick={() => onAction("stop", network)}
        >
          Stop
        </button>
      </div>

      {status?.error && <Notice>{status.error}</Notice>}

      {status?.path && (
        <p className="break-all font-mono text-[10px] text-zinc-500">
          Event path: {status.path}
        </p>
      )}

      {status?.log_path && (
        <p className="break-all font-mono text-[10px] text-zinc-500">
          Process log: {status.log_path}
        </p>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            BitMiner responses
          </h5>

          <span className="text-[10px] tabular-nums text-zinc-500">
            {results.length}
          </span>
        </div>

        <div
          aria-live="polite"
          aria-label="Bitcoin bit-miner API responses"
          className="mt-2 max-h-56 space-y-2 overflow-y-auto overscroll-contain rounded-xl bg-white p-2 dark:bg-zinc-900"
        >
          {results.map((entry) => (
            <div
              key={entry.id}
              className="border-b border-zinc-200 pb-2 last:border-0 last:pb-0 dark:border-zinc-800"
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                <span className="min-w-0 break-words font-semibold">
                  {entry.label}
                </span>

                <time className="shrink-0">{entry.time}</time>
              </div>

              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] leading-4 text-zinc-700 dark:text-zinc-300">
                {JSON.stringify(entry.body, null, 2)}
              </pre>
            </div>
          ))}

          {results.length === 0 && (
            <p className="py-2 text-xs text-zinc-500">
              Start bit-miner to launch its window loop. Refresh checks
              process status without adding another response entry.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function WirePacketsBody({ metadata, loading }) {
  const route = metadata?.file_route;
  const href = route ? `${API_BASE}${route.startsWith("/") ? route : `/${route}`}` : null;
  if (loading && !metadata) return <p className="text-xs text-zinc-500">Loading…</p>;
  if (!metadata) return <p className="text-xs text-zinc-500">No wirepackets response yet.</p>;
  return (
    <div className="space-y-3">
      <Fields min="7rem">
        <Field label="Scope">{money(metadata.scope)}</Field>
        <Field label="Bytes">
          {metadata.bytes == null ? "Not reported" : Number(metadata.bytes).toLocaleString()}
        </Field>
      </Fields>
      {metadata.path && (
        <p className="break-all font-mono text-[11px] text-zinc-500">{metadata.path}</p>
      )}
      {href ? (
        <a className={`${BUTTON} w-full`} href={href} target="_blank" rel="noreferrer">
          Open persisted wirepackets file
        </a>
      ) : (
        <p className="text-xs text-zinc-500">The API has not returned a file route.</p>
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
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="mt-2 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Depth objects
            <span
              aria-hidden="true"
              className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </button>
          <Collapsible open={open}>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] text-zinc-500">
              {JSON.stringify(payload.objects, null, 2)}
            </pre>
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
  if (sections.length === 0) {
    return <p className="text-xs text-zinc-500">No payload records for this network.</p>;
  }
  return (
    <div className="space-y-4">
      {sections.map(([title, rows]) => (
        <div key={title}>
          <h5 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {title} <Pill>{rows.length}</Pill>
          </h5>
          <div className="grid gap-2">
            {rows.map((payload) => (
              <PayloadItem key={payloadRowKey(payload)} payload={payload} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NetworkCard({
  kind,
  network,
  defaultOpen,
  index,
  activation,
  budgetRow,
  group,
  board,
  wire,
  observation,
  busy,
  results,
  loadingBoards,
  loadingBudgets,
  loadingWire,
  budgetError,
  budgetNotice,
  onSaveBudget,
  onStreamAction,
  onRefreshStream,
}) {
  const meta = BITCOIN_KINDS[kind];
  const style = { animationDelay: `${Math.min(index, 6) * 60}ms` };

  if (!network) {
    return (
      <Card
        title={meta.label}
        subtitle={meta.note}
        badge={<Pill tone="warn">Not registered</Pill>}
        style={style}
      >
        <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          The API has not returned a {meta.label} network for this activation yet. It will appear
          here as soon as it is registered.
        </p>
      </Card>
    );
  }

  const budget = budgetRow?.budget || null;
  const configured = Boolean(budgetRow?.configured && budget);
  const payloadKind = ownPayloadKind(board, network);
  const payloadTotal =
    group.transit_inputs.length + group.exile_outputs.length + group.unclassified.length;

  return (
    <Card
      title={kind === "other" ? network.name : meta.label}
      subtitle={network.id}
      badge={<Pill tone={configured ? "ok" : "neutral"}>{configured ? "Budget set" : "No budget"}</Pill>}
      defaultOpen={defaultOpen}
      style={style}
    >
      <div className="space-y-3">
        <Fields min="7rem">
          <Field label="Purpose">{money(network.purpose)}</Field>
          <Field label="Derivation path">
            <span className="break-all font-mono text-xs">{money(network.path)}</span>
          </Field>
        </Fields>

        <Card
          inner
          defaultOpen
          title={`Network budget · activation ${activation}`}
          badge={loadingBudgets ? <Pill>Loading</Pill> : null}
        >
          <BudgetSummary budget={budget} />
          <BudgetEditor budget={budget} disabled={loadingBudgets} onSave={(draft) => onSaveBudget(network, draft)} />
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

        <Card
          inner
          scroll
          title="Payload board"
          badge={
            <Pill tone={payloadKind?.available ? "ok" : "neutral"}>
              {payloadKind ? (payloadKind.available ? "Available" : "Unavailable") : "None"}
            </Pill>
          }
        >
          <PayloadBoard board={board} kind={payloadKind} loading={loadingBoards} />
        </Card>

        <Card
          inner
          title="Bit-miner"
          badge={
            <Pill tone={observation?.running === true ? "ok" : "neutral"}>
              {observation?.running === true ? "Running" : "Idle"}
            </Pill>
          }
        >
          <StreamBody
            status={observation}
            busy={busy}
            results={results}
            network={network}
            onAction={onStreamAction}
            onRefresh={onRefreshStream}
          />
        </Card>

        <Card
          inner
          title="Wirepackets file"
          badge={<Pill tone={wire?.exists ? "ok" : "neutral"}>{wire?.exists ? "Present" : "None"}</Pill>}
        >
          <WirePacketsBody metadata={wire} loading={loadingWire} />
        </Card>

        <Card inner scroll title="Payload records" badge={<Pill>{payloadTotal}</Pill>}>
          <PayloadRecordsBody group={group} />
        </Card>
      </div>
    </Card>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export default function EventStorePage() {
  const [substrates, setSubstrates] = useState([]);
  const [substrate, setSubstrate] = useState("");
  const [activation, setActivation] = useState("");
  const [events, setEvents] = useState([]);
  const [networks, setNetworks] = useState([]);
  const [payloads, setPayloads] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [boards, setBoards] = useState({});
  const [wirePackets, setWirePackets] = useState({});
  const [observations, setObservations] = useState({});
  const [busyObservation, setBusyObservation] = useState({});
  const [streamResults, setStreamResults] = useState({});
  const [loadingList, setLoadingList] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingPayloads, setLoadingPayloads] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [loadingWire, setLoadingWire] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [budgetErrors, setBudgetErrors] = useState({});
  const [budgetNotices, setBudgetNotices] = useState({});
  const [store, setStore] = useState(null);

  const selectedSubstrateRef = useRef("");
  const selectedActivationRef = useRef("");
  const payloadRequestRef = useRef(0);
  const scopeRequestRef = useRef(0);

  const selectedEvents = useMemo(
    () => events.filter((event) => activationFromEvent(event) === String(activation)),
    [events, activation],
  );

  const retainedMass = useMemo(
    () =>
      selectedEvents.reduce((sum, event) => {
        const value = event?.retained_mass ?? event?.heritage?.state?.retained_mass ?? "0";
        return /^\d+$/.test(String(value)) ? sum + BigInt(value) : sum;
      }, 0n),
    [selectedEvents],
  );

  const payloadGroups = useMemo(() => {
    const groups = new Map();
    for (const payload of payloads) {
      const id = payload.network.id;
      if (!groups.has(id)) {
        groups.set(id, { transit_inputs: [], exile_outputs: [], unclassified: [] });
      }
      groups.get(id)[payload.direction].push(payload);
    }
    return groups;
  }, [payloads]);

  const networkBudgetById = useMemo(() => {
    const result = new Map();
    for (const row of budgets) {
      const network = normalizeNetwork(row.network);
      if (network) result.set(network.id, row);
    }
    return result;
  }, [budgets]);

  const activationOptions = useMemo(() => {
    const values = new Set(events.map(activationFromEvent).filter(Boolean));
    if (activation) values.add(String(activation));
    if (!values.size) values.add("0");
    return [...values].sort((a, b) => Number(b) - Number(a));
  }, [events, activation]);

  // One entry per network id (API networks first, then payload-only networks).
  const renderedNetworks = useMemo(() => {
    const byId = new Map(networks.map((network) => [network.id, network]));
    for (const payload of payloads) {
      if (!byId.has(payload.network.id)) byId.set(payload.network.id, payload.network);
    }
    return [...byId.values()];
  }, [networks, payloads]);

  // Bitcoin slots: Legacy, then SegWit, then any other Bitcoin network. Missing ones are placeholders.
  const bitcoinSlots = useMemo(() => {
    const buckets = { legacy: [], segwit: [], other: [] };
    for (const network of renderedNetworks) {
      if (bitcoinNetwork(network)) buckets[bitcoinKind(network)].push(network);
    }
    const slots = [];
    for (const kind of ["legacy", "segwit"]) {
      if (buckets[kind].length === 0) slots.push({ kind, network: null });
      else buckets[kind].forEach((network) => slots.push({ kind, network }));
    }
    buckets.other.forEach((network) => slots.push({ kind: "other", network }));
    return slots;
  }, [renderedNetworks]);

  const configuredCount = budgets.filter((row) => row.configured && row.budget).length;
  const anyLoading =
    loadingEvents || loadingBudgets || loadingPayloads || loadingBoards || loadingWire;

  const loadPayloadsForEvents = useCallback(async (name, eventRows, activationValue) => {
    const selectedActivation = String(activationValue);
    const scopedEvents = Array.isArray(eventRows)
      ? eventRows.filter((event) => activationFromEvent(event) === selectedActivation)
      : [];

    if (!name || !/^\d+$/.test(selectedActivation) || scopedEvents.length === 0) {
      payloadRequestRef.current += 1;
      setPayloads([]);
      setLoadingPayloads(false);
      return [];
    }

    const requestId = ++payloadRequestRef.current;
    setLoadingPayloads(true);

    try {
      const records = [
        ...new Set(
          scopedEvents
            .map((event) => event?.record)
            .filter((record) => typeof record === "string" && record.length > 0),
        ),
      ];

      const results = await Promise.allSettled(
        records.map((record) =>
          apiRequest(`/wallets/${enc(name)}/events/${enc(record)}/payloads`),
        ),
      );

      if (
        requestId !== payloadRequestRef.current ||
        selectedSubstrateRef.current !== name ||
        selectedActivationRef.current !== selectedActivation
      ) {
        return null;
      }

      // De-duplicate by record + network + path + depth identifier.
      const unique = new Map();
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const rows = Array.isArray(result.value?.payloads) ? result.value.payloads : [];
        rows.forEach((entry) => {
          const normalized = normalizePayload(entry, records[index]);
          if (!normalized) return;
          const key = payloadRowKey(normalized);
          if (!unique.has(key)) unique.set(key, normalized);
        });
      });
      const collected = [...unique.values()];
      setPayloads(collected);
      return collected;
    } catch (err) {
      if (
        requestId === payloadRequestRef.current &&
        selectedSubstrateRef.current === name &&
        selectedActivationRef.current === selectedActivation
      ) {
        setPayloads([]);
        setError(
          `Unable to load payload render data: ${err instanceof Error ? err.message : "unknown API error"}`,
        );
      }
      return null;
    } finally {
      if (requestId === payloadRequestRef.current) setLoadingPayloads(false);
    }
  }, []);

  const loadEvents = useCallback(
    async (name, activationValue) => {
      if (!name) return;
      const selected = String(activationValue);
      const requestId = ++scopeRequestRef.current;
      setLoadingEvents(true);
      setError("");
      try {
        const eventBody = await apiRequest(`/wallets/${enc(name)}/events`);
        if (requestId !== scopeRequestRef.current || selectedSubstrateRef.current !== name) return;
        const nextEvents = Array.isArray(eventBody?.events) ? eventBody.events : [];
        setEvents(nextEvents);
        setStore(eventBody);
        await loadPayloadsForEvents(name, nextEvents, selected);
      } catch (err) {
        if (requestId === scopeRequestRef.current) {
          setEvents([]);
          setPayloads([]);
          setError(err instanceof Error ? err.message : "Unable to load events.");
        }
      } finally {
        if (requestId === scopeRequestRef.current) setLoadingEvents(false);
      }
    },
    [loadPayloadsForEvents],
  );

  const loadBudgets = useCallback(async (name, activationValue) => {
    if (!name || !/^\d+$/.test(String(activationValue))) return;
    const selected = String(activationValue);
    try {
      const body = await apiRequest(
        `/wallets/${enc(name)}/activations/${enc(selected)}/budgets`,
      );
      if (selectedSubstrateRef.current !== name || selectedActivationRef.current !== selected) return;
      const rows = Array.isArray(body?.budgets) ? body.budgets : [];
      setBudgets(rows.filter((row) => row?.activation == null || String(row.activation) === selected));
    } catch (err) {
      if (selectedSubstrateRef.current === name && selectedActivationRef.current === selected) {
        setBudgets([]);
        setError(
          `Unable to load network budgets: ${err instanceof Error ? err.message : "API error"}`,
        );
      }
    } finally {
      if (selectedSubstrateRef.current === name && selectedActivationRef.current === selected) {
        setLoadingBudgets(false);
      }
    }
  }, []);

  const loadNetworkData = useCallback(async (name, activationValue, networkRows) => {
    if (!name || !/^\d+$/.test(String(activationValue))) return;
    const selected = String(activationValue);
    const requestId = ++scopeRequestRef.current;
    const activeNetworks = (networkRows || []).map(normalizeNetwork).filter(Boolean);
    setLoadingBoards(true);
    setLoadingWire(true);

    const boardResults = await Promise.allSettled(
      activeNetworks.map((network) =>
        apiRequest(
          `/wallets/${enc(name)}/activations/${enc(selected)}/networks/${enc(network.id)}/payload-board`,
        ),
      ),
    );
    if (
      requestId !== scopeRequestRef.current ||
      selectedSubstrateRef.current !== name ||
      selectedActivationRef.current !== selected
    ) {
      return;
    }

    const nextBoards = {};
    boardResults.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const body = result.value;
      if (body?.activation != null && String(body.activation) !== selected) return;
      nextBoards[activeNetworks[index].id] = body;
    });
    setBoards(nextBoards);
    setLoadingBoards(false);

    const btcNetworks = activeNetworks.filter(bitcoinNetwork);
    const wireResults = await Promise.allSettled(
      btcNetworks.map((network) =>
        apiRequest(
          `/wallets/${enc(name)}/activations/${enc(selected)}/networks/${enc(network.id)}/wirepackets`,
        ),
      ),
    );
    if (
      requestId !== scopeRequestRef.current ||
      selectedSubstrateRef.current !== name ||
      selectedActivationRef.current !== selected
    ) {
      return;
    }

    const nextWire = {};
    wireResults.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const metadata = result.value;
      if (metadata?.activation != null && String(metadata.activation) !== selected) return;
      nextWire[btcNetworks[index].id] = metadata;
    });
    setWirePackets(nextWire);
    setLoadingWire(false);
  }, []);

  const loadObservationStatuses = useCallback(async (name, activationValue, networkRows) => {
    if (!name || !/^\d+$/.test(String(activationValue))) return;
    const selected = String(activationValue);
    const btcNetworks = (networkRows || []).map(normalizeNetwork).filter(bitcoinNetwork);
    const results = await Promise.allSettled(
      btcNetworks.map((network) =>
        apiRequest(
          `/wallets/${enc(name)}/activations/${enc(selected)}/networks/${enc(network.id)}/observation`,
        ),
      ),
    );
    if (selectedSubstrateRef.current !== name || selectedActivationRef.current !== selected) return;
    const next = {};
    results.forEach((result, index) => {
      if (result.status === "fulfilled") next[btcNetworks[index].id] = result.value;
    });
    setObservations(next);
  }, []);

  const loadAll = useCallback(
    async (name, activationValue, networkRows = []) => {
      if (!name || !/^\d+$/.test(String(activationValue))) return;
      const selected = String(activationValue);
      selectedSubstrateRef.current = name;
      selectedActivationRef.current = selected;
      setLoadingBudgets(true);
      setError("");
      await Promise.all([
        loadBudgets(name, selected),
        loadNetworkData(name, selected, networkRows),
        loadObservationStatuses(name, selected, networkRows),
      ]);
    },
    [loadBudgets, loadNetworkData, loadObservationStatuses],
  );

  const loadInitial = useCallback(async () => {
    setLoadingList(true);
    try {
      const [walletBody, networkBody] = await Promise.all([
        apiRequest("/wallets"),
        apiRequest("/networks"),
      ]);
      const walletRows = Array.isArray(walletBody?.substrates) ? walletBody.substrates : [];
      const networkRows = (Array.isArray(networkBody?.networks) ? networkBody.networks : [])
        .map(normalizeNetwork)
        .filter(Boolean);
      setSubstrates(walletRows);
      setNetworks(networkRows);
      const initialName = walletRows[0]?.name || "";
      if (initialName) {
        setSubstrate(initialName);
        selectedSubstrateRef.current = initialName;
        const initialActivation = String(walletRows[0]?.activations ?? "0");
        const safeActivation = /^\d+$/.test(initialActivation) ? initialActivation : "0";
        setActivation(safeActivation);
        selectedActivationRef.current = safeActivation;
        await loadEvents(initialName, safeActivation);
        await loadAll(initialName, safeActivation, networkRows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to initialize Event Store.");
    } finally {
      setLoadingList(false);
    }
  }, [loadAll, loadEvents]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const chooseSubstrate = async (name) => {
    selectedSubstrateRef.current = name;
    selectedActivationRef.current = "";
    scopeRequestRef.current += 1;
    payloadRequestRef.current += 1;
    setSubstrate(name);
    setActivation("");
    setEvents([]);
    setPayloads([]);
    setBudgets([]);
    setBoards({});
    setWirePackets({});
    setObservations({});
    setStreamResults({});
    setStore(null);
    setError("");
    setNotice("");
    if (!name) return;
    try {
      const substrateRow = substrates.find((entry) => entry.name === name);
      const rawActivation = String(substrateRow?.activations ?? "0");
      const selected = /^\d+$/.test(rawActivation) ? rawActivation : "0";
      setActivation(selected);
      selectedActivationRef.current = selected;
      await loadEvents(name, selected);
      await loadAll(name, selected, networks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open substrate.");
    }
  };

  function chooseActivation(value) {
    if (!/^\d+$/.test(String(value))) return;
    const selected = String(value);
    selectedActivationRef.current = selected;
    scopeRequestRef.current += 1;
    payloadRequestRef.current += 1;
    setActivation(selected);
    setBudgets([]);
    setWirePackets({});
    setBoards({});
    setObservations({});
    setStreamResults({});
    setPayloads([]);
    setError("");
    setNotice("");
    setBudgetErrors({});
    setBudgetNotices({});
    loadPayloadsForEvents(substrate, events, selected);
    loadAll(substrate, selected, networks);
  }

  const refreshAll = async () => {
  if (!substrate || !/^\d+$/.test(String(activation))) return;

  const selected = String(activation);

  await Promise.all([
    loadEvents(substrate, selected),
    loadBudgets(substrate, selected),
    loadNetworkData(substrate, selected, networks),
  ]);

  setNotice("Event Store refreshed.");
};

  const saveBudget = async (network, draft) => {
    const key = networkKey(network);
    setBudgetErrors((current) => ({ ...current, [key]: "" }));
    setBudgetNotices((current) => ({ ...current, [key]: "" }));
    try {
      const body = {
        min_events: Number(draft.min_events),
        max_events: Number(draft.max_events),
        max_retained_mass: parseU128(draft.max_retained_mass, "Maximum retained mass"),
      };
      if (!Number.isSafeInteger(body.min_events) || body.min_events < 0) {
        throw new Error("Minimum events must be a non-negative safe integer.");
      }
      if (!Number.isSafeInteger(body.max_events) || body.max_events < 0) {
        throw new Error("Maximum events must be a non-negative safe integer.");
      }
      await apiRequest(
        `/wallets/${enc(substrate)}/activations/${enc(activation)}/budgets/${enc(network.id)}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      setBudgetNotices((current) => ({ ...current, [key]: "Network budget saved." }));
      await loadBudgets(substrate, activation);
    } catch (err) {
      setBudgetErrors((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Unable to save network budget.",
      }));
    }
  };

  const appendStreamResult = (networkId, label, body) => {
    setStreamResults((current) => ({
      ...current,
      [networkId]: [
        ...(current[networkId] || []),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          label,
          time: new Date().toLocaleTimeString(),
          body,
        },
      ].slice(-60),
    }));
  };

  // One explicit status request. Never called on a timer.
 const refreshStream = async (network) => {
  const id = network.id;
  const route = `/wallets/${enc(substrate)}/activations/${enc(activation)}/networks/${enc(id)}/observation`;

  setBusyObservation((current) => ({
    ...current,
    [id]: true,
  }));

  try {
    const status = await apiRequest(route);

    setObservations((current) => ({
      ...current,
      [id]: status,
    }));
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Unable to retrieve bit-miner process status.",
    );
  } finally {
    setBusyObservation((current) => ({
      ...current,
      [id]: false,
    }));
  }
};

  // Start: one POST, one initial status GET, one payload-board + wirepackets fetch.
  // Stop: one DELETE. No polling.
  const streamAction = async (action, network) => {
    const id = network.id;
    const route = `/wallets/${enc(substrate)}/activations/${enc(activation)}/networks/${enc(id)}/observation`;

    setBusyObservation((current) => ({ ...current, [id]: true }));

    try {
      const result = await apiRequest(route, {
        method: action === "start" ? "POST" : "DELETE",
      });

      appendStreamResult(id, `${action.toUpperCase()} observation response`, result);
      setObservations((current) => ({ ...current, [id]: result }));

      if (action === "start") {
        const status = await apiRequest(route);
        appendStreamResult(id, "Initial process status", status);
        setObservations((current) => ({ ...current, [id]: status }));

        const [board, wire] = await Promise.all([
          apiRequest(
            `/wallets/${enc(substrate)}/activations/${enc(activation)}/networks/${enc(id)}/payload-board`,
          ),
          apiRequest(
            `/wallets/${enc(substrate)}/activations/${enc(activation)}/networks/${enc(id)}/wirepackets`,
          ),
        ]);

        setBoards((current) => ({ ...current, [id]: board }));
        setWirePackets((current) => ({ ...current, [id]: wire }));
      }

      setNotice(result?.message || `Bitcoin bit-miner ${action} request completed.`);
    } catch (err) {
      const failure = {
        error: err instanceof Error ? err.message : "Bitcoin bit-miner request failed.",
      };
      appendStreamResult(id, `${action.toUpperCase()} request error`, failure);
      setError(failure.error);
    } finally {
      setBusyObservation((current) => ({ ...current, [id]: false }));
    }
  };

  const eventsEmptyText = loadingEvents
    ? "Loading persisted events…"
    : substrate
      ? "No persisted event records were returned."
      : "Select a substrate to inspect persisted records.";

  const emptyGroup = { transit_inputs: [], exile_outputs: [], unclassified: [] };

  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-4 text-zinc-950 sm:px-6 sm:py-8 dark:bg-zinc-950 dark:text-zinc-50">
      <style>{QTM_STYLES}</style>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">QTM Event Store</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500 sm:text-sm dark:text-zinc-400">
              Persisted substrate events, activation-scoped payloads, network budgets, payload
              boards, Bitcoin observation and API-owned wirepackets.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <a href="/network" className={BUTTON}>
              Network
            </a>
            <a href="/" className={BUTTON}>
              QTM
            </a>
            <button
              type="button"
              className={BUTTON}
              disabled={!substrate || anyLoading}
              onClick={refreshAll}
            >
              {anyLoading ? "Syncing…" : "Refresh"}
            </button>
          </div>
        </header>

        {error && <Notice>{error}</Notice>}
        {notice && <Notice type="success">{notice}</Notice>}

        <Card
          defaultOpen
          title="Overview"
          subtitle={substrate ? `${substrate} · activation ${activation || "—"}` : "No substrate selected"}
          badge={anyLoading ? <Pill>Syncing</Pill> : <Pill tone="ok">Ready</Pill>}
          className="w-full"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Persistent substrate
              </span>
              <select
                className={INPUT}
                value={substrate}
                disabled={loadingList}
                onChange={(event) => chooseSubstrate(event.target.value)}
              >
                <option value="">{loadingList ? "Loading substrates…" : "Select substrate"}</option>
                {substrates.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Activation
              </span>
              <select
                className={INPUT}
                value={activation}
                disabled={!substrate}
                onChange={(event) => chooseActivation(event.target.value)}
              >
                {activationOptions.map((value) => (
                  <option key={value} value={value}>
                    Activation {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Events" value={selectedEvents.length} />
            <Stat label="All events" value={events.length} />
            <Stat label="Payloads" value={payloads.length} />
            <Stat label="Budgets set" value={`${configuredCount} / ${networks.length}`} />
            <Stat label="Retained mass" value={retainedMass.toString()} />
            <Stat label="API base" value={API_BASE} wide />
            {store?.directory && <Stat label="Substrate directory" value={store.directory} wide />}
          </div>
        </Card>

        <SectionHeading title="Bitcoin" meta={`coin type ${COIN_TYPES[0].type}`}>
          Legacy and SegWit share the single Bitcoin payload kind.
        </SectionHeading>
        {loadingPayloads && <p className="px-1 text-xs text-zinc-500">Rendering payload records…</p>}
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
          {bitcoinSlots.map((slot, index) => {
            const id = slot.network?.id;
            return (
              <NetworkCard
                key={id || `placeholder-${slot.kind}`}
                kind={slot.kind}
                network={slot.network}
                defaultOpen={index === 0}
                index={index}
                activation={activation}
                budgetRow={id ? networkBudgetById.get(id) : undefined}
                group={(id && payloadGroups.get(id)) || emptyGroup}
                board={id ? boards[id] : undefined}
                wire={id ? wirePackets[id] : undefined}
                observation={id ? observations[id] : undefined}
                busy={id ? busyObservation[id] === true : false}
                results={(id && streamResults[id]) || []}
                loadingBoards={loadingBoards}
                loadingBudgets={loadingBudgets}
                loadingWire={loadingWire}
                budgetError={id ? budgetErrors[id] : ""}
                budgetNotice={id ? budgetNotices[id] : ""}
                onSaveBudget={saveBudget}
                onStreamAction={streamAction}
                onRefreshStream={refreshStream}
              />
            );
          })}
        </div>

        <SectionHeading title="Other chains" meta="not yet implemented">
          One payload kind each, from the paths registry. Placeholders until wired up.
        </SectionHeading>
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {COIN_TYPES.filter((coin) => coin.key !== "bitcoin").map((coin, index) => {
            const registered = networks.filter((network) => coinKey(network) === coin.key).length;
            return (
              <Card
                key={coin.key}
                title={coin.name}
                subtitle={`coin type ${coin.type}`}
                badge={<Pill tone="warn">Planned</Pill>}
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <Fields min="7rem">
                  <Field label="Registry path">
                    <span className="break-all font-mono text-xs">{coin.path}</span>
                  </Field>
                  <Field label="API networks">{registered}</Field>
                </Fields>
              </Card>
            );
          })}
        </div>

        <SectionHeading title="Diagnostics" />
        <Card
          scroll
          title="Persisted event records"
          subtitle="GET /wallets/:name/events"
          badge={<Pill>{events.length}</Pill>}
          className="w-full"
        >
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
                {events.map((event, index) => {
                  const state = event?.heritage?.state;
                  return (
                    <tr
                      key={`${event.record}-${index}`}
                      className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono">
                        {activationFromEvent(event) ?? money(event.activation)}
                      </td>
                      <td className="px-4 py-3">{money(event.kind)}</td>
                      <td className="max-w-sm break-all px-4 py-3 font-mono text-xs text-zinc-500">
                        {money(event.record)}
                      </td>
                      <td className="break-all px-4 py-3 font-mono">
                        {money(event.dimension ?? state?.dimension)}
                      </td>
                      <td className="break-all px-4 py-3 font-mono">
                        {money(event.structural_value ?? state?.structural_value)}
                      </td>
                      <td className="px-4 py-3">{money(event.depth_objects)}</td>
                      <td className="break-all px-4 py-3 font-mono">
                        {money(event.retained_mass ?? state?.retained_mass)}
                      </td>
                    </tr>
                  );
                })}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">
                      {eventsEmptyText}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">
            {events.map((event, index) => {
              const state = event?.heritage?.state;
              return (
                <article key={`${event.record}-card-${index}`} className={`${INNER} p-3`}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="min-w-0 break-all text-sm font-semibold">{money(event.kind)}</h4>
                    <Pill>Act. {activationFromEvent(event) ?? money(event.activation)}</Pill>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-zinc-500">
                    {money(event.record)}
                  </p>
                  <div className="mt-3">
                    <Fields min="7rem">
                      <Field label="Dimension">{money(event.dimension ?? state?.dimension)}</Field>
                      <Field label="Structural value (Σ)">
                        {money(event.structural_value ?? state?.structural_value)}
                      </Field>
                      <Field label="Depth objects">{money(event.depth_objects)}</Field>
                      <Field label="Retained mass">
                        {money(event.retained_mass ?? state?.retained_mass)}
                      </Field>
                    </Fields>
                  </div>
                </article>
              );
            })}
            {events.length === 0 && (
              <p className="col-span-full rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 lg:hidden">
                {eventsEmptyText}
              </p>
            )}
          </div>
        </Card>

        <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
          QTM Event Store · {API_BASE}
        </footer>
      </div>
    </main>
  );
}
