
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = (
  process.env.NEXT_PUBLIC_QTM_API_BASE ||
  "https://qtm-api-anwp.onrender.com"
).replace(/\/+$/, "");

const REFRESH_INTERVAL_MS = 80000;
const SUBSTRATE_QUERY_KEY = "substrate";
const MUTATION_HOLD_MS = 8000;

const KNOWN_OBSERVATION_KEYS = [
  "running",
  "commitment",
  "listen_port",
  "path",
  "message",
  "runtime",
  "clips",
  "event",
];

const BUTTON =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-zinc-300 px-3 text-xs font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";

const BUTTON_PRIMARY =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full bg-zinc-950 px-3 text-xs font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200";

const PANEL =
  "min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";

const MUTED = "text-zinc-500 dark:text-zinc-400";
const ERROR_TEXT = "text-pink-600 dark:text-pink-400";

async function apiRequest(path, signal, options = {}) {
  const method = options.method || "GET";
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;

    const reason =
      cause instanceof Error && cause.message ? cause.message : "network error";

    throw new Error(
      `Could not reach the QTM runtime at ${API_BASE} (${reason}). Make sure qtm-api is running and that this page is allowed to call it (CORS / mixed content). Hosted instances can take about a minute to wake from sleep.`,
    );
  }

  const bodyText = await response.text();
  let body = null;

  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const apiMessage =
      body &&
      typeof body === "object" &&
      (body.error || body.message || body.detail);

    const reason =
      typeof apiMessage === "string" && apiMessage.trim()
        ? apiMessage
        : bodyText
          ? bodyText.slice(0, 300)
          : `Request failed with HTTP ${response.status}`;

    throw new Error(
      `${reason}${response.status ? ` [HTTP ${response.status}]` : ""}`,
    );
  }

  return body ?? {};
}

function normalizeEntries(result, keys = []) {
  if (Array.isArray(result)) return result;

  for (const key of keys) {
    if (Array.isArray(result?.[key])) return result[key];
  }

  return [];
}

/* ---------- Pipeline data: wirepackets and payload board ---------- */

const WIREPACKETS_READ_LIMIT = 8 * 1024 * 1024;
const WIREPACKET_ROW_LIMIT = 100;
const PACKET_MAGIC = "QTMGSP02";
// Mirrors WirePacket::MIN_SIZE / MAX_SIZE in bit-miner broadcast.rs:
// magic 8 + txid 32 + vout 4 + value 8 + script length 4 + commitment 32
const PACKET_MIN_SIZE = 8 + 32 + 4 + 8 + 4 + 32;
const PACKET_MAX_SIZE = 1_048_576;

// Streams the stored wirepackets bytes. The route mirrors the canonical file:
//   activations/<activation>/event/wirepackets  (no commitment segment; the
//   commitment travels inside every packet).
function wirepacketsFileUrl(substrate, activation) {
  return `${API_BASE}/wallets/${encodeURIComponent(substrate)}/activations/${encodeURIComponent(String(activation))}/event/wirepackets/file`;
}

function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function formatBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return "—";
  const exact = `${bytes.toLocaleString("en-US")} byte${bytes === 1 ? "" : "s"}`;
  if (bytes < 1024) return exact;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${exact} (${value.toFixed(value >= 100 ? 0 : 2)} ${units[unit]})`;
}

// File framing written by the observation stream:
//   [u32 big-endian length][serialized WirePacket] repeated
function parseWireFrames(buffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const frames = [];
  let offset = 0;
  let problem = null;

  while (offset < data.length) {
    const remaining = data.length - offset;

    if (remaining < 4) {
      problem = `${remaining} trailing byte(s) at offset ${offset} are too short for a length prefix.`;
      break;
    }

    const length = view.getUint32(offset, false);
    const start = offset + 4;

    // Same bounds TcpReceiver enforces on a frame length.
    if (length < PACKET_MIN_SIZE || length > PACKET_MAX_SIZE) {
      problem = `Frame ${frames.length} at offset ${offset} has invalid length ${length}.`;
      break;
    }

    if (start + length > data.length) {
      problem = `Frame ${frames.length} at offset ${offset} declares ${length} bytes but ${data.length - start} remain.`;
      break;
    }

    frames.push({ index: frames.length, offset, length, start });
    offset = start + length;
  }

  return { data, frames, problem, bytes: data.length };
}

// Mirrors WirePacket::deserialize (bit-miner broadcast.rs), QTMGSP02:
//   magic[8] txid[32] vout u32le value u64le script_len u32le script commitment[32]
// The txid is stored in consensus byte order; it is reversed here to match the
// displayed Bitcoin txid. The commitment is shown as commitment_id() does:
// plain hex of the 32 bytes.
function decodeWirePacket(bytes) {
  if (bytes.length < PACKET_MIN_SIZE) return { error: "wire packet too short" };
  if (bytes.length > PACKET_MAX_SIZE) {
    return { error: "wire packet exceeds maximum size" };
  }

  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== PACKET_MAGIC) return { error: "invalid wire packet magic" };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scriptLen = view.getUint32(52, true);
  const remaining = bytes.length - 56;

  if (remaining < 32 || scriptLen > remaining - 32) {
    return { error: "script length exceeds packet boundary" };
  }

  if (56 + scriptLen + 32 !== bytes.length) {
    return { error: "trailing bytes in wire packet" };
  }

  return {
    txid: bytesToHex(bytes.slice(8, 40).reverse()),
    vout: view.getUint32(40, true),
    value: view.getBigUint64(44, true).toString(),
    scriptLen,
    commitment: bytesToHex(bytes.subarray(56 + scriptLen)),
  };
}

function reportedBool(value) {
  return typeof value === "boolean" ? value : null;
}

function reportedText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseByteCount(value) {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : value;

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isNotFound(reason) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return message.includes("[HTTP 404]");
}

// One call per API resource. Each result keeps its own status so one failing
// resource never hides the others.
async function fetchPipelineData(basePath, encodedNetwork, signal) {
  const [status, pipelines, wirepackets, payloadBoard] =
    await Promise.allSettled([
      apiRequest(`${basePath}/networks/${encodedNetwork}/observation`, signal),
      apiRequest(`${basePath}/observations`, signal),
      apiRequest(`${basePath}/networks/${encodedNetwork}/wirepackets`, signal),
      apiRequest(`${basePath}/networks/${encodedNetwork}/payload-board`, signal),
    ]);

  return { status, pipelines, wirepackets, payloadBoard };
}

function normalizeWirepacketsMeta(body) {
  if (!isPlainObject(body)) return null;

  const entry = Array.isArray(body.packets)
    ? body.packets.find((item) => isPlainObject(item) && item.path)
    : null;

  return {
    exists: body.exists === true,
    path: reportedText(body.path),
    file: entry
      ? { path: String(entry.path), bytes: parseByteCount(entry.bytes) }
      : null,
  };
}

function normalizePayloadBoardKinds(body) {
  const kinds = Array.isArray(body?.kinds) ? body.kinds : [];

  return kinds
    .filter((entry) => isPlainObject(entry) && entry.in_scope === true)
    .map((entry) => ({
      kind: reportedText(entry.kind) ?? "unknown",
      available: entry.available === true,
      depth_path: reportedText(entry.depth_path),
      depth_record: reportedText(entry.depth_record),
      depth_objects: Array.isArray(entry.depth_objects)
        ? entry.depth_objects.filter(isPlainObject)
        : [],
    }));
}

function buildPipelineData(scope, results) {
  const state = (result, allowMissing = false) =>
    result.status === "fulfilled"
      ? "ok"
      : allowMissing && isNotFound(result.reason)
        ? "unavailable"
        : "failed";

  const errors = [];
  const labels = {
    status: "status",
    pipelines: "pipelines",
    wirepackets: "wirepackets",
    payloadBoard: "payload board",
  };

  for (const [key, label] of Object.entries(labels)) {
    const result = results[key];
    // 404 on status = no live observation yet.
    if (result.status === "rejected" && !isNotFound(result.reason)) {
      if (result.reason?.name === "AbortError") continue;
      errors.push(
        `${label}: ${result.reason instanceof Error ? result.reason.message : "unavailable"}`,
      );
    }
  }

  return {
    scope,
    wirepackets:
      results.wirepackets.status === "fulfilled"
        ? normalizeWirepacketsMeta(results.wirepackets.value)
        : null,
    kinds:
      results.payloadBoard.status === "fulfilled"
        ? normalizePayloadBoardKinds(results.payloadBoard.value)
        : null,
    retrieval: {
      status: state(results.status, true),
      pipelines: state(results.pipelines),
      wirepackets: state(results.wirepackets),
      payload_board: state(results.payloadBoard),
    },
    errors,
  };
}

function WirepacketsFileViewer({ substrate, activation, meta }) {
  const [state, setState] = useState({ status: "idle" });
  const requestRef = useRef(0);
  const url = wirepacketsFileUrl(substrate, activation);

  useEffect(() => {
    requestRef.current += 1;
    setState({ status: "idle" });
  }, [substrate, activation]);

  const readFile = useCallback(async () => {
    const requestId = ++requestRef.current;
    setState({ status: "loading" });

    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/octet-stream" },
      });

      if (requestId !== requestRef.current) return;

      if (response.status === 404) {
        setState({
          status: "error",
          message: "No wirepackets file exists at the canonical path yet.",
        });
        return;
      }

      if (!response.ok) {
        throw new Error(`The API returned HTTP ${response.status} for the wirepackets file.`);
      }

      const buffer = await response.arrayBuffer();
      if (requestId !== requestRef.current) return;

      if (buffer.byteLength > WIREPACKETS_READ_LIMIT) {
        setState({
          status: "error",
          message: `The file is ${formatBytes(buffer.byteLength)}, over the in-page read limit. Use Download.`,
        });
        return;
      }

      const parsed = parseWireFrames(buffer);
      const packets = parsed.frames.map((frame) => ({
        ...frame,
        packet: decodeWirePacket(
          parsed.data.subarray(frame.start, frame.start + frame.length),
        ),
      }));

      setState({
        status: "ready",
        readAt: new Date(),
        bytes: parsed.bytes,
        problem: parsed.problem,
        packets,
      });
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setState({
        status: "error",
        message:
          cause instanceof Error && cause.message
            ? cause.message
            : "Unable to read the wirepackets file.",
      });
    }
  }, [url]);

  const ready = state.status === "ready";

  // Everything shown comes from the packets: each one carries its outpoint,
  // value, script and commitment.
  const decoded = ready
    ? state.packets.filter((item) => !item.packet.error)
    : [];
  const txidCount = new Set(decoded.map((item) => item.packet.txid)).size;
  const commitmentIds = [...new Set(decoded.map((item) => item.packet.commitment))];
  const rows = ready
    ? state.packets.slice(0, WIREPACKET_ROW_LIMIT).map((item) => ({
        "#": item.index,
        txid: item.packet.txid ?? "—",
        vout: item.packet.vout ?? "—",
        value_sats: item.packet.value ?? "—",
        script_bytes: item.packet.scriptLen ?? "—",
        commitment_id: item.packet.commitment ?? "—",
        problem: item.packet.error ?? "",
      }))
    : [];

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={BUTTON}
          disabled={!meta?.exists || state.status === "loading"}
          onClick={readFile}
        >
          {state.status === "loading" ? "Reading…" : ready ? "Read again" : "Read packets"}
        </button>
        {meta?.exists && (
          <a className={BUTTON} href={url} download target="_blank" rel="noopener noreferrer">
            Open file
          </a>
        )}
      </div>

      {state.status === "error" && <ErrorMessage>{state.message}</ErrorMessage>}

      {ready && (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <CompactValue label="Bytes read" value={formatBytes(state.bytes)} />
            <CompactValue label="Packets" value={state.packets.length} />
            <CompactValue label="Transactions" value={txidCount} />
            <CompactValue
              label="Commitments"
              value={
                commitmentIds.length === 1 ? "1 (consistent)" : commitmentIds.length
              }
            />
            <CompactValue label="Framing" value={state.problem ? "invalid" : "valid"} />
            <CompactValue label="Read at" value={state.readAt.toLocaleTimeString()} />
          </div>
          {state.problem && <ErrorMessage>{state.problem}</ErrorMessage>}
          <ObjectTable
            rows={rows}
            columns={["#", "txid", "vout", "value_sats", "script_bytes", "commitment_id", "problem"]}
          />
          {state.packets.length > WIREPACKET_ROW_LIMIT && (
            <p className={`text-[10px] ${MUTED}`}>
              Showing the first {WIREPACKET_ROW_LIMIT} of {state.packets.length} packets. Use Open file for the rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PipelineDataPanel({ data, substrate, activation }) {
  const meta = data.wirepackets;
  const retrieval = data.retrieval;

  return (
    <div className="min-w-0 space-y-3 border-t border-zinc-200 p-2 dark:border-zinc-800 sm:p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {Object.entries(retrieval).map(([key, value]) => (
          <DiagnosticBadge key={key} status={value === "ok" ? "live" : "unknown"}>
            {humanizeKey(key)}: {value}
          </DiagnosticBadge>
        ))}
      </div>

      {data.errors.length > 0 && (
        <ErrorMessage>{data.errors.join(" | ")}</ErrorMessage>
      )}

      {/* Persisted wirepackets file */}
      <section className="min-w-0">
        <h3 className="text-xs font-semibold sm:text-sm">Wirepackets file</h3>
        {!meta ? (
          <p className={`mt-1 text-xs ${MUTED}`}>Wirepackets metadata is unavailable.</p>
        ) : (
          <div className="mt-1 min-w-0 space-y-2">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              <CompactValue label="File present" value={meta.exists} />
              <CompactValue
                label="Size"
                value={meta.exists && meta.file ? formatBytes(meta.file.bytes) : "No file"}
              />
              <CompactValue label="Route" value="…/event/wirepackets/file" mono />
            </div>
            <p className={`break-all font-mono text-[10px] ${MUTED}`}>
              {displayValue(meta.file?.path ?? meta.path)}
            </p>
            <WirepacketsFileViewer
              substrate={substrate}
              activation={activation}
              meta={meta}
            />
          </div>
        )}
      </section>

      {/* Network-scoped payload board with persisted depth objects */}
      <section className="min-w-0">
        <h3 className="text-xs font-semibold sm:text-sm">Payload board · depth objects</h3>
        {data.kinds === null ? (
          <p className={`mt-1 text-xs ${MUTED}`}>Payload board is unavailable.</p>
        ) : data.kinds.length === 0 ? (
          <p className={`mt-1 text-xs ${MUTED}`}>
            No in-scope payload kind is reported for this network.
          </p>
        ) : (
          data.kinds.map((entry) => (
            <div
              key={entry.kind}
              className="mt-2 min-w-0 space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
            >
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <CompactValue label="Kind" value={entry.kind} />
                <CompactValue label="Network registered" value={entry.available} />
                <CompactValue label="Depth record" value={entry.depth_record} mono />
                <CompactValue label="Depth objects" value={entry.depth_objects.length} />
              </div>
              <p className={`break-all font-mono text-[10px] ${MUTED}`}>
                {displayValue(entry.depth_path)}
              </p>
              {entry.depth_objects.length > 0 && (
                <ObjectTable
                  rows={entry.depth_objects}
                  columns={["position", "identifier", "mass", "from"]}
                />
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";

  if (Array.isArray(value)) {
    return value.length
      ? value.map((item) => displayValue(item)).join(", ")
      : "—";
  }

  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value) {
  return !isPlainObject(value) && !Array.isArray(value);
}

function isPrimitiveArray(value) {
  return Array.isArray(value) && value.every(isScalar);
}

function humanizeKey(key) {
  return String(key).replace(/[_-]+/g, " ").trim();
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildScopeKey(name, activation, networkId, pathId) {
  if (!name || !networkId || !pathId) return "";
  return `${name}:${activation}:${networkId}:${pathId}`;
}

function getPathIdentifier(entry) {
  return String(
    entry?.path ??
      entry?.identifier ??
      entry?.network_path ??
      entry?.name ??
      entry?.id ??
      "",
  );
}

function getNetworkId(entry) {
  return String(entry?.id ?? entry?.name ?? "").trim();
}

function getSubstrateName(entry) {
  return String(entry?.name ?? "");
}

function formatTimestamp(value) {
  if (value === null || value === undefined || value === "") return "—";

  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);

  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function parseActivation(value) {
  if (value === null || value === undefined || value === "") return 0;

  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : 0;
}

function diagnosticClass(status) {
  if (status === "live" || status === "running") {
    return "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  return "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

function DiagnosticBadge({ status, children }) {
  return (
    <span
      className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium leading-4 ${diagnosticClass(status)}`}
    >
      {children}
    </span>
  );
}

function DiagnosticValue({ label, value }) {
  return (
    <div className="min-w-0 overflow-hidden">
      <p className={`break-words text-[10px] font-medium uppercase tracking-wide ${MUTED} [overflow-wrap:anywhere]`}>
        {label}
      </p>
      <p className="mt-0.5 min-w-0 break-words text-xs font-medium [overflow-wrap:anywhere]">
        {displayValue(value)}
      </p>
    </div>
  );
}

function CompactValue({ label, value, mono = false, title }) {
  const text = displayValue(value);
  const tip = title ? `${text} — ${title}` : text;
  const valueClass = "mt-0.5 block truncate whitespace-nowrap text-xs font-medium";

  return (
    <div className="min-w-0 rounded-lg bg-zinc-50 px-2 py-1.5 text-center dark:bg-zinc-950/60">
      <p className={`truncate whitespace-nowrap text-[10px] font-medium uppercase tracking-wide ${MUTED}`}>
        {label}
      </p>
      {mono ? (
        <code title={tip} className={`${valueClass} font-mono`}>
          {text}
        </code>
      ) : (
        <p title={tip} className={valueClass}>
          {text}
        </p>
      )}
    </div>
  );
}

function ErrorMessage({ children }) {
  if (!children) return null;

  return (
    <p
      role="status"
      className={`min-w-0 break-words text-xs leading-5 ${ERROR_TEXT} [overflow-wrap:anywhere]`}
    >
      {children}
    </p>
  );
}

function ObjectTable({ rows, columns = [] }) {
  const normalized = rows.map((row) =>
    isPlainObject(row) ? row : { value: row },
  );

  const keys = [...columns];

  for (const row of normalized) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }

  const cols = keys.slice(0, 10);

  if (normalized.length === 0 || cols.length === 0) return null;

  const cell = (value) => (
    <span className="[overflow-wrap:anywhere]">{displayValue(value)}</span>
  );

  return (
    <div className="min-w-0">
      <div className="hidden w-full min-w-0 overflow-x-auto sm:block">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <tr>
              {cols.map((key) => (
                <th key={key} className="whitespace-nowrap px-3 py-2 sm:px-4">
                  {humanizeKey(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {normalized.map((row, index) => (
              <tr key={index} className="align-top">
                {cols.map((key) => (
                  <td
                    key={key}
                    className="max-w-[260px] px-3 py-2 font-mono text-[10px] sm:px-4"
                  >
                    {cell(row[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:hidden">
        {normalized.map((row, index) => (
          <div
            key={index}
            className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <dl className="grid grid-cols-1 gap-2">
              {cols.map((key) => (
                <div key={key} className="min-w-0">
                  <dt className={`text-[10px] font-medium uppercase tracking-wide ${MUTED}`}>
                    {humanizeKey(key)}
                  </dt>
                  <dd className="mt-0.5 min-w-0 text-xs font-medium">
                    {cell(row[key])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResponseFields({ data, omit = [], depth = 0 }) {
  if (!isPlainObject(data)) return null;

  const entries = Object.entries(data).filter(([key]) => !omit.includes(key));
  const scalars = entries.filter(
    ([, value]) => isScalar(value) || isPrimitiveArray(value),
  );
  const objects = entries.filter(([, value]) => isPlainObject(value));
  const arrays = entries.filter(
    ([, value]) => Array.isArray(value) && !isPrimitiveArray(value),
  );

  if (entries.length === 0) return null;

  return (
    <div className="min-w-0 space-y-3">
      {scalars.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
          {scalars.map(([key, value]) => (
            <DiagnosticValue key={key} label={humanizeKey(key)} value={value} />
          ))}
        </div>
      )}

      {objects.map(([key, value]) => (
        <details
          key={key}
          open={depth === 0 && Object.keys(value).length <= 6}
          className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
            {humanizeKey(key)}
            <span className={`ml-2 font-normal ${MUTED}`}>
              {Object.keys(value).length} fields
            </span>
          </summary>
          <div className="min-w-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
            {depth >= 2 ? (
              <pre className="max-h-60 overflow-auto text-[10px] leading-4">
                {safeJson(value)}
              </pre>
            ) : (
              <ResponseFields data={value} depth={depth + 1} />
            )}
          </div>
        </details>
      ))}

      {arrays.map(([key, value]) => (
        <details
          key={key}
          open
          className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800"
        >
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
            {humanizeKey(key)}
            <span className={`ml-2 font-normal ${MUTED}`}>
              {value.length} items
            </span>
          </summary>
          <div className="min-w-0 border-t border-zinc-200 p-2 dark:border-zinc-800">
            <ObjectTable rows={value} />
          </div>
        </details>
      ))}
    </div>
  );
}

function getEventKey(event, index) {
  const record = event?.record ?? event?.record_name ?? event?.id ?? "";
  const kind = event?.kind ?? event?.type ?? "event";
  const activation = event?.activation ?? "";
  const dimension = event?.dimension ?? "";

  return record || activation || dimension
    ? `${kind}-${activation}-${dimension}-${record}`
    : `${kind}-${index}`;
}

function updateSubstrateQuery(name) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);

  if (name) url.searchParams.set(SUBSTRATE_QUERY_KEY, name);
  else url.searchParams.delete(SUBSTRATE_QUERY_KEY);

  window.history.replaceState({}, "", url);
}

function getSubstrateQuery() {
  if (typeof window === "undefined") return "";

  return new URLSearchParams(window.location.search).get(SUBSTRATE_QUERY_KEY) ?? "";
}

function resolvePreferredSubstrate(entries, preferred, current) {
  const names = entries.map(getSubstrateName).filter(Boolean);

  if (preferred && names.includes(preferred)) return preferred;
  if (current && names.includes(current)) return current;

  return names[0] || "";
}

export default function NetworkPage() {
  const [networks, setNetworks] = useState([]);
  const [substrates, setSubstrates] = useState([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedSubstrate, setSelectedSubstrate] = useState("");
  const [selectedActivation, setSelectedActivation] = useState(0);

  const [substrateState, setSubstrateState] = useState(null);
  const [eventStore, setEventStore] = useState(null);

  const [observation, setObservation] = useState(null);
  const [observationList, setObservationList] = useState([]);
  const [observationScope, setObservationScope] = useState("");
  const [observationStale, setObservationStale] = useState(false);
  const [observationNotice, setObservationNotice] = useState("");
  const [observationLoading, setObservationLoading] = useState(false);
  const [observationActionLoading, setObservationActionLoading] = useState(false);
  const [observationError, setObservationError] = useState("");
  const [lastObservationCheck, setLastObservationCheck] = useState(null);
  const [pipelineData, setPipelineData] = useState(null);

  const [networkLoading, setNetworkLoading] = useState(true);
  const [substrateLoading, setSubstrateLoading] = useState(true);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [substrateListError, setSubstrateListError] = useState("");
  const [stateError, setStateError] = useState("");
  const [eventStoreError, setEventStoreError] = useState("");
  const [stateStatus, setStateStatus] = useState("unknown");
  const [eventStoreStatus, setEventStoreStatus] = useState("unknown");
  const [lastNetworkCheck, setLastNetworkCheck] = useState(null);
  const [lastSubstrateCheck, setLastSubstrateCheck] = useState(null);
  const [lastDiagnosticsCheck, setLastDiagnosticsCheck] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const networkRequestRef = useRef(null);
  const substrateRequestRef = useRef(null);
  const diagnosticsRequestRef = useRef(null);
  const observationRequestRef = useRef(null);

  const networkRequestIdRef = useRef(0);
  const substrateRequestIdRef = useRef(0);
  const diagnosticsRequestIdRef = useRef(0);
  const observationRequestIdRef = useRef(0);

  const observationScopeRef = useRef("");
  const observationDataRef = useRef(null);
  const observationMutationRef = useRef(0);
  const observationHoldRef = useRef({ scope: "", until: 0, running: false });

  const diagnosticsSubstrateRef = useRef("");
  const observationContextRef = useRef("");
  const requestedSubstrateRef = useRef(null);
  const selectedSubstrateRef = useRef("");
  const selectedPathRef = useRef("");
  const selectedActivationRef = useRef(0);
  const activationInitializedRef = useRef(false);

  useEffect(() => {
    if (requestedSubstrateRef.current === null) {
      requestedSubstrateRef.current = getSubstrateQuery();
    }
  }, []);

  useEffect(() => {
    selectedSubstrateRef.current = selectedSubstrate;
  }, [selectedSubstrate]);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    selectedActivationRef.current = selectedActivation;
  }, [selectedActivation]);

  const setActivationSynced = useCallback((value) => {
    const next = parseActivation(value);
    selectedActivationRef.current = next;
    setSelectedActivation(next);
  }, []);

  const resetObservation = useCallback((scope) => {
    observationScopeRef.current = scope;
    observationDataRef.current = null;
    observationHoldRef.current = { scope: "", until: 0, running: false };

    setObservationScope(scope);
    setObservation(null);
    setObservationList([]);
    setPipelineData(null);
    setObservationStale(false);
    setObservationNotice("");
  }, []);

  const claimObservationScope = useCallback(
    (scope) => {
      if (observationScopeRef.current === scope) return;

      resetObservation(scope);
      setObservationError("");
    },
    [resetObservation],
  );

  const commitObservation = useCallback((scope, value) => {
    observationScopeRef.current = scope;
    observationDataRef.current = value;
    setObservationScope(scope);
    setObservation(value);
  }, []);

  const loadNetworks = useCallback(async ({ silent = false } = {}) => {
    networkRequestRef.current?.abort();

    const requestId = ++networkRequestIdRef.current;
    const controller = new AbortController();
    networkRequestRef.current = controller;

    if (!silent) {
      setNetworkLoading(true);
      setNetworkError("");
    }

    try {
      const result = await apiRequest("/networks", controller.signal);

      if (requestId !== networkRequestIdRef.current) return;

      const entries = normalizeEntries(result, ["networks"]).filter((entry) =>
        getPathIdentifier(entry),
      );

      setNetworks(entries);
      setLastNetworkCheck(new Date());

      const current = selectedPathRef.current;
      const stillValid =
        current && entries.some((entry) => getPathIdentifier(entry) === current);

      const next = stillValid
        ? current
        : entries.length
          ? getPathIdentifier(entries[0])
          : "";

      if (next !== current) {
        selectedPathRef.current = next;
        setSelectedPath(next);
      }

      setNetworkError("");
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        requestId !== networkRequestIdRef.current
      ) {
        return;
      }

      setNetworkError(
        error instanceof Error
          ? error.message
          : "Unable to load registered network paths.",
      );
    } finally {
      if (requestId === networkRequestIdRef.current && !silent) {
        setNetworkLoading(false);
      } else if (requestId === networkRequestIdRef.current && silent) {
        setNetworkLoading(false);
      }
    }
  }, []);

  const loadSubstrates = useCallback(async ({ silent = false } = {}) => {
    substrateRequestRef.current?.abort();

    const requestId = ++substrateRequestIdRef.current;
    const controller = new AbortController();
    substrateRequestRef.current = controller;

    if (!silent) {
      setSubstrateLoading(true);
      setSubstrateListError("");
    }

    try {
      const result = await apiRequest("/wallets", controller.signal);

      if (requestId !== substrateRequestIdRef.current) return;

      const entries = normalizeEntries(result, ["substrates"]).filter(
        (entry) => getSubstrateName(entry),
      );

      setSubstrates(entries);
      setLastSubstrateCheck(new Date());

      const preferred =
        requestedSubstrateRef.current === null
          ? ""
          : requestedSubstrateRef.current;

      const resolved = resolvePreferredSubstrate(
        entries,
        preferred,
        selectedSubstrateRef.current,
      );

      if (requestedSubstrateRef.current !== null) {
        requestedSubstrateRef.current = "";
      }

      if (resolved !== selectedSubstrateRef.current) {
        selectedSubstrateRef.current = resolved;
        setSelectedSubstrate(resolved);
        updateSubstrateQuery(resolved);
      }

      setSubstrateListError("");
    } catch (error) {
      if (
        error?.name === "AbortError" ||
        requestId !== substrateRequestIdRef.current
      ) {
        return;
      }

      setSubstrateListError(
        error instanceof Error
          ? error.message
          : "Unable to load persisted substrates.",
      );
    } finally {
      if (requestId === substrateRequestIdRef.current) {
        setSubstrateLoading(false);
      }
    }
  }, []);

  const loadHostDiagnostics = useCallback(
    async (name, { silent = false } = {}) => {
      if (!name) {
        diagnosticsRequestRef.current?.abort();
        diagnosticsRequestIdRef.current += 1;
        diagnosticsSubstrateRef.current = "";

        setSubstrateState(null);
        setEventStore(null);
        setStateStatus("unknown");
        setEventStoreStatus("unknown");
        setStateError("");
        setEventStoreError("");
        setDiagnosticsLoading(false);
        return;
      }

      diagnosticsRequestRef.current?.abort();

      const requestId = ++diagnosticsRequestIdRef.current;
      diagnosticsSubstrateRef.current = name;

      const controller = new AbortController();
      diagnosticsRequestRef.current = controller;

      const isCurrent = () =>
        requestId === diagnosticsRequestIdRef.current &&
        diagnosticsSubstrateRef.current === name &&
        selectedSubstrateRef.current === name;

      if (!silent) {
        setSubstrateState(null);
        setEventStore(null);
        setStateError("");
        setEventStoreError("");
        setStateStatus("checking");
        setEventStoreStatus("checking");
        setDiagnosticsLoading(true);
      }

      const encodedName = encodeURIComponent(name);

      try {
        const [stateResult, eventsResult] = await Promise.allSettled([
          apiRequest(`/wallets/${encodedName}`, controller.signal),
          apiRequest(`/wallets/${encodedName}/events`, controller.signal),
        ]);

        if (!isCurrent()) return;

        const stateAborted =
          stateResult.status === "rejected" &&
          stateResult.reason?.name === "AbortError";

        const eventsAborted =
          eventsResult.status === "rejected" &&
          eventsResult.reason?.name === "AbortError";

        if (stateAborted || eventsAborted) return;

        if (stateResult.status === "fulfilled") {
          setSubstrateState(stateResult.value);
          setStateStatus("live");
          setStateError("");
        } else {
          setStateStatus("error");
          setStateError(
            stateResult.reason instanceof Error
              ? stateResult.reason.message
              : "Persisted substrate state could not be read.",
          );
        }

        if (eventsResult.status === "fulfilled") {
          const result = eventsResult.value;
          const events = normalizeEntries(result, ["events"]);

          setEventStore({ ...result, events });
          setEventStoreStatus("live");
          setEventStoreError("");

          const unique = Array.from(
            new Set(events.map((event) => parseActivation(event?.activation))),
          );
          const current = selectedActivationRef.current;

          if (!activationInitializedRef.current && unique.length > 0) {
            activationInitializedRef.current = true;
            setActivationSynced(Math.max(...unique));
          } else if (!silent && unique.length > 0 && !unique.includes(current)) {
            setActivationSynced(Math.max(...unique));
          }
        } else {
          setEventStoreStatus("error");
          setEventStoreError(
            eventsResult.reason instanceof Error
              ? eventsResult.reason.message
              : "Persistent event store could not be read.",
          );
        }

        setLastDiagnosticsCheck(new Date());
      } finally {
        if (isCurrent() && !silent) setDiagnosticsLoading(false);
      }
    },
    [setActivationSynced],
  );

  const selectedNetwork = useMemo(
    () =>
      networks.find((entry) => getPathIdentifier(entry) === selectedPath) ?? null,
    [networks, selectedPath],
  );

  const selectedNetworkId = selectedNetwork ? getNetworkId(selectedNetwork) : "";
  const observationHasNetworkContext = Boolean(selectedNetwork);

  const loadObservation = useCallback(
    async ({ silent = false } = {}) => {
      const name = selectedSubstrateRef.current;
      const networkId = selectedNetworkId;
      const activation = selectedActivationRef.current;
      const pathId = selectedPathRef.current;

      observationRequestRef.current?.abort();

      if (!name || !networkId || !pathId) {
        observationRequestIdRef.current += 1;
        observationContextRef.current = "";
        resetObservation("");
        setObservationError("");
        setObservationLoading(false);
        return;
      }

      const requestId = ++observationRequestIdRef.current;
      const mutationVersion = observationMutationRef.current;
      const contextKey = buildScopeKey(name, activation, networkId, pathId);

      observationContextRef.current = contextKey;
      claimObservationScope(contextKey);

      const controller = new AbortController();
      observationRequestRef.current = controller;

      const isCurrent = () =>
        requestId === observationRequestIdRef.current &&
        mutationVersion === observationMutationRef.current &&
        observationContextRef.current === contextKey &&
        selectedSubstrateRef.current === name &&
        selectedPathRef.current === pathId &&
        selectedActivationRef.current === activation;

      if (!silent) setObservationError("");
      setObservationLoading(true);

      const encodedName = encodeURIComponent(name);
      const encodedNetwork = encodeURIComponent(networkId);
      const basePath = `/wallets/${encodedName}/activations/${activation}`;

      try {
        const results = await fetchPipelineData(
          basePath,
          encodedNetwork,
          controller.signal,
        );
        const statusResult = results.status;
        const listResult = results.pipelines;

        if (!isCurrent()) return;

        const statusAborted =
          statusResult.status === "rejected" &&
          statusResult.reason?.name === "AbortError";

        const listAborted =
          listResult.status === "rejected" &&
          listResult.reason?.name === "AbortError";

        if (statusAborted || listAborted) return;

        setPipelineData(buildPipelineData(contextKey, results));

        if (listResult.status === "fulfilled") {
          setObservationList(
            normalizeEntries(listResult.value, ["pipelines", "observations"]),
          );
        }

        const previous = observationDataRef.current;

        if (statusResult.status === "fulfilled") {
          const payload = statusResult.value;
          const hasPayload =
            isPlainObject(payload) && Object.keys(payload).length > 0;

          const hold = observationHoldRef.current;
          const held = hold.scope === contextKey && Date.now() < hold.until;

          const contradictsHold =
            held &&
            hasPayload &&
            payload.running !== undefined &&
            Boolean(payload.running) !== hold.running;

          if (!hasPayload) {
            if (previous) setObservationStale(true);
          } else if (!contradictsHold) {
            observationDataRef.current = payload;
            setObservation(payload);
            setObservationStale(false);
            setObservationNotice("");
          }

          setObservationError("");
        } else {
          const error = statusResult.reason;
          const message =
            error instanceof Error
              ? error.message
              : "Observation status unavailable.";

          const notFound =
            message.includes("[HTTP 404]") ||
            message.toLowerCase().includes("no live") ||
            message.toLowerCase().includes("not found");

          if (previous) setObservationStale(true);
          setObservationError(notFound ? "" : message);
        }

        setLastObservationCheck(new Date());
      } catch (error) {
        if (error?.name === "AbortError" || !isCurrent()) return;

        if (observationDataRef.current) setObservationStale(true);

        setObservationError(
          error instanceof Error
            ? error.message
            : "Observation status unavailable.",
        );
      } finally {
        if (isCurrent()) setObservationLoading(false);
      }
    },
    [selectedNetworkId, claimObservationScope, resetObservation],
  );

  const startObservation = useCallback(async () => {
    const name = selectedSubstrateRef.current;
    const activation = selectedActivationRef.current;
    const pathId = selectedPathRef.current;
    const networkId = selectedNetworkId;

    const pathHint = selectedNetwork ? getPathIdentifier(selectedNetwork) : pathId;

    if (!name || !networkId) return;

    const scope = buildScopeKey(name, activation, networkId, pathId);

    observationMutationRef.current += 1;
    const mutationVersion = observationMutationRef.current;

    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;

    setObservationLoading(false);
    claimObservationScope(scope);
    setObservationActionLoading(true);
    setObservationError("");
    setObservationNotice("Starting pipeline");

    const stillSameScope = () =>
      mutationVersion === observationMutationRef.current &&
      selectedSubstrateRef.current === name &&
      selectedActivationRef.current === activation &&
      selectedPathRef.current === pathId;

    try {
      const basePath = `/wallets/${encodeURIComponent(name)}/activations/${activation}`;
      const encodedNetwork = encodeURIComponent(networkId);

      // 1. POST …/networks/:network/observation → start_bitcoin_observation.
      //    Starts (or joins) the single stream owned by the stream manager for
      //    this substrate · activation.
      const started = await apiRequest(
        `${basePath}/networks/${encodedNetwork}/observation`,
        undefined,
        { method: "POST", body: pathHint ? { path: pathHint } : {} },
      );

      if (!stillSameScope()) return;

      if (!isPlainObject(started) || started.running !== true) {
        throw new Error(
          started?.message ||
            "The API did not confirm that the observation stream is running.",
        );
      }

      // The start itself succeeded. Show it before the follow-up reads.
      commitObservation(scope, started);
      setObservationStale(false);
      setObservationNotice("Reading pipeline data");

      // 2. Read everything the API currently has: status, activation
      //    pipelines, wirepackets metadata and the payload board (depth
      //    objects). The stream works asynchronously, so an empty result right
      //    after start is normal.
      const results = await fetchPipelineData(basePath, encodedNetwork);

      if (!stillSameScope()) return;

      const status =
        results.status.status === "fulfilled" && isPlainObject(results.status.value)
          ? results.status.value
          : null;

      commitObservation(scope, status ? { ...started, ...status } : started);

      if (results.pipelines.status === "fulfilled") {
        setObservationList(
          normalizeEntries(results.pipelines.value, ["pipelines", "observations"]),
        );
      }

      const data = buildPipelineData(scope, results);
      setPipelineData(data);

      setObservationStale(false);
      setObservationNotice(
        data.errors.length
          ? "Pipeline running · some data unavailable"
          : "Pipeline running · data retrieved",
      );

      observationHoldRef.current = {
        scope,
        until: Date.now() + MUTATION_HOLD_MS,
        running: true,
      };

      setLastObservationCheck(new Date());
    } catch (error) {
      if (error?.name === "AbortError" || !stillSameScope()) return;

      setObservationError(
        error instanceof Error ? error.message : "Unable to start observation.",
      );
      setObservationNotice("");
    } finally {
      if (mutationVersion === observationMutationRef.current) {
        setObservationActionLoading(false);
      }
    }
  }, [
    selectedNetwork,
    selectedNetworkId,
    claimObservationScope,
    commitObservation,
  ]);

  const stopObservation = useCallback(async () => {
    const name = selectedSubstrateRef.current;
    const activation = selectedActivationRef.current;
    const pathId = selectedPathRef.current;
    const networkId = selectedNetworkId;

    if (!name || !networkId) return;

    const scope = buildScopeKey(name, activation, networkId, pathId);

    observationMutationRef.current += 1;
    const mutationVersion = observationMutationRef.current;

    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;

    setObservationLoading(false);
    claimObservationScope(scope);
    setObservationActionLoading(true);
    setObservationError("");

    const stillSameScope = () =>
      mutationVersion === observationMutationRef.current &&
      selectedSubstrateRef.current === name &&
      selectedActivationRef.current === activation &&
      selectedPathRef.current === pathId;

    try {
      const encodedName = encodeURIComponent(name);
      const encodedNetwork = encodeURIComponent(networkId);
      const basePath =
        `/wallets/${encodedName}/activations/${activation}` +
        `/networks/${encodedNetwork}/observation`;

      const stopped = await apiRequest(basePath, undefined, {
        method: "DELETE",
      });

      if (!stillSameScope()) return;

      const payload = {
        ...(isPlainObject(stopped) ? stopped : {}),
        running: false,
      };

      if (!payload.message) payload.message = "Stop request accepted.";

      commitObservation(scope, payload);
      setObservationList([]);
      setObservationStale(false);
      setObservationNotice("Stop accepted");
      observationHoldRef.current = {
        scope,
        until: Date.now() + MUTATION_HOLD_MS,
        running: false,
      };
      setLastObservationCheck(new Date());
    } catch (error) {
      if (error?.name === "AbortError" || !stillSameScope()) return;

      setObservationError(
        error instanceof Error ? error.message : "Unable to stop observation.",
      );
    } finally {
      if (mutationVersion === observationMutationRef.current) {
        setObservationActionLoading(false);
      }
    }
  }, [selectedNetworkId, claimObservationScope, commitObservation]);

  useEffect(() => {
    loadNetworks();
    loadSubstrates();

    return () => {
      networkRequestRef.current?.abort();
      substrateRequestRef.current?.abort();
      diagnosticsRequestRef.current?.abort();
      observationRequestRef.current?.abort();

      networkRequestIdRef.current += 1;
      substrateRequestIdRef.current += 1;
      diagnosticsRequestIdRef.current += 1;
      observationRequestIdRef.current += 1;
    };
  }, [loadNetworks, loadSubstrates]);

  useEffect(() => {
    if (!selectedSubstrate) {
      diagnosticsRequestRef.current?.abort();
      diagnosticsRequestIdRef.current += 1;
      diagnosticsSubstrateRef.current = "";
      activationInitializedRef.current = false;

      setSubstrateState(null);
      setEventStore(null);
      setStateStatus("unknown");
      setEventStoreStatus("unknown");
      setStateError("");
      setEventStoreError("");
      setDiagnosticsLoading(false);
      return undefined;
    }

    activationInitializedRef.current = false;
    loadHostDiagnostics(selectedSubstrate);

    return () => diagnosticsRequestRef.current?.abort();
  }, [selectedSubstrate, loadHostDiagnostics]);

  useEffect(() => {
    loadObservation();

    return () => observationRequestRef.current?.abort();
  }, [
    selectedSubstrate,
    selectedPath,
    selectedActivation,
    selectedNetworkId,
    loadObservation,
  ]);

  useEffect(() => {
    if (!autoRefresh) return undefined;

    const interval = setInterval(() => {
      loadNetworks({ silent: true });
      loadSubstrates({ silent: true });

      if (selectedSubstrateRef.current) {
        loadHostDiagnostics(selectedSubstrateRef.current, { silent: true });
      }

      loadObservation({ silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [
    autoRefresh,
    loadNetworks,
    loadSubstrates,
    loadHostDiagnostics,
    loadObservation,
  ]);

  const persistedEvents = eventStore?.events ?? [];
  const runtime = eventStore?.runtime ?? null;

  const activationOptions = useMemo(() => {
    const values = new Set();

    const host = substrates.find(
      (entry) => getSubstrateName(entry) === selectedSubstrate,
    );

    values.add(parseActivation(host?.activations));

    for (const event of persistedEvents) {
      values.add(parseActivation(event?.activation));
    }

    values.add(selectedActivation);

    return Array.from(values)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }, [substrates, selectedSubstrate, persistedEvents, selectedActivation]);

  const refreshAll = () => {
    loadNetworks({ silent: true });
    loadSubstrates({ silent: true });

    if (selectedSubstrateRef.current) {
      loadHostDiagnostics(selectedSubstrateRef.current, { silent: true });
    }

    loadObservation({ silent: true });
  };

  const handleSubstrateChange = (event) => {
    const name = event.target.value;

    diagnosticsRequestRef.current?.abort();
    diagnosticsRequestIdRef.current += 1;
    diagnosticsSubstrateRef.current = name;

    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;
    observationContextRef.current = "";

    requestedSubstrateRef.current = "";
    selectedSubstrateRef.current = name;
    activationInitializedRef.current = false;

    setSelectedSubstrate(name);
    updateSubstrateQuery(name);

    setSubstrateState(null);
    setEventStore(null);
    setStateError("");
    setEventStoreError("");
    setStateStatus(name ? "checking" : "unknown");
    setEventStoreStatus(name ? "checking" : "unknown");

    resetObservation("");
    setObservationError("");
    setObservationLoading(false);
  };

  const handlePathSelect = (identifier) => {
    if (identifier === selectedPathRef.current) return;

    selectedPathRef.current = identifier;
    observationRequestRef.current?.abort();
    observationRequestIdRef.current += 1;
    observationContextRef.current = "";

    setSelectedPath(identifier);
    resetObservation("");
    setObservationError("");
    setObservationLoading(false);
  };

  const handleActivationChange = (event) => {
    setActivationSynced(event.target.value);
  };

  const selectedHostEntry = substrates.find(
    (entry) => getSubstrateName(entry) === selectedSubstrate,
  );

  const hostLive = stateStatus === "live" && eventStoreStatus === "live";

  const hostStatus = hostLive
    ? "live"
    : stateStatus === "error" || eventStoreStatus === "error"
      ? "error"
      : diagnosticsLoading
        ? "checking"
        : "unknown";

  const currentScopeKey = buildScopeKey(
    selectedSubstrate,
    selectedActivation,
    selectedNetworkId,
    selectedPath,
  );

  const scopeMatches = Boolean(
    currentScopeKey && observationScope === currentScopeKey,
  );

  const scopedObservation = scopeMatches ? observation : null;
  const scopedObservationList = scopeMatches ? observationList : [];
  const scopedPipelineData =
    pipelineData && pipelineData.scope === currentScopeKey ? pipelineData : null;

  const observationListRows = scopedObservationList.map((row) => {
    if (!isPlainObject(row)) return row;
    // listen_port is derived from the commitment (listen_port_from_commitment);
    // it is labelled as such and is not evidence of a bound listener.
    const {
      commitment: _domainCommitment,
      event: _event,
      listen_port: derivedPort,
      message: _message,
      ...rest
    } = row;
    return { network: rest.network, derived_port: derivedPort, ...rest };
  });

  const observationRunning = Boolean(scopedObservation?.running);

  const observationBadge = observationError
    ? { status: "error", label: "Error" }
    : observationRunning
      ? { status: "running", label: "Running" }
      : observationLoading && !scopedObservation
        ? { status: "checking", label: "Checking" }
        : scopedObservation
          ? { status: "live", label: "Idle" }
          : { status: "unknown", label: "Not started" };

  const observationClips = Array.isArray(scopedObservation?.clips)
    ? scopedObservation.clips
    : [];

  const hasExtraObservationFields = scopedObservation
    ? Object.keys(scopedObservation).some(
        (key) => !KNOWN_OBSERVATION_KEYS.includes(key),
      )
    : false;

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full min-w-0 max-w-7xl px-3 py-4 sm:px-5 sm:py-7 lg:px-8">
        <header className="mb-5 sm:mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl md:text-3xl">
            Network
          </h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-600 dark:text-zinc-400 sm:text-sm sm:leading-6">
            Network observation is scoped to the selected substrate, activation,
            and registered path. The substrate remains the persistent host for
            system state and event records.
          </p>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button type="button" onClick={refreshAll} className={BUTTON_PRIMARY}>
              Refresh
            </button>

            <button
              type="button"
              onClick={() => setAutoRefresh((value) => !value)}
              aria-pressed={autoRefresh}
              className={BUTTON}
            >
              Live updates: {autoRefresh ? "On" : "Off"}
            </button>

            <a
              href={
                selectedSubstrate
                  ? `/?substrate=${encodeURIComponent(selectedSubstrate)}`
                  : "/"
              }
              className={BUTTON}
            >
              Back to QTM
            </a>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <DiagnosticBadge status="unknown">
              {networks.length} registered paths
            </DiagnosticBadge>
            <DiagnosticBadge status="unknown">
              {substrates.length} substrates
            </DiagnosticBadge>
            <DiagnosticBadge status={hostStatus}>
              {hostLive
                ? "Substrate reachable"
                : hostStatus === "error"
                  ? "Substrate check failed"
                  : hostStatus === "checking"
                    ? "Checking substrate"
                    : "Substrate not confirmed"}
            </DiagnosticBadge>
            <DiagnosticBadge status={observationBadge.status}>
              {observationBadge.status === "running"
                ? "Observation running"
                : observationBadge.status === "checking"
                  ? "Observation checking"
                  : observationBadge.status === "error"
                    ? "Observation error"
                    : observationBadge.status === "live"
                      ? "Observation idle"
                      : "Observation not started"}
            </DiagnosticBadge>
          </div>

          <p className={`mt-2 break-words text-[10px] sm:text-xs ${MUTED}`}>
            {lastNetworkCheck
              ? `Paths checked ${lastNetworkCheck.toLocaleTimeString()}`
              : "Waiting for network data"}
            {" · "}
            {lastSubstrateCheck
              ? `Substrates checked ${lastSubstrateCheck.toLocaleTimeString()}`
              : "Waiting for substrate data"}
            {" · "}
            {REFRESH_INTERVAL_MS / 1000}s refresh interval
          </p>
        </header>

        {networkError && (
          <div className="mb-3">
            <ErrorMessage>{networkError}</ErrorMessage>
          </div>
        )}

        <section className={`${PANEL} mb-4 p-3 sm:p-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold sm:text-base">
                Substrate environment
              </h2>
              <p className={`mt-1 text-[11px] leading-5 sm:text-xs ${MUTED}`}>
                Persistent host for state and events. Shared with the main QTM
                page through the substrate URL parameter.
              </p>
            </div>
            <DiagnosticBadge status={hostStatus}>
              {hostLive
                ? "Reachable"
                : hostStatus === "error"
                  ? "Check failed"
                  : diagnosticsLoading
                    ? "Checking"
                    : "Not checked"}
            </DiagnosticBadge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_auto]">
            <label className="block min-w-0">
              <span className={`mb-1.5 block text-[10px] font-medium uppercase tracking-wide ${MUTED}`}>
                Substrate
              </span>
              <select
                value={selectedSubstrate}
                onChange={handleSubstrateChange}
                disabled={substrateLoading || substrates.length === 0}
                className="h-9 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
              >
                {substrates.length === 0 && (
                  <option value="">
                    {substrateLoading ? "Loading substrates…" : "No substrates found"}
                  </option>
                )}
                {substrates.map((substrate) => {
                  const name = getSubstrateName(substrate);
                  return <option key={name} value={name}>{name}</option>;
                })}
              </select>
            </label>

            <label className="block min-w-0">
              <span className={`mb-1.5 block text-[10px] font-medium uppercase tracking-wide ${MUTED}`}>
                Activation
              </span>
              <select
                value={selectedActivation}
                onChange={handleActivationChange}
                disabled={!selectedSubstrate}
                className="h-9 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
              >
                {activationOptions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>

            <div className="flex items-end sm:col-span-2 lg:col-span-1">
              <button
                type="button"
                onClick={() => loadHostDiagnostics(selectedSubstrate)}
                disabled={!selectedSubstrate || diagnosticsLoading}
                className={`${BUTTON} w-full lg:w-auto`}
              >
                Check substrate
              </button>
            </div>
          </div>

          {substrateListError && (
            <div className="mt-3"><ErrorMessage>{substrateListError}</ErrorMessage></div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">Persisted system state</p>
                <DiagnosticBadge status={stateStatus}>
                  {stateStatus === "live" ? "Reachable" : stateStatus === "error" ? "Unavailable" : stateStatus === "checking" ? "Checking" : "Not checked"}
                </DiagnosticBadge>
              </div>
              {stateError && <p className={`mt-2 break-words text-xs ${ERROR_TEXT} [overflow-wrap:anywhere]`}>{stateError}</p>}
            </div>

            <div className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">Persistent event store</p>
                <DiagnosticBadge status={eventStoreStatus}>
                  {eventStoreStatus === "live" ? "Readable" : eventStoreStatus === "error" ? "Unavailable" : eventStoreStatus === "checking" ? "Checking" : "Not checked"}
                </DiagnosticBadge>
              </div>
              {eventStoreError && <p className={`mt-2 break-words text-xs ${ERROR_TEXT} [overflow-wrap:anywhere]`}>{eventStoreError}</p>}
            </div>
          </div>

          {lastDiagnosticsCheck && (
            <p className={`mt-2 text-[10px] ${MUTED}`}>
              Diagnostics checked {lastDiagnosticsCheck.toLocaleTimeString()}
            </p>
          )}
        </section>

        {substrateState && (
          <section className={`${PANEL} mb-4`}>
            <div className="border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
              <h2 className="text-sm font-semibold sm:text-base">Substrate system state</h2>
              <p className={`mt-1 break-all text-[10px] sm:text-xs ${MUTED}`}>
                {displayValue(substrateState.namespace)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 p-3 min-[420px]:grid-cols-2 sm:grid-cols-3 sm:p-4 lg:grid-cols-4">
              <DiagnosticValue label="Substrate" value={selectedSubstrate} />
              <DiagnosticValue label="Dimension" value={substrateState.dimension} />
              <DiagnosticValue label="Commitment" value={substrateState.commitment} />
              <DiagnosticValue label="Coordinate" value={substrateState.coordinate} />
              <DiagnosticValue label="Sigma" value={substrateState.sigma} />
              <DiagnosticValue label="Network" value={substrateState.network} />
              <DiagnosticValue label="Indices" value={substrateState.indices} />
              <DiagnosticValue
                label="Entropy"
                value={substrateState.entropy ? `Present · ${String(substrateState.entropy).length} characters` : "Not available"}
              />
              <DiagnosticValue label="Registered activations" value={selectedHostEntry?.activations} />
            </div>

            <p className={`px-3 pb-3 text-[10px] leading-5 sm:px-4 ${MUTED}`}>
              Entropy content is not displayed. This report only indicates whether the field is present.
            </p>
          </section>
        )}

        {/* Network observation is the primary network operation panel. */}
        <section className={`${PANEL} mb-4 sm:mb-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="whitespace-nowrap text-sm font-semibold sm:text-base">Network observation</h2>
              <DiagnosticBadge status={observationBadge.status}>{observationBadge.label}</DiagnosticBadge>
            </div>
            <span className={`whitespace-nowrap text-[10px] ${MUTED}`}>
              {lastObservationCheck && scopeMatches
                ? `Checked ${lastObservationCheck.toLocaleTimeString()}`
                : autoRefresh
                  ? `Refreshes every ${REFRESH_INTERVAL_MS / 1000}s`
                  : "Live updates off"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 border-b border-zinc-200 p-2 dark:border-zinc-800 sm:grid-cols-4 sm:p-2.5">
            <CompactValue label="Substrate" value={selectedSubstrate || "—"} />
            <CompactValue label="Activation" value={selectedActivation} />
            <CompactValue label="Network ID" value={selectedNetworkId || "—"} />
            <CompactValue label="Path" value={selectedNetwork ? getPathIdentifier(selectedNetwork) : selectedPath || "—"} />
          </div>

          <div className="flex min-h-[2.75rem] flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4" aria-live="polite">
            {observationHasNetworkContext ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={startObservation}
                  disabled={!selectedSubstrate || !selectedNetworkId || observationActionLoading || observationRunning}
                  className={BUTTON_PRIMARY}
                >
                  {observationActionLoading && !observationRunning ? "Starting…" : "Start"}
                </button>
                <button
                  type="button"
                  onClick={stopObservation}
                  disabled={!selectedSubstrate || !selectedNetworkId || observationActionLoading || !observationRunning}
                  className={BUTTON}
                >
                  {observationActionLoading && observationRunning ? "Stopping…" : "Stop"}
                </button>
                <button
                  type="button"
                  onClick={() => loadObservation()}
                  disabled={!selectedSubstrate || !selectedNetworkId || observationLoading || observationActionLoading}
                  className={BUTTON}
                >
                  Refresh status
                </button>
              </div>
            ) : (
              <span className={`text-xs ${MUTED}`}>
                Select a registered network path to scope observation.
              </span>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {observationActionLoading && <DiagnosticBadge status="checking">Applying…</DiagnosticBadge>}
              {observationLoading && !observationActionLoading && <DiagnosticBadge status="checking">Refreshing…</DiagnosticBadge>}
              {scopedObservation && observationStale && <DiagnosticBadge status="checking">Last known result</DiagnosticBadge>}
              {scopedObservation && observationNotice && <DiagnosticBadge status="running">{observationNotice}</DiagnosticBadge>}
            </div>
          </div>

          {observationError && (
            <div className="px-3 pb-2 sm:px-4"><ErrorMessage>{observationError}</ErrorMessage></div>
          )}

          {scopedObservation && (
            <div className="min-w-0 space-y-2 border-t border-zinc-200 p-2 dark:border-zinc-800 sm:p-2.5">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                <CompactValue label="Running" value={scopedObservation.running ? "yes" : "no"} />
                <CompactValue
                  label="Derived port"
                  value={scopedObservation.listen_port}
                  title="Derived from the substrate commitment; not a bound listener"
                />
                <CompactValue label="Path hint" value={scopedObservation.path} />
                <CompactValue
                  label="Runtime"
                  value={scopedObservation.runtime?.unix_seconds !== undefined ? formatTimestamp(scopedObservation.runtime.unix_seconds) : "—"}
                />
                <CompactValue label="Clips" value={observationClips.length} />
              </div>

              {scopedObservation.listen_port !== undefined && (
                <p className={`text-[10px] leading-4 ${MUTED}`}>
                  Derived port {displayValue(scopedObservation.listen_port)} comes from
                  listen_port_from_commitment() over the commitment bytes that travel with
                  the wire packets. The stream is a Mempool.space WebSocket; the API does
                  not report a bound listener on this port.
                </p>
              )}

              {hasExtraObservationFields && (
                <details className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold">Additional response fields</summary>
                  <div className="min-w-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
                    <ResponseFields data={scopedObservation} omit={KNOWN_OBSERVATION_KEYS} />
                  </div>
                </details>
              )}

              <details className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold">Raw runtime response</summary>
                <pre className="max-h-56 overflow-auto border-t border-zinc-200 bg-zinc-50 p-3 text-[10px] leading-4 dark:border-zinc-800 dark:bg-zinc-950">{safeJson(scopedObservation)}</pre>
              </details>
            </div>
          )}

          {scopedObservation && observationClips.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800">
              <div className="px-3 py-1.5 sm:px-4"><h3 className="text-xs font-semibold sm:text-sm">Observation clips</h3></div>
              <div className="min-w-0 px-3 pb-2 sm:px-4">
                <ObjectTable rows={observationClips} columns={["substrate", "active", "direction"]} />
              </div>
            </div>
          )}

          {scopedObservationList.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800">
              <div className="px-3 py-1.5 sm:px-4"><h3 className="text-xs font-semibold sm:text-sm">Activation observation list</h3></div>
              <div className="min-w-0 px-3 pb-2 sm:px-4">
                <ObjectTable rows={observationListRows} columns={["network", "listen_port", "running", "path"]} />
              </div>
            </div>
          )}

          {scopedPipelineData && (
            <PipelineDataPanel
              data={scopedPipelineData}
              substrate={selectedSubstrate}
              activation={selectedActivation}
            />
          )}

          {observationHasNetworkContext && !scopedObservation && !observationLoading && !observationActionLoading && !observationError && (
            <p className={`px-3 py-3 text-center text-xs sm:px-4 ${MUTED}`}>
              No live observation for this path. Start one to request observation through the QTM runtime.
            </p>
          )}

          {observationLoading && !scopedObservation && (
            <p className={`px-3 py-3 text-center text-xs sm:px-4 ${MUTED}`}>Loading observation status…</p>
          )}
        </section>

        <section className={`${PANEL} mb-4 sm:mb-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800 sm:px-4">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold sm:text-base">Registered network paths</h2>
              <p className={`mt-1 text-[10px] sm:text-xs ${MUTED}`}>
                Derivation contexts. Select a path to scope observation. Persisted events stay on the substrate.
              </p>
            </div>
            <span className={`text-[10px] sm:text-xs ${MUTED}`}>{networks.length} paths</span>
          </div>

          <div className="w-full min-w-0 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs sm:text-sm">
              <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 sm:text-xs">
                <tr>
                  <th className="px-3 py-2.5 sm:px-4">Network</th>
                  <th className="px-3 py-2.5 sm:px-4">ID</th>
                  <th className="px-3 py-2.5 sm:px-4">Coin</th>
                  <th className="px-3 py-2.5 sm:px-4">Purpose</th>
                  <th className="px-3 py-2.5 sm:px-4">Registered path</th>
                  <th className="px-3 py-2.5 sm:px-4">Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {networks.map((network, index) => {
                  const identifier = getPathIdentifier(network);
                  const selected = identifier === selectedPath;

                  return (
                    <tr
                      key={`${network.id ?? identifier}-${index}`}
                      className={`align-top transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${selected ? "bg-zinc-50 dark:bg-zinc-800/60" : ""}`}
                    >
                      <td className="px-3 py-2.5 font-medium sm:px-4">{displayValue(network.name ?? identifier)}</td>
                      <td className={`px-3 py-2.5 font-mono text-[10px] sm:px-4 sm:text-xs ${MUTED}`}>{displayValue(network.id)}</td>
                      <td className="px-3 py-2.5 sm:px-4">{displayValue(network.coin)}</td>
                      <td className="px-3 py-2.5 sm:px-4">{displayValue(network.purpose)}</td>
                      <td className="break-all px-3 py-2.5 font-mono text-[10px] sm:px-4 sm:text-xs">{identifier}</td>
                      <td className="px-3 py-2.5 sm:px-4">
                        <button
                          type="button"
                          onClick={() => handlePathSelect(identifier)}
                          aria-pressed={selected}
                          className={BUTTON}
                        >
                          {selected ? "Selected" : "Select path"}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!networkLoading && networks.length === 0 && (
                  <tr><td colSpan={6} className={`px-3 py-8 text-center text-xs sm:px-4 sm:text-sm ${MUTED}`}>No registered paths were returned.</td></tr>
                )}

                {networkLoading && networks.length === 0 && (
                  <tr><td colSpan={6} className={`px-3 py-8 text-center text-xs sm:px-4 sm:text-sm ${MUTED}`}>Loading registered paths…</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedNetwork && (
            <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
              <p className={`text-[10px] font-semibold uppercase tracking-wide ${MUTED}`}>Selected path context</p>
              <p className="mt-1 break-all text-xs font-medium">{getPathIdentifier(selectedNetwork)}</p>
              <p className={`mt-1 text-[10px] leading-5 sm:text-xs ${MUTED}`}>
                Derivation context only. Observation is managed above; event records remain on the selected substrate.
              </p>
            </div>
          )}
        </section>

        <section className={PANEL}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold sm:text-base">Persistent event store</h2>
              <p className={`mt-1 break-all text-[10px] sm:text-xs ${MUTED} [overflow-wrap:anywhere]`}>
                {eventStore?.events_directory ?? (selectedSubstrate ? `Substrate: ${selectedSubstrate}` : "Select a substrate")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DiagnosticBadge status={eventStoreStatus}>
                {eventStoreStatus === "live" ? "Readable" : eventStoreStatus === "error" ? "Unavailable" : eventStoreStatus === "checking" ? "Checking" : "Not checked"}
              </DiagnosticBadge>
              <DiagnosticBadge status="unknown">{persistedEvents.length} records</DiagnosticBadge>
            </div>
          </div>

          {eventStoreError && <div className="p-3 sm:p-4"><ErrorMessage>{eventStoreError}</ErrorMessage></div>}

          {eventStore && (
            <>
              <div className="grid grid-cols-1 gap-4 p-3 min-[420px]:grid-cols-2 sm:grid-cols-3 sm:p-4 lg:grid-cols-4">
                <DiagnosticValue label="Substrate" value={eventStore.substrate} />
                <DiagnosticValue label="Event directory" value={eventStore.events_directory} />
                <DiagnosticValue label="Substrate directory" value={eventStore.directory} />
                <DiagnosticValue label="Runtime time" value={runtime?.unix_seconds !== undefined ? formatTimestamp(runtime.unix_seconds) : "—"} />
                <DiagnosticValue label="Runtime nanoseconds" value={runtime?.subsec_nanos} />
                <DiagnosticValue label="Persistent records" value={persistedEvents.length} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800 sm:px-4">
                <h3 className="text-xs font-semibold sm:text-sm">Persisted event records</h3>
                <span className={`text-[10px] sm:text-xs ${MUTED}`}>
                  {lastDiagnosticsCheck ? `Checked ${lastDiagnosticsCheck.toLocaleTimeString()}` : "Not checked"}
                </span>
              </div>

              <div className="w-full min-w-0 overflow-x-auto">
                <table className="w-full min-w-[740px] border-collapse text-left text-xs">
                  <thead className="bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    <tr>
                      <th className="px-3 py-2.5 sm:px-4">Kind</th>
                      <th className="px-3 py-2.5 sm:px-4">Record</th>
                      <th className="px-3 py-2.5 sm:px-4">Activation</th>
                      <th className="px-3 py-2.5 sm:px-4">Dimension</th>
                      <th className="px-3 py-2.5 sm:px-4">Structural value</th>
                      <th className="px-3 py-2.5 sm:px-4">Depth objects</th>
                      <th className="px-3 py-2.5 sm:px-4">Retained mass</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {persistedEvents.map((event, index) => (
                      <tr key={getEventKey(event, index)} className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                        <td className="px-3 py-2.5 font-medium sm:px-4">{displayValue(event.kind)}</td>
                        <td className="max-w-[220px] break-all px-3 py-2.5 font-mono text-[10px] sm:px-4">{displayValue(event.record)}</td>
                        <td className="px-3 py-2.5 tabular-nums sm:px-4">{displayValue(event.activation)}</td>
                        <td className="px-3 py-2.5 tabular-nums sm:px-4">{displayValue(event.dimension)}</td>
                        <td className="px-3 py-2.5 tabular-nums sm:px-4">{displayValue(event.structural_value)}</td>
                        <td className="px-3 py-2.5 tabular-nums sm:px-4">{displayValue(event.depth_objects)}</td>
                        <td className="px-3 py-2.5 tabular-nums sm:px-4">{displayValue(event.retained_mass)}</td>
                      </tr>
                    ))}

                    {diagnosticsLoading && persistedEvents.length === 0 && (
                      <tr><td colSpan={7} className={`px-3 py-8 text-center ${MUTED}`}>Reading the persistent event store…</td></tr>
                    )}

                    {!diagnosticsLoading && eventStoreStatus === "live" && persistedEvents.length === 0 && (
                      <tr><td colSpan={7} className={`px-3 py-8 text-center ${MUTED}`}>Event store is reachable, but no records were returned for this substrate.</td></tr>
                    )}

                    {!diagnosticsLoading && !selectedSubstrate && persistedEvents.length === 0 && (
                      <tr><td colSpan={7} className={`px-3 py-8 text-center ${MUTED}`}>Select a substrate to inspect its event store.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!eventStore && eventStoreStatus === "error" && !diagnosticsLoading && (
            <p className={`px-3 py-6 text-center text-xs sm:px-4 sm:text-sm ${MUTED}`}>
              Event store is unavailable for this substrate. See the error above.
            </p>
          )}

          {!eventStore && eventStoreStatus !== "error" && !diagnosticsLoading && (
            <p className={`px-3 py-8 text-center text-xs sm:px-4 sm:text-sm ${MUTED}`}>
              Select a substrate to load its persisted event records.
            </p>
          )}
        </section>

        <footer className={`mt-6 border-t border-zinc-200 pt-3.5 text-[10px] leading-5 dark:border-zinc-800 sm:mt-8 sm:pt-4 sm:text-xs ${MUTED}`}>
          QTM Network · Substrate host · Path-scoped observation · Event-store diagnostics · qtm-api
        </footer>
      </div>
    </main>
  );
}
