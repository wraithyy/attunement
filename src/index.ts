import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * A config source: sync or async, returns raw config, or null/undefined to
 * let the next source try. (`unknown` already covers promises — attune
 * awaits every result.)
 */
export type Source = () => unknown;

/**
 * @internal DEV detection shared across entries. Two paths: bundlers doing
 * define-replacement need the dotted process.env.NODE_ENV literal (no
 * optional chain — it breaks the match); Vite browser ESM has no `process`
 * and needs import.meta.env.DEV. The cast: import.meta typing depends on
 * the consumer's bundler types.
 */
export const DEV =
  (typeof process !== "undefined" && process.env.NODE_ENV !== "production") ||
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export interface AttuneOptions<S extends StandardSchemaV1> {
  schema: S;
  /** Tried in order; first source yielding a non-nullish value wins. */
  sources: Source[];
  /** Runs after validation, before load() resolves — wire up API base URL, logger, etc. */
  onLoad?: (
    config: StandardSchemaV1.InferOutput<S>,
    fingerprint: Fingerprint
  ) => void | Promise<void>;
}

/** Identifies the loaded config — tag Sentry scope, prefix logs. */
export interface Fingerprint {
  /** FNV-1a over the validated config (key-order independent), 8 hex chars. */
  hash: string;
  /** `_version` from the raw config, when the deploy pipeline stamps one. */
  version?: string;
  /** `_generatedAt` from the raw config. */
  generatedAt?: string;
}

export interface Attuned<T, S extends StandardSchemaV1 = StandardSchemaV1> {
  /** Cached — every call returns the same promise, fetch fired at attune() time. */
  load: () => Promise<T>;
  /** Fingerprint of the loaded config; same promise timing as load(). */
  fingerprint: () => Promise<Fingerprint>;
  /**
   * Register wiring that must finish before load() resolves (and so before
   * first render under the React Provider). Same queue and guarantees as
   * options.onLoad — use onReady from modules the config module must not
   * import (router, i18n) to avoid import cycles. Callback errors reject the
   * load. Registered after the config already resolved: runs immediately
   * (DEV warns — the before-render guarantee no longer applies); after a
   * failed load: never runs.
   */
  onReady: (
    cb: (config: T, fingerprint: Fingerprint) => void | Promise<void>
  ) => void;
  /** @internal wiring for attunement/react, /devtools and /testing */
  _schema: S;
}

export class ConfigError extends Error {
  readonly issues: readonly StandardSchemaV1.Issue[];

  constructor(message: string, issues: readonly StandardSchemaV1.Issue[] = []) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

function levenshtein(a: string, b: string): number {
  // ponytail: O(n*m) full matrix; config keys are short, never a bottleneck
  // ?? 0 never fires — indexes are in-bounds by construction, this only
  // satisfies noUncheckedIndexedAccess
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = row[j] ?? 0;
      row[j] = next;
    }
  }
  return row[b.length] ?? 0;
}

function didYouMean(key: string, rawKeys: string[]): string {
  const nearest = rawKeys
    .filter((raw) => raw !== key)
    .map((raw) => ({ raw, distance: levenshtein(key, raw) }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest ? ` (did you mean "${nearest.raw}"?)` : "";
}

/** @internal shared by attune() and the test provider */
export function formatIssues(
  issues: readonly StandardSchemaV1.Issue[],
  raw?: unknown
): string {
  const rawKeys =
    raw && typeof raw === "object" ? Object.keys(raw) : [];
  const lines = issues.map((issue) => {
    const segments = issue.path?.map((p) =>
      typeof p === "object" ? String(p.key) : String(p)
    );
    const path = segments?.join(".");
    if (!path) return `  ${issue.message}`;
    // suggest only for top-level keys the raw object doesn't have
    const first = segments?.length === 1 ? segments[0] : undefined;
    const suggestion =
      first !== undefined && !rawKeys.includes(first)
        ? didYouMean(first, rawKeys)
        : "";
    return `  ${path}: ${issue.message}${suggestion}`;
  });
  return `Invalid runtime config — you didn't say the magic word:\n${lines.join("\n")}`;
}

/**
 * @internal freeze the validated config so nothing mutates it after load.
 * Guards plain data only — internal state of Date/class instances stays
 * mutable (Object.freeze can't reach it).
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

// JSON.stringify with sorted object keys — same config, same hash,
// regardless of which source/merge order produced it
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`);
  return `{${entries.join(",")}}`;
}

// ponytail: FNV-1a, 32-bit — collision-safe enough to tell configs apart in
// logs, not a security boundary; swap for crypto.subtle if that ever changes
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** @internal shared with the CLI (--print-fingerprint) — same hash as runtime */
export function makeFingerprint(config: unknown, raw: unknown): Fingerprint {
  const meta = (key: string): string | undefined => {
    const value =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)[key]
        : undefined;
    return typeof value === "string" ? value : undefined;
  };
  const version = meta("_version");
  const generatedAt = meta("_generatedAt");
  return {
    hash: fnv1a(stableStringify(config)),
    ...(version !== undefined ? { version } : {}),
    ...(generatedAt !== undefined ? { generatedAt } : {}),
  };
}

async function resolveSources(sources: Source[]): Promise<unknown> {
  const failures: string[] = [];

  for (const source of sources) {
    try {
      const raw = await source();
      if (raw !== null && raw !== undefined) {
        return raw;
      }
      failures.push("source returned nothing");
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new ConfigError(
    `No config source succeeded:\n${failures.map((f) => `  - ${f}`).join("\n")}`
  );
}

/**
 * Load, validate and cache runtime config. Loading starts immediately —
 * call at module scope so the fetch races the rest of your bundle.
 */
export function attune<S extends StandardSchemaV1>(
  options: AttuneOptions<S>
): Attuned<StandardSchemaV1.InferOutput<S>, S> {
  type T = StandardSchemaV1.InferOutput<S>;
  type ReadyCallback = (config: T, fingerprint: Fingerprint) => void | Promise<void>;

  // one queue for onLoad and onReady — same machinery, same guarantees
  const queue: ReadyCallback[] = options.onLoad ? [options.onLoad] : [];
  let settled: { config: T; fingerprint: Fingerprint } | null = null;
  let failed = false;

  const promise = (async () => {
    const raw = await resolveSources(options.sources);
    const result = await options.schema["~standard"].validate(raw);

    if (result.issues) {
      throw new ConfigError(formatIssues(result.issues, raw), result.issues);
    }

    const config = deepFreeze(result.value);
    const fingerprint = deepFreeze(makeFingerprint(config, raw));
    // index loop: a callback may register more during its await
    for (let i = 0; i < queue.length; i++) {
      try {
        await queue[i]?.(config, fingerprint);
      } catch (error) {
        // wrap so the React boundary can tell config failures from app bugs
        throw new ConfigError(
          `config callback failed: ${error instanceof Error ? error.message : String(error)}`,
          []
        );
      }
    }
    queue.length = 0; // flushed closures must not be pinned for app lifetime
    settled = { config, fingerprint };
    return settled;
  })();

  promise.catch(() => {
    failed = true;
  });

  const onReady = (cb: ReadyCallback): void => {
    if (settled) {
      const { config, fingerprint } = settled;
      if (DEV) {
        console.warn(
          "attunement: onReady() registered after the config resolved — the before-first-render guarantee no longer applies. Register at module scope of a module your entry imports."
        );
      }
      // errors surface as unhandled rejections on purpose — a silently
      // swallowed late callback is worse than a loud one
      void Promise.resolve().then(() => cb(config, fingerprint));
    } else if (!failed) {
      queue.push(cb);
    }
    // failed load: wiring for an app that will never render — skip
  };

  // stable promise identity — React use() re-suspends on a fresh promise
  const configPromise = promise.then(({ config }) => config);
  const fingerprintPromise = promise.then(({ fingerprint }) => fingerprint);

  // eager start must not surface as unhandledrejection when nobody awaited yet
  configPromise.catch(() => {});
  fingerprintPromise.catch(() => {});

  return {
    load: () => configPromise,
    fingerprint: () => fingerprintPromise,
    onReady,
    _schema: options.schema,
  };
}

export interface FromJsonOptions extends RequestInit {
  /** Per-attempt timeout in ms; 0 disables. Default 8000. */
  timeoutMs?: number;
  /** Extra attempts after the first, on network errors, timeouts and 5xx. Default 2. */
  retries?: number;
  /** Base backoff delay in ms, doubles each retry. Default 300. */
  backoffMs?: number;
}

function attemptSignal(timeoutMs: number, outer: AbortSignal | null | undefined) {
  if (!timeoutMs) return outer ?? undefined;
  const timeout = AbortSignal.timeout(timeoutMs);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}

/**
 * Source: fetch a JSON file (e.g. /app-config.json). Non-2xx throws;
 * network errors, timeouts and 5xx are retried with exponential backoff.
 */
export function fromJson(url: string, options: FromJsonOptions = {}): Source {
  const { timeoutMs = 8000, retries = 2, backoffMs = 300, ...init } = options;

  return async () => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0 && backoffMs > 0) {
        await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
      }
      // caller cancelled the whole load — fail now, don't retry
      if (init.signal?.aborted) throw init.signal.reason;

      let response: Response;
      try {
        response = await fetch(url, {
          // no-store: a CDN-cached stale config survives reloads and makes
          // every retry a loop — config must always hit the origin
          cache: "no-store",
          ...init,
          signal: attemptSignal(timeoutMs, init.signal),
        });
      } catch (error) {
        if (init.signal?.aborted) throw error;
        lastError = error; // network error or timeout — retry
        continue;
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch (error) {
          // body stalled/dropped after headers, or truncated JSON — retry
          if (init.signal?.aborted) throw error;
          lastError = error;
          continue;
        }
      }

      const error = new Error(
        `${url}: HTTP ${response.status} ${response.statusText}`
      );
      if (response.status < 500) throw error; // 4xx won't heal, don't retry
      lastError = error;
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw retries > 0
      ? new Error(`${url}: ${retries + 1} attempts failed, last error: ${message}`)
      : lastError;
  };
}

/**
 * Combine sources into one: all run in parallel, results shallow-merge with
 * later sources winning (base first, overrides last). Nullish parts are
 * skipped; if every part is nullish the merge yields nothing and the source
 * chain falls through. A throwing part fails the whole merge.
 */
// ponytail: shallow merge only — nested override sections need their own source
export function merge(...sources: Source[]): Source {
  return async () => {
    const parts = await Promise.all(sources.map((source) => source()));
    const objects = parts.filter(
      (part): part is object => part !== null && typeof part === "object"
    );
    if (objects.length === 0) return undefined;
    return Object.assign({}, ...objects);
  };
}

/**
 * Wrap a source so its failure means "nothing" instead of an error — an
 * optional override file 404s, merge() and the source chain fall through.
 */
export function optional(source: Source): Source {
  // async wrapper catches sync throws too, not just rejected promises
  return async () => {
    try {
      return await source();
    } catch {
      return undefined;
    }
  };
}

/** Source: read a global injected into index.html (e.g. window.__APP_CONFIG__). */
export function fromWindow(key: string): Source {
  // indexing globalThis by arbitrary key needs the record shape; TS's
  // globalThis type has no string index signature
  return () => (globalThis as Record<string, unknown>)[key];
}
