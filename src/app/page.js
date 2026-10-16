"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = "https://qtm-api.onrender.com";

const TABS = [
  { id: "create", label: "create" },
  { id: "open", label: "open" },
  { id: "transit", label: "transit" },
  { id: "exile", label: "exile" },
];

const STATE_KEYS = [
  "perm", "indices", "entropy", "dimension", "structural_value",
  "structuralValue", "activation_count", "activationCount",
  "retained_mass", "retainedMass", "commitment", "coordinate",
  "sigma", "network",
];

const TRANSITION_KEYS = [
  "tau", "delta", "gross_work", "grossWork", "net_work",
  "netWork", "mirror_bytes", "mirrorBytes",
];

const EVENT_KEYS = [
  "activation", "scale", "runtime", "dimension", "structural_value",
  "structuralValue", "activation_count", "activationCount",
  "retained_mass", "retainedMass", "commitment", "coordinate",
  "sigma", "network",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getObject(source, keys) {
  if (!isRecord(source)) return undefined;

  for (const key of keys) {
    if (isRecord(source[key])) return source[key];
  }

  return undefined;
}

function getValue(source, keys) {
  if (!isRecord(source)) return undefined;

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(source, key) &&
      source[key] !== null &&
      source[key] !== undefined
    ) {
      return source[key];
    }
  }

  return undefined;
}

function pickFields(source, keys) {
  if (!isRecord(source)) return {};

  return Object.fromEntries(
    Object.entries(source).filter(([key]) => keys.includes(key)),
  );
}

function hasContent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return true;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function formatKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");
}

function formatValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;

  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/*
 * DirectionResponse from qtm-api:
 * {
 *   frame: {
 *     qtm: { identifier, qtm: {...} },
 *     event: { scale, runtime, depth: { path, objects } }
 *   },
 *   selection?: {...}
 * }
 *
 * ReceiveResponse:
 * {
 *   frame: {
 *     quantum_transaction: {...},
 *     event: { scale, runtime, depth: {...} }
 *   }
 * }
 *
 * The Event Map is frame.event. Keep the original object intact.
 */
function getEventMap(source) {
  if (!isRecord(source)) return undefined;

  const direct = getObject(source, ["event", "event_map", "eventMap"]);
  if (direct) return direct;

  const frame = getObject(source, ["frame"]);
  const frameEvent = getObject(frame, ["event", "event_map", "eventMap"]);
  if (frameEvent) return frameEvent;

  const transaction = getObject(frame, [
    "quantum_transaction",
    "quantumTransaction",
  ]);

  const transactionEvent = getObject(transaction, [
    "event",
    "event_map",
    "eventMap",
  ]);

  return transactionEvent;
}

async function readResponse(res) {
  const text = await res.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { response_text: text };
    }
  }

  if (!res.ok) {
    const message =
      getValue(data, ["error", "message", "detail"]) ??
      `Request failed with status ${res.status}`;

    throw new Error(
      `${formatValue(message)}${res.statusText ? ` (${res.statusText})` : ""}`,
    );
  }

  return data;
}

function FragmentRow({ k, v }) {
  return (
    <>
      <dt className="min-w-0 break-words text-zinc-500 dark:text-zinc-400">
        {formatKey(k)}
      </dt>
      <dd className="min-w-0 whitespace-pre-wrap break-all font-mono text-zinc-800 dark:text-zinc-200">
        {formatValue(v)}
      </dd>
    </>
  );
}

function ResultSection({
  title,
  description,
  value,
  defaultOpen = false,
  raw = false,
}) {
  const populated = hasContent(value);
  const entries = isRecord(value) ? Object.entries(value) : null;

  return (
    <details
      className="group overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-800/60 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </span>
          {description && (
            <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          )}
        </span>

        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-transform group-open:rotate-180 dark:border-zinc-700 dark:text-zinc-300"
        >
          <svg viewBox="0 0 20 20" fill="none" className="size-4">
            <path
              d="m5 7.5 5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>

      <div className="border-t border-zinc-200 px-3 py-3 sm:px-4 dark:border-zinc-800">
        {!populated ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {value === null || value === undefined
              ? "This field was not returned by the API."
              : "The API returned an empty value for this section."}
          </p>
        ) : raw ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">
            {formatValue(value)}
          </pre>
        ) : entries ? (
          <dl className="grid min-w-0 grid-cols-[minmax(90px,0.7fr)_minmax(0,1.5fr)] gap-x-3 gap-y-3 text-xs sm:gap-x-5">
            {entries.map(([key, entryValue]) => (
              <FragmentRow key={key} k={key} v={entryValue} />
            ))}
          </dl>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">
            {formatValue(value)}
          </pre>
        )}
      </div>
    </details>
  );
}

function ResultHeading({ eyebrow, title }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
    </div>
  );
}

function HeritageSections({ heritage, prefix = "" }) {
  const state =
    getObject(heritage, ["state", "quantperm", "quant_perm", "quantPerm"]) ??
    pickFields(heritage, STATE_KEYS);

  const transition =
    getObject(heritage, [
      "transition",
      "transition_heritage",
      "transitionHeritage",
    ]) ?? pickFields(heritage, TRANSITION_KEYS);

  return (
    <div className="space-y-3">
      <ResultSection
        title={`${prefix}State / QuantPerm`}
        description="QuantPerm state, coordinates, and substrate root values"
        value={state}
        defaultOpen
      />

      <ResultSection
        title={`${prefix}Transition / Transition Heritage`}
        description="Transition measurements and mirror bytes"
        value={transition}
      />

      <ResultSection
        title={`${prefix}Complete Heritage`}
        description="All fields contained in the heritage object"
        value={heritage}
        raw
      />
    </div>
  );
}

function EventMapSections({ eventMap, metadata, prefix = "" }) {
  return (
    <div className="space-y-3">
      <ResultSection
        title={`${prefix}Event Map`}
        description="The complete universal event instance from Direction.frame.event; all returned fields are preserved."
        value={eventMap}
        defaultOpen
        raw
      />

      <ResultSection
        title={`${prefix}Recognized event metadata`}
        description="A supplementary view of event fields recognized by the frontend. This is not a replacement for the complete Event Map."
        value={metadata}
      />
    </div>
  );
}

function OpenResults({ result }) {
  const frame = getObject(result, ["frame"]) ?? result;

  const transaction =
    getObject(frame, ["quantum_transaction", "quantumTransaction"]) ??
    getObject(result, ["quantum_transaction", "quantumTransaction"]);

  const eventMap = getEventMap(result);

  const heritage =
    getObject(eventMap, ["heritage", "state_heritage", "stateHeritage"]) ??
    getObject(transaction, ["heritage", "state_heritage", "stateHeritage"]) ??
    getObject(frame, ["heritage", "state_heritage", "stateHeritage"]) ??
    getObject(result, ["heritage", "state_heritage", "stateHeritage"]);

  const transactionQtm =
    getObject(transaction, ["qtm", "Qtm"]) ??
    getObject(frame, ["qtm", "Qtm"]);

  const eventQtm = getObject(eventMap, ["qtm", "Qtm"]);

  const metadata = pickFields(eventMap, EVENT_KEYS);

  return (
    <section className="mt-5 space-y-4">
      <ResultHeading eyebrow="Receive result" title="QuantumTransaction" />

      <div className="space-y-3">
        <ResultSection
          title="QuantumTransaction"
          description="Transaction amount, persisted constant, and receive frame"
          value={transaction}
          defaultOpen
          raw
        />

        <ResultSection
          title="Transaction QTM"
          description="QTM values associated with the outer transaction"
          value={transactionQtm}
          raw
        />

        {eventQtm && (
          <ResultSection
            title="Received Event QTM"
            description="QTM projection returned by the receive operation"
            value={eventQtm}
            raw
          />
        )}

        {eventMap ? (
          <EventMapSections eventMap={eventMap} metadata={metadata} prefix="Receive " />
        ) : (
          <ResultSection
            title="Receive Event Map"
            description="The expected frame.event object was not present in this response."
            value={undefined}
          />
        )}

        {heritage ? (
          <HeritageSections heritage={heritage} />
        ) : (
          <ResultSection
            title="Received Event Heritage"
            description="No separate heritage object was found at the expected response locations."
            value={undefined}
          />
        )}
      </div>
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
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        type={type}
        autoComplete={autoComplete}
        className={`h-9 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800 ${
          mono ? "font-mono" : ""
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function TransitResults({ result, network, path }) {
  const frame = getObject(result, ["frame"]);
  const eventMap = getEventMap(result);
  const qtm = getObject(frame, ["qtm", "Qtm"]);

  const heritage = getObject(eventMap, [
    "heritage",
    "state_heritage",
    "stateHeritage",
  ]);

  const transition = getObject(eventMap, [
    "transition",
    "transition_heritage",
    "transitionHeritage",
  ]);

  const metadata = pickFields(eventMap, EVENT_KEYS);

  const networkDepth = {
    network: network?.name ?? network?.id ?? "Not specified",
    network_identifier: network?.id ?? "Not returned",
    path: path || network?.path || "Not specified",
  };

  return (
    <section className="mt-5 space-y-4">
      <ResultHeading eyebrow="Transit result" title="QP44 event" />

      <div className="space-y-3">
        <ResultSection
          title="QTM | Network Depth"
          description="QTM frame associated with the selected network and path"
          value={qtm}
          defaultOpen
          raw
        />

        <ResultSection
          title="Network Depth Registry"
          description="Selected network and path context"
          value={networkDepth}
        />

        {eventMap ? (
          <EventMapSections eventMap={eventMap} metadata={metadata} />
        ) : (
          <ResultSection
            title="Event Map"
            description="The API response did not contain frame.event at the expected location."
            value={undefined}
          />
        )}

        {heritage && <HeritageSections heritage={heritage} />}

        {transition && (
          <ResultSection
            title="Event Transition"
            description="Transition fields returned with the event"
            value={transition}
            raw
          />
        )}

        <ResultSection
          title="Complete Transit Response"
          description="The full DirectionResponse, including frame, QTM, Event Map, and selection"
          value={result}
          raw
        />
      </div>
    </section>
  );
}

function ExileResults({ result }) {
  const frame = getObject(result, ["frame"]);
  const eventMap = getEventMap(result);
  const qtm = getObject(frame, ["qtm", "Qtm"]);

  const heritage = getObject(eventMap, [
    "heritage",
    "state_heritage",
    "stateHeritage",
  ]);

  const metadata = pickFields(eventMap, EVENT_KEYS);

  return (
    <section className="mt-5 space-y-4">
      <ResultHeading eyebrow="Exile result" title="Exile event" />

      <div className="space-y-3">
        <ResultSection
          title="Stored QTM"
          description="QTM values returned by the exile operation"
          value={qtm}
          defaultOpen
          raw
        />

        {eventMap ? (
          <EventMapSections eventMap={eventMap} metadata={metadata} prefix="Exile " />
        ) : (
          <ResultSection
            title="Exile Event Map"
            description="The API response did not contain frame.event at the expected location."
            value={undefined}
          />
        )}

        {heritage ? (
          <HeritageSections heritage={heritage} prefix="Exile " />
        ) : (
          <ResultSection title="Exile Heritage" value={undefined} />
        )}

        <ResultSection
          title="Complete Exile Response"
          description="The complete DirectionResponse returned by the API"
          value={result}
          raw
        />
      </div>
    </section>
  );
}

function ResultCard({ result, tab, network, path }) {
  if (result === null || result === undefined) return null;

  return (
    <div className="mt-5 space-y-4">
      {tab === "open" && <OpenResults result={result} />}

      {tab === "transit" && (
        <TransitResults result={result} network={network} path={path} />
      )}

      {tab === "exile" && <ExileResults result={result} />}

      {tab === "create" && (
        <section className="space-y-3">
          <ResultHeading eyebrow="Create result" title="Substrate creation" />
        </section>
      )}

      <ResultSection
        title="Complete API response"
        description="The entire JSON response returned by the server, without filtering or renaming any fields."
        value={result}
        defaultOpen
        raw
      />
    </div>
  );
}

function NumberField({ label, value, onChange, min = 0 }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <input
        type="number"
        min={min}
        step="1"
        className="h-9 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2.5 font-mono text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </label>
  );
}

function NetworkSelect({ networks, value, onChange, loading }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Network
      </span>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || networks.length === 0}
        className="h-9 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
      >
        {networks.length === 0 && (
          <option value="">
            {loading ? "Loading networks..." : "No networks available"}
          </option>
        )}

        {networks.map((network, index) => (
          <option key={`${network.id}-${index}`} value={network.id}>
            {network.name} — {network.id}
          </option>
        ))}
      </select>
    </label>
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

  const loadSubstrates = useCallback(async (preferredName) => {
    setListLoading(true);
    setListError("");

    try {
      const res = await fetch(`${API_BASE}/wallets`, {
        cache: "no-store",
      });

      const data = await readResponse(res);

      if (!Array.isArray(data.substrates)) {
        throw new Error("The API response did not contain a substrates array.");
      }

      const validSubstrates = data.substrates.filter(
        (item) => item && typeof item.name === "string",
      );

      setSubstrates(validSubstrates);

      setSelectedSubstrate((current) => {
        const preferred = preferredName || current;

        if (
          preferred &&
          validSubstrates.some((item) => item.name === preferred)
        ) {
          return preferred;
        }

        return validSubstrates[0]?.name || "";
      });
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Unable to load substrates.",
      );
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadNetworks = useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError("");

    try {
      const res = await fetch(`${API_BASE}/networks`, {
        cache: "no-store",
      });

      const data = await readResponse(res);

      if (!Array.isArray(data.networks)) {
        throw new Error("The API response did not contain a networks array.");
      }

      const validNetworks = data.networks.filter(
        (network) =>
          network &&
          typeof network.id === "string" &&
          typeof network.name === "string",
      );

      setNetworks(validNetworks);

      setSelectedNetwork((current) => {
        if (validNetworks.some((network) => network.id === current)) {
          return current;
        }

        return validNetworks[0]?.id || "";
      });

      const firstNetwork = validNetworks[0];

      if (firstNetwork) {
        if (Number.isFinite(firstNetwork.purpose)) {
          setPurpose((current) =>
            current === "44" ? String(firstNetwork.purpose) : current,
          );
        }

        if (Number.isFinite(firstNetwork.coin)) {
          setCoin((current) =>
            current === "0" ? String(firstNetwork.coin) : current,
          );
        }

        setPath((current) => current || firstNetwork.path || "");
      }
    } catch (err) {
      setNetworkError(
        err instanceof Error ? err.message : "Unable to load networks.",
      );
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

  const currentNetwork =
    networks.find((network) => network.id === selectedNetwork) ?? null;

  function handleNetworkChange(networkId) {
    const network = networks.find((item) => item.id === networkId);

    setSelectedNetwork(networkId);
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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResult(null);

    if (tab !== "create" && !selectedSubstrate) {
      setError("Select a substrate before performing this operation.");
      return;
    }

    setLoading(true);

    try {
      let res;

      if (tab === "create") {
        const substrateName = name.trim();

        if (!substrateName) {
          throw new Error("Enter a substrate name.");
        }

        let createPayload;

        if (seedSource === "bip39") {
          if (!phrase.trim()) {
            throw new Error("Enter a BIP39 mnemonic phrase.");
          }

          if (!language) {
            throw new Error("Select a BIP39 language.");
          }

          createPayload = {
            name: substrateName,
            seed_source: "bip39",
            phrase: phrase.trim(),
            language,
            passphrase,
          };
        } else {
          const parsedIndices = indices.split(",").map((item) => item.trim());

          if (
            parsedIndices.length !== 12 ||
            parsedIndices.some(
              (item) =>
                item === "" ||
                !/^\d+$/.test(item) ||
                !Number.isInteger(Number(item)) ||
                Number(item) < 0 ||
                Number(item) > 2047,
            )
          ) {
            throw new Error(
              "Enter exactly 12 indices, each an integer from 0 to 2047.",
            );
          }

          createPayload = {
            name: substrateName,
            seed_source: "persistent",
            indices: parsedIndices.map(Number).join(","),
            entropy: entropy.trim() || substrateName,
          };
        }

        res = await fetch(`${API_BASE}/wallets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createPayload),
        });

        const data = await readResponse(res);

        setResult(data);
        setName("");
        setEntropy("");
        setPhrase("");
        setPassphrase("");

        await loadSubstrates(substrateName);
      } else if (tab === "open") {
        const amount = Number(receiveAmount);

        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new Error("Receive amount must be a positive safe integer.");
        }

        if (!["receive", "change"].includes(receiveFlow)) {
          throw new Error("Select a valid receive flow.");
        }

        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/receive`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ amount, flow: receiveFlow }),
          },
        );

        setResult(await readResponse(res));
      } else if (tab === "transit") {
        if (!selectedNetwork) {
          throw new Error("Select a network before transit.");
        }

        const numericFields = {
          purpose: Number(purpose),
          coin: Number(coin),
          account: Number(account),
          change: Number(change),
          external: Number(external),
          activation: Number(activation),
        };

        for (const [fieldName, fieldValue] of Object.entries(numericFields)) {
          if (!Number.isSafeInteger(fieldValue) || fieldValue < 0) {
            throw new Error(
              `${fieldName} must be a non-negative safe integer.`,
            );
          }
        }

        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/transit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              network: selectedNetwork,
              path: path.trim() || undefined,
              ...numericFields,
            }),
          },
        );

        setResult(await readResponse(res));
        await loadSubstrates(selectedSubstrate);
      } else if (tab === "exile") {
        res = await fetch(
          `${API_BASE}/wallets/${encodeURIComponent(selectedSubstrate)}/exile`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
        );

        setResult(await readResponse(res));
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
    <div className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-900 sm:px-6 sm:py-12 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            QuantPerm · QTM
          </p>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl dark:text-zinc-50">
            QTM substrate console
          </h1>

          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Manage substrates using the Rust API server (
            <code className="rounded-sm bg-zinc-200/80 px-1 py-0.5 text-xs dark:bg-zinc-800">
              qtm-api
            </code>
            ) and the <code>qp_hd</code> wallet engine.
          </p>
        </header>

        <section className="mb-5 rounded-lg border border-zinc-200/90 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.025)] sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between gap-3">
            <label
              htmlFor="substrate"
              className="text-sm font-semibold text-zinc-800 dark:text-zinc-200"
            >
              Substrate
            </label>

            <button
              type="button"
              onClick={() => loadSubstrates()}
              disabled={listLoading}
              className="rounded-sm px-2 py-1 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {listLoading ? "Refreshing..." : "Refresh list"}
            </button>
          </div>

          <select
            id="substrate"
            value={selectedSubstrate}
            onChange={(e) => {
              setSelectedSubstrate(e.target.value);
              setResult(null);
              setError("");
            }}
            disabled={listLoading || substrates.length === 0}
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800"
          >
            {substrates.length === 0 && (
              <option value="">
                {listLoading ? "Loading substrates..." : "No substrates available"}
              </option>
            )}

            {substrates.map((substrate, index) => (
              <option key={`${substrate.name}-${index}`} value={substrate.name}>
                {substrate.name}
                {" — dimension "}
                {substrate.dimension ?? "not returned"}
                {" · activations "}
                {substrate.activations ?? "not returned"}
              </option>
            ))}
          </select>

          {selectedSubstrate && (
            <div className="mt-3 space-y-2">
              <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
                Selected: <span className="font-mono">{selectedSubstrate}</span>
              </p>

              <ResultSection
                title="Selected substrate details"
                description="All fields returned for the selected substrate in the substrate-list response"
                value={
                  substrates.find((item) => item.name === selectedSubstrate) ?? {}
                }
                raw
              />
            </div>
          )}

          {listError && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              Unable to load the substrate list: {listError}
            </p>
          )}

          {!listLoading && !listError && substrates.length === 0 && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              No substrates were found. Create one using the create tab.
            </p>
          )}
        </section>

        <nav
          aria-label="Substrate operations"
          className="mb-5 grid grid-cols-4 gap-1 rounded-md border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setResult(null);
                setError("");
              }}
              className={`min-w-0 rounded-sm px-1.5 py-2 text-sm font-medium transition-colors sm:px-2 ${
                tab === t.id
                  ? "bg-white text-zinc-950 shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section className="rounded-lg border border-zinc-200/90 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.025)] sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {TABS.find((t) => t.id === tab)?.label}
            </h2>

            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {tab === "create" &&
                "Initialize a substrate using persistent indices or a BIP39 mnemonic."}
              {tab === "open" &&
                "Receive a QuantumTransaction and inspect its QTM projection, Event Map, and complete API response."}
              {tab === "transit" &&
                "Select a network, customize its path, and inspect the resulting QP44 event and complete Event Map."}
              {tab === "exile" &&
                "Exile the selected substrate using the wallet engine and inspect its complete Event Map."}
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
                  <button
                    type="button"
                    aria-pressed={seedSource === "persistent"}
                    onClick={() => {
                      setSeedSource("persistent");
                      setError("");
                    }}
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${
                      seedSource === "persistent"
                        ? "border-zinc-500 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800/70"
                        : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Persistent indices
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      Enter the 12 PERM indices and conditioning entropy.
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={seedSource === "bip39"}
                    onClick={() => {
                      setSeedSource("bip39");
                      setError("");
                    }}
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${
                      seedSource === "bip39"
                        ? "border-zinc-500 bg-zinc-50 dark:border-zinc-500 dark:bg-zinc-800/70"
                        : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      BIP39 mnemonic
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      Derive the indices and conditioning entropy from a mnemonic.
                    </span>
                  </button>
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
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        BIP39 language
                      </span>
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        required
                        className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
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

                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Mnemonic phrase
                      </span>
                      <textarea
                        value={phrase}
                        onChange={(e) => setPhrase(e.target.value)}
                        required
                        rows={3}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Enter the words in the selected language"
                        className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm leading-6 text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
                      />
                    </label>

                    <Field
                      label="BIP39 passphrase (optional)"
                      value={passphrase}
                      onChange={setPassphrase}
                      placeholder="Leave empty if not used"
                      type="password"
                      autoComplete="off"
                    />

                    <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      The API validates the mnemonic and derives the 12 indices
                      and conditioning entropy. The phrase and passphrase are
                      sent with this creation request.
                    </p>
                  </div>
                )}
              </>
            )}

            {tab === "open" && (
              <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/50">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Receive amount / activation"
                    value={receiveAmount}
                    onChange={setReceiveAmount}
                    min={1}
                  />

                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Flow
                    </span>
                    <select
                      value={receiveFlow}
                      onChange={(e) => setReceiveFlow(e.target.value)}
                      className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
                    >
                      <option value="receive">Receive</option>
                      <option value="change">Change</option>
                    </select>
                  </label>
                </div>

                <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Open calls the API receive endpoint. The amount is passed to
                  the QuantumTransaction receive operation; it is not a
                  displayed wallet balance.
                </p>
              </div>
            )}

            {tab === "transit" && (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:gap-x-4">
                  <NetworkSelect
                    networks={networks}
                    value={selectedNetwork}
                    onChange={handleNetworkChange}
                    loading={networkLoading}
                  />

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
                  <div
                    role="alert"
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                  >
                    Network presets could not be loaded: {networkError}
                    <button
                      type="button"
                      onClick={loadNetworks}
                      disabled={networkLoading}
                      className="ml-2 font-semibold underline underline-offset-2 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {currentNetwork && (
                  <div className="space-y-2 rounded-md border border-zinc-200/80 bg-zinc-50/70 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/70">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Selected network
                    </p>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {currentNetwork.name}
                    </p>
                    <p className="break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {path || "No derivation path specified"}
                    </p>
                    <ResultSection
                      title="Complete network definition"
                      description="All network fields returned by the API"
                      value={currentNetwork}
                      raw
                    />
                  </div>
                )}
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
              className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
            >
              {loading && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
                />
              )}

              {loading
                ? "Processing..."
                : tab === "open"
                  ? "Receive QuantumTransaction"
                  : TABS.find((t) => t.id === tab)?.label}
            </button>
          </form>
        </section>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <ResultCard
          result={result}
          tab={tab}
          network={currentNetwork}
          path={path}
        />

        <footer className="mt-9 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
          QTM substrate console
        </footer>
      </main>
    </div>
  );
}