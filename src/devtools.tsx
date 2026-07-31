import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
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
  try {
    localStorage.setItem(storageKey, JSON.stringify(overrides));
  } catch {
    // private mode / quota — overrides just don't persist
  }
}

export function clearOverrides(storageKey = DEFAULT_KEY): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore, see writeOverrides
  }
}

function urlOverrides(): Record<string, unknown> {
  const params = new URLSearchParams(location.search);
  const overrides: Record<string, unknown> = {};
  for (const [name, value] of params) {
    if (!name.startsWith("config.")) continue;
    const key = name.slice("config.".length);
    // bracket-assignment on a plain object would hit the __proto__ setter
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
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

export interface DevtoolsProps<T extends Record<string, unknown> = Record<string, unknown>> {
  config: AttunedReact<T>;
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
    // host shell (TanStack Devtools) clips overflow — panel must scroll itself
    maxHeight: "100%",
    overflowY: "auto",
    boxSizing: "border-box",
  },
  // explicit height: TanStack Devtools shell CSS (`> * > * { height: 100% }`)
  // stretches every panel child to the full shell height otherwise
  row: { display: "flex", gap: 8, alignItems: "center", marginBottom: 6, height: "auto" },
  key: { flex: "0 0 40%", overflow: "hidden", textOverflow: "ellipsis" },
  input: { flex: 1, background: "#2d3748", color: "inherit", border: "1px solid #4a5568", borderRadius: 4, padding: "2px 6px", fontSize: 12 },
  button: { background: "#2b6cb0", color: "white", border: 0, borderRadius: 4, padding: "4px 10px", cursor: "pointer", marginRight: 8 },
  note: { opacity: 0.7, marginTop: 8, height: "auto" },
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
        // keep the raw text while typing ("1." must survive); numbers are
        // coerced once, on save
        const text = e.target.value;
        onChange(text === "" ? undefined : text);
      }}
    />
  );
}

/**
 * Override panel generated from the schema: enum → select, boolean →
 * checkbox, number/string → input. Saving writes localStorage and reloads —
 * config is load-once by design, a reload is the honest apply.
 */
export function AttunementDevtoolsPanel<T extends Record<string, unknown>>({
  config,
  storageKey = DEFAULT_KEY,
}: DevtoolsProps<T>) {
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
      <div style={{ height: "auto" }}>
        <button
          style={styles.button}
          onClick={() => {
            const coerced = Object.fromEntries(
              Object.entries(overrides).map(([key, value]) => {
                const field = fields.find((f) => f.key === key);
                const asNumber = Number(value);
                return field?.type === "number" &&
                  typeof value === "string" &&
                  value.trim() !== "" &&
                  Number.isFinite(asNumber)
                  ? [key, asNumber]
                  : [key, value];
              })
            );
            writeOverrides(coerced, storageKey);
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
export function AttunementDevtools<T extends Record<string, unknown>>(
  props: DevtoolsProps<T>
) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 99999 }}>
      {open && (
        // panel's maxHeight:100% is inert in an auto-height parent — cap here
        <div style={{ marginBottom: 8, maxHeight: "70vh", overflowY: "auto" }}>
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
export function attunementDevtoolsPlugin<T extends Record<string, unknown>>(
  config: AttunedReact<T>,
  storageKey?: string
): { name: string; render: ReactElement } {
  return {
    name: "Attunement",
    render: <AttunementDevtoolsPanel config={config} storageKey={storageKey} />,
  };
}
