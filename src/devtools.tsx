import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { introspectShape, type FieldInfo } from "./cli.js";
import type { Source } from "./index.js";
import type { AttunedReact } from "./react.js";

const DEFAULT_KEY = "attunement:overrides";

/** Read stored dev overrides (empty object when none/invalid). */
export function readOverrides(storageKey = DEFAULT_KEY): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function writeOverrides(
  overrides: Record<string, unknown>,
  storageKey = DEFAULT_KEY
): void {
  localStorage.setItem(storageKey, JSON.stringify(overrides));
}

export function clearOverrides(storageKey = DEFAULT_KEY): void {
  localStorage.removeItem(storageKey);
}

function urlOverrides(): Record<string, unknown> {
  const params = new URLSearchParams(location.search);
  const overrides: Record<string, unknown> = {};
  for (const [name, value] of params) {
    if (!name.startsWith("config.")) continue;
    const key = name.slice("config.".length);
    try {
      overrides[key] = JSON.parse(value); // numbers/booleans/JSON
    } catch {
      overrides[key] = value; // plain string
    }
  }
  return overrides;
}

/**
 * Dev override source: localStorage overrides + `?config.KEY=value` URL
 * bootstrap (URL wins and is persisted). Combine over your real sources with
 * `merge` so the schema validates the overridden result:
 *
 *   sources: [merge(fromJson("/app-config.json"), fromOverrides())]
 *
 * Dev-only by your own guard — don't ship it enabled to production.
 */
export function fromOverrides(storageKey = DEFAULT_KEY): Source {
  return () => {
    const stored = readOverrides(storageKey);
    const fromUrl = urlOverrides();
    if (Object.keys(fromUrl).length > 0) {
      writeOverrides({ ...stored, ...fromUrl }, storageKey);
    }
    const overrides = { ...stored, ...fromUrl };
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  };
}

// --- panel ---

export interface DevtoolsProps {
  config: AttunedReact<Record<string, unknown>>;
  /** Must match the key given to fromOverrides. */
  storageKey?: string;
}

const styles = {
  panel: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    color: "#e2e8f0",
    background: "#1a202c",
    padding: 12,
    borderRadius: 8,
    minWidth: 320,
  },
  row: { display: "flex", gap: 8, alignItems: "center", marginBottom: 6 },
  key: { flex: "0 0 40%", overflow: "hidden", textOverflow: "ellipsis" },
  input: { flex: 1, background: "#2d3748", color: "inherit", border: "1px solid #4a5568", borderRadius: 4, padding: "2px 6px", fontSize: 12 },
  button: { background: "#2b6cb0", color: "white", border: 0, borderRadius: 4, padding: "4px 10px", cursor: "pointer", marginRight: 8 },
  note: { opacity: 0.7, marginTop: 8 },
} satisfies Record<string, CSSProperties>;

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldInfo;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (field.type === "enum") {
    return (
      <select
        style={styles.input}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">(unset)</option>
        {(field.values ?? []).map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      style={styles.input}
      value={value === undefined ? "" : String(value)}
      placeholder={field.defaultValue !== undefined ? String(field.defaultValue) : ""}
      onChange={(e) => {
        const text = e.target.value;
        if (text === "") return onChange(undefined);
        onChange(field.type === "number" && !Number.isNaN(Number(text)) ? Number(text) : text);
      }}
    />
  );
}

/**
 * Override panel generated from the schema: enum → select, boolean →
 * checkbox, number/string → input. Saving writes localStorage and reloads —
 * config is load-once by design, a reload is the honest apply.
 */
export function AttunementDevtoolsPanel({ config, storageKey = DEFAULT_KEY }: DevtoolsProps) {
  const [loaded, setLoaded] = useState<Record<string, unknown> | null>(null);
  const [overrides, setOverrides] = useState<Record<string, unknown>>(() =>
    readOverrides(storageKey)
  );

  useEffect(() => {
    config.load().then(setLoaded, () => setLoaded(null));
  }, [config]);

  let fields: FieldInfo[];
  try {
    fields = introspectShape(config._schema);
  } catch {
    return (
      <div style={styles.panel}>
        attunement: schema is not introspectable (zod object schema required) —
        overrides unavailable.
      </div>
    );
  }

  const dirty = Object.keys(overrides).length > 0;

  return (
    <div style={styles.panel}>
      {fields.map((field) => (
        <div key={field.key} style={styles.row} title={field.description}>
          <span style={styles.key}>
            {field.key}
            {field.key in overrides ? " *" : ""}
          </span>
          <FieldInput
            field={field}
            value={overrides[field.key] ?? loaded?.[field.key]}
            onChange={(value) =>
              setOverrides((prev) => {
                const next = { ...prev };
                if (value === undefined || value === loaded?.[field.key]) {
                  delete next[field.key];
                } else {
                  next[field.key] = value;
                }
                return next;
              })
            }
          />
        </div>
      ))}
      <div>
        <button
          style={styles.button}
          onClick={() => {
            writeOverrides(overrides, storageKey);
            location.reload();
          }}
        >
          Save & reload
        </button>
        <button
          style={{ ...styles.button, background: "#4a5568" }}
          onClick={() => {
            clearOverrides(storageKey);
            location.reload();
          }}
        >
          Clear & reload
        </button>
      </div>
      <div style={styles.note}>
        {dirty
          ? `${Object.keys(overrides).length} override(s) — needs fromOverrides() in sources`
          : "no overrides"}
      </div>
    </div>
  );
}

/** Standalone floating widget — a toggle button fixed bottom-right. */
export function AttunementDevtools(props: DevtoolsProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999 }}>
      {open && (
        <div style={{ marginBottom: 8 }}>
          <AttunementDevtoolsPanel {...props} />
        </div>
      )}
      <button
        style={{ ...styles.button, float: "right" }}
        onClick={() => setOpen((o) => !o)}
        aria-label="attunement devtools"
      >
        {open ? "× config" : "⚙ config"}
      </button>
    </div>
  );
}

/**
 * TanStack Devtools plugin — drop into `@tanstack/react-devtools`:
 *
 *   <TanStackDevtools plugins={[attunementDevtoolsPlugin(appConfig)]} />
 */
export function attunementDevtoolsPlugin(
  config: AttunedReact<Record<string, unknown>>,
  storageKey?: string
): { name: string; render: ReactNode } {
  return {
    name: "Attunement",
    render: <AttunementDevtoolsPanel config={config} storageKey={storageKey} />,
  };
}
