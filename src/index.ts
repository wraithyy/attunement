import type { StandardSchemaV1 } from "@standard-schema/spec";

/** A config source. Return raw config, or null/undefined to let the next source try. */
export type Source = () => unknown | Promise<unknown>;

export interface AttuneOptions<S extends StandardSchemaV1> {
  schema: S;
  /** Tried in order; first source yielding a non-nullish value wins. */
  sources: Source[];
  /** Runs after validation, before load() resolves — wire up API base URL, logger, etc. */
  onLoad?: (
    config: StandardSchemaV1.InferOutput<S>
  ) => void | Promise<void>;
}

export interface Attuned<T> {
  /** Cached — every call returns the same promise, fetch fired at attune() time. */
  load: () => Promise<T>;
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

/** @internal freeze the validated config so nothing mutates it after load */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
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
): Attuned<StandardSchemaV1.InferOutput<S>> {
  const promise = (async () => {
    const raw = await resolveSources(options.sources);
    const result = await options.schema["~standard"].validate(raw);

    if (result.issues) {
      throw new ConfigError(formatIssues(result.issues, raw), result.issues);
    }

    const config = deepFreeze(result.value);
    await options.onLoad?.(config);
    return config;
  })();

  // eager start must not surface as unhandledrejection when nobody awaited yet
  promise.catch(() => {});

  return { load: () => promise };
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
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          signal: attemptSignal(timeoutMs, init.signal),
        });
      } catch (error) {
        lastError = error; // network error or timeout — retry
        continue;
      }

      if (response.ok) return response.json();

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

/** Source: read a global injected into index.html (e.g. window.__APP_CONFIG__). */
export function fromWindow(key: string): Source {
  return () => (globalThis as Record<string, unknown>)[key];
}
