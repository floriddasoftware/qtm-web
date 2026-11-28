"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_QTM_API_BASE || "https://qtm-api.onrender.com").replace(/\/+$/, "");
const ROUTES = {
  substrates: () => ["GET", "/wallets"],
  events: ({ name }) => ["GET", `/wallets/${encodeURIComponent(name)}/events`],
  networks: ({ name, activation }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks`],
  budgets: ({ name, activation }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/budgets`],
  saveBudget: ({ name, activation, network }) => ["PUT", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/budgets/${encodeURIComponent(network)}`],
  miner: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation`],
  minerStart: ({ name, activation, network }) => ["POST", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation`],
  minerStop: ({ name, activation, network }) => ["DELETE", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation`],
  log: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation/log`],
  wirepackets: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/wirepackets`],
  wirepacketsFile: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/wirepackets/file`],
  signing: ({ name, activation, network, commitment }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/wirepacket/${encodeURIComponent(commitment)}/signing`],
  networkBoard: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/payload-board`],
  activationBoard: ({ name, activation }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/payload-board`],
};

const btn =
  "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-zinc-400/40 disabled:pointer-events-none disabled:opacity-40";
const btnNeutral = `${btn} border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800`;
const btnPrimary = `${btn} border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200`;
const btnSuccess = `${btn} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300`;
const btnError = `${btn} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/60 dark:text-rose-300`;

const card = "rounded-xl border border-zinc-200/90 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/90";
const subCard = "rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60";
const metricBox = "rounded-lg border border-zinc-200/80 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/70";
const errText = "text-xs font-medium text-rose-600 dark:text-rose-300";
const okText = "text-xs font-medium text-emerald-600 dark:text-emerald-300";

async function req(route, body, signal) {
  const [method, path] = route;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new Error(data?.error || data?.message || (typeof data === "string" ? data : `HTTP ${res.status}`));
  return data;
}

function activationId(ev) {
  return ev?.activation ?? ev?.id ?? ev?.sequence ?? ev?.event ?? null;
}

function parseMaxEvents(budget) {
  const n = Number(budget?.max_events);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function JsonNode({ k, v, depth = 0 }) {
  const indent = { paddingLeft: `${Math.min(depth, 5) * 12}px` };
  if (v === null || typeof v !== "object") {
    const isHex = typeof v === "string" && (v.length >= 24 || /^[0-9a-fA-F]{16,}$/.test(v));
    return (
      <div style={indent} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200/60 py-1.5 last:border-0 dark:border-zinc-800/70">
        {k !== undefined && <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{k}</span>}
        <span className={`text-xs break-all ${isHex ? "font-mono text-zinc-900 dark:text-zinc-100" : "text-zinc-800 dark:text-zinc-200"}`}>
          {v === null ? "null" : String(v)}
        </span>
      </div>
    );
  }
  const entries = Array.isArray(v) ? v.map((item, i) => [String(i), item]) : Object.entries(v);
  if (!entries.length) {
    return (
      <div style={indent} className="flex items-center justify-between py-1.5 text-xs text-zinc-400">
        <span>{k ?? "root"}</span>
        <span>{Array.isArray(v) ? "[]" : "{}"}</span>
      </div>
    );
  }
  return (
    <div style={indent} className="py-1">
      {k !== undefined && <div className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{k}</div>}
      <div className="rounded-lg border border-zinc-200/70 bg-white/80 px-2.5 dark:border-zinc-800 dark:bg-zinc-900/70">
        {entries.map(([ck, cv], i) => (
          <JsonNode key={`${ck}-${i}`} k={ck} v={cv} depth={depth + 1} />
        ))}
      </div>
    </div>
  );
}

function JsonPanel({ title, value, error }) {
  const [copied, setCopied] = useState(false);
  if (!value && !error) return null;
  const formatted = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`mt-3 ${subCard}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{title}</span>
        {!error && (
          <button type="button" onClick={copy} className="rounded px-2 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800">
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {error ? (
        <p className={`whitespace-pre-wrap ${errText}`}>{error}</p>
      ) : typeof value === "string" ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
          {value}
        </pre>
      ) : (
        <>
          <div className="max-h-72 overflow-auto">
            <JsonNode v={value} />
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-[11px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
              Raw JSON
            </summary>
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-white p-2.5 font-mono text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {formatted}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

function WirePacketsPanel({ data, error, maxEvents }) {
  if (!data && !error) return null;
  if (error) return <JsonPanel title="WirePackets" error={error} />;

  const submissions = Array.isArray(data?.packets) ? data.packets : [];

  const discoveredIds = submissions
    .map((entry) => Number(entry?.submission))
    .filter((id) => Number.isInteger(id) && id > 0);

  const persistedSet = new Set(discoveredIds);
  const uniquePersistedIds = Array.from(persistedSet).sort((a, b) => a - b);

  const persistedInBudget = uniquePersistedIds.filter((id) => id >= 1 && id <= maxEvents);
  const persistedOutsideBudget = uniquePersistedIds.filter((id) => id < 1 || id > maxEvents);

  const missingInBudget = [];
  for (let id = 1; id <= maxEvents; id += 1) {
    if (!persistedSet.has(id)) missingInBudget.push(id);
  }

  const coveragePercent = Math.min(100, Math.max(0, (persistedInBudget.length / maxEvents) * 100));

  const totalBytes =
    typeof data?.bytes === "number"
      ? data.bytes
      : submissions.reduce((sum, entry) => sum + (Number(entry?.bytes) || 0), 0);

  const totalPackets = submissions.reduce(
    (sum, entry) => sum + (Number(entry?.packet_count) || entry?.packets?.length || 0),
    0
  );

  return (
    <div className={`mt-3 space-y-3 ${subCard}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          Persisted WirePackets · Budget 1..{maxEvents}
        </span>

        <div className="flex flex-wrap gap-1.5 text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
          <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">
            {uniquePersistedIds.length} persisted
          </span>

          <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">
            {persistedInBudget.length}/{maxEvents} covered
          </span>

          {persistedOutsideBudget.length > 0 && (
            <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-amber-700 dark:border-zinc-800 dark:text-amber-300">
              {persistedOutsideBudget.length} outside budget
            </span>
          )}

          <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">
            {totalPackets} pkt
          </span>

          <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">
            {totalBytes.toLocaleString()} B
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Budget Coverage (1..{maxEvents})</span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
            {persistedInBudget.length}/{maxEvents} · {coveragePercent.toFixed(coveragePercent % 1 === 0 ? 0 : 1)}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(coveragePercent)}
          aria-label="Persisted submission budget coverage"
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800"
        >
          <div
            style={{ width: `${coveragePercent}%` }}
            className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-500"
          />
        </div>

        <div className="mt-2 space-y-1 text-[11px] text-zinc-500">
          <div>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Persisted IDs:</span>{" "}
            <span className="font-mono">{uniquePersistedIds.length ? uniquePersistedIds.join(", ") : "none"}</span>
          </div>
          <div>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Missing in 1..{maxEvents}:</span>{" "}
            <span className="font-mono">{missingInBudget.length ? missingInBudget.join(", ") : "none"}</span>
          </div>
          {persistedOutsideBudget.length > 0 && (
            <div className="text-amber-700 dark:text-amber-300">
              <span className="font-medium">Outside budget:</span>{" "}
              <span className="font-mono">{persistedOutsideBudget.join(", ")}</span>
            </div>
          )}
        </div>
      </div>

      {data?.exists === false || !submissions.length ? (
        <p className="text-xs text-zinc-500">No persisted WirePackets submissions found in storage.</p>
      ) : (
        <div className="space-y-2.5">
          {submissions.map((entry, idx) => {
            const pkts = Array.isArray(entry?.packets) ? entry.packets : [];
            const subId = entry.submission ?? entry.name ?? idx + 1;
            const numId = Number(subId);
            const inBudget = Number.isInteger(numId) && numId >= 1 && numId <= maxEvents;
            return (
              <div key={`sub-${subId}-${idx}`} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Submission #{subId}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          inBudget
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {inBudget ? "In budget" : "Outside budget"}
                      </span>
                    </div>
                    {entry.path && <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{entry.path}</div>}
                  </div>
                  <div className="flex gap-1.5 text-[11px] tabular-nums text-zinc-500">
                    <span>{Number(entry.bytes || 0).toLocaleString()} B</span>
                    <span>·</span>
                    <span>{entry.packet_count ?? pkts.length} pkts</span>
                  </div>
                </div>

                {!pkts.length ? (
                  <p className="text-xs text-zinc-500">No packets decoded in this submission.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 text-[11px] text-zinc-500 dark:border-zinc-800">
                          <th className="py-1.5 pr-2 font-medium">#</th>
                          <th className="py-1.5 px-2 font-medium">Txid</th>
                          <th className="py-1.5 px-2 font-medium">Vout</th>
                          <th className="py-1.5 px-2 font-medium">Value (sat)</th>
                          <th className="py-1.5 px-2 font-medium">Script Pubkey</th>
                          <th className="py-1.5 pl-2 font-medium">Commitment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pkts.map((p, pIdx) => (
                          <tr key={`${subId}-${p.txid}-${p.vout}-${pIdx}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                            <td className="py-1.5 pr-2 tabular-nums text-zinc-400">{pIdx + 1}</td>
                            <td className="max-w-[11rem] truncate py-1.5 px-2 font-mono text-[11px]" title={p.txid}>{p.txid || "—"}</td>
                            <td className="py-1.5 px-2 tabular-nums">{p.vout ?? "—"}</td>
                            <td className="py-1.5 px-2 tabular-nums">{p.value_sat != null ? Number(p.value_sat).toLocaleString() : "—"}</td>
                            <td className="max-w-[9rem] truncate py-1.5 px-2 font-mono text-[11px]" title={p.script_pubkey}>{p.script_pubkey || "—"}</td>
                            <td className="max-w-[10rem] truncate py-1.5 pl-2 font-mono text-[11px]" title={p.commitment}>{p.commitment || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <details className="text-[11px] text-zinc-500">
        <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-300">Raw payload JSON</summary>
        <pre className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-white p-2 font-mono text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function WirePacketsFilePanel({ data, error }) {
  if (!data && !error) return null;
  if (error) return <JsonPanel title="WirePackets Binary" error={error} />;

  const byteLength = Number(data?.byteLength || 0);
  const hex = typeof data?.hex === "string" ? data.hex : "";

  return (
    <div className={`mt-3 space-y-3 ${subCard}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">WirePackets Concatenated Binary</span>
        <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] tabular-nums text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900">
          {byteLength.toLocaleString()} bytes
        </span>
      </div>
      {byteLength === 0 ? (
        <p className="text-xs text-zinc-500">No binary bytes returned.</p>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          {hex}
        </pre>
      )}
    </div>
  );
}

function EventMetrics({ event }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className={metricBox}>
        <div className="text-[11px] text-zinc-500">Dimension</div>
        <div className="mt-0.5 text-base font-semibold tabular-nums">{event?.dimension ?? "—"}</div>
      </div>
      <div className={metricBox}>
        <div className="text-[11px] text-zinc-500">Retained Mass</div>
        <div className="mt-0.5 break-all text-base font-semibold tabular-nums">{event?.retained_mass ?? "—"}</div>
      </div>
      <div className={metricBox}>
        <div className="text-[11px] text-zinc-500">Delta</div>
        <div className="mt-0.5 text-base font-semibold tabular-nums">{event?.delta ?? "—"}</div>
      </div>
    </div>
  );
}

function NetworkCard({
  network,
  activeClip,
  budget,
  onBudgetChange,
  onSaveBudget,
  saving,
  budgetMessage,
  minerStatus,
  minerBusy,
  minerMessage,
  onStart,
  onStop,
  onRefresh,
  onLog,
  onPackets,
  onPacketFile,
  onSigning,
  onNetworkBoard,
}) {
  const [logData, setLogData] = useState(null);
  const [logError, setLogError] = useState("");
  const [packetData, setPacketData] = useState(null);
  const [packetError, setPacketError] = useState("");
  const [fileData, setFileData] = useState(null);
  const [fileError, setFileError] = useState("");
  const [signingData, setSigningData] = useState(null);
  const [signingError, setSigningError] = useState("");
  const [boardData, setBoardData] = useState(null);
  const [boardError, setBoardError] = useState("");
  const [panelBusy, setPanelBusy] = useState("");

  const commitments = useMemo(() => {
    const subs = packetData?.packets || [];
    return [
      ...new Set(
        subs
          .flatMap((s) => s?.packets || [])
          .map((p) => p?.commitment)
          .filter(Boolean)
      ),
    ];
  }, [packetData]);

  async function runPanel(key, fn, setVal, setErr, label) {
    setPanelBusy(key);
    setVal(null);
    setErr("");
    try {
      setVal(await fn());
    } catch (e) {
      setErr(e?.message || `Failed to load ${label}.`);
    } finally {
      setPanelBusy("");
    }
  }

  const running = Boolean(minerStatus?.running);
  const maxEvents = parseMaxEvents(budget);

  return (
    <article className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{network}</h3>
          <p className="text-xs text-zinc-500">
            Act {activeClip?.activation?.id} · <span className="font-mono">{activeClip?.substrate?.name}</span>
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            running
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-400"
          }`}
        >
          {running ? "Running" : minerStatus ? "Stopped" : "Unknown"}
        </span>
      </div>

      <div className={`mt-3 ${subCard}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Event Budget</span>
          <span className={`text-[11px] ${budget?.configured ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}>
            {budget?.configured ? `Persisted (1..${maxEvents})` : "Default (1..1)"}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-zinc-500">
            Min Events
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={budget?.min_events ?? "1"}
              onChange={(e) => onBudgetChange(network, "min_events", e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="text-[11px] text-zinc-500">
            Max Events
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={budget?.max_events ?? "1"}
              onChange={(e) => onBudgetChange(network, "max_events", e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-zinc-500">Target range: 1..{maxEvents}</span>
          <button type="button" className={btnPrimary} disabled={saving} onClick={() => onSaveBudget(network)}>
            {saving ? "Saving…" : "Save budget"}
          </button>
        </div>
        {budgetMessage && (
          <p role="status" className={`mt-2 ${budgetMessage.type === "success" ? okText : errText}`}>
            {budgetMessage.text}
          </p>
        )}
      </div>

      <div className={`mt-3 ${subCard}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">BitMiner</span>
          {minerStatus?.pid != null && <span className="font-mono text-[11px] text-zinc-500">PID {minerStatus.pid}</span>}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button type="button" className={btnSuccess} disabled={minerBusy || running} onClick={onStart}>
            {minerBusy ? "Working…" : "Start"}
          </button>
          <button type="button" className={btnError} disabled={minerBusy || !running} onClick={onStop}>
            {minerBusy ? "Working…" : "Stop"}
          </button>
          <button type="button" className={btnNeutral} disabled={minerBusy} onClick={onRefresh}>
            Refresh
          </button>
        </div>
        {minerMessage && (
          <p role="status" className={`mt-2 ${/fail|error|unable|invalid/i.test(minerMessage) ? errText : okText}`}>
            {minerMessage}
          </p>
        )}
        {minerStatus?.error && !running && <p className={`mt-1.5 whitespace-pre-wrap ${errText}`}>{minerStatus.error}</p>}
        {minerStatus && (
          <div className="mt-2 space-y-0.5 text-[11px] text-zinc-500">
            <div>State: {running ? "running" : "stopped"} · Activation: {minerStatus.activation ?? activeClip?.activation?.id}</div>
            <div className="truncate font-mono" title={minerStatus.log_path}>Log: {minerStatus.log_path || "—"}</div>
          </div>
        )}
      </div>

      <div className={`mt-3 ${subCard}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Observation & Payloads</span>
          {panelBusy && <span className="text-[11px] text-zinc-500">Loading {panelBusy}…</span>}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("log", onLog, setLogData, setLogError, "log")}>
            Log
          </button>
          <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("packets", onPackets, setPacketData, setPacketError, "WirePackets")}>
            WirePackets (1..{maxEvents})
          </button>
          <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("file", onPacketFile, setFileData, setFileError, "WirePackets file")}>
            Binary File
          </button>
          <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("board", onNetworkBoard, setBoardData, setBoardError, "network board")}>
            Payload Board
          </button>
          {commitments.map((c) => (
            <button
              key={c}
              type="button"
              className={`${btnNeutral} font-mono`}
              disabled={!!panelBusy}
              onClick={() => runPanel("signing", () => onSigning(c), setSigningData, setSigningError, "signing")}
            >
              Sign {c.slice(0, 8)}
            </button>
          ))}
        </div>

        <JsonPanel title="Observation Log" value={logData} error={logError} />
        <WirePacketsPanel data={packetData} error={packetError} maxEvents={maxEvents} />
        <WirePacketsFilePanel data={fileData} error={fileError} />
        <JsonPanel title="Signing Data" value={signingData} error={signingError} />
        <JsonPanel title="Network Payload Board" value={boardData} error={boardError} />
      </div>

      <EventMetrics event={activeClip?.event} />
    </article>
  );
}

export default function Home() {
  const [substrates, setSubstrates] = useState([]);
  const [events, setEvents] = useState([]);
  const [activeClip, setActiveClip] = useState(null);
  const [budgets, setBudgets] = useState({});
  const [budgetSaving, setBudgetSaving] = useState({});
  const [budgetMessages, setBudgetMessages] = useState({});
  const [minerStatuses, setMinerStatuses] = useState({});
  const [minerBusy, setMinerBusy] = useState({});
  const [minerMessages, setMinerMessages] = useState({});
  const [activationBoard, setActivationBoard] = useState(null);
  const [activationBoardError, setActivationBoardError] = useState("");
  const [activationBoardBusy, setActivationBoardBusy] = useState(false);
  const [loadingSubstrates, setLoadingSubstrates] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingNetworks, setLoadingNetworks] = useState(false);
  const [error, setError] = useState("");

  const selectedSubstrate = useMemo(
    () => (activeClip ? substrates.find((s) => s.name === activeClip.substrate.name) || null : null),
    [activeClip, substrates]
  );
  const activations = useMemo(() => events.map(activationId).filter((id) => id != null).map(String), [events]);
  const activeActivation = activeClip?.activation?.id != null ? String(activeClip.activation.id) : "";
  const activeNetworks = useMemo(() => (Array.isArray(activeClip?.network) ? activeClip.network : []), [activeClip]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoadingSubstrates(true);
      setError("");
      try {
        const data = await req(ROUTES.substrates(), undefined, ctrl.signal);
        setSubstrates(Array.isArray(data) ? data : data?.substrates || data?.wallets || []);
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e.message || "Failed to load substrates.");
      } finally {
        if (!ctrl.signal.aborted) setLoadingSubstrates(false);
      }
    })();
    return () => ctrl.abort();
  }, []);

  const refreshStatus = useCallback(async (name, activation, network) => {
    const key = `${name}:${activation}:${network}`;
    try {
      const status = await req(ROUTES.miner({ name, activation, network }));
      setMinerStatuses((prev) => ({ ...prev, [key]: status }));
      return status;
    } catch (e) {
      setMinerStatuses((prev) => ({ ...prev, [key]: { running: false, error: e.message } }));
      throw e;
    }
  }, []);

  const loadContext = useCallback(
    async (substrate, activation) => {
      setLoadingNetworks(true);
      setBudgets({});
      setBudgetMessages({});
      setMinerStatuses({});
      setMinerMessages({});
      setActivationBoard(null);
      setActivationBoardError("");
      try {
        const [netRes, budRes] = await Promise.all([
          req(ROUTES.networks({ name: substrate.name, activation })),
          req(ROUTES.budgets({ name: substrate.name, activation })),
        ]);
        const ev = netRes?.event;
        if (!Array.isArray(netRes?.networks) || !ev || ev.dimension == null || ev.retained_mass == null || ev.delta == null) {
          throw new Error("Invalid activation network/event response.");
        }
        const nets = netRes.networks.filter((n) => typeof n === "string" && n);
        const entries = Array.isArray(budRes?.budgets) ? budRes.budgets : [];
        const mapped = {};
        nets.forEach((n) => {
          const found = entries.find((item) => item?.network?.id === n);
          mapped[n] = {
            min_events: String(found?.budget?.min_events ?? 1),
            max_events: String(found?.budget?.max_events ?? 1),
            configured: Boolean(found?.configured),
          };
        });
        setActiveClip({ substrate: { name: substrate.name }, activation: { id: activation }, network: nets, event: ev });
        setBudgets(mapped);
        await Promise.allSettled(nets.map((n) => refreshStatus(substrate.name, activation, n)));
      } catch (e) {
        setError(e.message || "Failed to load activation context.");
        setActiveClip({ substrate: { name: substrate.name }, activation: { id: activation }, network: [], event: null });
      } finally {
        setLoadingNetworks(false);
      }
    },
    [refreshStatus]
  );

  const selectSubstrate = useCallback(
    async (name) => {
      const sub = substrates.find((s) => s.name === name);
      if (!sub) return;
      setError("");
      setEvents([]);
      setActiveClip(null);
      setLoadingEvents(true);
      try {
        const data = await req(ROUTES.events({ name: sub.name }));
        const list = Array.isArray(data) ? data : data?.events || data?.activations || [];
        setEvents(list);
        const latest = [...list].reverse().find((e) => activationId(e) != null);
        if (latest) await loadContext(sub, activationId(latest));
      } catch (e) {
        setError(e.message || "Failed to load activations.");
      } finally {
        setLoadingEvents(false);
      }
    },
    [substrates, loadContext]
  );

  const selectActivation = useCallback(
    async (id) => {
      if (!selectedSubstrate || !id) return;
      const ev = events.find((e) => String(activationId(e)) === String(id));
      if (!ev) return;
      setError("");
      await loadContext(selectedSubstrate, activationId(ev));
    },
    [selectedSubstrate, events, loadContext]
  );

  const updateBudget = useCallback((network, field, value) => {
    setBudgets((prev) => ({ ...prev, [network]: { ...prev[network], [field]: value } }));
    setBudgetMessages((prev) => ({ ...prev, [network]: null }));
  }, []);

  const saveBudget = useCallback(
    async (network) => {
      if (!activeClip || !budgets[network]) return;
      const minEvents = Number(budgets[network].min_events);
      const maxEvents = Number(budgets[network].max_events);
      if (
        budgets[network].min_events === "" ||
        budgets[network].max_events === "" ||
        !Number.isInteger(minEvents) ||
        !Number.isInteger(maxEvents) ||
        minEvents < 0 ||
        maxEvents <= 0 ||
        minEvents > maxEvents
      ) {
        setBudgetMessages((prev) => ({
          ...prev,
          [network]: { type: "error", text: "Min >= 0, max >= 1, and min <= max required." },
        }));
        return;
      }
      setBudgetSaving((prev) => ({ ...prev, [network]: true }));
      try {
        const res = await req(
          ROUTES.saveBudget({ name: activeClip.substrate.name, activation: activeClip.activation.id, network }),
          { min_events: minEvents, max_events: maxEvents }
        );
        setBudgets((prev) => ({
          ...prev,
          [network]: {
            min_events: String(res?.budget?.min_events ?? minEvents),
            max_events: String(res?.budget?.max_events ?? maxEvents),
            configured: true,
          },
        }));
        setBudgetMessages((prev) => ({ ...prev, [network]: { type: "success", text: "Budget saved" } }));
      } catch (e) {
        setBudgetMessages((prev) => ({ ...prev, [network]: { type: "error", text: e.message || "Save failed." } }));
      } finally {
        setBudgetSaving((prev) => ({ ...prev, [network]: false }));
      }
    },
    [activeClip, budgets]
  );

  const minerAction = useCallback(
    async (network, action) => {
      if (!activeClip) return;
      const name = activeClip.substrate.name;
      const activation = activeClip.activation.id;
      const key = `${name}:${activation}:${network}`;
      setMinerBusy((prev) => ({ ...prev, [key]: true }));
      try {
        const res = await req(
          action === "start" ? ROUTES.minerStart({ name, activation, network }) : ROUTES.minerStop({ name, activation, network })
        );
        setMinerMessages((prev) => ({
          ...prev,
          [key]: res?.message || (action === "start" ? "Started" : "Stopped"),
        }));
        await refreshStatus(name, activation, network);
      } catch (e) {
        setMinerMessages((prev) => ({ ...prev, [key]: e.message || `${action} failed.` }));
      } finally {
        setMinerBusy((prev) => ({ ...prev, [key]: false }));
      }
    },
    [activeClip, refreshStatus]
  );

  const fetchPanel = useCallback(
    async (network, kind, commitment) => {
      if (!activeClip) return null;
      const args = { name: activeClip.substrate.name, activation: activeClip.activation.id, network };
      if (kind === "log") return req(ROUTES.log(args));
      if (kind === "packets") return req(ROUTES.wirepackets(args));
      if (kind === "signing") return req(ROUTES.signing({ ...args, commitment }));
      if (kind === "board") return req(ROUTES.networkBoard(args));
      if (kind === "file") {
        const [, path] = ROUTES.wirepacketsFile(args);
        const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.text();
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch {
            /* plain text */
          }
          throw new Error(parsed?.error || body || `HTTP ${res.status}`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return {
          byteLength: bytes.length,
          hex: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" "),
        };
      }
      return null;
    },
    [activeClip]
  );

  const loadActivationBoard = useCallback(async () => {
    if (!activeClip) return;
    setActivationBoardBusy(true);
    setActivationBoard(null);
    setActivationBoardError("");
    try {
      setActivationBoard(await req(ROUTES.activationBoard({ name: activeClip.substrate.name, activation: activeClip.activation.id })));
    } catch (e) {
      setActivationBoardError(e.message || "Failed to load payload board.");
    } finally {
      setActivationBoardBusy(false);
    }
  }, [activeClip]);

  return (
    <main className="min-h-screen bg-zinc-50 px-3 py-5 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-6 sm:py-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Event Store</h1>
            <p className="text-xs text-zinc-500">Activations, event budgets, BitMiner controls, and persisted submissions.</p>
          </div>
          {activeClip && (
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900">
              <span className="font-mono">{activeClip.substrate.name}</span>
              <span className="mx-1.5 text-zinc-400">/</span>
              <span className="tabular-nums font-medium">Act {activeClip.activation.id}</span>
            </div>
          )}
        </header>

        <section className={card}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Substrate
              <select
                value={activeClip?.substrate?.name || ""}
                disabled={loadingSubstrates}
                onChange={(e) => selectSubstrate(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">{loadingSubstrates ? "Loading…" : "Select substrate"}</option>
                {substrates.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Activation
              <select
                value={activeActivation}
                disabled={loadingEvents || loadingNetworks || !selectedSubstrate || !activations.length}
                onChange={(e) => selectActivation(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">
                  {loadingEvents ? "Loading…" : !activations.length ? "No activations" : "Select activation"}
                </option>
                {activations.map((id) => (
                  <option key={id} value={id}>Activation {id}</option>
                ))}
              </select>
            </label>
          </div>

          {(loadingSubstrates || loadingEvents || loadingNetworks) && (
            <p className="mt-2.5 text-xs text-zinc-500">Syncing state from API…</p>
          )}
          {error && <p className={`mt-2.5 ${errText}`}>{error}</p>}
        </section>

        {activeClip && (
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Activation Context</h2>
                <p className="text-xs text-zinc-500">Persisted activation parameters and board.</p>
              </div>
              <button type="button" className={btnNeutral} disabled={activationBoardBusy} onClick={loadActivationBoard}>
                {activationBoardBusy ? "Loading…" : "Payload Board"}
              </button>
            </div>
            <EventMetrics event={activeClip.event} />
            <JsonPanel title="Activation Payload Board" value={activationBoard} error={activationBoardError} />
          </section>
        )}

        {activeClip && !loadingNetworks && (
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Network Contexts</h2>
              <p className="text-xs text-zinc-500">Scoped budgets, BitMiner controls, and persisted submissions.</p>
            </div>

            {activeNetworks.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {activeNetworks.map((network) => {
                  const key = `${activeClip.substrate.name}:${activeClip.activation.id}:${network}`;
                  return (
                    <NetworkCard
                      key={key}
                      network={network}
                      activeClip={activeClip}
                      budget={budgets[network]}
                      onBudgetChange={updateBudget}
                      onSaveBudget={saveBudget}
                      saving={Boolean(budgetSaving[network])}
                      budgetMessage={budgetMessages[network]}
                      minerStatus={minerStatuses[key]}
                      minerBusy={Boolean(minerBusy[key])}
                      minerMessage={minerMessages[key]}
                      onStart={() => minerAction(network, "start")}
                      onStop={() => minerAction(network, "stop")}
                      onRefresh={() =>
                        refreshStatus(activeClip.substrate.name, activeClip.activation.id, network).catch((e) =>
                          setMinerMessages((prev) => ({ ...prev, [key]: e.message }))
                        )
                      }
                      onLog={() => fetchPanel(network, "log")}
                      onPackets={() => fetchPanel(network, "packets")}
                      onPacketFile={() => fetchPanel(network, "file")}
                      onSigning={(c) => fetchPanel(network, "signing", c)}
                      onNetworkBoard={() => fetchPanel(network, "board")}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-xs text-zinc-500 dark:border-zinc-800">
                No networks registered for this activation.
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
