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

function formatIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  const lines = issues.map((issue) => {
    const path = issue.path
      ?.map((p) => (typeof p === "object" ? String(p.key) : String(p)))
      .join(".");
    return path ? `  ${path}: ${issue.message}` : `  ${issue.message}`;
  });
  return `Invalid runtime config — you didn't say the magic word:\n${lines.join("\n")}`;
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
      throw new ConfigError(formatIssues(result.issues), result.issues);
    }

    await options.onLoad?.(result.value);
    return result.value;
  })();

  // eager start must not surface as unhandledrejection when nobody awaited yet
  promise.catch(() => {});

  return { load: () => promise };
}

/** Source: fetch a JSON file (e.g. /app-config.json). Non-2xx throws. */
export function fromJson(url: string, init?: RequestInit): Source {
  return async () => {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
    }
    return response.json();
  };
}

/** Source: read a global injected into index.html (e.g. window.__APP_CONFIG__). */
export function fromWindow(key: string): Source {
  return () => (globalThis as Record<string, unknown>)[key];
}
