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

const btn = "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-zinc-400/40 disabled:pointer-events-none disabled:opacity-40";
const btnNeutral = `${btn} border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800`;
const btnPrimary = `${btn} border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200`;
const btnSuccess = `${btn} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300`;
const btnError = `${btn} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/70 dark:bg-rose-950/60 dark:text-rose-300`;
const card = "rounded-xl border border-zinc-200/90 bg-white p-4 dark:border-zinc-800/90 dark:bg-zinc-900/90";
const subCard = "rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/60";
const metricBox = "rounded-lg border border-zinc-200/80 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/70";
const errText = "text-xs font-medium text-rose-600 dark:text-rose-300";
const okText = "text-xs font-medium text-emerald-600 dark:text-emerald-300";

async function req([method, path], body, signal) {
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
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) throw new Error(data?.error || data?.message || (typeof data === "string" ? data : `HTTP ${res.status}`));
  return data;
}

const activationId = (event) => event?.activation ?? event?.id ?? event?.sequence ?? event?.event ?? null;
const parseMaxEvents = (budget) => {
  const n = Number(budget?.max_events);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
};

function compactIds(ids) {
  if (!ids.length) return "—";
  const ranges = [];
  let start = ids[0], end = ids[0];
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === end + 1) end = ids[i];
    else {
      ranges.push(start === end ? `${start}` : `${start}–${end}`);
      start = end = ids[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return ranges.join(", ");
}

function missingIds(persisted, max) {
  const ranges = [];
  let next = 1;
  for (const id of persisted) {
    if (id > next) ranges.push(next === id - 1 ? `${next}` : `${next}–${id - 1}`);
    next = id + 1;
  }
  if (next <= max) ranges.push(next === max ? `${next}` : `${next}–${max}`);
  return ranges.join(", ") || "—";
}

function JsonNode({ k, v, depth = 0 }) {
  const indent = { paddingLeft: `${Math.min(depth, 5) * 12}px` };
  if (v === null || typeof v !== "object") {
    const hex = typeof v === "string" && (v.length >= 24 || /^[0-9a-fA-F]{16,}$/.test(v));
    return <div style={indent} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200/60 py-1.5 last:border-0 dark:border-zinc-800/70">
      {k !== undefined && <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{k}</span>}
      <span className={`break-all text-xs ${hex ? "font-mono text-zinc-900 dark:text-zinc-100" : "text-zinc-800 dark:text-zinc-200"}`}>{v === null ? "null" : String(v)}</span>
    </div>;
  }
  const entries = Array.isArray(v) ? v.map((item, i) => [String(i), item]) : Object.entries(v);
  if (!entries.length) return <div style={indent} className="flex items-center justify-between py-1.5 text-xs text-zinc-400"><span>{k ?? "root"}</span><span>{Array.isArray(v) ? "[]" : "{}"}</span></div>;
  return <div style={indent} className="py-1">
    {k !== undefined && <div className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">{k}</div>}
    <div className="rounded-lg border border-zinc-200/70 bg-white/80 px-2.5 dark:border-zinc-800 dark:bg-zinc-900/70">
      {entries.map(([key, value], i) => <JsonNode key={`${key}-${i}`} k={key} v={value} depth={depth + 1} />)}
    </div>
  </div>;
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
    } catch { setCopied(false); }
  }
  return <div className={`mt-3 ${subCard}`}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{title}</span>
      {!error && <button type="button" onClick={copy} className="rounded px-2 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800">{copied ? "Copied" : "Copy"}</button>}
    </div>
    {error ? <p className={`whitespace-pre-wrap ${errText}`}>{error}</p> : typeof value === "string" ?
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">{value}</pre> :
      <>
        <div className="max-h-72 overflow-auto"><JsonNode v={value} /></div>
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Raw JSON</summary>
          <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-white p-2.5 font-mono text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">{formatted}</pre>
        </details>
      </>}
  </div>;
}

function WirePacketsPanel({ data, error, maxEvents }) {
  if (!data && !error) return null;
  if (error) return <JsonPanel title="WirePackets" error={error} />;

  const submissions = Array.isArray(data?.packets) ? data.packets : [];
  const ids = [...new Set(submissions.map((entry) => Number(entry?.submission)).filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
  const within = ids.filter((id) => id <= maxEvents);
  const outside = ids.filter((id) => id > maxEvents);
  const percent = Math.min(100, (within.length / maxEvents) * 100);
  const bytes = typeof data?.bytes === "number" ? data.bytes : submissions.reduce((sum, entry) => sum + (Number(entry?.bytes) || 0), 0);
  const packetCount = submissions.reduce((sum, entry) => sum + (Number(entry?.packet_count) || entry?.packets?.length || 0), 0);

  return <div className={`mt-3 space-y-3 ${subCard}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Persisted submissions · Budget 1–{maxEvents}</span>
      <div className="flex flex-wrap gap-1.5 text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
        <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">{ids.length} persisted</span>
        <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">{within.length}/{maxEvents} covered</span>
        {outside.length > 0 && <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-amber-700 dark:border-zinc-800 dark:text-amber-300">{outside.length} outside</span>}
        <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">{packetCount} pkt</span>
        <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 dark:border-zinc-800 dark:bg-zinc-900">{bytes.toLocaleString()} B</span>
      </div>
    </div>

    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Budget coverage</span>
        <span className="text-[11px] font-medium tabular-nums text-zinc-600 dark:text-zinc-400">{within.length}/{maxEvents} ({percent.toFixed(percent % 1 === 0 ? 0 : 1)}%)</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Persisted submission coverage" className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 ring-1 ring-inset ring-zinc-200/80 dark:bg-zinc-950 dark:ring-zinc-800">
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300 dark:bg-blue-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 space-y-1 text-xs text-zinc-500">
        <p>Persisted: <span className="font-mono text-zinc-700 dark:text-zinc-300">{compactIds(within)}</span></p>
        <p>Missing: <span className="font-mono text-zinc-700 dark:text-zinc-300">{missingIds(within, maxEvents)}</span></p>
        {outside.length > 0 && <p className="text-amber-700 dark:text-amber-300">Outside budget: <span className="font-mono">{compactIds(outside)}</span></p>}
      </div>
    </div>

    {data?.exists === false || !submissions.length ? <p className="text-xs text-zinc-500">No persisted WirePackets submissions found in storage.</p> :
      <div className="space-y-2.5">
        {submissions.map((entry, idx) => {
          const packets = Array.isArray(entry?.packets) ? entry.packets : [];
          const id = entry.submission ?? entry.name ?? idx + 1;
          const numericId = Number(entry.submission);
          const inBudget = Number.isSafeInteger(numericId) && numericId > 0 && numericId <= maxEvents;
          return <div key={`sub-${id}-${idx}`} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Submission #{id}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${inBudget ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"}`}>{inBudget ? "In budget" : "Outside budget"}</span>
                </div>
                {entry.path && <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{entry.path}</div>}
              </div>
              <div className="flex gap-1.5 text-[11px] tabular-nums text-zinc-500"><span>{Number(entry.bytes || 0).toLocaleString()} B</span><span>·</span><span>{entry.packet_count ?? packets.length} pkts</span></div>
            </div>
            {!packets.length ? <p className="text-xs text-zinc-500">No packets decoded in this submission.</p> :
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                  <thead><tr className="border-b border-zinc-200 text-[11px] text-zinc-500 dark:border-zinc-800">
                    {["#", "Txid", "Vout", "Value (sat)", "Script Pubkey", "Commitment"].map((label) => <th key={label} className="px-2 py-1.5 font-medium first:pl-0 last:pr-0">{label}</th>)}
                  </tr></thead>
                  <tbody>{packets.map((packet, pIdx) => <tr key={`${id}-${packet.txid}-${packet.vout}-${pIdx}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                    <td className="py-1.5 pr-2 tabular-nums text-zinc-400">{pIdx + 1}</td>
                    <td className="max-w-[11rem] truncate px-2 py-1.5 font-mono text-[11px]" title={packet.txid}>{packet.txid || "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{packet.vout ?? "—"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{packet.value_sat != null ? Number(packet.value_sat).toLocaleString() : "—"}</td>
                    <td className="max-w-[9rem] truncate px-2 py-1.5 font-mono text-[11px]" title={packet.script_pubkey}>{packet.script_pubkey || "—"}</td>
                    <td className="max-w-[10rem] truncate py-1.5 pl-2 font-mono text-[11px]" title={packet.commitment}>{packet.commitment || "—"}</td>
                  </tr>)}</tbody>
                </table>
              </div>}
          </div>;
        })}
      </div>}
    <details className="text-[11px] text-zinc-500">
      <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-300">Raw payload JSON</summary>
      <pre className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-white p-2 font-mono text-[11px] dark:border-zinc-800 dark:bg-zinc-900">{JSON.stringify(data, null, 2)}</pre>
    </details>
  </div>;
}

function WirePacketsFilePanel({ data, error }) {
  if (!data && !error) return null;
  if (error) return <JsonPanel title="WirePackets Binary" error={error} />;
  const length = Number(data?.byteLength || 0);
  return <div className={`mt-3 space-y-3 ${subCard}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">WirePackets binary</span>
      <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] tabular-nums text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900">{length.toLocaleString()} bytes</span>
    </div>
    {length === 0 ? <p className="text-xs text-zinc-500">No binary bytes returned.</p> :
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">{data.hex || ""}</pre>}
  </div>;
}

function EventMetrics({ event }) {
  return <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
    {[["Dimension", event?.dimension], ["Retained Mass", event?.retained_mass], ["Delta", event?.delta]].map(([label, value]) =>
      <div key={label} className={metricBox}><div className="text-[11px] text-zinc-500">{label}</div><div className="mt-0.5 break-all text-base font-semibold tabular-nums">{value ?? "—"}</div></div>)}
  </div>;
}

function NetworkCard(props) {
  const {
    network, activeClip, budget, onBudgetChange, onSaveBudget, saving, budgetMessage,
    minerStatus, minerBusy, minerMessage, onStart, onStop, onRefresh, onLog,
    onPackets, onPacketFile, onSigning, onNetworkBoard,
  } = props;
  const [logData, setLogData] = useState(null), [logError, setLogError] = useState("");
  const [packetData, setPacketData] = useState(null), [packetError, setPacketError] = useState("");
  const [fileData, setFileData] = useState(null), [fileError, setFileError] = useState("");
  const [signingData, setSigningData] = useState(null), [signingError, setSigningError] = useState("");
  const [boardData, setBoardData] = useState(null), [boardError, setBoardError] = useState("");
  const [panelBusy, setPanelBusy] = useState("");
  const commitments = useMemo(() => [...new Set((packetData?.packets || []).flatMap((s) => s?.packets || []).map((p) => p?.commitment).filter(Boolean))], [packetData]);
  async function runPanel(key, fn, setValue, setError, label) {
    setPanelBusy(key); setValue(null); setError("");
    try { setValue(await fn()); }
    catch (e) { setError(e?.message || `Failed to load ${label}.`); }
    finally { setPanelBusy(""); }
  }
  const running = Boolean(minerStatus?.running), maxEvents = parseMaxEvents(budget);

  return <article className={card}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{network}</h3><p className="text-xs text-zinc-500">Act {activeClip?.activation?.id} · <span className="font-mono">{activeClip?.substrate?.name}</span></p></div>
      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${running ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300" : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-400"}`}>{running ? "Running" : minerStatus ? "Stopped" : "Unknown"}</span>
    </div>

    <div className={`mt-3 ${subCard}`}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">Event budget</span><span className={`text-[11px] ${budget?.configured ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}>{budget?.configured ? `Persisted (1–${maxEvents})` : "Default (1–1)"}</span></div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        {[["min_events", "Min events", 0], ["max_events", "Max events", 1]].map(([field, label, min]) =>
          <label key={field} className="text-[11px] text-zinc-500">{label}<input type="number" min={min} step="1" inputMode="numeric" value={budget?.[field] ?? (field === "min_events" ? "1" : "1")} onChange={(e) => onBudgetChange(network, field, e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" /></label>)}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2"><span className="text-[11px] text-zinc-500">Target: 1–{maxEvents}</span><button type="button" className={btnPrimary} disabled={saving} onClick={() => onSaveBudget(network)}>{saving ? "Saving…" : "Save budget"}</button></div>
      {budgetMessage && <p role="status" className={`mt-2 ${budgetMessage.type === "success" ? okText : errText}`}>{budgetMessage.text}</p>}
    </div>

    <div className={`mt-3 ${subCard}`}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">BitMiner</span>{minerStatus?.pid != null && <span className="font-mono text-[11px] text-zinc-500">PID {minerStatus.pid}</span>}</div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" className={btnSuccess} disabled={minerBusy || running} onClick={onStart}>{minerBusy ? "Working…" : "Start"}</button>
        <button type="button" className={btnError} disabled={minerBusy || !running} onClick={onStop}>{minerBusy ? "Working…" : "Stop"}</button>
        <button type="button" className={btnNeutral} disabled={minerBusy} onClick={onRefresh}>Refresh</button>
      </div>
      {minerMessage && <p role="status" className={`mt-2 ${/fail|error|unable|invalid/i.test(minerMessage) ? errText : okText}`}>{minerMessage}</p>}
      {minerStatus?.error && !running && <p className={`mt-1.5 whitespace-pre-wrap ${errText}`}>{minerStatus.error}</p>}
      {minerStatus && <div className="mt-2 space-y-0.5 text-[11px] text-zinc-500"><div>State: {running ? "running" : "stopped"} · Activation: {minerStatus.activation ?? activeClip?.activation?.id}</div><div className="truncate font-mono" title={minerStatus.log_path}>Log: {minerStatus.log_path || "—"}</div></div>}
    </div>

    <div className={`mt-3 ${subCard}`}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">Observation & payloads</span>{panelBusy && <span className="text-[11px] text-zinc-500">Loading {panelBusy}…</span>}</div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("log", onLog, setLogData, setLogError, "log")}>Log</button>
        <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("packets", onPackets, setPacketData, setPacketError, "WirePackets")}>WirePackets</button>
        <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("file", onPacketFile, setFileData, setFileError, "WirePackets file")}>Binary file</button>
        <button type="button" className={btnNeutral} disabled={!!panelBusy} onClick={() => runPanel("board", onNetworkBoard, setBoardData, setBoardError, "network board")}>Payload board</button>
        {commitments.map((commitment) => <button key={commitment} type="button" className={`${btnNeutral} font-mono`} disabled={!!panelBusy} onClick={() => runPanel("signing", () => onSigning(commitment), setSigningData, setSigningError, "signing")}>Sign {commitment.slice(0, 8)}</button>)}
      </div>
      <JsonPanel title="Observation log" value={logData} error={logError} />
      <WirePacketsPanel data={packetData} error={packetError} maxEvents={maxEvents} />
      <WirePacketsFilePanel data={fileData} error={fileError} />
      <JsonPanel title="Signing data" value={signingData} error={signingError} />
      <JsonPanel title="Network payload board" value={boardData} error={boardError} />
    </div>
    <EventMetrics event={activeClip?.event} />
  </article>;
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

  const selectedSubstrate = useMemo(() => activeClip ? substrates.find((s) => s.name === activeClip.substrate.name) || null : null, [activeClip, substrates]);
  const activations = useMemo(() => events.map(activationId).filter((id) => id != null).map(String), [events]);
  const activeActivation = activeClip?.activation?.id != null ? String(activeClip.activation.id) : "";
  const activeNetworks = Array.isArray(activeClip?.network) ? activeClip.network : [];

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoadingSubstrates(true); setError("");
      try {
        const data = await req(ROUTES.substrates(), undefined, ctrl.signal);
        setSubstrates(Array.isArray(data) ? data : data?.substrates || data?.wallets || []);
      } catch (e) { if (!ctrl.signal.aborted) setError(e.message || "Failed to load substrates."); }
      finally { if (!ctrl.signal.aborted) setLoadingSubstrates(false); }
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

  const loadContext = useCallback(async (substrate, activation) => {
    setLoadingNetworks(true); setBudgets({}); setBudgetMessages({}); setMinerStatuses({}); setMinerMessages({});
    setActivationBoard(null); setActivationBoardError("");
    try {
      const [networkData, budgetData] = await Promise.all([
        req(ROUTES.networks({ name: substrate.name, activation })),
        req(ROUTES.budgets({ name: substrate.name, activation })),
      ]);
      const event = networkData?.event;
      if (!Array.isArray(networkData?.networks) || !event || event.dimension == null || event.retained_mass == null || event.delta == null) throw new Error("Invalid activation network/event response.");
      const networks = networkData.networks.filter((network) => typeof network === "string" && network);
      const entries = Array.isArray(budgetData?.budgets) ? budgetData.budgets : [];
      const mapped = Object.fromEntries(networks.map((network) => {
        const found = entries.find((item) => item?.network?.id === network);
        return [network, { min_events: String(found?.budget?.min_events ?? 1), max_events: String(found?.budget?.max_events ?? 1), configured: Boolean(found?.configured) }];
      }));
      setActiveClip({ substrate: { name: substrate.name }, activation: { id: activation }, network: networks, event });
      setBudgets(mapped);
      await Promise.allSettled(networks.map((network) => refreshStatus(substrate.name, activation, network)));
    } catch (e) {
      setError(e.message || "Failed to load activation context.");
      setActiveClip({ substrate: { name: substrate.name }, activation: { id: activation }, network: [], event: null });
    } finally { setLoadingNetworks(false); }
  }, [refreshStatus]);

  const selectSubstrate = useCallback(async (name) => {
    const substrate = substrates.find((item) => item.name === name);
    if (!substrate) return;
    setError(""); setEvents([]); setActiveClip(null); setLoadingEvents(true);
    try {
      const data = await req(ROUTES.events({ name: substrate.name }));
      const list = Array.isArray(data) ? data : data?.events || data?.activations || [];
      setEvents(list);
      const latest = [...list].reverse().find((event) => activationId(event) != null);
      if (latest) await loadContext(substrate, activationId(latest));
    } catch (e) { setError(e.message || "Failed to load activations."); }
    finally { setLoadingEvents(false); }
  }, [substrates, loadContext]);

  const selectActivation = useCallback(async (id) => {
    if (!selectedSubstrate || !id) return;
    const event = events.find((item) => String(activationId(item)) === String(id));
    if (!event) return;
    setError("");
    await loadContext(selectedSubstrate, activationId(event));
  }, [selectedSubstrate, events, loadContext]);

  const updateBudget = useCallback((network, field, value) => {
    setBudgets((prev) => ({ ...prev, [network]: { ...prev[network], [field]: value } }));
    setBudgetMessages((prev) => ({ ...prev, [network]: null }));
  }, []);

  const saveBudget = useCallback(async (network) => {
    if (!activeClip || !budgets[network]) return;
    const minEvents = Number(budgets[network].min_events), maxEvents = Number(budgets[network].max_events);
    if (budgets[network].min_events === "" || budgets[network].max_events === "" || !Number.isInteger(minEvents) || !Number.isInteger(maxEvents) || minEvents < 0 || maxEvents <= 0 || minEvents > maxEvents) {
      setBudgetMessages((prev) => ({ ...prev, [network]: { type: "error", text: "Min >= 0, max >= 1, and min <= max required." } }));
      return;
    }
    setBudgetSaving((prev) => ({ ...prev, [network]: true }));
    try {
      const result = await req(ROUTES.saveBudget({ name: activeClip.substrate.name, activation: activeClip.activation.id, network }), { min_events: minEvents, max_events: maxEvents });
      setBudgets((prev) => ({ ...prev, [network]: { min_events: String(result?.budget?.min_events ?? minEvents), max_events: String(result?.budget?.max_events ?? maxEvents), configured: true } }));
      setBudgetMessages((prev) => ({ ...prev, [network]: { type: "success", text: "Budget saved" } }));
    } catch (e) {
      setBudgetMessages((prev) => ({ ...prev, [network]: { type: "error", text: e.message || "Save failed." } }));
    } finally { setBudgetSaving((prev) => ({ ...prev, [network]: false })); }
  }, [activeClip, budgets]);

  const minerAction = useCallback(async (network, action) => {
    if (!activeClip) return;
    const name = activeClip.substrate.name, activation = activeClip.activation.id, key = `${name}:${activation}:${network}`;
    setMinerBusy((prev) => ({ ...prev, [key]: true }));
    try {
      const result = await req(action === "start" ? ROUTES.minerStart({ name, activation, network }) : ROUTES.minerStop({ name, activation, network }));
      setMinerMessages((prev) => ({ ...prev, [key]: result?.message || (action === "start" ? "Started" : "Stopped") }));
      await refreshStatus(name, activation, network);
    } catch (e) { setMinerMessages((prev) => ({ ...prev, [key]: e.message || `${action} failed.` })); }
    finally { setMinerBusy((prev) => ({ ...prev, [key]: false })); }
  }, [activeClip, refreshStatus]);

  const fetchPanel = useCallback(async (network, kind, commitment) => {
    if (!activeClip) return null;
    const args = { name: activeClip.substrate.name, activation: activeClip.activation.id, network };
    if (kind === "log") return req(ROUTES.log(args));
    if (kind === "packets") return req(ROUTES.wirepackets(args));
    if (kind === "signing") return req(ROUTES.signing({ ...args, commitment }));
    if (kind === "board") return req(ROUTES.networkBoard(args));
    if (kind === "file") {
      const [, path] = ROUTES.wirepacketsFile(args);
      const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.text();
        let parsed;
        try { parsed = JSON.parse(body); } catch { /* plain text response */ }
        throw new Error(parsed?.error || body || `HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { byteLength: bytes.length, hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ") };
    }
    return null;
  }, [activeClip]);

  const loadActivationBoard = useCallback(async () => {
    if (!activeClip) return;
    setActivationBoardBusy(true); setActivationBoard(null); setActivationBoardError("");
    try { setActivationBoard(await req(ROUTES.activationBoard({ name: activeClip.substrate.name, activation: activeClip.activation.id }))); }
    catch (e) { setActivationBoardError(e.message || "Failed to load payload board."); }
    finally { setActivationBoardBusy(false); }
  }, [activeClip]);

  return <main className="min-h-screen bg-zinc-50 px-3 py-5 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 sm:px-6 sm:py-7">
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-xl font-semibold tracking-tight">Event Store</h1><p className="text-xs text-zinc-500">Activations, budgets, BitMiner controls, and persisted submissions.</p></div>
        {activeClip && <div className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-900"><span className="font-mono">{activeClip.substrate.name}</span><span className="mx-1.5 text-zinc-400">/</span><span className="font-medium tabular-nums">Act {activeClip.activation.id}</span></div>}
      </header>

      <section className={card}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Substrate
            <select value={activeClip?.substrate?.name || ""} disabled={loadingSubstrates} onChange={(e) => selectSubstrate(e.target.value)} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
              <option value="">{loadingSubstrates ? "Loading…" : "Select substrate"}</option>
              {substrates.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Activation
            <select value={activeActivation} disabled={loadingEvents || loadingNetworks || !selectedSubstrate || !activations.length} onChange={(e) => selectActivation(e.target.value)} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
              <option value="">{loadingEvents ? "Loading…" : !activations.length ? "No activations" : "Select activation"}</option>
              {activations.map((id) => <option key={id} value={id}>Activation {id}</option>)}
            </select>
          </label>
        </div>
        {(loadingSubstrates || loadingEvents || loadingNetworks) && <p className="mt-2.5 text-xs text-zinc-500">Syncing state from API…</p>}
        {error && <p className={`mt-2.5 ${errText}`}>{error}</p>}
      </section>

      {activeClip && <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-sm font-semibold">Activation context</h2><p className="text-xs text-zinc-500">Persisted activation parameters and board.</p></div>
          <button type="button" className={btnNeutral} disabled={activationBoardBusy} onClick={loadActivationBoard}>{activationBoardBusy ? "Loading…" : "Payload board"}</button>
        </div>
        <EventMetrics event={activeClip.event} />
        <JsonPanel title="Activation payload board" value={activationBoard} error={activationBoardError} />
      </section>}

      {activeClip && !loadingNetworks && <section className="space-y-3">
        <div><h2 className="text-sm font-semibold">Network contexts</h2><p className="text-xs text-zinc-500">Budgets, BitMiner controls, and persisted submissions.</p></div>
        {activeNetworks.length ? <div className="grid gap-4 md:grid-cols-2">
          {activeNetworks.map((network) => {
            const key = `${activeClip.substrate.name}:${activeClip.activation.id}:${network}`;
            return <NetworkCard key={key} network={network} activeClip={activeClip} budget={budgets[network]} onBudgetChange={updateBudget} onSaveBudget={saveBudget} saving={Boolean(budgetSaving[network])} budgetMessage={budgetMessages[network]} minerStatus={minerStatuses[key]} minerBusy={Boolean(minerBusy[key])} minerMessage={minerMessages[key]} onStart={() => minerAction(network, "start")} onStop={() => minerAction(network, "stop")} onRefresh={() => refreshStatus(activeClip.substrate.name, activeClip.activation.id, network).catch((e) => setMinerMessages((prev) => ({ ...prev, [key]: e.message })))} onLog={() => fetchPanel(network, "log")} onPackets={() => fetchPanel(network, "packets")} onPacketFile={() => fetchPanel(network, "file")} onSigning={(commitment) => fetchPanel(network, "signing", commitment)} onNetworkBoard={() => fetchPanel(network, "board")} />;
          })}
        </div> : <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-xs text-zinc-500 dark:border-zinc-800">No networks registered for this activation.</div>}
      </section>}
    </div>
  </main>;
}
