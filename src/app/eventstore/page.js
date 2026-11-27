"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_QTM_API_BASE || "https://qtm-api.onrender.com").replace(/\/+$/, "");
const API_ROUTES = {
  listSubstrates: () => ["GET", "/wallets"],
  listEvents: ({ name }) => ["GET", `/wallets/${encodeURIComponent(name)}/events`],
  activationNetworks: ({ name, activation }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks`],
  activationBudgets: ({ name, activation }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/budgets`],
  saveBudget: ({ name, activation, network }) => ["PUT", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/budgets/${encodeURIComponent(network)}`],
  bitminer: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation`],
  bitminerStart: ({ name, activation, network }) => ["POST", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation`],
  bitminerStop: ({ name, activation, network }) => ["DELETE", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation`],
  log: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/observation/log`],
  wirepackets: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/wirepackets`],
  wirepacketsFile: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/wirepackets/file`],
  signing: ({ name, activation, network, commitment }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/wirepacket/${encodeURIComponent(commitment)}/signing`],
  networkBoard: ({ name, activation, network }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/networks/${encodeURIComponent(network)}/payload-board`],
  activationBoard: ({ name, activation }) => ["GET", `/wallets/${encodeURIComponent(name)}/activations/${encodeURIComponent(activation)}/payload-board`],
};

async function apiRequest(route, body, signal) {
  const [method, path] = route;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!response.ok) throw new Error(data?.error || data?.message || (typeof data === "string" ? data : `Request failed (${response.status})`));
  return data;
}
async function loadActivationNetworks(name, activation, signal) {
  const data = await apiRequest(API_ROUTES.activationNetworks({ name, activation }), undefined, signal);
  if (!data || !Array.isArray(data.networks) || !data.event || data.event.dimension == null || data.event.retained_mass == null || data.event.delta == null) throw new Error("Invalid activation network/event response.");
  return { networks: data.networks.filter((n) => typeof n === "string" && n.length), event: { dimension: data.event.dimension, retained_mass: data.event.retained_mass, delta: data.event.delta } };
}
async function loadActivationBudgets(name, activation, signal) {
  const data = await apiRequest(API_ROUTES.activationBudgets({ name, activation }), undefined, signal);
  return Array.isArray(data?.budgets) ? data.budgets : [];
}
function mapBudgets(networks, entries) {
  const mapped = {};
  networks.forEach((network) => {
    const item = entries.find((entry) => entry?.network?.id === network);
    mapped[network] = { min_events: String(item?.budget?.min_events ?? 1), max_events: String(item?.budget?.max_events ?? 1), configured: Boolean(item?.configured) };
  });
  return mapped;
}
function createActiveClip(substrate, activation, networks = [], event = null) {
  if (!substrate || activation == null) return null;
  return { substrate: { name: substrate.name }, activation: { id: activation }, network: networks, event };
}
function activationId(event) { return event?.activation ?? event?.id ?? event?.sequence ?? event?.event ?? null; }
const buttonBase = "inline-flex min-w-0 items-center justify-center rounded-xl border px-3 py-2.5 text-xs font-medium leading-tight transition focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:pointer-events-none disabled:opacity-45 active:border-emerald-500 active:bg-emerald-50 active:text-emerald-700";
const buttonNeutral = `${buttonBase} border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-emerald-900 dark:hover:bg-emerald-950/40`;
const buttonPrimary = `${buttonBase} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700`;
const buttonDanger = `${buttonBase} border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-red-900 dark:hover:bg-red-950`;

function OutputPanel({ title, value, error }) {
  if (!value && !error) return null;
  return <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"><div className="mb-2 text-xs font-semibold text-zinc-500">{title}</div>{error ? <p className="whitespace-pre-wrap text-sm text-red-600 dark:text-red-400">{error}</p> : <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>}</div>;
}

function NetworkContext({ network, activeClip, budget, onBudgetChange, onSaveBudget, saving, budgetMessage, minerStatus, minerBusy, minerMessage, onStart, onStop, onRefresh, onLog, onPackets, onPacketFile, onSigning, onNetworkBoard }) {
  const substrate = activeClip?.substrate?.name;
  const activation = activeClip?.activation?.id;
  const event = activeClip?.event;
  const [logData, setLogData] = useState(null);
  const [logError, setLogError] = useState("");
  const [logPageOpen, setLogPageOpen] = useState(false);
  const [packetData, setPacketData] = useState(null);
  const [packetError, setPacketError] = useState("");
  const [fileData, setFileData] = useState(null);
  const [fileError, setFileError] = useState("");
  const [signingData, setSigningData] = useState(null);
  const [signingError, setSigningError] = useState("");
  const [boardData, setBoardData] = useState(null);
  const [boardError, setBoardError] = useState("");
  const [panelBusy, setPanelBusy] = useState("");
  const packets = packetData?.packets || [];
  const commitments = [...new Set(packets.flatMap((entry) => entry?.packets || []).map((packet) => packet?.commitment).filter(Boolean))];

  async function runPanel(key, action, setter, errorSetter, title) {
    setPanelBusy(key); setter(null); errorSetter("");
    try { setter(await action()); } catch (err) { errorSetter(err?.message || `Failed to load ${title}.`); }
    finally { setPanelBusy(""); }
  }
  async function openLogPage() {
    setPanelBusy("log"); setLogData(null); setLogError("");
    try { setLogData(await onLog()); setLogPageOpen(true); }
    catch (err) { setLogError(err?.message || "Failed to load log."); }
    finally { setPanelBusy(""); }
  }
  const statusLabel = minerStatus?.running ? "Running" : minerStatus ? "Stopped" : "Status unknown";
  return (
    <article className="rounded-2xl border border-zinc-200/80 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-all font-semibold">{network}</h3><p className="mt-1 text-xs text-zinc-500">Activation {activation} · {substrate}</p></div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${minerStatus?.running ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>{statusLabel}</span>
      </div>
      <section className="mt-4 rounded-xl border border-zinc-200/70 p-3 dark:border-zinc-800/80">
        <h4 className="text-sm font-semibold">Saved Event Budget</h4>
        <p className="mt-1 text-xs text-zinc-500">Last persisted values for this activation and network.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="min-w-0 text-xs text-zinc-500">Min Events<input type="number" min="0" step="1" inputMode="numeric" value={budget?.min_events ?? "1"} onChange={(e) => onBudgetChange(network, "min_events", e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-zinc-700 dark:text-zinc-100" /></label>
          <label className="min-w-0 text-xs text-zinc-500">Max Events<input type="number" min="1" step="1" inputMode="numeric" value={budget?.max_events ?? "1"} onChange={(e) => onBudgetChange(network, "max_events", e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-zinc-700 dark:text-zinc-100" /></label>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-zinc-500">{budget?.configured ? "Persisted budget" : "Budget not configured"}</span><button type="button" className={buttonPrimary} disabled={saving} onClick={() => onSaveBudget(network)}>{saving ? "Saving…" : "Save budget"}</button></div>
        {budgetMessage && <p role="status" className={`mt-2 text-xs ${budgetMessage.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{budgetMessage.text}</p>}
      </section>
      <section className="mt-4 rounded-xl border border-zinc-200/70 p-3 dark:border-zinc-800/80">
        <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">BitMiner</h4>{minerStatus?.pid != null && <span className="text-xs text-zinc-500">PID {minerStatus.pid}</span>}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button type="button" className={buttonPrimary} disabled={minerBusy || minerStatus?.running} onClick={onStart}>{minerBusy ? "Working…" : "Start"}</button>
          <button type="button" className={buttonDanger} disabled={minerBusy || !minerStatus?.running} onClick={onStop}>{minerBusy ? "Working…" : "Stop"}</button>
          <button type="button" className={`${buttonNeutral} col-span-2 sm:col-span-1`} disabled={minerBusy} onClick={onRefresh}>Refresh status</button>
        </div>
        {minerMessage && <p role="status" className="mt-2 text-xs text-zinc-500">{minerMessage}</p>}
        {minerStatus?.error && !minerStatus.running && <p className="mt-2 whitespace-pre-wrap text-xs text-amber-600 dark:text-amber-400">{minerStatus.error}</p>}
        {minerStatus && <div className="mt-2 grid gap-1 text-xs text-zinc-500"><div>Process: {minerStatus.running ? "running" : "not running"}</div><div>Activation: {minerStatus.activation}</div><div className="break-all">Log path: {minerStatus.log_path || "—"}</div></div>}
      </section>
      <section className="mt-4 rounded-xl border border-zinc-200/70 p-3 dark:border-zinc-800/80">
        <h4 className="text-sm font-semibold">Observation & Payload Tools</h4>
        <details className="group mt-2 rounded-lg border border-zinc-200/70 dark:border-zinc-800/70">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-200"><span>Observation tools</span><span className="text-xs text-zinc-400 transition group-open:rotate-180">⌄</span></summary>
          <div className="grid grid-cols-1 gap-2 border-t border-zinc-200/70 p-2 sm:grid-cols-2 dark:border-zinc-800/70">
            <button className={`${buttonNeutral} justify-between`} type="button" disabled={panelBusy !== ""} onClick={openLogPage}><span>Observation log</span><span className="inline-flex size-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 dark:border-zinc-800" aria-label="Open log page"><svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 11 11 5M6 5h5v5"/></svg></span></button>
            <button className={buttonNeutral} type="button" disabled={panelBusy !== ""} onClick={() => runPanel("packets", onPackets, setPacketData, setPacketError, "WirePackets")}>WirePackets</button>
            <button className={buttonNeutral} type="button" disabled={panelBusy !== ""} onClick={() => runPanel("file", onPacketFile, setFileData, setFileError, "WirePackets file")}>WirePackets file</button>
            <button className={buttonNeutral} type="button" disabled={panelBusy !== ""} onClick={() => runPanel("board", onNetworkBoard, setBoardData, setBoardError, "network payload board")}>Network payload board</button>
            {commitments.map((commitment) => <button key={commitment} className={buttonNeutral} type="button" disabled={panelBusy !== ""} onClick={() => runPanel("signing", () => onSigning(commitment), setSigningData, setSigningError, "signing")}>Signing · {commitment.slice(0, 10)}</button>)}
          </div>
        </details>
        {panelBusy && <p className="mt-2 text-xs text-zinc-500">Loading {panelBusy}…</p>}
        <OutputPanel title="Observation log" value={logData} error={logError} />
        <OutputPanel title="WirePackets" value={packetData} error={packetError} />
        <OutputPanel title="WirePackets file (hex)" value={fileData} error={fileError} />
        <OutputPanel title="Signing information" value={signingData} error={signingError} />
        <OutputPanel title="Network payload board" value={boardData} error={boardError} />
      </section>
      {logPageOpen && <div className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100" role="dialog" aria-modal="true" aria-label={`${network} observation log`}><header className="flex items-center justify-between gap-3 border-b border-zinc-200/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-zinc-800"><div className="min-w-0"><div className="text-xs text-zinc-500">{substrate} · Activation {activation}</div><h2 className="truncate text-base font-semibold">{network} observation log</h2></div><button type="button" className={`${buttonNeutral} shrink-0`} onClick={() => setLogPageOpen(false)}>Close</button></header><main className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-6"><div className="mx-auto w-full max-w-5xl"><div className="mb-3 flex items-center justify-between gap-3"><span className="text-xs text-zinc-500">Log snapshot</span><button type="button" className={buttonNeutral} disabled={panelBusy !== ""} onClick={openLogPage}>{panelBusy === "log" ? "Refreshing…" : "Refresh"}</button></div>{logError ? <p className="rounded-xl border border-red-200 p-3 text-sm text-red-700">{logError}</p> : <pre className="min-h-48 w-full overflow-auto whitespace-pre-wrap break-all rounded-xl border border-zinc-200/80 bg-zinc-50 p-3 text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">{typeof logData === "string" ? logData : JSON.stringify(logData, null, 2)}</pre>}</div></main></div>}
      <section className="mt-4 rounded-xl border border-zinc-200/70 p-3 dark:border-zinc-800/80"><h4 className="text-sm font-semibold">Persisted Activation Event</h4><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"><div className="rounded-xl border border-zinc-200/50 bg-zinc-50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900"><div className="text-xs text-zinc-500">Dimension</div><div className="mt-1 text-lg font-semibold tabular-nums">{event?.dimension ?? "—"}</div></div><div className="rounded-xl border border-zinc-200/50 bg-zinc-50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900"><div className="text-xs text-zinc-500">Retained Mass</div><div className="mt-1 break-all text-lg font-semibold tabular-nums">{event?.retained_mass ?? "—"}</div></div><div className="rounded-xl border border-zinc-200/50 bg-zinc-50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900"><div className="text-xs text-zinc-500">Transition Delta</div><div className="mt-1 text-lg font-semibold tabular-nums">{event?.delta ?? "—"}</div></div></div></section>
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
  const selectedSubstrate = useMemo(() => activeClip ? substrates.find((s) => s.name === activeClip.substrate.name) || null : null, [activeClip, substrates]);
  const activations = useMemo(() => events.map(activationId).filter((id) => id != null).map(String), [events]);
  const activeActivation = activeClip?.activation?.id != null ? String(activeClip.activation.id) : "";
  const activeNetworks = useMemo(() => Array.isArray(activeClip?.network) ? activeClip.network : [], [activeClip]);
  const keyFor = useCallback((network) => `${activeClip?.substrate?.name || ""}:${activeClip?.activation?.id ?? ""}:${network}`, [activeClip]);

  useEffect(() => {
    const controller = new AbortController();
    async function boot() {
      setLoadingSubstrates(true); setError("");
      try { const data = await apiRequest(API_ROUTES.listSubstrates(), undefined, controller.signal); setSubstrates(Array.isArray(data) ? data : data?.substrates || data?.wallets || []); }
      catch (err) { if (!controller.signal.aborted) setError(err.message || "Failed to load substrates."); }
      finally { if (!controller.signal.aborted) setLoadingSubstrates(false); }
    }
    boot(); return () => controller.abort();
  }, []);

  const loadEvents = useCallback(async (name, signal) => {
    if (!name) { setEvents([]); return []; }
    const data = await apiRequest(API_ROUTES.listEvents({ name }), undefined, signal);
    const list = Array.isArray(data) ? data : data?.events || data?.activations || [];
    setEvents(list); return list;
  }, []);

  const refreshStatus = useCallback(async (name, activation, network) => {
    const key = `${name}:${activation}:${network}`;
    try { const status = await apiRequest(API_ROUTES.bitminer({ name, activation, network })); setMinerStatuses((prev) => ({ ...prev, [key]: status })); return status; }
    catch (err) { setMinerStatuses((prev) => ({ ...prev, [key]: { running: false, error: err.message } })); throw err; }
  }, []);

  const loadContext = useCallback(async (substrate, activation) => {
    setLoadingNetworks(true); setBudgets({}); setBudgetMessages({}); setMinerStatuses({}); setMinerMessages({}); setActivationBoard(null); setActivationBoardError("");
    try {
      const [context, saved] = await Promise.all([loadActivationNetworks(substrate.name, activation), loadActivationBudgets(substrate.name, activation)]);
      setActiveClip(createActiveClip(substrate, activation, context.networks, context.event));
      setBudgets(mapBudgets(context.networks, saved));
      await Promise.allSettled(context.networks.map((network) => refreshStatus(substrate.name, activation, network)));
    } catch (err) { setError(err.message || "Failed to load activation context."); setActiveClip(createActiveClip(substrate, activation, [], null)); setBudgets({}); }
    finally { setLoadingNetworks(false); }
  }, [refreshStatus]);

  const selectSubstrate = useCallback(async (name) => {
    const substrate = substrates.find((item) => item.name === name); if (!substrate) return;
    setError(""); setEvents([]); setActiveClip(null); setBudgets({}); setMinerStatuses({}); setLoadingEvents(true);
    try {
      const list = await loadEvents(substrate.name);
      const latest = list.slice().reverse().find((e) => activationId(e) != null);
      if (!latest) { setActiveClip(null); setBudgets({}); return; }
      await loadContext(substrate, activationId(latest));
    } catch (err) { setError(err.message || "Failed to load activations."); setActiveClip(null); }
    finally { setLoadingEvents(false); }
  }, [substrates, loadEvents, loadContext]);

  const selectActivation = useCallback(async (activation) => {
    if (!selectedSubstrate || activation === "") return;
    const selected = events.find((e) => String(activationId(e)) === String(activation)); if (!selected) return;
    setError(""); setActiveClip(createActiveClip(selectedSubstrate, activationId(selected), [], null));
    await loadContext(selectedSubstrate, activationId(selected));
  }, [selectedSubstrate, events, loadContext]);


  const updateNetworkBudget = useCallback((network, field, value) => {
    setBudgets((prev) => ({ ...prev, [network]: { ...prev[network], [field]: value } }));
    setBudgetMessages((prev) => ({ ...prev, [network]: null }));
  }, []);
  const saveNetworkBudget = useCallback(async (network) => {
    if (!activeClip) return;
    const values = budgets[network]; if (!values) return;
    const minEvents = Number(values.min_events), maxEvents = Number(values.max_events);
    if (values.min_events === "" || values.max_events === "" || !Number.isInteger(minEvents) || !Number.isInteger(maxEvents) || minEvents < 0 || maxEvents <= 0 || minEvents > maxEvents) {
      setBudgetMessages((prev) => ({ ...prev, [network]: { type: "error", text: "Min must be non-negative, max must be positive, and min cannot exceed max." } })); return;
    }
    setBudgetSaving((prev) => ({ ...prev, [network]: true })); setBudgetMessages((prev) => ({ ...prev, [network]: null }));
    try {
      const response = await apiRequest(API_ROUTES.saveBudget({ name: activeClip.substrate.name, activation: activeClip.activation.id, network }), { min_events: minEvents, max_events: maxEvents });
      const saved = response?.budget;
      setBudgets((prev) => ({ ...prev, [network]: { min_events: String(saved?.min_events ?? minEvents), max_events: String(saved?.max_events ?? maxEvents), configured: true } }));
      setBudgetMessages((prev) => ({ ...prev, [network]: { type: "success", text: "budget saved" } }));
    } catch (err) { setBudgetMessages((prev) => ({ ...prev, [network]: { type: "error", text: err.message || "Failed to save budget." } })); }
    finally { setBudgetSaving((prev) => ({ ...prev, [network]: false })); }
  }, [activeClip, budgets]);

  const minerAction = useCallback(async (network, action) => {
    if (!activeClip) return;
    const name = activeClip.substrate.name, activation = activeClip.activation.id, key = `${name}:${activation}:${network}`;
    setMinerBusy((prev) => ({ ...prev, [key]: true })); setMinerMessages((prev) => ({ ...prev, [key]: null }));
    try {
      const route = action === "start" ? API_ROUTES.bitminerStart({ name, activation, network }) : API_ROUTES.bitminerStop({ name, activation, network });
      const result = await apiRequest(route);
      setMinerMessages((prev) => ({ ...prev, [key]: result?.message || `BitMiner ${action} request completed.` }));
      await refreshStatus(name, activation, network);
    } catch (err) { setMinerMessages((prev) => ({ ...prev, [key]: err.message || `BitMiner ${action} failed.` })); }
    finally { setMinerBusy((prev) => ({ ...prev, [key]: false })); }
  }, [activeClip, refreshStatus]);

  const fetchNetworkPanel = useCallback(async (network, kind, commitment) => {
    if (!activeClip) return;
    const args = { name: activeClip.substrate.name, activation: activeClip.activation.id, network };
    if (kind === "log") return apiRequest(API_ROUTES.log(args));
    if (kind === "packets") return apiRequest(API_ROUTES.wirepackets(args));
    if (kind === "signing") return apiRequest(API_ROUTES.signing({ ...args, commitment }));
    if (kind === "board") return apiRequest(API_ROUTES.networkBoard(args));
    if (kind === "file") {
      const [, path] = API_ROUTES.wirepacketsFile(args);
      const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
      if (!response.ok) { const body = await response.text(); let parsed; try { parsed = JSON.parse(body); } catch {} throw new Error(parsed?.error || body || `Request failed (${response.status})`); }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return `Bytes: ${bytes.length}\nHex:\n${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ")}`;
    }
  }, [activeClip]);

  const loadActivationBoard = useCallback(async () => {
    if (!activeClip) return;
    setActivationBoardBusy(true); setActivationBoard(null); setActivationBoardError("");
    try { setActivationBoard(await apiRequest(API_ROUTES.activationBoard({ name: activeClip.substrate.name, activation: activeClip.activation.id }))); }
    catch (err) { setActivationBoardError(err.message || "Failed to load activation payload board."); }
    finally { setActivationBoardBusy(false); }
  }, [activeClip]);


  return (
    <main className="min-h-screen w-full bg-white px-3 py-4 text-zinc-900 [font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif] dark:bg-zinc-950 dark:text-zinc-100 sm:px-5 sm:py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header><h1 className="text-2xl font-semibold tracking-tight">Event Store</h1><p className="mt-1 text-sm text-zinc-500">Persistent activation, network budgets, and BitMiner observation controls.</p></header>
        <section className="flex w-full flex-col gap-3 rounded-2xl border border-zinc-200/70 p-2.5 dark:border-zinc-800/70">
        <section className="rounded-2xl border border-zinc-200/80 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950"><div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">Substrate<select className="w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 dark:border-zinc-700" value={activeClip?.substrate?.name || ""} disabled={loadingSubstrates} onChange={(e) => selectSubstrate(e.target.value)}><option value="">{loadingSubstrates ? "Loading substrates…" : "Select substrate"}</option>{substrates.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">Activation<select className="w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 dark:border-zinc-700" value={activeActivation} disabled={loadingEvents || loadingNetworks || !selectedSubstrate || !activations.length} onChange={(e) => selectActivation(e.target.value)}><option value="">{loadingEvents ? "Loading activations…" : !activations.length ? "No persisted activations" : "Select activation"}</option>{activations.map((id) => <option key={id} value={id}>Activation {id}</option>)}</select></label>
        </div>{loadingSubstrates && <p className="mt-3 text-xs text-zinc-500">Loading substrates…</p>}{loadingEvents && <p className="mt-3 text-xs text-zinc-500">Loading persisted activations…</p>}{loadingNetworks && <p className="mt-3 text-xs text-zinc-500">Loading activation networks, event values, saved budgets, and miner status…</p>}{error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}</section>
        {activeClip && <section className="rounded-2xl border border-zinc-200/80 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-950"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Activation Context</h2><p className="mt-1 text-xs text-zinc-500">{activeClip.substrate.name} · Activation {activeClip.activation.id}</p></div><button type="button" className={buttonNeutral} disabled={activationBoardBusy} onClick={loadActivationBoard}>{activationBoardBusy ? "Loading…" : "Activation payload board"}</button></div><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"><div className="rounded-xl border border-zinc-200/50 bg-zinc-50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900"><div className="text-xs text-zinc-500">Dimension</div><div className="mt-1 text-lg font-semibold tabular-nums">{activeClip.event?.dimension ?? "—"}</div></div><div className="rounded-xl border border-zinc-200/50 bg-zinc-50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900"><div className="text-xs text-zinc-500">Retained Mass</div><div className="mt-1 break-all text-lg font-semibold tabular-nums">{activeClip.event?.retained_mass ?? "—"}</div></div><div className="rounded-xl border border-zinc-200/50 bg-zinc-50 p-3 dark:border-zinc-800/50 dark:bg-zinc-900"><div className="text-xs text-zinc-500">Delta</div><div className="mt-1 text-lg font-semibold tabular-nums">{activeClip.event?.delta ?? "—"}</div></div></div>{activationBoardError && <p className="mt-2 text-xs text-red-600">{activationBoardError}</p>}<OutputPanel title="Activation payload board" value={activationBoard} error={activationBoardError} /></section>}
        {activeClip && !loadingNetworks && <section className="flex flex-col gap-3"><header><h2 className="text-lg font-semibold">Network Contexts</h2><p className="mt-1 text-sm text-zinc-500">Budget and observation controls are scoped to each registered network.</p></header>{activeNetworks.length ? <div className="grid gap-3">{activeNetworks.map((network) => { const key = keyFor(network); const name = activeClip.substrate.name, activation = activeClip.activation.id; return <NetworkContext key={`${name}:${activation}:${network}`} network={network} activeClip={activeClip} budget={budgets[network]} onBudgetChange={updateNetworkBudget} onSaveBudget={saveNetworkBudget} saving={Boolean(budgetSaving[network])} budgetMessage={budgetMessages[network]} minerStatus={minerStatuses[key]} minerBusy={Boolean(minerBusy[key])} minerMessage={minerMessages[key]} onStart={() => minerAction(network, "start")} onStop={() => minerAction(network, "stop")} onRefresh={() => refreshStatus(name, activation, network).catch((err) => setMinerMessages((prev) => ({ ...prev, [key]: err.message })))} onLog={() => fetchNetworkPanel(network, "log")} onPackets={() => fetchNetworkPanel(network, "packets")} onPacketFile={() => fetchNetworkPanel(network, "file")} onSigning={(commitment) => fetchNetworkPanel(network, "signing", commitment)} onNetworkBoard={() => fetchNetworkPanel(network, "board")} />; })}</div> : <div className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">No network contexts available for this activation.</div>}</section>}
        </section>
      </div>
    </main>
  );
}
